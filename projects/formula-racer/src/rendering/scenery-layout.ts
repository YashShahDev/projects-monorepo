import type { TrackGeometry } from "../simulation/track-geometry.ts";
import type { Trackside } from "../simulation/trackside.ts";

/** A box on the ground: `lengthM` runs along `headingRad` (0 faces +z), `depthM` across it. */
export interface Footprint {
  x: number;
  z: number;
  headingRad: number;
  lengthM: number;
  depthM: number;

  /** Which side of the track it stands on; stands rise away from the track. */
  side: "left" | "right";
}

export interface Building extends Footprint {
  kind: "pits" | "tower";
  heightM: number;
}

export interface Tree {
  x: number;
  z: number;

  /** Height, metres. */
  heightM: number;
}

export interface SceneryLayout {
  grandstands: Footprint[];
  buildings: Building[];
  trees: Tree[];
}

const STAND = { lengthM: 48, depthM: 14 };
const PITS = { lengthM: 110, depthM: 16, heightM: 7 };

// Behind the barrier, leaving room for a service road.
const SETBACK_M = 6;

// Trees stay outside the widest runoff (20 m) with room for the barrier and a verge.
const TREE_CLEARANCE_M = 24;
const TREE_ATTEMPTS = 700;
const TREE_BELT_M = 140;
const MAX_CORNER_STANDS = 4;

/** Mulberry32: small, fast and the same on every engine, so scenery never shifts. */
function random(seed: number) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Places stands, buildings and trees around a circuit. Everything stays behind the
 * barriers and clear of every part of the track; the same track always gets the same
 * layout.
 */
export function layoutScenery(
  track: TrackGeometry,
  trackside: Trackside,
  startDistanceM: number,
  seed = 1,
): SceneryLayout {
  const edge = track.halfWidthM + track.kerbWidthM;
  const n = track.count;

  /** A footprint beside sample `i`, its track-facing side `setback` behind the barrier. */
  const beside = (i: number, side: "left" | "right", size: { lengthM: number; depthM: number }) => {
    const sign = side === "left" ? 1 : -1;
    const sideEdge = side === "left" ? trackside.left : trackside.right;
    const barrier = sideEdge.barrierM[i] ?? Number.NaN;
    const face = (Number.isNaN(barrier) ? (sideEdge.runoffM[i] ?? edge) : barrier) + SETBACK_M;
    const offset = (face + size.depthM / 2) * sign;
    const tx = track.tx[i] ?? 0;
    const tz = track.tz[i] ?? 1;
    const footprint: Footprint = {
      x: (track.x[i] ?? 0) + tz * offset,
      z: (track.z[i] ?? 0) - tx * offset,
      headingRad: Math.atan2(tx, tz),
      ...size,
      side,
    };

    return footprint;
  };

  const placed: Footprint[] = [];
  const fits = (f: Footprint) => {
    const fx = Math.sin(f.headingRad);
    const fz = Math.cos(f.headingRad);
    const points = [{ x: f.x, z: f.z }];
    for (const a of [-1, -0.5, 0, 0.5, 1]) {
      for (const b of [-1, 1]) {
        points.push({
          x: f.x + fx * a * (f.lengthM / 2) + fz * b * (f.depthM / 2),
          z: f.z + fz * a * (f.lengthM / 2) - fx * b * (f.depthM / 2),
        });
      }
    }

    const clearOfTrack = points.every((p) => trackside.distanceToTrack(p.x, p.z, 80) > edge + SETBACK_M);
    const clearOfOthers = placed.every((o) => Math.hypot(o.x - f.x, o.z - f.z) > (o.lengthM + f.lengthM) / 2 + 10);

    return clearOfTrack && clearOfOthers;
  };

  const start = track.locate(track.pointAt(startDistanceM).x, track.pointAt(startDistanceM).z).index;
  const grandstands: Footprint[] = [];
  const buildings: Building[] = [];

  // The main grandstand faces the pits across the start line; try both ways round.
  for (const [standSide, pitSide] of [
    ["right", "left"],
    ["left", "right"],
  ] as const) {
    const stand = beside(start, standSide, STAND);
    const pits = { ...beside(start, pitSide, PITS), kind: "pits" as const, heightM: PITS.heightM };
    if (fits(stand) && fits(pits)) {
      grandstands.push(stand);
      buildings.push(pits);
      placed.push(stand, pits);
      break;
    }
  }

  // Spectators gather where cars brake hardest: outside the slowest corners, where the
  // gravel and asphalt runoff are.
  const corners: { i: number; side: "left" | "right"; curvature: number }[] = [];
  for (const side of ["left", "right"] as const) {
    const runoff = (side === "left" ? trackside.left : trackside.right).runoff;
    for (let i = 0; i < n; i += 1) {
      if (runoff[i] !== "grass" && runoff[(i - 1 + n) % n] === "grass") {
        let end = i;
        let tightest = 0;
        let apex = i;
        while (runoff[end % n] !== "grass" && end < i + n) {
          const k = Math.abs(track.curvature[end % n] ?? 0);
          if (k > tightest) {
            tightest = k;
            apex = end % n;
          }

          end += 1;
        }

        corners.push({ i: apex, side, curvature: tightest });
      }
    }
  }

  corners.sort((a, b) => b.curvature - a.curvature);
  for (const corner of corners) {
    if (grandstands.length > MAX_CORNER_STANDS) {
      break;
    }

    // Slide along the runoff a little until the stand fits.
    for (const shift of [0, 10, -10, 20, -20, 30]) {
      const stand = beside((corner.i + shift + n) % n, corner.side, STAND);
      if (fits(stand)) {
        grandstands.push(stand);
        placed.push(stand);
        break;
      }
    }
  }

  // A race-control tower at the end of the pits.
  const pits = buildings[0];
  if (pits) {
    const along = Math.round((PITS.lengthM / 2 + 12) / track.spacingM);
    const tower = {
      ...beside((start + along) % n, pits.side, { lengthM: 12, depthM: 12 }),
      kind: "tower" as const,
      heightM: 18,
    };
    if (fits(tower)) {
      buildings.push(tower);
      placed.push(tower);
    }
  }

  // Trees in a belt along the circuit, where the camera sees them: trees far out cost
  // as much to draw and are rarely in view.
  const next = random(seed);
  const trees: Tree[] = [];
  for (let attempt = 0; attempt < TREE_ATTEMPTS; attempt += 1) {
    const i = Math.floor(next() * n);
    const sign = next() < 0.5 ? 1 : -1;
    const offset = (edge + TREE_CLEARANCE_M + next() * TREE_BELT_M) * sign;
    const x = (track.x[i] ?? 0) + (track.tz[i] ?? 0) * offset;
    const z = (track.z[i] ?? 0) - (track.tx[i] ?? 0) * offset;
    const heightM = 6 + next() * 8;

    // Another part of the circuit may pass closer than this one.
    if (trackside.distanceToTrack(x, z, 60) <= edge + TREE_CLEARANCE_M) {
      continue;
    }

    if (placed.some((f) => Math.hypot(f.x - x, f.z - z) <= f.lengthM / 2 + 4)) {
      continue;
    }

    trees.push({ x, z, heightM });
  }

  return { grandstands, buildings, trees };
}
