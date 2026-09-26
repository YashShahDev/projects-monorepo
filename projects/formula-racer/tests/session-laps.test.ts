import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDrivingSession } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { parseTrack } from "../src/content/track.ts";
import { parseEnergyRules } from "../src/content/energy-rules.ts";
import { PHYSICS_VERSION } from "../src/simulation/version.ts";
import { autopilot } from "./support/autopilot.ts";
import { car } from "./support/vehicle.ts";

const track = parseTrack(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8")),
);
const idle = { throttle: false, brake: false, left: false, right: false, deploy: false };
const throttle = { ...idle, throttle: true };

let session: DrivingSession | undefined;
afterEach(() => session?.dispose());

function hold(s: DrivingSession, held: typeof idle, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    s.frame(1 / 60, held);
  }

  return s.state();
}

describe("session laps", () => {
  test("a three-second countdown holds the car on the grid, then timing starts", async () => {
    session = await createDrivingSession(car, track);
    expect(session.state().countdownS).toBeCloseTo(3, 5);
    const during = hold(session, throttle, 2.5);
    expect(during.countdownS).toBeGreaterThan(0);
    expect(Math.abs(during.speedKmh)).toBeLessThan(1);
    expect(during.lap).toBeUndefined();
    const after = hold(session, throttle, 1.5);
    expect(after.countdownS).toBe(0);
    expect(after.speedKmh).toBeGreaterThan(20);
    expect(after.lap?.elapsedS).toBeGreaterThan(0.4);
  });

  test("running wide onto the grass invalidates the lap", async () => {
    session = await createDrivingSession(car, track);
    hold(session, idle, 3);
    let lap = session.state().lap;
    for (let t = 0; t < 9 && lap?.valid !== false; t += 1 / 60) {
      session.frame(1 / 60, throttle);
      lap = session.state().lap;
    }

    expect(lap?.valid).toBe(false);
  });

  test("reset abandons the lap and restarts the countdown", async () => {
    session = await createDrivingSession(car, track);
    hold(session, throttle, 6);
    session.action("reset");
    const state = session.state();
    expect(state.lap).toBeUndefined();
    expect(state.countdownS).toBeCloseTo(3, 5);
  });

  test("changing assists mid-lap restarts on the grid, so no lap mixes assist sets", async () => {
    session = await createDrivingSession(car, track);
    hold(session, idle, 3);
    hold(session, throttle, 3);
    session.setAssists({ steering: true, abs: true, traction: false });
    const state = session.state();
    expect(state.lap).toBeUndefined();
    expect(state.countdownS).toBeCloseTo(3, 5);
    expect(state.assists.traction).toBe(false);
    expect(Math.abs(state.speedKmh)).toBeLessThan(1);
  });

  test("a clean lap is recorded with its physics version, assists and tuning", async () => {
    session = await createDrivingSession(car, track);
    hold(session, idle, 3);
    for (let t = 0; t < 200 && session.state().laps.length === 0; t += 1 / 60) {
      session.frame(1 / 60, autopilot(session));
    }

    const [lap] = session.state().laps;
    expect(lap?.valid).toBe(true);
    expect(lap?.timeS).toBeGreaterThan(60);
    expect(lap?.physicsVersion).toBe(PHYSICS_VERSION);
    expect(lap?.assists).toEqual({ steering: true, abs: true, traction: true });
    expect(lap?.tuned).toBe(false);
  }, 30_000);
});

describe("session energy", () => {
  const rules = parseEnergyRules(
    JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/rules/energy-2026-c18.json"), "utf8")),
  );

  test("E cycles Balanced → Harvest → Balanced", async () => {
    session = await createDrivingSession(car, track, { energy: rules });
    expect(session.state().energy?.mode).toBe("balanced");
    session.action("energyMode");
    expect(session.state().energy?.mode).toBe("harvest");
    session.action("energyMode");
    expect(session.state().energy?.mode).toBe("balanced");
  });

  test("holding Shift deploys more than Balanced", async () => {
    const deployed = async (deploy: boolean) => {
      const s = await createDrivingSession(car, track, { energy: rules });
      hold(s, idle, 3);
      hold(s, { ...throttle, deploy }, 4);
      const used = rules.socWindowJ - (s.state().energy?.socJ ?? 0);
      s.dispose();

      return used;
    };

    expect(await deployed(true)).toBeGreaterThan((await deployed(false)) * 1.3);
  });

  test("crossing the line starts a new Recharge allowance", async () => {
    session = await createDrivingSession(car, track, { energy: rules });
    hold(session, idle, 3);
    let before = 0;
    for (let t = 0; t < 200 && session.state().laps.length === 0; t += 1 / 60) {
      before = session.state().energy?.lapRechargeJ ?? 0;
      session.frame(1 / 60, autopilot(session));
    }

    expect(before).toBeGreaterThan(1_000_000);
    expect(session.state().energy?.lapRechargeJ ?? 0).toBeLessThan(200_000);
  }, 30_000);
});
