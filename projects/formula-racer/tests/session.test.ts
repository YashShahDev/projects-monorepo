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
const idle = { throttle: false, brake: false, left: false, right: false };
const throttle = { ...idle, throttle: true };

let session: DrivingSession | undefined;
afterEach(() => session?.dispose());

async function start() {
  session = await createDrivingSession(car, track);
  return session;
}

function drive(s: DrivingSession, held: typeof idle, seconds: number, hz = 60) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / hz) s.frame(1 / hz, held);
  return s.state();
}

describe("driving session", () => {
  test("starts on the road at the track's start line, stopped in first gear", async () => {
    const s = await start();
    const state = s.state();
    expect(state.surface).toBe("road");
    expect(state.lapDistanceM).toBeCloseTo(track.startDistanceM, -1);
    expect(state.gear).toBe(1);
    expect(Math.abs(state.speedKmh)).toBeLessThan(1);
  });

  test("holding throttle drives forward along the lap and up the gears", async () => {
    const s = await start();
    const state = drive(s, throttle, 4);
    expect(state.speedKmh).toBeGreaterThan(120);
    expect(state.gear).toBeGreaterThan(2);
    expect(state.lapDistanceM).toBeGreaterThan(track.startDistanceM + 50);
  });

  test("Escape pauses and resumes; paused frames do not move the car", async () => {
    const s = await start();
    drive(s, throttle, 1);
    s.action("pause");
    const before = s.state();
    const after = drive(s, throttle, 1);
    expect(after.paused).toBe(true);
    expect(after.simSeconds).toBe(before.simSeconds);
    s.action("pause");
    expect(drive(s, throttle, 0.5).simSeconds).toBeGreaterThan(before.simSeconds);
  });

  test("the long frame gap after resuming does not fast-forward the car", async () => {
    const s = await start();
    drive(s, throttle, 1);
    s.action("pause");
    const before = s.state().simSeconds;
    s.action("pause");
    // The browser's frame clock reports the whole paused time on the first frame back.
    s.frame(30, throttle);
    expect(s.state().simSeconds - before).toBeLessThan(0.02);
  });

  test("losing focus pauses until the player resumes", async () => {
    const s = await start();
    s.focusLost();
    expect(drive(s, throttle, 0.5).paused).toBe(true);
  });

  test("R puts the car back on the start line at rest", async () => {
    const s = await start();
    drive(s, { ...throttle, right: true }, 3);
    s.action("reset");
    const state = drive(s, idle, 0.5);
    expect(state.lapDistanceM).toBeCloseTo(track.startDistanceM, -1);
    expect(Math.abs(state.speedKmh)).toBeLessThan(2);
    expect(state.gear).toBe(1);
  });

  test("C switches camera", async () => {
    const s = await start();
    s.action("camera");
    expect(s.state().camera).toBe("nose");
  });

  test("render rate does not change where the car ends up", async () => {
    const at = async (hz: number) => {
      const s = await createDrivingSession(car, track);
      const state = drive(s, throttle, 2, hz);
      s.dispose();
      return state.lapDistanceM;
    };
    expect(await at(30)).toBe(await at(144));
  });
});
