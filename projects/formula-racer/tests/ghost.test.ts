import { describe, expect, test } from "bun:test";
import {
  createGhostRecorder,
  decodeGhost,
  encodeGhost,
  ghostDelta,
  ghostPoseAt,
  MAX_GHOST_SAMPLES,
} from "../src/simulation/ghost.ts";
import type { Ghost } from "../src/simulation/ghost.ts";
import { MAX_LAP_MARKS } from "../src/simulation/tyre-marks.ts";
import type { TyreMark } from "../src/simulation/tyre-marks.ts";

/** A car driving along +z at `speed`, sampled every `dt`, for a lap of `length` metres. */
function straightLap(speed: number, dt: number, length = 300, marks: TyreMark[] = []): Ghost {
  const recorder = createGhostRecorder();
  recorder.begin({ timeS: 0, x: 0, z: 0, heading: 0, progressM: 0 });
  let t = 0;
  for (; (t + dt) * speed < length; t += dt) {
    recorder.sample({ timeS: t + dt, x: 0, z: (t + dt) * speed, heading: 0, progressM: (t + dt) * speed });
  }

  const lapTime = length / speed;

  return recorder.finish({ timeS: lapTime, x: 0, z: length, heading: 0, progressM: length }, marks);
}

describe("recording", () => {
  test("keeps ten samples a second, plus exact samples at both ends of the lap", () => {
    const ghost = straightLap(30, 1 / 60);
    expect(ghost.lapTimeS).toBeCloseTo(10, 9);
    expect(ghost.timeS[0]).toBe(0);
    expect(ghost.timeS.at(-1)).toBeCloseTo(10, 5);
    expect(ghost.timeS.length).toBeGreaterThanOrEqual(100);
    expect(ghost.timeS.length).toBeLessThanOrEqual(102);
  });

  test("records the same lap whether the steps come at 60 or 120 Hz", () => {
    const a = straightLap(30, 1 / 60);
    const b = straightLap(30, 1 / 120);
    for (const t of [0.5, 3.33, 7.9]) {
      expect(ghostPoseAt(a, t).z).toBeCloseTo(ghostPoseAt(b, t).z, 1);
    }
  });

  test("progress only counts new ground: reversing never takes it back", () => {
    const recorder = createGhostRecorder();
    recorder.begin({ timeS: 0, x: 0, z: 0, heading: 0, progressM: 0 });
    const path = [10, 20, 15, 5, 12, 25, 40];
    path.forEach((p, i) => {
      recorder.sample({ timeS: (i + 1) * 0.1, x: 0, z: p, heading: 0, progressM: p });
    });
    const ghost = recorder.finish({ timeS: 0.8, x: 0, z: 50, heading: 0, progressM: 50 });
    for (let i = 1; i < ghost.progressM.length; i += 1) {
      expect(ghost.progressM[i] ?? 0).toBeGreaterThanOrEqual(ghost.progressM[i - 1] ?? 0);
    }
  });

  test("stops keeping samples past the cap", () => {
    const recorder = createGhostRecorder();
    recorder.begin({ timeS: 0, x: 0, z: 0, heading: 0, progressM: 0 });
    for (let i = 1; i < 5000; i += 1) {
      recorder.sample({ timeS: i * 0.1, x: 0, z: i, heading: 0, progressM: i });
    }

    expect(
      recorder.finish({ timeS: 500, x: 0, z: 5000, heading: 0, progressM: 5000 }).timeS.length,
    ).toBeLessThanOrEqual(MAX_GHOST_SAMPLES);
  });
});

