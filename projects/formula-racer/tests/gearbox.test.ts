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
      if (gear !== gears.at(-1)) {
        gears.push(gear);
      }

      expect(rpm).toBeLessThanOrEqual(box.redlineRpm);
      expect(rpm).toBeGreaterThanOrEqual(box.idleRpm);
    }

    expect(gears).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("hovering around a shift point does not hunt between gears", () => {
    const gearbox = createGearbox(box);
    const upshift = (box.gearTopSpeedsKmh[2] ?? 0) * (box.upshiftRpm / box.redlineRpm);
    for (let v = 0; v < upshift - 1; v += 1) {
      gearbox.update(kmh(v));
    }

    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(gearbox.update(kmh(upshift + (i % 2 ? 2 : -2))).gear);
    }

    // At most the one upshift, never back down again.
    expect([...seen].every((gear) => gear === 3 || gear === 4)).toBe(true);
    expect(gearbox.update(kmh(upshift - 2)).gear).toBe(4);
  });

  test("braking to a hairpin steps back down to first", () => {
    const gearbox = createGearbox(box);
    for (let v = 0; v <= 300; v += 1) {
      gearbox.update(kmh(v));
    }

    let gear = 8;
    for (let v = 300; v >= 60; v -= 1) {
      gear = gearbox.update(kmh(v)).gear;
    }

    expect(gear).toBe(1);
  });

  test("reset returns to first gear", () => {
    const gearbox = createGearbox(box);
    for (let v = 0; v <= 200; v += 1) {
      gearbox.update(kmh(v));
    }

    gearbox.reset();
    expect(gearbox.update(0).gear).toBe(1);
  });
});

describe("reverse", () => {
  test("a downshift request at a standstill selects reverse, and an upshift returns to first", () => {
    const gearbox = createGearbox(box);
    gearbox.update(0);
    gearbox.request("down");
    expect(gearbox.update(0).gear).toBe(-1);

    // Automatic stays in reverse; it never shifts out of R on its own.
    expect(gearbox.update(kmh(-10)).gear).toBe(-1);
    gearbox.request("up");
    expect(gearbox.update(kmh(-0.5)).gear).toBe(1);
  });

  test("reverse is refused while the car is moving", () => {
    const gearbox = createGearbox(box);
    gearbox.update(kmh(20));
    gearbox.request("down");
    expect(gearbox.update(kmh(20)).gear).toBe(1);
  });

  test("engine speed in reverse reaches the redline at the 30 km/h reverse cap", () => {
    const gearbox = createGearbox(box);
    gearbox.request("down");
    gearbox.update(0);
    expect(gearbox.update(kmh(-30)).rpm).toBeCloseTo(box.redlineRpm, 6);
    expect(gearbox.update(kmh(-15)).rpm).toBeCloseTo(box.redlineRpm / 2, 6);
  });

  test("reset leaves reverse for first", () => {
    const gearbox = createGearbox(box);
    gearbox.request("down");
    gearbox.update(0);
    gearbox.reset();
    expect(gearbox.update(0).gear).toBe(1);
  });
});

