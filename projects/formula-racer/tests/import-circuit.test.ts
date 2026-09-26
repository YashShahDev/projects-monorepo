import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import type { TrackGeometry } from "../src/simulation/track-geometry.ts";
import { CIRCUITS, importCircuit, projectLonLat } from "../tools/import-circuit.ts";

const source = (id: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../content/tracks/sources/${id}.geojson`), "utf8"));

/** Twice the signed area; positive when the loop turns left (anticlockwise seen from above). */
function signedArea(g: TrackGeometry): number {
  let sum = 0;
  for (let i = 0; i < g.count; i += 1) {
    const j = (i + 1) % g.count;

    // Left of +z is +x (see `ribbon`), so a left-turning loop has negative x·z' − z·x'.
    sum -= (g.x[i] ?? 0) * (g.z[j] ?? 0) - (g.z[i] ?? 0) * (g.x[j] ?? 0);
  }

  return sum;
}

function segmentsCross(g: TrackGeometry): boolean {
  const n = g.count;
  const p = (i: number) => ({ x: g.x[i % n] ?? 0, z: g.z[i % n] ?? 0 });
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if ((j + 1) % n === i) {
        continue;
      }

      const [a, b, c, d] = [p(i), p(i + 1), p(j), p(j + 1)];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) {
        return true;
      }
    }
  }

  return false;
}

test("projects longitude and latitude to metres, east along +x and north along −z", () => {
  const origin = { lon: 7.42, lat: 43.73 };
  const east = projectLonLat([7.43, 43.73], origin);
  const north = projectLonLat([7.42, 43.74], origin);

  // 0.01° of longitude at 43.73° N is about 804 m; 0.01° of latitude about 1112 m.
  expect(east.x).toBeCloseTo(804, -1);
  expect(east.z).toBeCloseTo(0, 6);
  expect(north.x).toBeCloseTo(0, 6);
  expect(north.z).toBeCloseTo(-1112, -1);
});

describe.each(CIRCUITS.map((c) => [c.id, c] as const))("%s", (_, circuit) => {
  const track = parseTrack(importCircuit(source(circuit.source), circuit), circuit.id);
  const geometry = buildTrackGeometry(track);

  test("is shipped exactly as the importer writes it", () => {
    const file: unknown = JSON.parse(
      readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${circuit.id}.json`), "utf8"),
    );
    expect(file).toEqual(importCircuit(source(circuit.source), circuit));
  });

  test("is a closed lap within 2% of the published length", () => {
    const first = track.controlPoints[0];
    const last = track.controlPoints.at(-1);
    expect(Math.hypot((first?.x ?? 0) - (last?.x ?? 0), (first?.z ?? 0) - (last?.z ?? 0))).toBeLessThan(30);
    expect(Math.abs(geometry.lengthM / circuit.publishedLengthM - 1)).toBeLessThan(0.02);
  });

  test("runs in the race direction and never crosses itself", () => {
    expect(Math.sign(signedArea(geometry))).toBe(circuit.clockwise ? -1 : 1);
    expect(segmentsCross(geometry)).toBe(false);
  });

  test("has no bend tighter than the car can turn using the track's width", () => {
    let tightest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < geometry.count; i += 1) {
      tightest = Math.min(tightest, 1 / Math.max(Math.abs(geometry.curvature[i] ?? 0), 1e-9));
    }

    // The car's lock (0.38 rad on a 3.6 m wheelbase) turns about 9 m. Through a hairpin
    // it can swing out to the kerb less its 1.3 m clearance, which Monaco's 7.5 m Loews
    // hairpin needs.
    expect(tightest + track.widthM / 2 - 1.3).toBeGreaterThan(9.5);
  });

  test("puts the grid and the active-aero zones on straights", () => {
    // Flat out: a 250 m radius holds 300 km/h at under 3 g. Monaco's pit straight kinks
    // to about 290 m.
    const straight = (d: number) => {
      const i = geometry.locate(geometry.pointAt(d).x, geometry.pointAt(d).z).index;

      return Math.abs(geometry.curvature[i] ?? 0) < 1 / 250;
    };

    for (let d = -60; d <= 60; d += 10) {
      expect(straight((track.startDistanceM + d + geometry.lengthM) % geometry.lengthM)).toBe(true);
    }

    expect(track.activeAeroZones.length).toBeGreaterThan(0);
    for (const zone of track.activeAeroZones) {
      expect(zone.endM - zone.startM).toBeGreaterThan(250);
      for (let d = zone.startM; d < zone.endM; d += 10) {
        expect(straight(d)).toBe(true);
      }
    }
  });
});
