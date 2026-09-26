/**
 * A minimal client for the control server (docs/CONTROL.md). It starts the server,
 * drives one lap of Harbour Park by steering onto the centreline and slowing for the
 * curvature ahead, and prints the lap. Run with `bun run examples/control-client.ts`.
 */
import { resolve } from "node:path";

interface Observation {
  speedMps: number;
  track: { lateralM: number; headingErrorRad: number; ahead: { spacingM: number; curvature: number[] } };
}

interface Reply {
  type: "observation" | "error" | "closed";
  error?: string;
  observation?: Observation;
  events?: { type: string; timeS?: number }[];
  done?: boolean;
}

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));

// Replies are trusted to match docs/CONTROL.md; a real client would check more of them.
const isReply = (value: unknown): value is Reply =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

/** Steer back to the centreline, and hold a speed the next stretch's tightest bend allows. */
function decide(o: Observation) {
  const { lateralM, headingErrorRad, ahead } = o.track;

  // Steer +1 is full right. Positive lateral and heading error both mean "to the left".
  const aimError = headingErrorRad - (ahead.curvature[1] ?? 0) * ahead.spacingM;
  const steer = clamp(2 * aimError + 0.15 * lateralM, -1, 1);

  const lookSamples = Math.ceil(Math.max(40, o.speedMps * 2.5) / ahead.spacingM);
  const tightest = Math.max(1e-4, ...ahead.curvature.slice(0, lookSamples).map(Math.abs));
  const target = Math.sqrt(9.81 / tightest);

  return {
    throttle: o.speedMps < target * 0.95 ? 1 : 0,
    brake: o.speedMps > target * 1.05 ? 1 : 0,
    steer,
  };
}

/** Drives one lap through a fresh server; resolves with the lap time and every event seen. */
export async function driveALap(track = "harbour") {
  const server = Bun.spawn(["bun", "run", resolve(import.meta.dirname, "../tools/sim-server.ts")], {
    stdin: "pipe",
    stdout: "pipe",
  });
  const lines = server.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  const send = async (message: object): Promise<Reply> => {
    await server.stdin.write(`${JSON.stringify(message)}\n`);
    await server.stdin.flush();
    while (!buffered.includes("\n")) {
      const { value, done } = await lines.read();
      if (done) {
        throw new Error("the server closed");
      }

      buffered += value;
    }

    const cut = buffered.indexOf("\n");
    const line = buffered.slice(0, cut);
    buffered = buffered.slice(cut + 1);

    const reply: unknown = JSON.parse(line);
    if (!isReply(reply)) {
      throw new Error(`not a reply: ${line}`);
    }

    return reply;
  };

  const events: string[] = [];
  let reply = await send({ type: "reset", track, seed: 1, maxLaps: 1 });
  let lapS: number | undefined;
  while (reply.type === "observation" && reply.done !== true && reply.observation) {
    reply = await send({ type: "step", ...decide(reply.observation), steps: 3 });
    for (const event of reply.events ?? []) {
      events.push(event.type);
      lapS = event.type === "lap" ? event.timeS : lapS;
    }
  }

  if (reply.type === "error") {
    throw new Error(reply.error);
  }

  await send({ type: "close" });
  await server.exited;

  return { lapS, events };
}

if (import.meta.main) {
  const { lapS, events } = await driveALap();
  console.log(`lap: ${lapS?.toFixed(3) ?? "none"} s; events: ${events.join(", ")}`);
}
