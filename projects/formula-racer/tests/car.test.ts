import { describe, expect, test } from "bun:test";
import { parseCar } from "../src/content/car.ts";
import { car } from "./support/vehicle.ts";

describe("car content", () => {
  test("the shipped car is valid and uses 2026-style proportions", () => {
    expect(car.id).toBe("fr26");
    expect(car.wheels.frontAxleZ - car.wheels.rearAxleZ).toBeCloseTo(3.4, 5);
  });
  test("names the failing field", () => {
    expect(() => parseCar({ ...car, wheels: { ...car.wheels, radius: -0.3 } })).toThrow(
      "car.wheels.radius must be positive",
    );
  });
  test("rejects out-of-range bias and unsupported versions", () => {
    expect(() => parseCar({ ...car, brakes: { ...car.brakes, frontBias: 1.5 } })).toThrow(
      "car.brakes.frontBias must be between 0 and 1",
    );
    expect(() => parseCar({ ...car, version: 2 })).toThrow("car.version must be 1");
  });
  test("rejects a power curve too dense to search every step", () => {
    const curve = (count: number) => Array.from({ length: count }, (_, i) => [4000 + i * 100, 0.5]);
    const withCurve = (count: number) => ({ ...car, powertrain: { ...car.powertrain, powerCurve: curve(count) } });
    expect(() => parseCar(withCurve(64))).not.toThrow();
    expect(() => parseCar(withCurve(65))).toThrow("car.powertrain.powerCurve must be");
  });
  test("rejects a rear axle ahead of the centre", () => {
    expect(() => parseCar({ ...car, wheels: { ...car.wheels, rearAxleZ: 1 } })).toThrow(
      "car.wheels.rearAxleZ must be between -10 and 0",
    );
  });
});
