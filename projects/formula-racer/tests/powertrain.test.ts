import { describe, expect, test } from "bun:test";
import { parseCar } from "../src/content/car.ts";
import { createPowertrain } from "../src/simulation/powertrain.ts";
import { car } from "./support/vehicle.ts";

const DT = 1 / 60;
const kmh = (v: number) => v / 3.6;

/** Ramps speed up at full throttle and records each step's output. */
function sweep(toKmh: number) {
  const powertrain = createPowertrain(car.powertrain);
  const out = [];
  for (let v = 0; v <= toKmh; v += 0.25) {
    out.push({ v, ...powertrain.update(1, kmh(v), DT) });
  }

  return out;
}

describe("powertrain", () => {
  test("launch force is capped at the traction-limited maximum", () => {
    const [first] = sweep(1);
    expect(first?.driveForceN).toBe(car.powertrain.maxDriveForceN);
  });

  test("an upshift cuts drive for the shift time, then drive resumes", () => {
    const run = sweep(150);
    const shift = run.findIndex((s, i) => i > 0 && s.gear > (run[i - 1]?.gear ?? 1));
    expect(shift).toBeGreaterThan(0);
    const cutSteps = Math.round(car.powertrain.shiftTimeS / DT);
    for (let k = 0; k < cutSteps; k += 1) {
      expect(run[shift + k]?.driveForceN).toBe(0);
    }

    expect(run[shift + cutSteps]?.driveForceN ?? 0).toBeGreaterThan(0);
  });

  test("above the traction cap, drive is the power curve over road speed", () => {
    // 256 km/h in 7th (305 km/h at 12 500 rpm) is 10 492 rpm; the curve is 0.75 + 0.25 *
    // (10 492 - 7000) / 3500 = 0.9994 of the 400 kW ICE, and 399.8 kW / 71.11 m/s = 5622 N.
    const at256 = sweep(256).at(-1);
    expect(at256?.gear).toBe(7);
    expect(at256?.driveForceN ?? 0).toBeCloseTo(5622, -1);
  });

  test("upshifting past the power peak lands back near it, so drive rises", () => {
    const run = sweep(300);
    const cutSteps = Math.round(car.powertrain.shiftTimeS / DT);
    const shift = run.findIndex((s, i) => i > 0 && s.gear === 7 && (run[i - 1]?.gear ?? 0) === 6);
    const before = run[shift - 1];
    const after = run[shift + cutSteps];
    if (!before || !after) {
      throw new Error("no 6→7 upshift in the sweep");
    }

    expect(after.rpm).toBeLessThan(before.rpm);
    expect(after.driveForceN).toBeGreaterThan(before.driveForceN);
  });

  test("no throttle, no drive", () => {
    expect(createPowertrain(car.powertrain).update(0, kmh(100), DT).driveForceN).toBe(0);
  });

  test("reset returns to first gear with no shift pending", () => {
    const powertrain = createPowertrain(car.powertrain);
    for (let v = 0; v < 200; v += 1) {
      powertrain.update(1, kmh(v), DT);
    }

    powertrain.reset();
    const state = powertrain.update(1, 0, DT);
    expect(state.gear).toBe(1);
    expect(state.driveForceN).toBe(car.powertrain.maxDriveForceN);
  });
});

describe("powertrain content", () => {
  const withCurve = (powerCurve: unknown) => () =>
    parseCar({ ...car, powertrain: { ...car.powertrain, powerCurve } });

  test("rejects a power curve whose rpm does not increase", () => {
    expect(
      withCurve([
        [4000, 0.5],
        [3000, 0.8],
      ]),
    ).toThrow("car.powertrain.powerCurve[1] rpm must be greater than the point before");
  });

  test("rejects fractions outside 0–1", () => {
    expect(
      withCurve([
        [4000, 0.5],
        [9000, 1.2],
      ]),
    ).toThrow("car.powertrain.powerCurve[1][1]");
  });
});
