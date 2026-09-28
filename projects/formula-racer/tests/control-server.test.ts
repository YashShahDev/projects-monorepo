import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { driveALap } from "../examples/control-client.ts";

const server = resolve(import.meta.dirname, "../tools/sim-server.ts");

test("the server answers each line in order, errors included, and exits on close", async () => {
  const lines = [
    "not json",
    JSON.stringify({ type: "step", throttle: 1, brake: 0, steer: 0 }),
    JSON.stringify({ type: "reset", track: "test-loop" }),
    JSON.stringify({ type: "step", throttle: 1, brake: 0, steer: 0, steps: 60 }),
    JSON.stringify({ type: "close" }),
    JSON.stringify({ type: "reset" }),
  ];
  const child = Bun.spawn(["bun", "run", server], { stdin: new Blob([`${lines.join("\n")}\n`]), stdout: "pipe" });
  const replies = (await new Response(child.stdout).text())
    .trim()
    .split("\n")
    .map((line): { type?: unknown; error?: unknown } => {
      const reply: unknown = JSON.parse(line);

      return typeof reply === "object" && reply !== null ? reply : {};
    });
  expect(await child.exited).toBe(0);

  // Nothing after close is answered.
  expect(replies.map((reply) => reply.type)).toEqual(["error", "error", "observation", "observation", "closed"]);
  expect(replies[0]?.error).toBe("a message must be one line of JSON");
  expect(replies[1]?.error).toBe("send reset before step");
});

test("the documented example client drives a lap through the server", async () => {
  const { lapS, events } = await driveALap("harbour");
  expect(lapS ?? 0).toBeGreaterThan(60);
  expect(lapS ?? Infinity).toBeLessThan(200);
  expect(events).toEqual(["sector", "sector", "lap"]);
}, 60_000);
