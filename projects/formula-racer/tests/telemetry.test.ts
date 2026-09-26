import { describe, expect, test } from "bun:test";
import { createGMeter, shiftLights } from "../src/app/telemetry.ts";

describe("shift lights", () => {
  const gearbox = { upshiftRpm: 11800, redlineRpm: 12500 };

  test("stay dark well below the shift point", () => {
    expect(shiftLights(4000, gearbox, 8)).toBe(0);
    expect(shiftLights(9000, gearbox, 8)).toBe(0);
  });

  test("fill in over the last 2000 rpm and are all lit at the upshift point", () => {
    expect(shiftLights(9900, gearbox, 8)).toBe(1);
    expect(shiftLights(10800, gearbox, 8)).toBe(4);
    expect(shiftLights(11800, gearbox, 8)).toBe(8);
    expect(shiftLights(12500, gearbox, 8)).toBe(8);
  });
});

describe("g meter", () => {
  test("a steady 90 km/h turn at 0.5 rad/s reads 1.27 g to the side and no braking", () => {
    const meter = createGMeter();
    let g = { lateral: 0, longitudinal: 0 };
    for (let i = 0; i < 120; i += 1) {
      g = meter.update(25, 0.5, 1 / 60);
    }

    // a = v·ω = 12.5 m/s², positive for a left turn.
    expect(g.lateral).toBeCloseTo(12.5 / 9.81, 2);
    expect(g.longitudinal).toBeCloseTo(0, 6);
  });

  test("braking from speed reads negative longitudinal g, smoothed over frame noise", () => {
    const meter = createGMeter();
    let speed = 80;
    let g = { lateral: 0, longitudinal: 0 };
    meter.update(speed, 0, 1 / 60);
    for (let i = 0; i < 60; i += 1) {
      // 4 g of braking, with alternate frames twice as long.
      const dt = i % 2 === 0 ? 1 / 60 : 1 / 30;
      speed -= 4 * 9.81 * dt;
      g = meter.update(speed, 0, dt);
    }

    expect(g.longitudinal).toBeCloseTo(-4, 1);
  });

  test("a zero-length frame changes nothing", () => {
    const meter = createGMeter();
    meter.update(50, 0.2, 1 / 60);
    const before = meter.update(50, 0.2, 1 / 60);
    expect(meter.update(90, 0.2, 0)).toEqual(before);
  });

  test("after a reset the next reading starts afresh instead of a huge deceleration", () => {
    const meter = createGMeter();
    meter.update(80, 0, 1 / 60);
    meter.update(80, 0, 1 / 60);
    meter.reset();
    expect(meter.update(0, 0, 1 / 60)).toEqual({ lateral: 0, longitudinal: 0 });
  });
});
