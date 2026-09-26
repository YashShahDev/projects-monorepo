// Converts a circuit centreline from bacinger/f1-circuits (MIT, GeoJSON; the sources are
// in content/tracks/sources) into a game track file.
//
//   bun run tools/import-circuit.ts && bun run format   # writes every circuit in CIRCUITS
//
// Latitude and longitude become metres by a local equirectangular projection about the
// start line, which is exact to well under a metre over a few kilometres. The line is
// resampled every 2 m and smoothed, because the survey points are 20–40 m apart and
// their corners would otherwise be kinks; control points are then kept every 10 m.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { array, ContentError, finite, object } from "../src/content/validate.ts";

export interface CircuitConfig {
  id: string;
  name: string;
  source: string;

  /**
   * The start line as lap distance from the source's first point, which is the track's
   * origin. Most sources begin on the line; Monaco's begins at the Casino.
   */
  startM: number;
  publishedLengthM: number;

  /** Race direction seen from above. */
  clockwise: boolean;
  widthM: number;
  kerbWidthM: number;

  /** Most active-aero zones to place, longest straights first. */
  zones: number;

  /** Zones to use instead, where the straights curve too much to be found. */
  fixedZones?: { startM: number; endM: number }[];
  setting?: "street";
}

// In-game names are our own; the layouts are the real ones.
export const CIRCUITS: CircuitConfig[] = [
  {
    id: "riviera",
    name: "Riviera Streets",
    source: "mc-1929",
    startM: 2400,

    // The pit straight, from Anthony Noghes to the braking for Sainte Devote.
    fixedZones: [{ startM: 2230, endM: 2500 }],
    publishedLengthM: 3337,
    clockwise: true,
    widthM: 10,
    kerbWidthM: 1,
    zones: 1,
    setting: "street",
  },
  {
    id: "ardennes",
    name: "Ardennes Ring",
    source: "be-1925",
    startM: 0,
    publishedLengthM: 7004,
    clockwise: true,
    widthM: 13,
    kerbWidthM: 1.5,
    zones: 2,
  },
  {
    id: "royal-park",
    name: "Royal Park",
    source: "it-1922",
    startM: 0,
    publishedLengthM: 5793,
    clockwise: true,
    widthM: 13,
    kerbWidthM: 1.5,
    zones: 3,
  },
];

const EARTH_RADIUS_M = 6_371_008.8;
const SAMPLE_M = 2;
const SMOOTH_SIGMA_M = 8;
const CONTROL_EVERY = 5;
const STRAIGHT_CURVATURE = 1 / 400;
const MIN_ZONE_RUN_M = 400;

// Straight Mode opens after the corner exit and closes well before the braking point.
const ZONE_START_INSET_M = 60;
const ZONE_END_INSET_M = 140;

interface Point {
  x: number;
  z: number;
}

/** Metres from `origin`: east along +x, north along −z (so +x is on the left of +z). */
export function projectLonLat([lon, lat]: [number, number], origin: { lon: number; lat: number }): Point {
  const rad = Math.PI / 180;

  return {
    x: (lon - origin.lon) * rad * Math.cos(origin.lat * rad) * EARTH_RADIUS_M,
    z: -(lat - origin.lat) * rad * EARTH_RADIUS_M,
  };
}

function coordinates(geojson: unknown): [number, number][] {
  const root = object(geojson, "geojson");
  const feature = object(array(root.features, "geojson.features", 1)[0], "geojson.features[0]");
  const geometry = object(feature.geometry, "geojson.features[0].geometry");
  if (geometry.type !== "LineString") {
    throw new ContentError("geojson.features[0].geometry must be a LineString");
  }

  return array(geometry.coordinates, "coordinates", 4).map((pair, i) => {
    const [lon, lat] = array(pair, `coordinates[${String(i)}]`, 2);

    return [finite(lon, `coordinates[${String(i)}][0]`), finite(lat, `coordinates[${String(i)}][1]`)];
  });
}

/** Points every `step` metres around the closed polyline, starting at its first point. */
function resample(points: Point[], step: number): Point[] {
  const n = points.length;
  const out: Point[] = [];
  let carry = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i] ?? { x: 0, z: 0 };
    const b = points[(i + 1) % n] ?? { x: 0, z: 0 };
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = carry; d < length; d += step) {
      out.push({ x: a.x + ((b.x - a.x) * d) / length, z: a.z + ((b.z - a.z) * d) / length });
    }

    carry = (((carry - length) % step) + step) % step;
  }

  return out;
}

