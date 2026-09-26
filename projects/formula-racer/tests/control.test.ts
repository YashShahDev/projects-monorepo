import { afterEach, describe, expect, test } from "bun:test";
import { createControlEnvironment } from "../src/control/environment.ts";
import type { ControlEnvironment, ControlReply } from "../src/control/environment.ts";
import { AHEAD_SAMPLES } from "../src/control/link.ts";
import { CONTROL_VERSION } from "../src/control/protocol.ts";
import { fileSessions } from "../tools/control-sources.ts";

const sources = fileSessions();
let environments: ControlEnvironment[] = [];
afterEach(() => {
  for (const environment of environments) {
    environment.close();
  }

  environments = [];
});

const open = () => {
  const environment = createControlEnvironment(sources);
  environments.push(environment);

  return environment;
};

function observation(reply: ControlReply) {
  if (reply.type !== "observation") {
    throw new Error(`expected an observation, got ${JSON.stringify(reply)}`);
  }

  return reply;
}

describe("control environment", () => {
  test("reset starts an episode at the green light", async () => {
    const reply = observation(await open().handle({ type: "reset", track: "harbour", seed: 7 }));
    expect(reply.controlVersion).toBe(CONTROL_VERSION);
    expect(reply.seed).toBe(7);
    expect(reply.events).toEqual([{ type: "reset" }]);
    expect(reply.done).toBe(false);
    const o = reply.observation;
    expect(o.simSeconds).toBe(0);
    expect(o.lap).toMatchObject({ completed: 0, elapsedS: 0, sector: 1, valid: true });
    expect(Math.abs(o.speedMps)).toBeLessThan(0.5);
    expect(o.track.id).toBe("harbour");
    expect(Math.abs(o.track.lateralM)).toBeLessThan(1);
    expect(Math.abs(o.track.headingErrorRad)).toBeLessThan(0.05);
    expect(o.track.ahead.curvature).toHaveLength(AHEAD_SAMPLES);
    expect(o.track.ahead.leftBarrierM).toHaveLength(AHEAD_SAMPLES);
    expect(o.wheels.map((wheel) => wheel.surface)).toEqual(["road", "road", "road", "road"]);
    expect(o.energy?.mode).toBe("balanced");
  });

  test("the same reset and actions give the same observations", async () => {
    const run = async () => {
      const environment = open();
      const replies = [await environment.handle({ type: "reset", track: "harbour", seed: 3 })];
      for (let k = 0; k < 40; k += 1) {
        const steer = Math.sin(k / 5) * 0.3;
        replies.push(await environment.handle({ type: "step", throttle: 1, brake: 0, steer, steps: 5 }));
      }

      return replies;
    };

    const [first, second] = [await run(), await run()];
    expect(second).toEqual(first);
    const end = first.at(-1);
    expect(end && observation(end).observation.speedMps).toBeGreaterThan(30);
  });

  test("a step message advances the number of steps it asks for", async () => {
    const environment = open();
    await environment.handle({ type: "reset" });
    const reply = observation(await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0, steps: 90 }));

    // Rapier's timestep is a 32-bit float, so the clock is exact to about 1e-7.
    expect(reply.observation.simSeconds).toBeCloseTo(1.5, 6);
    expect(reply.observation.lap.elapsedS ?? 0).toBeCloseTo(1.5, 1);
    expect(reply.observation.speedMps).toBeGreaterThan(10);
  });

  test("malformed messages get an error reply and the episode carries on", async () => {
    const environment = open();
    expect(await environment.handle({ type: "step", throttle: 0, brake: 0, steer: 0 })).toMatchObject({
      type: "error",
      error: "send reset before step",
    });
    await environment.handle({ type: "reset" });
    const bad: unknown[] = [
      null,
      "step",
      [1, 2],
      { type: "fly" },
      { type: "step", throttle: 2, brake: 0, steer: 0 },
      { type: "step", throttle: 1, brake: 0 },
      { type: "step", throttle: 1, brake: 0, steer: Number.NaN },
      { type: "step", throttle: 1, brake: 0, steer: 0, steps: 0 },
      { type: "step", throttle: 1, brake: 0, steer: 0, steps: 1.5 },
      { type: "step", throttle: 1, brake: 0, steer: 0, shift: "sideways" },
      { type: "reset", track: "atlantis" },
      { type: "reset", gearbox: "sequential" },
      { type: "reset", assists: { abs: "yes" } },
      { type: "reset", maxLaps: 0 },
    ];
    for (const message of bad) {
      const reply = await environment.handle(message);
      expect(reply.type).toBe("error");
    }

    const reply = observation(await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0, steps: 60 }));
    expect(reply.observation.speedMps).toBeGreaterThan(5);
  });

  test("an episode ends at its time limit, and only reset starts another", async () => {
    const environment = open();
    await environment.handle({ type: "reset", maxSeconds: 2 });
    const last = observation(await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0, steps: 600 }));
    expect(last.done).toBe(true);
    expect(last.observation.simSeconds).toBeCloseTo(2, 6);
    expect(await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0 })).toMatchObject({
      type: "error",
    });
    expect(observation(await environment.handle({ type: "reset" })).done).toBe(false);
  });

  test("leaving the track and coming back are events", async () => {
    const environment = open();
    await environment.handle({ type: "reset", track: "harbour" });
    const events: string[] = [];
    await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0, steps: 120 });
    for (let k = 0; k < 60 && !events.includes("offTrack"); k += 1) {
      const reply = observation(
        await environment.handle({ type: "step", throttle: 0.5, brake: 0, steer: -1, steps: 5 }),
      );
      events.push(...reply.events.map((event) => event.type));
    }

    expect(events).toContain("offTrack");
  });

  test("the car's settings come from reset", async () => {
    const environment = open();
    const reply = observation(
      await environment.handle({
        type: "reset",
        gearbox: "manual",
        energyMode: "attack",
        assists: { abs: false },
      }),
    );
    expect(reply.observation.energy?.mode).toBe("attack");
    const moved = observation(
      await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0, shift: "up", steps: 30 }),
    );
    expect(moved.observation.gear).toBe(2);
  });

  test("close ends the environment", async () => {
    const environment = open();
    await environment.handle({ type: "reset" });
    expect(await environment.handle({ type: "close" })).toEqual({ type: "closed", controlVersion: CONTROL_VERSION });
    expect((await environment.handle({ type: "reset" })).type).toBe("error");
  });
});
