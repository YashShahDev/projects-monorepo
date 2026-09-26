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

/** A structure spanning the road: its legs stand `widthM` apart across the track. */
export interface Span {
  kind: "gantry" | "bridge";
  x: number;
  z: number;

  /** The track's direction under it. */
  headingRad: number;
  widthM: number;

  /** Height of the underside above the road. */
  clearanceM: number;
}

/** Dressing on one barrier segment, from one barrier point to the next. */
export interface Attachment {
  kind: "hoarding" | "tyres" | "fence" | "pitwall";
  side: "left" | "right";
  a: { x: number; z: number };
  b: { x: number; z: number };
}

export interface SceneryLayout {
  grandstands: Footprint[];
  buildings: Building[];
  trees: Tree[];
  spans: Span[];
  attachments: Attachment[];
  marshals: Footprint[];
}

const STAND = { lengthM: 48, depthM: 14 };
const PITS = { lengthM: 110, depthM: 16, heightM: 7 };

// Behind the barrier, leaving room for a service road.
const SETBACK_M = 6;

// Trees stay outside the widest runoff (20 m) with room for the barrier and a verge.
const TREE_CLEARANCE_M = 24;
const TREE_ATTEMPTS = 700;
const TREE_BELT_M = 140;
const MAX_CORNER_STANDS = 7;

// Overhead structures clear the road by more than a car's camera ever rises.
const SPAN_CLEARANCE_M = { gantry: 6, bridge: 6.5 };

// Legs stand this far outside the kerbs, or a metre past a nearer barrier.
const SPAN_LEG_M = 3;
const MAX_BRIDGES = 2;
const STRAIGHT_CURVATURE = 1 / 800;

