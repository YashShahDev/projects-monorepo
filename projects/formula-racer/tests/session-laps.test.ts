import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDrivingSession } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { parseTrack } from "../src/content/track.ts";
import { PHYSICS_VERSION } from "../src/simulation/version.ts";
import { autopilot } from "./support/autopilot.ts";
import { car } from "./support/vehicle.ts";

const track = parseTrack(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"),
  ),
);
const idle = { throttle: false, brake: false, left: false, right: false };
const throttle = { ...idle, throttle: true };

let session: DrivingSession | undefined;
afterEach(() => session?.dispose());

function hold(s: DrivingSession, held: typeof idle, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) s.frame(1 / 60, held);
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
