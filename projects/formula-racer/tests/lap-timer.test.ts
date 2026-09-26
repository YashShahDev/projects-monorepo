import { describe, expect, test } from "bun:test";
import { createLapTimer } from "../src/simulation/lap-timer.ts";

const LENGTH = 3000;
const DT = 1 / 60;

/** Drives the timer at a steady speed, returning the time reached. */
function drive(
  timer: ReturnType<typeof createLapTimer>,
  from: { t: number; d: number },
  metres: number,
  speed = 50,
  onTrack = true,
) {
  let { t, d } = from;
  const steps = Math.round(Math.abs(metres) / (speed * DT));
  const sign = Math.sign(metres);
  for (let i = 0; i < steps; i += 1) {
    t += DT;
    d = (((d + sign * speed * DT) % LENGTH) + LENGTH) % LENGTH;
    timer.update(t, d, onTrack);
  }
  return { t, d };
}

function start(startDistanceM = 100) {
  const timer = createLapTimer({ lengthM: LENGTH, sectors: 3 });
  timer.start(0, startDistanceM);
  return { timer, at: { t: 0, d: startDistanceM } };
}

describe("lap timer", () => {
  test("a full forward lap is timed from the line, interpolated within the step", () => {
    const { timer, at } = start();
    drive(timer, at, LENGTH + 10);
    const [lap] = timer.laps();
    // 3000 m at 50 m/s is exactly 60 s, however the steps fall.
    expect(lap?.timeS).toBeCloseTo(60, 6);
    expect(lap?.valid).toBe(true);
    expect(lap?.sectorsS.map((s) => Math.round(s * 1000) / 1000)).toEqual([20, 20, 20]);
  });

  test("backing over the line does not count, and the lap must still be driven in full", () => {
    const { timer, at } = start();
    const back = drive(timer, at, -30);
    const forward = drive(timer, back, LENGTH);
    expect(timer.laps()).toHaveLength(0);
    drive(timer, forward, 40);
    expect(timer.laps()).toHaveLength(1);
  });

  test("a shortcut invalidates the lap, which still ends at the real start line", () => {
    const { timer, at } = start();
    const before = drive(timer, at, 500);
    // The nearest centreline point jumps 800 m ahead: the car cut across the infield.
    const t = before.t + DT;
    const d = before.d + 800;
    timer.update(t, d, false);
    drive(timer, { t, d }, LENGTH - 500 - 800 + 10);
    const [lap] = timer.laps();
    expect(lap?.valid).toBe(false);
  });

  test("after a shortcut, the next lap is timed from the real start line", () => {
    // Codex P3 review: skipped distance used to displace every later lap boundary.
    const { timer, at } = start(100);
    const before = drive(timer, at, 500);
    const t = before.t + DT;
    timer.update(t, before.d + 800, false);
    const line = drive(timer, { t, d: before.d + 800 }, LENGTH - 1300);
    expect(timer.laps()).toHaveLength(1);
    // A full clean lap from the line closes back at the line after 60 s.
    drive(timer, line, LENGTH + 5);
    const [, clean] = timer.laps();
    expect(clean?.valid).toBe(true);
    expect(clean?.timeS).toBeCloseTo(60, 3);
  });

  test("leaving the track invalidates the lap but it is still timed; the next is clean", () => {
    const { timer, at } = start();
    const off = drive(timer, at, 200, 50, false);
    const lap1 = drive(timer, off, LENGTH - 200 + 5);
    drive(timer, lap1, LENGTH);
    const [first, second] = timer.laps();
    expect(first?.valid).toBe(false);
    expect(first?.timeS).toBeCloseTo(60, 3);
    expect(second?.valid).toBe(true);
  });

  test("abort discards the lap in progress", () => {
    const { timer, at } = start();
    drive(timer, at, 2000);
    timer.abort();
    expect(timer.current()).toBeUndefined();
    timer.start(100, 100);
    drive(timer, { t: 100, d: 100 }, LENGTH + 1);
    expect(timer.laps()).toHaveLength(1);
    expect(timer.laps()[0]?.timeS).toBeCloseTo(60, 3);
  });

  test("reports the current lap's elapsed time and sector", () => {
    const { timer, at } = start();
    drive(timer, at, 1100);
    const current = timer.current();
    expect(current?.elapsedS).toBeCloseTo(22, 1);
    expect(current?.sector).toBe(2);
    expect(current?.valid).toBe(true);
  });
});
