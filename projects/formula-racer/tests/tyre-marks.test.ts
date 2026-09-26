import { expect, test } from "bun:test";
import { createMarkRecorder, MAX_LAP_MARKS, MAX_MARKS } from "../src/simulation/tyre-marks.ts";
import type { MarkWheel } from "../src/simulation/tyre-marks.ts";

const still: MarkWheel = { slip: "none", contact: { x: 0, y: 0, z: 0 } };
const at = (x: number, z = 0, slip: MarkWheel["slip"] = "locked"): MarkWheel => ({ slip, contact: { x, y: 0, z } });

/** One wheel doing `wheel`, the other three rolling cleanly. */
const oneWheel = (wheel: MarkWheel) => [wheel, still, still, still];

test("rolling tyres leave nothing", () => {
  const marks = createMarkRecorder();
  for (let i = 0; i < 100; i += 1) {
    marks.step([still, still, still, still], i / 60, i / 60);
  }

  expect(marks.since(0).marks).toEqual([]);
});

test("a slipping tyre lays one joined trail of short segments", () => {
  const marks = createMarkRecorder();
  for (let i = 0; i <= 40; i += 1) {
    marks.step(oneWheel(at(i * 0.25)), i / 60, i / 60);
  }

  const trail = marks.since(0).marks;

  // 10 m in steps of 0.25 m, joined every 0.5 m.
  expect(trail).toHaveLength(20);
  expect(trail[0]).toMatchObject({ ax: 0, bx: 0.5 });
  for (let k = 1; k < trail.length; k += 1) {
    expect(trail[k]?.ax).toBe(trail[k - 1]?.bx ?? Number.NaN);
  }
});

test("a trail ends when the tyre grips again or the car jumps, and does not bridge the gap", () => {
  const marks = createMarkRecorder();
  const path = [at(0), at(1), at(2), still, at(3), at(4), at(40), at(41)];
  path.forEach((wheel, i) => {
    marks.step(oneWheel(wheel), i, i);
  });
  expect(marks.since(0).marks.map((m) => [m.ax, m.bx])).toEqual([
    [0, 1],
    [1, 2],
    [3, 4],
    [40, 41],
  ]);
});

test("each wheel keeps its own trail, and a wheel in the air breaks it", () => {
  const marks = createMarkRecorder();
  const air: MarkWheel = { slip: "none", contact: undefined };
  marks.step([at(0), at(0, 2, "spinning"), still, still], 0, 0);
  marks.step([at(1), at(1, 2, "spinning"), still, still], 1, 1);
  marks.step([air, at(2, 2, "sliding"), still, still], 2, 2);
  marks.step([at(3), at(3, 2, "sliding"), still, still], 3, 3);
  const trails = marks.since(0).marks.map((m) => [m.ax, m.az, m.bx]);
  expect(trails).toEqual([
    [0, 0, 1],
    [0, 2, 1],
    [1, 2, 2],
    [2, 2, 3],
  ]);
});

test("keeps the newest marks within its bound, and reports what is new since a serial", () => {
  const marks = createMarkRecorder();
  const total = MAX_MARKS + 250;
  for (let i = 0; i <= total; i += 1) {
    marks.step(oneWheel(at(i)), i, i);
  }

  const all = marks.since(0);
  expect(all.serial).toBe(total);
  expect(all.marks).toHaveLength(MAX_MARKS);
  expect(all.marks[0]?.ax).toBe(250);
  expect(all.marks.at(-1)?.bx).toBe(total);

  const recent = marks.since(total - 3);
  expect(recent.marks.map((m) => m.ax)).toEqual([total - 3, total - 2, total - 1]);
  expect(marks.since(total).marks).toEqual([]);
});

test("marks are timed by the session clock, and the lap's marks by the lap clock", () => {
  const marks = createMarkRecorder();
  marks.step(oneWheel(at(0)), 100, undefined);
  marks.step(oneWheel(at(1)), 101, undefined);
  marks.step(oneWheel(at(2)), 102, 0.5);
  marks.step(oneWheel(at(3)), 103, 1.5);
  expect(marks.since(0).marks.map((m) => m.timeS)).toEqual([101, 102, 103]);

  // Only marks laid while a lap was timed belong to it, and taking them starts afresh.
  expect(marks.takeLap().map((m) => [m.ax, m.timeS])).toEqual([
    [1, 0.5],
    [2, 1.5],
  ]);
  expect(marks.takeLap()).toEqual([]);
});

test("a lap keeps at most its bound of marks, the first ones laid", () => {
  const marks = createMarkRecorder();
  for (let i = 0; i <= MAX_LAP_MARKS + 50; i += 1) {
    marks.step(oneWheel(at(i)), i, i);
  }

  const lap = marks.takeLap();
  expect(lap).toHaveLength(MAX_LAP_MARKS);
  expect(lap[0]?.ax).toBe(0);
});

test("lifting ends every trail, as after a reset", () => {
  const marks = createMarkRecorder();
  marks.step(oneWheel(at(0)), 0, 0);
  marks.lift();
  marks.step(oneWheel(at(1)), 1, 1);
  marks.step(oneWheel(at(2)), 2, 2);
  expect(marks.since(0).marks.map((m) => [m.ax, m.bx])).toEqual([[1, 2]]);
});
