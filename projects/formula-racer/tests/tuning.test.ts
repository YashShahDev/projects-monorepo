import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDrivingSession } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { parseTrack } from "../src/content/track.ts";
import { car } from "./support/vehicle.ts";

const track = parseTrack(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"),
  ),
);
const throttle = { throttle: true, brake: false, left: false, right: false };

let session: DrivingSession | undefined;
afterEach(() => session?.dispose());

function speedAfter(s: DrivingSession, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) s.frame(1 / 60, throttle);
  return s.state().speedKmh;
}

describe("development tuning", () => {
  test("a structural change waits for the next reset", async () => {
    session = await createDrivingSession(car, track);
    const stock = speedAfter(session, 1);
    session.action("reset");
    session.retune({ massKg: car.massKg * 2 });
    expect(session.state().pendingTuning).toBe(true);
    // Still the stock car until the player resets.
    expect(speedAfter(session, 1)).toBeCloseTo(stock, 0);
    session.action("reset");
    expect(session.state().pendingTuning).toBe(false);
    expect(session.state().tuned).toBe(true);
    expect(speedAfter(session, 1)).toBeLessThan(stock * 0.8);
  });

  test("an invalid value is rejected by name and leaves the car alone", async () => {
    session = await createDrivingSession(car, track);
    expect(() => session?.retune({ massKg: -5 })).toThrow("car.massKg must be positive");
    expect(session.state().pendingTuning).toBe(false);
    expect(session.state().tuned).toBe(false);
  });

  test("nested values can be tuned", async () => {
    session = await createDrivingSession(car, track);
    session.retune({ aero: { ...car.aero, dragAreaM2: 3 } });
    session.action("reset");
    expect(session.car().aero.dragAreaM2).toBe(3);
  });

  test("tuning back to stock clears the tuned flag", async () => {
    session = await createDrivingSession(car, track);
    session.retune({ massKg: 900 });
    session.action("reset");
    session.retune({ massKg: car.massKg });
    session.action("reset");
    expect(session.state().tuned).toBe(false);
  });
});
