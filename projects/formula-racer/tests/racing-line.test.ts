import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { findCorners } from "../src/app/track-map.ts";
import type { TrackDefinition } from "../src/content/track.ts";
import { buildRacingLine, estimatedLapTimeS, lineLimits, slowestBetween } from "../src/simulation/racing-line.ts";
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

  test("is continuous across the lap seam, with no jumps or kinks", () => {
    let largest = 0;
    let kink = 0;
    const n = line.count;
    for (let i = 1; i < n; i += 1) {
      largest = Math.max(largest, Math.abs((line.offsetM[i] ?? 0) - (line.offsetM[i - 1] ?? 0)));
    }

    for (let i = 0; i < n; i += 1) {
      const [a, b, c] = [line.offsetM[(i + n - 1) % n] ?? 0, line.offsetM[i] ?? 0, line.offsetM[(i + 1) % n] ?? 0];
      kink = Math.max(kink, Math.abs(a - 2 * b + c));
    }

    const seam = Math.abs((line.offsetM[0] ?? 0) - (line.offsetM[n - 1] ?? 0));
    expect(seam).toBeLessThanOrEqual(largest + 1e-9);

    // It may cross the road steeply out of a hairpin, but under 27° to the centreline
    // (1 m sideways per 2 m sample), and its sideways slope changes smoothly.
    expect(largest).toBeLessThan(1);
    expect(kink).toBeLessThan(0.2);
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

      // A corner reached while still accelerating out of the one before, at full grip
      // all the way, needs no slowing for.
      const accelerating =
        (line.speedMps[index(corner.startM)] ?? 0) > (line.speedMps[index(corner.startM - 300)] ?? 0);
      expect(slowest < fastest || accelerating).toBe(true);
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

/** A closed track through `points`, with corners rounded by the geometry's spline. */
function trackThrough(points: { x: number; z: number }[], widthM: number): TrackDefinition {
  return {
    version: 1,
    id: "synthetic",
    name: "Synthetic",
    widthM,
    kerbWidthM: 1,
    controlPoints: points,
    startDistanceM: 0,
    surfaceGrip: { road: 1, kerb: 1, grass: 1, gravel: 1 },
    activeAeroZones: [],
    setting: "circuit",
    lighting: "day",
  };
}

/** A square with 300 m sides and 20 m corners on a 12 m road, driven one way round. */
function square(): TrackDefinition {
  const points: { x: number; z: number }[] = [];
  const corners = [
    [0, 0],
    [300, 0],
    [300, 300],
    [0, 300],
  ] as const;
  const r = 20;
  corners.forEach(([cx, cz], k) => {
    const [px, pz] = corners[(k + 3) % 4] ?? [0, 0];
    const [nx, nz] = corners[(k + 1) % 4] ?? [0, 0];
    const into = { x: (cx - px) / 300, z: (cz - pz) / 300 };
    const out = { x: (nx - cx) / 300, z: (nz - cz) / 300 };
    for (let d = 150; d > r; d -= 20) {
      points.push({ x: cx - into.x * d, z: cz - into.z * d });
    }

    for (let t = 0; t <= 4; t += 1) {
      const a = (t / 4) * (Math.PI / 2);
      const f = (1 - Math.cos(a)) * r;
      const g = Math.sin(a) * r;
      points.push({ x: cx - into.x * (r - g) + out.x * f, z: cz - into.z * (r - g) + out.z * f });
    }
  });

  return trackThrough(points, 12);
}

/** Sum of squared second differences round a closed line: its squared curvature on even steps. */
function bending(x: ArrayLike<number>, z: ArrayLike<number>, n: number): number {
  return squaredCurvature(x, z, n);
}

describe("minimum-curvature solve", () => {
  // Least summed squared curvature spreads an isolated corner's turn over the straights
  // either side, so it reaches well into the inside half rather than clipping the kerb:
  // the kerb-clipping late apex is a minimum-time trait (C3).
  test("takes a 90° corner from the outside edge, through the inside half, and out again", () => {
    const geometry = buildTrackGeometry(square());
    const squareLine = buildRacingLine(geometry, limits, { iterations: 0 });
    const room = geometry.halfWidthM - limits.clearanceM;
    const n = geometry.count;
    const at = (m: number) => Math.round(m / geometry.spacingM + n) % n;

    // The apex of each corner is where the centreline bends most.
    for (let c = 0; c < 4; c += 1) {
      let apex = at((c * n * geometry.spacingM) / 4);
      for (let k = 0; k < n / 4; k += 1) {
        const i = (at((c * n * geometry.spacingM) / 4) + k) % n;
        if (Math.abs(geometry.curvature[i] ?? 0) > Math.abs(geometry.curvature[apex] ?? 0)) {
          apex = i;
        }
      }

      const turn = Math.sign(geometry.curvature[apex] ?? 0);
      const side = (i: number) => ((squareLine.offsetM[i] ?? 0) * turn) / room;
      const apexM = apex * geometry.spacingM;
      expect(side(apex)).toBeGreaterThan(0.3);
      expect(side(at(apexM - 90))).toBeLessThan(-0.95);
      expect(side(at(apexM + 90))).toBeLessThan(-0.95);
    }

    // Using the width, it turns on a wider radius than the road's own 20 m.
    const tightest = Math.max(...squareLine.curvature.map(Math.abs));
    expect(1 / tightest).toBeGreaterThan(24);
  });

  test("bends within 1% as little as a brute-force search on a small track", () => {
    const geometry = buildTrackGeometry(
      trackThrough(
        [
          { x: 0, z: 0 },
          { x: 60, z: -10 },
          { x: 110, z: 30 },
          { x: 90, z: 90 },
          { x: 30, z: 70 },
          { x: -10, z: 40 },
        ],
        16,
      ),
    );
    const small = buildRacingLine(geometry, limits, { iterations: 0 });
    const n = geometry.count;
    const bound = geometry.halfWidthM - limits.clearanceM;

    // Projected coordinate descent, run until nothing moves: slow, but certain.
    const offset = Array.from({ length: n }, () => 0);
    const nx = Array.from({ length: n }, (_, i) => geometry.tz[i] ?? 0);
    const nz = Array.from({ length: n }, (_, i) => -(geometry.tx[i] ?? 0));
    const px = (i: number) => (geometry.x[(i + n) % n] ?? 0) + (offset[(i + n) % n] ?? 0) * (nx[(i + n) % n] ?? 0);
    const pz = (i: number) => (geometry.z[(i + n) % n] ?? 0) + (offset[(i + n) % n] ?? 0) * (nz[(i + n) % n] ?? 0);
    for (let sweep = 0, moved = Infinity; sweep < 400_000 && moved > 1e-11; sweep += 1) {
      moved = 0;
      for (let j = 0; j < n; j += 1) {
        let gradient = 0;
        for (const [i, w] of [
          [j - 1, 1],
          [j, -2],
          [j + 1, 1],
        ] as const) {
          const rx = px(i - 1) - 2 * px(i) + px(i + 1);
          const rz = pz(i - 1) - 2 * pz(i) + pz(i + 1);
          gradient += w * (rx * (nx[j] ?? 0) + rz * (nz[j] ?? 0));
        }

        const next = Math.max(-bound, Math.min(bound, (offset[j] ?? 0) - gradient / 6));
        moved = Math.max(moved, Math.abs(next - (offset[j] ?? 0)));
        offset[j] = next;
      }
    }

    const xs = Array.from({ length: n }, (_, i) => px(i));
    const zs = Array.from({ length: n }, (_, i) => pz(i));
    const reference = bending(xs, zs, n);
    expect(bending(small.x, small.z, n)).toBeLessThan(reference * 1.01);
    for (const offsetM of small.offsetM) {
      expect(Math.abs(offsetM)).toBeLessThanOrEqual(bound + 1e-9);
    }
  }, 60_000);

  for (const id of ["harbour", "riviera", "ardennes", "royal-park", "corniche", "test-loop"]) {
    test(`on ${id}, the line's estimated lap beats the centreline's and stays on the road`, () => {
      const geometry = buildTrackGeometry(
        parseTrack(
          JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")),
        ),
      );
      const started = performance.now();
      const raced = buildRacingLine(geometry, limits);
      const builtMs = performance.now() - started;
      const centre = buildRacingLine(geometry, { ...limits, clearanceM: geometry.halfWidthM });
      expect(centre.offsetM.every((o) => o === 0)).toBe(true);
      expect(estimatedLapTimeS(raced)).toBeLessThan(estimatedLapTimeS(centre));
      const bound = geometry.halfWidthM - limits.clearanceM;
      expect(raced.offsetM.every((o) => Math.abs(o) <= bound + 1e-9)).toBe(true);

      // A loose bound, since the machine may be busy: it catches a solver gone quadratic.
      expect(builtMs).toBeLessThan(3000);
    });
  }
});

describe("minimum-time refinement", () => {
  for (const id of ["harbour", "riviera", "ardennes", "royal-park", "corniche", "test-loop"]) {
    test(`on ${id}, each iteration's estimated lap is no slower, and the last is faster`, () => {
      const geometry = buildTrackGeometry(
        parseTrack(
          JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")),
        ),
      );
      const refined = buildRacingLine(geometry, limits);
      const laps = refined.lapTimesS;
      expect(laps.length).toBeGreaterThan(1);
      for (let k = 1; k < laps.length; k += 1) {
        expect(laps[k] ?? Infinity).toBeLessThanOrEqual(laps[k - 1] ?? 0);
      }

      expect(laps.at(-1) ?? Infinity).toBeLessThan(laps[0] ?? 0);
      expect(estimatedLapTimeS(refined)).toBeCloseTo(laps.at(-1) ?? 0, 6);
      const minimumCurvature = buildRacingLine(geometry, limits, { iterations: 0 });
      expect(minimumCurvature.lapTimesS).toEqual([laps[0] ?? 0]);
    });
  }

  // The point-mass profile alone would happily plan a slow kink tighter than the wheels
  // can turn; Riviera's hairpin came out at a 4.8 m radius against the car's 8.5 m.
  const lockRadiusM = (car.wheels.frontAxleZ - car.wheels.rearAxleZ) / Math.tan(car.steering.maxAngleRad);
  for (const id of ["harbour", "riviera", "ardennes", "royal-park", "corniche", "test-loop"]) {
    test(`on ${id}, the line never turns tighter than the car can steer`, () => {
      const geometry = buildTrackGeometry(
        parseTrack(
          JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")),
        ),
      );
      const refined = buildRacingLine(geometry, limits);
      const tightest = Math.max(...refined.curvature.map(Math.abs));
      expect(1 / tightest).toBeGreaterThanOrEqual(lockRadiusM);
    });
  }

  // On a symmetric corner this model moves the apex barely later (0.5 m); what the time
  // gradient buys is the classic geometric line, clipping the inside at the apex.
  test("clips the apex that the minimum-curvature line leaves open", () => {
    const geometry = buildTrackGeometry(square());
    const n = geometry.count;
    const room = geometry.halfWidthM - limits.clearanceM;

    // How far inside each line gets through each corner, averaged over the four.
    const depth = (candidate: ReturnType<typeof buildRacingLine>) => {
      let total = 0;
      for (let c = 0; c < 4; c += 1) {
        const from = Math.round((c * n) / 4);
        let apex = from;
        for (let k = 0; k < n / 4; k += 1) {
          const i = (from + k) % n;
          if (Math.abs(geometry.curvature[i] ?? 0) > Math.abs(geometry.curvature[apex] ?? 0)) {
            apex = i;
          }
        }

        const turn = Math.sign(geometry.curvature[apex] ?? 0);
        let deepest = 0;
        for (let o = -60; o <= 60; o += 1) {
          deepest = Math.max(deepest, (candidate.offsetM[(apex + o + n) % n] ?? 0) * turn);
        }

        total += deepest / 4;
      }

      return total / room;
    };

    const open = depth(buildRacingLine(geometry, limits, { iterations: 0 }));
    const clipped = depth(buildRacingLine(geometry, limits));
    expect(open).toBeLessThan(0.6);
    expect(clipped).toBeGreaterThan(0.85);
  });
});

describe("grip measured along the line", () => {
  const n = harbour.count;
  const hairpin = line.speedMps.indexOf(Math.min(...line.speedMps));
  const near = (i: number) => Math.abs(((i - hairpin + n + n / 2) % n) - n / 2) * harbour.spacingM < 60;

  test("a scale of one everywhere is the line built without one", () => {
    const same = buildRacingLine(harbour, limits, { gripScale: new Float64Array(n).fill(1) });
    expect(same.offsetM).toEqual(line.offsetM);
    expect(same.speedMps).toEqual(line.speedMps);
    expect(Array.from(same.gripScale)).toEqual(Array.from({ length: n }, () => 1));
  });

  test("more grip at one corner carries more speed there, and less carries less", () => {
    const scaled = (s: number) =>
      buildRacingLine(harbour, limits, { gripScale: Float64Array.from({ length: n }, (_, i) => (near(i) ? s : 1)) });
    const [more, less] = [scaled(1.2), scaled(0.8)];
    expect(more.speedMps[hairpin] ?? 0).toBeGreaterThan((line.speedMps[hairpin] ?? 0) * 1.05);
    expect(less.speedMps[hairpin] ?? 0).toBeLessThan((line.speedMps[hairpin] ?? 0) * 0.95);
    expect(Array.from(more.gripScale.filter((s) => s !== 1))).not.toHaveLength(0);
  });
});
