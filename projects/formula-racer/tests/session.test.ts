import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDrivingSession } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { parseTrack } from "../src/content/track.ts";
import { car } from "./support/vehicle.ts";

const track = parseTrack(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8")),
);
const idle = { throttle: false, brake: false, left: false, right: false, deploy: false };
const throttle = { ...idle, throttle: true };

let session: DrivingSession | undefined;
afterEach(() => session?.dispose());

async function start() {
  session = await createDrivingSession(car, track);

  return session;
}

/** Waits out the standing-start countdown, during which the car is held. */
function ready(s: DrivingSession) {
  const wait = s.state().countdownS;
  for (let t = 0; t < wait - 1e-9; t += 1 / 60) {
    s.frame(1 / 60, idle);
  }

  return s;
}

function drive(s: DrivingSession, held: typeof idle, seconds: number, hz = 60) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / hz) {
    s.frame(1 / hz, held);
  }

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
    const s = ready(await start());
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

  test("the cockpit camera uses the model's anchor", async () => {
    session = await createDrivingSession(car, track, {
      cameraAnchors: { chase: { x: 0, y: 0.5, z: 0 }, cockpit: { x: 0, y: 3, z: 0 } },
    });
    session.action("camera");
    const { car: pose, camera } = session.frame(0, {
      throttle: false,
      brake: false,
      left: false,
      right: false,
      deploy: false,
    });
    expect(camera.position.y).toBeCloseTo(pose.position.y + 3, 1);
  });

  test("C switches camera", async () => {
    const s = await start();
    s.action("camera");
    expect(s.state().camera).toBe("cockpit");
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

  // Codex P2 review: the car was drawn from the pre-step snapshot with the post-step
  // camera, and whole 60 Hz steps judder at 144 Hz.
  async function atSpeed() {
    const s = await start();
    drive(s, throttle, 8);

    return s;
  }

  test("each frame's camera follows the car pose drawn in that frame", async () => {
    const s = await atSpeed();
    for (let i = 0; i < 30; i += 1) {
      const { car, camera } = s.frame(1 / 144, throttle);
      const gap = Math.hypot(camera.position.x - car.position.x, camera.position.z - car.position.z);
      expect(gap).toBeCloseTo(6, 1);
    }
  });

  test("the drawn car moves smoothly at 144 Hz between 60 Hz simulation steps", async () => {
    const s = await atSpeed();
    let last = s.frame(1 / 144, throttle).car.position;
    const moves: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const { position } = s.frame(1 / 144, throttle).car;
      moves.push(Math.hypot(position.x - last.x, position.z - last.z));
      last = position;
    }

    expect(Math.min(...moves)).toBeGreaterThan(0);
    expect(Math.max(...moves) / Math.min(...moves)).toBeLessThan(1.3);
  });
});