describe("manual gearbox", () => {
  const manual = () => {
    const gearbox = createGearbox(box);
    gearbox.setMode("manual");

    return gearbox;
  };

  test("never shifts on its own, even at the redline", () => {
    const gearbox = manual();
    for (let v = 0; v <= 150; v += 1) {
      expect(gearbox.update(kmh(v)).gear).toBe(1);
    }

    expect(gearbox.update(kmh(150)).rpm).toBe(box.redlineRpm);
  });

  test("shifts one gear per request, up and down", () => {
    const gearbox = manual();
    gearbox.update(kmh(80));
    gearbox.request("up");
    expect(gearbox.update(kmh(80)).gear).toBe(2);
    gearbox.request("up");
    expect(gearbox.update(kmh(80)).gear).toBe(3);
    gearbox.request("down");
    expect(gearbox.update(kmh(80)).gear).toBe(2);
  });

  test("refuses a downshift that would over-rev the engine", () => {
    // fr26 tops: 1st 99, 2nd 136, 3rd 172, 4th 209 km/h.
    const gearbox = manual();
    for (let i = 0; i < 3; i += 1) {
      gearbox.request("up");
      gearbox.update(kmh(150));
    }

    expect(gearbox.update(kmh(150)).gear).toBe(4);
    gearbox.request("down");
    expect(gearbox.update(kmh(150)).gear).toBe(3);

    // 2nd tops out at 130 km/h, so 150 km/h would be over the redline.
    gearbox.request("down");
    expect(gearbox.update(kmh(150)).gear).toBe(3);
  });

  test("stays in top gear when asked to go higher", () => {
    const gearbox = manual();
    for (let i = 0; i < 12; i += 1) {
      gearbox.request("up");
      gearbox.update(kmh(300));
    }

    expect(gearbox.update(kmh(300)).gear).toBe(box.gearTopSpeedsKmh.length);
  });

  test("reverse works the same as in automatic", () => {
    const gearbox = manual();
    gearbox.request("down");
    expect(gearbox.update(0).gear).toBe(-1);
  });
});

describe("hybrid gearbox", () => {
  const hybrid = () => {
    const gearbox = createGearbox(box);
    gearbox.setMode("hybrid");

    return gearbox;
  };

  test("takes the driver's early upshift, and holds a gear past the automatic shift point", () => {
    const gearbox = hybrid();
    gearbox.update(kmh(60));
    gearbox.request("up");
    expect(gearbox.update(kmh(60)).gear).toBe(2);

    // Automatic would upshift from 2nd at the upshift point; hybrid waits for the limiter.
    const top2 = box.gearTopSpeedsKmh[1] ?? 0;
    expect(gearbox.update(kmh((top2 * box.upshiftRpm) / box.redlineRpm + 1)).gear).toBe(2);
  });

  test("refuses an upshift that would bog the engine, rather than taking it and shifting back", () => {
    const gearbox = hybrid();
    gearbox.update(kmh(30));
    gearbox.request("up");
    expect(gearbox.update(kmh(30)).gear).toBe(1);
  });

  test("upshifts by itself at the limiter", () => {
    const gearbox = hybrid();
    const top1 = box.gearTopSpeedsKmh[0] ?? 0;
    expect(gearbox.update(kmh(top1)).gear).toBe(2);
  });

  test("downshifts by itself when the engine would bog down", () => {
    const gearbox = hybrid();
    for (let v = 0; v <= 150; v += 1) {
      gearbox.update(kmh(v));
    }

    // Upshifting only at the limiter, 150 km/h is 3rd (tops out at 165 km/h).
    expect(gearbox.update(kmh(150)).gear).toBe(3);
    let gear = 3;
    for (let v = 150; v >= 40; v -= 1) {
      gear = gearbox.update(kmh(v)).gear;
    }

    expect(gear).toBe(1);
  });
});

describe("gearbox content", () => {
  const withBox = (patch: Record<string, unknown>) => {
    const raw = { ...car, powertrain: { ...car.powertrain, gearbox: { ...box, ...patch } } };

    return () => parseCar(raw);
  };

  test("rejects gears that do not get taller", () => {
    expect(withBox({ gearTopSpeedsKmh: [95, 130, 120] })).toThrow(
      "car.powertrain.gearbox.gearTopSpeedsKmh[2] must be greater than the gear below",
    );
  });

  test("rejects spacing so wide an upshift would land below the downshift point", () => {
    // Upshifting at 12300 rpm from a 95 km/h first into a 200 km/h second lands at
    // 12300 * 95 / 200 = 5843 rpm, under the 8300 rpm downshift point.
    expect(withBox({ gearTopSpeedsKmh: [95, 200, 250] })).toThrow(
      "car.powertrain.gearbox.gearTopSpeedsKmh[1] is too tall",
    );
  });

  test("requires downshift < upshift <= redline", () => {
    expect(withBox({ downshiftRpm: 12300 })).toThrow("car.powertrain.gearbox.downshiftRpm");
  });
});
