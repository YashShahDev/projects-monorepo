import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { findCorners } from "../src/app/track-map.ts";
import { buildRacingLine, guideColour, lineLimits, slowestBetween } from "../src/simulation/racing-line.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { car } from "./support/vehicle.ts";

const harbour = buildTrackGeometry(
  parseTrack(JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"))),
);
const limits = lineLimits(car);
const line = buildRacingLine(harbour, limits);

const squaredCurvature = (x: ArrayLike<number>, z: ArrayLike<number>, n: number): number => {
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const [a, b, c] = [(i + n - 1) % n, i, (i + 1) % n];
    const ddx = (x[a] ?? 0) - 2 * (x[b] ?? 0) + (x[c] ?? 0);
    const ddz = (z[a] ?? 0) - 2 * (z[b] ?? 0) + (z[c] ?? 0);
    sum += ddx * ddx + ddz * ddz;
  }

  return sum;
};

describe("racing line", () => {
  test("stays inside the track with room for the car, everywhere", () => {
    const room = harbour.halfWidthM - limits.clearanceM;
    expect(limits.clearanceM).toBeGreaterThan(1);
    for (const offset of line.offsetM) {
      expect(Math.abs(offset)).toBeLessThanOrEqual(room + 1e-9);
    }

    // It uses the width: somewhere it reaches the edge of the allowed band.
    expect(Math.max(...line.offsetM.map(Math.abs))).toBeGreaterThan(room * 0.9);
  });

  test("bends less than the centreline", () => {
    const centre = squaredCurvature(harbour.x, harbour.z, harbour.count);
    expect(squaredCurvature(line.x, line.z, line.count)).toBeLessThan(centre * 0.7);
  });

  test("is continuous across the lap seam", () => {
    let largest = 0;
    for (let i = 1; i < line.count; i += 1) {
      largest = Math.max(largest, Math.abs((line.offsetM[i] ?? 0) - (line.offsetM[i - 1] ?? 0)));
    }

    const seam = Math.abs((line.offsetM[0] ?? 0) - (line.offsetM[line.count - 1] ?? 0));
    expect(seam).toBeLessThanOrEqual(largest + 1e-9);
    expect(largest).toBeLessThan(0.5);
  });

  test("is the same every time it is built", () => {
    expect(buildRacingLine(harbour, limits).offsetM).toEqual(line.offsetM);
  });
});