describe("playback", () => {
  test("interpolates the ghost's pose between samples, turning the short way round", () => {
    const recorder = createGhostRecorder();
    recorder.begin({ timeS: 0, x: 0, z: 0, heading: Math.PI - 0.1, progressM: 0 });
    const ghost = recorder.finish({ timeS: 1, x: 10, z: 20, heading: -Math.PI + 0.1, progressM: 22 });
    const mid = ghostPoseAt(ghost, 0.5);
    expect(mid.x).toBeCloseTo(5, 6);
    expect(mid.z).toBeCloseTo(10, 6);
    expect(Math.abs(Math.abs(mid.heading) - Math.PI)).toBeLessThan(1e-6);

    // Outside the lap it holds the end poses.
    expect(ghostPoseAt(ghost, -1).x).toBe(0);
    expect(ghostPoseAt(ghost, 5).x).toBe(10);
  });

  test("the delta is positive when the car is behind the ghost and negative when ahead", () => {
    const ghost = straightLap(30, 1 / 60);

    // The ghost reached 150 m at 5 s.
    expect(ghostDelta(ghost, 5.5, 150)).toBeCloseTo(0.5, 2);
    expect(ghostDelta(ghost, 4.6, 150)).toBeCloseTo(-0.4, 2);
  });
});

describe("storage format", () => {
  test("round-trips through a compact string", () => {
    const ghost = straightLap(30, 1 / 60);
    const text = encodeGhost(ghost);

    // About 18 bytes a sample, as base64.
    expect(text.length).toBeLessThan(ghost.timeS.length * 18 * 1.4 + 64);
    const back = decodeGhost(text);
    expect(back?.lapTimeS).toBeCloseTo(ghost.lapTimeS, 2);
    expect(back?.timeS.length).toBe(ghost.timeS.length);
    for (const t of [0, 2.5, 9.99]) {
      expect(ghostPoseAt(back ?? ghost, t).z).toBeCloseTo(ghostPoseAt(ghost, t).z, 1);
    }
  });

  test("rejects anything malformed, oversized or from another format version", () => {
    expect(decodeGhost("not base64 at all!")).toBeUndefined();
    expect(decodeGhost("")).toBeUndefined();
    const text = encodeGhost(straightLap(30, 1 / 60));
    expect(decodeGhost(`9${text.slice(1)}`)).toBeUndefined();
    expect(decodeGhost(text.slice(0, text.length / 2))).toBeUndefined();
    const huge = createGhostRecorder();
    huge.begin({ timeS: 0, x: 0, z: 0, heading: 0, progressM: 0 });
    for (let i = 1; i < 1400; i += 1) {
      huge.sample({ timeS: i * 0.1, x: 0, z: i, heading: 0, progressM: i });
    }

    // Laps over the time cap are not stored.
    expect(
      decodeGhost(encodeGhost(huge.finish({ timeS: 160, x: 0, z: 1400, heading: 0, progressM: 1400 }))),
    ).toBeUndefined();
  });

  test("carries the lap's tyre marks, to float and centisecond precision", () => {
    const marks = [
      { ax: 1.1, az: 20.2, bx: 1.3, bz: 20.9, timeS: 0.67 },
      { ax: -4, az: 100, bx: -4.2, bz: 100.6, timeS: 3.334 },
    ];
    const ghost = straightLap(30, 1 / 60, 300, marks);
    expect(ghost.marks).toEqual(marks);
    const back = decodeGhost(encodeGhost(ghost));
    expect(back?.marks).toHaveLength(2);
    expect(back?.marks[1]?.bz).toBeCloseTo(100.6, 4);
    expect(back?.marks[1]?.timeS).toBe(3.33);
  });

  test("still reads ghosts saved before marks were kept", () => {
    const text = encodeGhost(straightLap(30, 1 / 60));

    // The older format is the same without the trailing mark count.
    const legacy = `1${btoa(atob(text.slice(1)).slice(0, -2))}`;
    const back = decodeGhost(legacy);
    expect(back?.timeS.length).toBe(straightLap(30, 1 / 60).timeS.length);
    expect(back?.marks).toEqual([]);
  });

  test("rejects a lap with more marks than a lap keeps", () => {
    const mark = { ax: 0, az: 0, bx: 0, bz: 1, timeS: 1 };
    const text = encodeGhost(
      straightLap(
        30,
        1 / 60,
        300,
        Array.from({ length: MAX_LAP_MARKS + 1 }, () => mark),
      ),
    );
    expect(decodeGhost(text)).toBeUndefined();
  });
});
