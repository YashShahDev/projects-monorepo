import { describe, expect, test } from "bun:test";
import { parseCar } from "../src/content/car.ts";
import { createGearbox } from "../src/simulation/gearbox.ts";
import { car } from "./support/vehicle.ts";

const kmh = (v: number) => v / 3.6;
const box = car.powertrain.gearbox;

describe("automatic gearbox", () => {
  test("waits in first gear at idle when stopped", () => {
    expect(createGearbox(box).update(0)).toEqual({ gear: 1, rpm: box.idleRpm });
  });

  test("a full-throttle run climbs through every gear once, in order, below the redline", () => {
    const gearbox = createGearbox(box);
    const gears: number[] = [];
    for (let v = 0; v <= 330; v += 0.5) {
      const { gear, rpm } = gearbox.update(kmh(v));
      if (gear !== gears.at(-1)) gears.push(gear);
      expect(rpm).toBeLessThanOrEqual(box.redlineRpm);
      expect(rpm).toBeGreaterThanOrEqual(box.idleRpm);
    }
    expect(gears).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("hovering around a shift point does not hunt between gears", () => {
    const gearbox = createGearbox(box);
    const upshift = (box.gearTopSpeedsKmh[2] ?? 0) * (box.upshiftRpm / box.redlineRpm);
    for (let v = 0; v < upshift - 1; v += 1) gearbox.update(kmh(v));
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(gearbox.update(kmh(upshift + (i % 2 ? 2 : -2))).gear);
    // At most the one upshift, never back down again.
    expect([...seen].every((gear) => gear === 3 || gear === 4)).toBe(true);
    expect(gearbox.update(kmh(upshift - 2)).gear).toBe(4);
  });

  test("braking to a hairpin steps back down to first", () => {
    const gearbox = createGearbox(box);
    for (let v = 0; v <= 300; v += 1) gearbox.update(kmh(v));
    let gear = 8;
    for (let v = 300; v >= 60; v -= 1) gear = gearbox.update(kmh(v)).gear;
    expect(gear).toBe(1);
  });

  test("reset returns to first gear", () => {
    const gearbox = createGearbox(box);
    for (let v = 0; v <= 200; v += 1) gearbox.update(kmh(v));
    gearbox.reset();
    expect(gearbox.update(0).gear).toBe(1);
  });
});

describe("gearbox content", () => {
  const withBox = (patch: Record<string, unknown>) => {
    const raw = structuredClone(car) as unknown as Record<string, Record<string, unknown>>;
    raw.powertrain = { ...raw.powertrain, gearbox: { ...box, ...patch } };
    return () => parseCar(raw);
  };

  test("rejects gears that do not get taller", () => {
    expect(withBox({ gearTopSpeedsKmh: [95, 130, 120] })).toThrow(
      "car.powertrain.gearbox.gearTopSpeedsKmh[2] must be greater than the gear below",
    );
  });

  test("rejects spacing so wide an upshift would land below the downshift point", () => {
    // Upshifting at 11800 rpm from a 95 km/h first into a 200 km/h second lands at
    // 11800 * 95 / 200 = 5605 rpm, under the 8000 rpm downshift point.
    expect(withBox({ gearTopSpeedsKmh: [95, 200, 250] })).toThrow(
      "car.powertrain.gearbox.gearTopSpeedsKmh[1] is too tall",
    );
  });

  test("requires downshift < upshift <= redline", () => {
    expect(withBox({ downshiftRpm: 12000 })).toThrow("car.powertrain.gearbox.downshiftRpm");
  });
});