describe("speed profile", () => {
  const corners = findCorners(harbour);

  test("is slowest at the hairpin", () => {
    const hairpin = corners.reduce((a, b) => (b.radiusM < a.radiusM ? b : a));
    let slowest = 0;
    line.speedMps.forEach((v, i) => {
      if (v < (line.speedMps[slowest] ?? Infinity)) {
        slowest = i;
      }
    });

    const at = slowest * harbour.spacingM;
    expect(at).toBeGreaterThan(hairpin.startM - 20);
    expect(at).toBeLessThan(hairpin.endM + 20);
    expect(line.speedMps[slowest] ?? 0).toBeLessThan(120 / 3.6);
  });

  test("slows before every corner that cannot be taken flat out", () => {
    const n = line.count;
    const index = (m: number) => Math.round(m / harbour.spacingM + n) % n;
    let limiting = 0;
    for (const corner of corners) {
      // A flat-out corner (Harbour's 250 m sweeper) never uses all the grip, and the
      // car may still be accelerating through it.
      let slowest = Infinity;
      let usage = 0;
      for (let d = corner.startM; d <= corner.endM; d += harbour.spacingM) {
        const v = line.speedMps[index(d)] ?? 0;
        const grip = limits.mu * (9.81 + (limits.downforceK * v * v) / limits.massKg);
        usage = Math.max(usage, (v * v * Math.abs(line.curvature[index(d)] ?? 0)) / grip);
        slowest = Math.min(slowest, v);
      }

      if (usage < 0.95) {
        continue;
      }

      limiting += 1;
      let fastest = 0;
      for (let d = corner.startM - 300; d < corner.startM; d += harbour.spacingM) {
        fastest = Math.max(fastest, line.speedMps[index(d)] ?? 0);
      }

      expect(slowest).toBeLessThan(fastest);
    }

    expect(limiting).toBeGreaterThanOrEqual(corners.length / 2);
  });

  test("never asks for more cornering grip than the car showed in the C5 measurements", () => {
    // Steady lateral g the car held with the assists on: 1.84 at 100 km/h, 3.24 at 200.
    const measured = (kmh: number) => 1.84 + ((3.24 - 1.84) * (kmh - 100)) / 100;
    for (let i = 0; i < line.count; i += 1) {
      const v = line.speedMps[i] ?? 0;
      const kmh = v * 3.6;
      if (kmh < 90 || kmh > 210) {
        continue;
      }

      const g = (v * v * Math.abs(line.curvature[i] ?? 0)) / 9.81;
      expect(g).toBeLessThanOrEqual(measured(kmh) + 1e-6);
    }
  });

  test("never brakes harder than the car stopped in C5", () => {
    // 100–0 km/h in 23.4 m is 16.5 m/s² on average; the profile stays under 2 g at
    // those speeds, where downforce adds little.
    for (let i = 0; i < line.count; i += 1) {
      const [v0, v1] = [line.speedMps[i] ?? 0, line.speedMps[(i + 1) % line.count] ?? 0];
      if (v0 * 3.6 > 110 || v1 >= v0) {
        continue;
      }

      const ds = line.stepM[i] ?? harbour.spacingM;
      expect((v0 * v0 - v1 * v1) / (2 * ds)).toBeLessThan(2 * 9.81);
    }
  });

  test("marks where the profile brakes, and the lift just before it", () => {
    const n = line.count;
    for (let i = 0; i < n; i += 1) {
      const next = line.speedMps[(i + 1) % n] ?? 0;
      if (next < (line.speedMps[i] ?? 0) - 0.05) {
        expect(line.phase[i]).toBe("brake");
      }
    }

    const firstBrake = line.phase.findIndex((p, i) => p === "brake" && line.phase[(i + n - 1) % n] !== "brake");
    expect(line.phase[(firstBrake + n - 1) % n]).toBe("lift");
  });
});

describe("guide colour", () => {
  const base = { aheadM: 100, targetMps: 30, decelMps2: 20, liftS: 0.6 };

  test("follows the profile when the car is on its speed", () => {
    expect(guideColour({ ...base, speedMps: 30, phase: "go" })).toBe("go");
    expect(guideColour({ ...base, speedMps: 30, phase: "lift" })).toBe("lift");
    expect(guideColour({ ...base, speedMps: 30, phase: "brake" })).toBe("brake");
  });

  test("turns red where a car arriving too fast can only just stop in time", () => {
    // From 70 m/s to 30 at 20 m/s² takes 100 m: this point needs braking now.
    expect(guideColour({ ...base, speedMps: 70, phase: "go" })).toBe("brake");
  });

  test("warns to lift just before that", () => {
    // 90 m is needed; 100 m ahead is within 0.6 s at 64 m/s.
    expect(guideColour({ ...base, speedMps: Math.sqrt(900 + 2 * 20 * 90), phase: "go" })).toBe("lift");
  });

  test("a slower car is never told to brake by a point it can already make", () => {
    expect(guideColour({ ...base, speedMps: 20, phase: "go" })).toBe("go");
  });
});

describe("corner speed hint", () => {
  test("is the slowest the profile goes through the corner, across the lap seam too", () => {
    const hairpin = findCorners(harbour).reduce((a, b) => (b.radiusM < a.radiusM ? b : a));
    const hint = slowestBetween(line, harbour.spacingM, hairpin.startM, hairpin.endM);
    expect(hint).toBe(Math.min(...line.speedMps));

    // A stretch that wraps past the end of the lap still reads both sides of it.
    const lap = line.count * harbour.spacingM;
    const wrapped = slowestBetween(line, harbour.spacingM, lap - 10, lap + 10);
    const either = Math.min(
      line.speedMps[line.count - 5] ?? Infinity,
      line.speedMps[line.count - 1] ?? Infinity,
      line.speedMps[0] ?? Infinity,
      line.speedMps[5] ?? Infinity,
    );
    expect(wrapped).toBeLessThanOrEqual(either);
  });
});
