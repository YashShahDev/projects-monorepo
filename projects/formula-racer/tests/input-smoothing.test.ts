import { describe, expect, test } from "bun:test";
import { createInputSmoother } from "../src/simulation/input-smoothing.ts";
import type { DigitalInput } from "../src/simulation/input-smoothing.ts";

const DT = 1 / 60;
const idle: DigitalInput = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  deploy: false,
};
const kmh = (v: number) => v / 3.6;

function hold(input: DigitalInput, seconds: number, speedMps = 0) {
  const smoother = createInputSmoother();
  let controls = smoother.update(idle, speedMps, DT);
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    controls = smoother.update(input, speedMps, DT);
  }

  return { smoother, controls };
}

describe("keyboard input smoothing", () => {
  test("steering ramps in instead of snapping to full lock", () => {
    expect(hold({ ...idle, right: true }, DT).controls.steer).toBeLessThan(0.2);
    expect(hold({ ...idle, right: true }, 0.4).controls.steer).toBeCloseTo(1, 5);
    expect(hold({ ...idle, left: true }, 0.4).controls.steer).toBeCloseTo(-1, 5);
  });

  test("letting go re-centres faster than steering in", () => {
    const { smoother } = hold({ ...idle, right: true }, 0.4);
    let steer = 1;
    for (let t = 0; t < 0.15; t += DT) {
      steer = smoother.update(idle, 0, DT).steer;
    }

    expect(steer).toBeLessThan(0.1);
  });

  test("available lock shrinks with speed", () => {
    const at = (v: number) => hold({ ...idle, right: true }, 2, kmh(v)).controls.steer;
    expect(at(100)).toBeLessThan(0.85);
    expect(at(250)).toBeLessThan(0.45);
    expect(at(250)).toBeGreaterThan(0.25);
  });

  test("opposite keys cancel and pedals are on/off", () => {
    const { controls } = hold({ ...idle, throttle: true, left: true, right: true }, 0.4);
    expect(controls).toEqual({ throttle: 1, brake: 0, steer: 0, deploy: false });
    expect(hold({ ...idle, brake: true }, DT).controls.brake).toBe(1);
  });

  test("reset returns steering to centre immediately", () => {
    const { smoother } = hold({ ...idle, right: true }, 0.4);
    smoother.reset();
    expect(smoother.update(idle, 0, DT).steer).toBe(0);
  });

  test("the deploy request passes straight through", () => {
    expect(hold({ ...idle, throttle: true, deploy: true }, DT).controls.deploy).toBe(true);
  });
});