// Hoardings take alternate stretches of this length, so the barrier still shows.
const HOARDING_STRETCH_M = 40;
const FENCE_REACH_M = 70;
const MARSHAL = { lengthM: 2.5, depthM: 2.5 };
const MARSHAL_EVERY_M = 300;

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

    // The barrier can swing out beyond the anchor sample's offset, so check its whole
    // line against the footprint, with a metre to spare.
    const clearOfBarriers = trackside.barriers.every((run) =>
      run.points.every((p) => {
        const dx = p.x - f.x;
        const dz = p.z - f.z;

        return Math.abs(dx * fx + dz * fz) > f.lengthM / 2 + 1 || Math.abs(dx * fz - dz * fx) > f.depthM / 2 + 1;
      }),
    );
    const clearOfOthers = placed.every((o) => Math.hypot(o.x - f.x, o.z - f.z) > (o.lengthM + f.lengthM) / 2 + 10);

    return clearOfTrack && clearOfBarriers && clearOfOthers;
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
  const mainStands = grandstands.length;
  for (const corner of corners) {
    if (grandstands.length - mainStands >= MAX_CORNER_STANDS) {
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

  const spans = layoutSpans(track, trackside, start, edge);

  // Marshal posts at intervals round the lap, alternating sides.
  const marshals: Footprint[] = [];
  const every = Math.round(MARSHAL_EVERY_M / track.spacingM);
  for (let k = 0; k * every < n; k += 1) {
    const i = (start + Math.round(every / 2) + k * every) % n;
    for (const side of k % 2 === 0 ? (["left", "right"] as const) : (["right", "left"] as const)) {
      const post = beside(i, side, MARSHAL);
      if (fits(post)) {
        marshals.push(post);
        placed.push(post);
        break;
      }
    }
  }

  return {
    grandstands,
    buildings,
    trees,
    spans,
    attachments: layoutAttachments(track, trackside, grandstands, buildings[0]),
    marshals,
  };
}

/** The start gantry over the line, and sponsor bridges over the middle of the longest straights. */
function layoutSpans(track: TrackGeometry, trackside: Trackside, start: number, edge: number): Span[] {
  const n = track.count;
  const spanAt = (i: number, kind: Span["kind"]): Span | undefined => {
    const reach = (side: typeof trackside.left) => {
      const barrier = side.barrierM[i] ?? Number.NaN;
      const leg = edge + SPAN_LEG_M;

      return Number.isNaN(barrier) || barrier > leg ? leg : barrier + 1;
    };

    // Centred on the road: the wider side sets the width, so neither leg lands inside
    // the barrier on the narrower side.
    const half = Math.max(reach(trackside.left), reach(trackside.right));
    const [x, z, tx, tz] = [track.x[i] ?? 0, track.z[i] ?? 0, track.tx[i] ?? 0, track.tz[i] ?? 1];
    const legsClear = [-1, 1].every(
      (sign) => trackside.distanceToTrack(x + tz * half * sign, z - tx * half * sign, 80) > edge + 0.5,
    );

    return legsClear
      ? { kind, x, z, headingRad: Math.atan2(tx, tz), widthM: 2 * half, clearanceM: SPAN_CLEARANCE_M[kind] }
      : undefined;
  };

  const spans: Span[] = [];
  const gantry = spanAt(start, "gantry");
  if (gantry) {
    spans.push(gantry);
  }

  // Straight runs, longest first; a bridge goes over the middle of each.
  const straight = (i: number) => Math.abs(track.curvature[((i % n) + n) % n] ?? 0) < STRAIGHT_CURVATURE;
  const runs: { from: number; length: number }[] = [];
  const first = [...Array(n).keys()].find((i) => !straight(i)) ?? 0;
  let runStart: number | undefined;
  for (let k = 1; k <= n; k += 1) {
    const i = first + k;
    if (straight(i) && runStart === undefined) {
      runStart = i;
    } else if (!straight(i) && runStart !== undefined) {
      runs.push({ from: runStart, length: i - runStart });
      runStart = undefined;
    }
  }

  runs.sort((a, b) => b.length - a.length);
  const apart = (i: number) =>
    spans.every((s) => {
      const d = Math.abs(track.locate(s.x, s.z).index - i);

      return Math.min(d, n - d) * track.spacingM > 250;
    });
  for (const run of runs) {
    const middle = (run.from + Math.floor(run.length / 2)) % n;
    if (spans.filter((s) => s.kind === "bridge").length >= MAX_BRIDGES) {
      break;
    }

    const bridge = apart(middle) ? spanAt(middle, "bridge") : undefined;
    if (bridge) {
      spans.push(bridge);
    }
  }

  return spans;
}

/**
 * Dresses each barrier segment by what is beside it: the pit wall along the pits, debris
 * fencing by the stands, tyre walls where there is run-off (the corners), and sponsor
 * hoardings on alternate stretches of the rest.
 */
function layoutAttachments(
  track: TrackGeometry,
  trackside: Trackside,
  grandstands: Footprint[],
  pits: Building | undefined,
): Attachment[] {
  const attachments: Attachment[] = [];
  for (const run of trackside.barriers) {
    const points = run.closed ? [...run.points, run.points[0] ?? { x: 0, z: 0 }] : run.points;
    const runoff = (run.side === "left" ? trackside.left : trackside.right).runoff;
    for (let k = 0; k + 1 < points.length; k += 1) {
      const a = points[k] ?? { x: 0, z: 0 };
      const b = points[k + 1] ?? a;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const i = (run.first + k) % track.count;
      const near = (f: Footprint, reach: number) => f.side === run.side && Math.hypot(f.x - mid.x, f.z - mid.z) < reach;
      let kind: Attachment["kind"] | undefined;
      if (pits && near(pits, pits.lengthM / 2 + 12)) {
        kind = "pitwall";
      } else if (grandstands.some((f) => near(f, FENCE_REACH_M))) {
        kind = "fence";
      } else if ((runoff[i] ?? "grass") !== "grass") {
        kind = "tyres";
      } else if (Math.floor((i * track.spacingM) / HOARDING_STRETCH_M) % 2 === 0) {
        kind = "hoarding";
      }

      if (kind) {
        attachments.push({ kind, side: run.side, a, b });
      }
    }
  }

  return attachments;
}
