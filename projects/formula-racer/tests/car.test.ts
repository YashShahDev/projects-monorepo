import { describe, expect, test } from "bun:test";
import { parseCar } from "../src/content/car.ts";
import { car } from "./support/vehicle.ts";

const clone = () => structuredClone(car) as unknown as Record<string, Record<string, unknown>>;

describe("car content", () => {
  test("the shipped car is valid and uses 2026-style proportions", () => {
    expect(car.id).toBe("fr26");
    expect(car.wheels.frontAxleZ - car.wheels.rearAxleZ).toBeCloseTo(3.4, 5);
  });
  test("names the failing field", () => {
    const bad = clone();
    bad.wheels = { ...bad.wheels, radius: -0.3 };
    expect(() => parseCar(bad)).toThrow("car.wheels.radius must be positive");
  });
  test("rejects out-of-range bias and unsupported versions", () => {
    const bad = clone();
    bad.brakes = { ...bad.brakes, frontBias: 1.5 };
    expect(() => parseCar(bad)).toThrow("car.brakes.frontBias must be between 0 and 1");
    expect(() => parseCar({ ...clone(), version: 2 })).toThrow("car.version must be 1");
  });
  test("rejects a rear axle ahead of the centre", () => {
    const bad = clone();
    bad.wheels = { ...bad.wheels, rearAxleZ: 1 };
    expect(() => parseCar(bad)).toThrow("car.wheels.rearAxleZ must be between -10 and 0");
  });
});
