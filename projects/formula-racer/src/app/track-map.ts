import type { TrackGeometry } from "../simulation/track-geometry.ts";

export interface Corner {
  /** Turn number in lap order, from 1. */
  number: number;
  startM: number;
  apexM: number;
  endM: number;
  direction: "left" | "right";

  /** Radius at the apex, metres. */
  radiusM: number;
}

// Tighter than this is a corner a driver brakes or lifts for.
const CORNER_RADIUS_M = 300;

// A bend has to turn at least this far to count, so kinks are not numbered.
const MIN_TURN_RAD = (15 * Math.PI) / 180;

/** The circuit's corners, numbered in the order a lap from `startDistanceM` reaches them. */
export function findCorners(track: TrackGeometry, startDistanceM = 0): Corner[] {
  const n = track.count;
  const k = (i: number) => track.curvature[((i % n) + n) % n] ?? 0;
  const inCorner = (i: number) => Math.abs(k(i)) > 1 / CORNER_RADIUS_M;

  // Start scanning just after a straight so no corner is split at sample 0.
  const offset = Array.from({ length: n }, (_, i) => i).find((i) => !inCorner(i));
  if (offset === undefined) {
    return [];
  }

  const corners: Corner[] = [];
  let i = offset;
  while (i < offset + n) {
    const sign = Math.sign(k(i));
    if (!inCorner(i)) {
      i += 1;
      continue;
    }

    // One corner is a run of samples turning the same way.
    let end = i;
    let turn = 0;
    let apex = i;
    while (end < offset + n && inCorner(end) && Math.sign(k(end)) === sign) {
      turn += Math.abs(k(end)) * track.spacingM;
      if (Math.abs(k(end)) > Math.abs(k(apex))) {
        apex = end;
      }

      end += 1;
    }

    if (turn >= MIN_TURN_RAD) {
      const at = (s: number) => (((s % n) + n) % n) * track.spacingM;
      corners.push({
        number: 0,
        startM: at(i),
        apexM: at(apex),
        endM: at(end),
        direction: sign > 0 ? "left" : "right",
        radiusM: 1 / Math.abs(k(apex)),
      });
    }

    i = end;
  }

  const fromStart = (c: Corner) => (((c.apexM - startDistanceM) % track.lengthM) + track.lengthM) % track.lengthM;
  corners.sort((a, b) => fromStart(a) - fromStart(b));

  return corners.map((c, index) => ({ ...c, number: index + 1 }));
}

/**
 * The corner the driver is heading for, and how far away its entry is (0 once inside,
 * until the apex is passed).
 */
export function nextCorner(
  corners: readonly Corner[],
  lengthM: number,
  distanceM: number,
): { corner: Corner; inM: number } | undefined {
  let best: { corner: Corner; inM: number } | undefined;
  for (const corner of corners) {
    const toApex = (((corner.apexM - distanceM) % lengthM) + lengthM) % lengthM;
    const toStart = (((corner.startM - distanceM) % lengthM) + lengthM) % lengthM;

    // Past the entry but not the apex: the corner is under way.
    const inM = toStart > toApex ? 0 : toStart;
    if (!best || toApex < (((best.corner.apexM - distanceM) % lengthM) + lengthM) % lengthM) {
      best = { corner, inM };
    }
  }

  return best;
}

/** A top-down map of the circuit fitted into a box, north (+z) up. */
export function mapProjection(track: TrackGeometry, width: number, height: number, padding: number) {
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < track.count; i += 1) {
    [minX, maxX] = [Math.min(minX, track.x[i] ?? 0), Math.max(maxX, track.x[i] ?? 0)];
    [minZ, maxZ] = [Math.min(minZ, track.z[i] ?? 0), Math.max(maxZ, track.z[i] ?? 0)];
  }

  const scale = Math.min((width - 2 * padding) / (maxX - minX || 1), (height - 2 * padding) / (maxZ - minZ || 1));
  const offsetU = (width - (maxX - minX) * scale) / 2;
  const offsetV = (height - (maxZ - minZ) * scale) / 2;

  // Seen from above with +z up the screen, +x (the left of a car heading +z) is screen left.
  const toMap = (x: number, z: number): [number, number] => [
    offsetU + (maxX - x) * scale,
    offsetV + (maxZ - z) * scale,
  ];
  const parts: string[] = [];
  for (let i = 0; i < track.count; i += 2) {
    const [u, v] = toMap(track.x[i] ?? 0, track.z[i] ?? 0);
    parts.push(`${i === 0 ? "M" : "L"}${u.toFixed(1)} ${v.toFixed(1)}`);
  }

  return { toMap, scale, path: `${parts.join("")}Z` };
}

/**
 * The road from `behindM` before to `aheadM` after a lap distance, drawn heading-up in a
 * 100×100 box: the car sits at the bottom centre and the road ahead runs up the box.
 */
export function previewPath(track: TrackGeometry, distanceM: number, aheadM: number, behindM: number) {
  const car = track.pointAt(distanceM);

  // Metres of road per box unit, so the whole look-ahead fits above the car.
  const unit = aheadM / 85;
  const points: { u: number; v: number }[] = [];
  for (let d = 0; d <= aheadM + behindM; d += track.spacingM) {
    const p = track.pointAt(distanceM - behindM + d);
    const dx = p.x - car.x;
    const dz = p.z - car.z;
    const forward = dx * car.tx + dz * car.tz;
    const left = dx * car.tz - dz * car.tx;
    points.push({ u: 50 - left / unit, v: 90 - forward / unit });
  }

  // The first point drawn is the car's own position.
  const start = Math.round(behindM / track.spacingM);
  const ordered = [...points.slice(start), ...points.slice(0, start).reverse()];
  const ahead = points.slice(start);
  const path = ahead.map((p, i) => `${i === 0 ? "M" : "L"}${p.u.toFixed(1)} ${p.v.toFixed(1)}`).join("");
  const behind = points
    .slice(0, start + 1)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.u.toFixed(1)} ${p.v.toFixed(1)}`)
    .join("");

  return { points: ordered.slice(0, ahead.length), path, behind };
}