function smooth(points: Point[], sigmaSamples: number): Point[] {
  const n = points.length;
  const reach = Math.ceil(sigmaSamples * 3);
  const weights = Array.from({ length: reach * 2 + 1 }, (_, k) => Math.exp(-(((k - reach) / sigmaSamples) ** 2) / 2));
  const total = weights.reduce((a, b) => a + b);

  return points.map((_, i) => {
    let [x, z] = [0, 0];
    weights.forEach((w, k) => {
      const p = points[(i + k - reach + n) % n] ?? { x: 0, z: 0 };
      x += p.x * w;
      z += p.z * w;
    });

    return { x: x / total, z: z / total };
  });
}

/** Unsigned curvature from the circle through the points `reach` samples either side. */
function curvatures(points: Point[], reach: number): number[] {
  const n = points.length;

  return points.map((b, i) => {
    const a = points[(i - reach + n) % n] ?? b;
    const c = points[(i + reach) % n] ?? b;
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const product =
      Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(c.x - a.x, c.z - a.z);

    return product > 0 ? Math.abs((2 * cross) / product) : 0;
  });
}

/** The longest straight runs as lap-distance spans, inset from each end. */
function aeroZones(points: Point[], count: number): { startM: number; endM: number }[] {
  const n = points.length;
  const straight = curvatures(points, 10).map((k) => k < STRAIGHT_CURVATURE);

  // Start scanning at a bend, so no run wraps past the scan's start.
  const bend = straight.indexOf(false);
  if (bend < 0) {
    return [];
  }

  const runs: { from: number; length: number }[] = [];
  let from = -1;
  for (let k = 1; k <= n; k += 1) {
    const i = (bend + k) % n;
    if (straight[i] === true && from < 0) {
      from = i;
    } else if (straight[i] !== true && from >= 0) {
      runs.push({ from, length: (((i - from) % n) + n) % n });
      from = -1;
    }
  }

  return runs
    .filter((run) => run.length * SAMPLE_M >= MIN_ZONE_RUN_M)
    .sort((a, b) => b.length - a.length)
    .slice(0, count)
    .map((run) => ({
      startM: run.from * SAMPLE_M + ZONE_START_INSET_M,
      endM: (run.from + run.length) * SAMPLE_M - ZONE_END_INSET_M,
    }))
    .filter((zone) => zone.endM <= n * SAMPLE_M)
    .sort((a, b) => a.startM - b.startM);
}

export function importCircuit(geojson: unknown, circuit: CircuitConfig) {
  const lonLat = coordinates(geojson);
  const [lon, lat] = lonLat[0] ?? [0, 0];
  const origin = { lon, lat };
  const [first] = lonLat;
  const last = lonLat.at(-1);
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    lonLat.pop();
  }

  const points = smooth(
    resample(
      lonLat.map((p) => projectLonLat(p, origin)),
      SAMPLE_M,
    ),
    SMOOTH_SIGMA_M / SAMPLE_M,
  );
  const round = (v: number) => Math.round(v * 100) / 100;

  return {
    version: 1,
    id: circuit.id,
    name: circuit.name,
    widthM: circuit.widthM,
    kerbWidthM: circuit.kerbWidthM,
    ...(circuit.setting ? { setting: circuit.setting } : {}),
    controlPoints: points.filter((_, i) => i % CONTROL_EVERY === 0).map((p) => [round(p.x), round(p.z)]),
    startDistanceM: circuit.startM,
    surfaceGrip: { road: 1, kerb: 0.85, grass: 0.45, gravel: 0.5 },
    activeAeroZones: circuit.fixedZones ?? aeroZones(points, circuit.zones),
  };
}

if (import.meta.main) {
  for (const circuit of CIRCUITS) {
    const root = resolve(import.meta.dirname, "..");
    const geojson: unknown = JSON.parse(
      readFileSync(resolve(root, `content/tracks/sources/${circuit.source}.geojson`), "utf8"),
    );
    const out = resolve(root, `public/assets/tracks/${circuit.id}.json`);
    writeFileSync(out, `${JSON.stringify(importCircuit(geojson, circuit), null, 2)}\n`);
    console.log(`wrote ${out}`);
  }
}
