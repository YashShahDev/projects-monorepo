import type { Surface, TrackGeometry, TrackLocation } from "./track-geometry.ts";

/** What lies between the kerb and the barrier. */
export type Runoff = "grass" | "gravel" | "asphalt";

/** Everything a wheel can stand on; asphalt runoff grips like the road. */
export type GroundSurface = Surface | "gravel" | "asphalt";

export interface TracksideEdge {
  /** Per centreline sample. */
  runoff: Runoff[];

  /** Distance from the centreline to the barrier's face, metres; NaN where there is none. */
  barrierM: Float64Array;

  /** Distance from the centreline to the outer edge of the runoff surface, metres. */
  runoffM: Float64Array;
}

export interface Trackside {
  left: TracksideEdge;
  right: TracksideEdge;

  /** Barrier face lines as world points, each an unbroken run (closed when `closed`). */
  barriers: { points: { x: number; z: number }[]; closed: boolean; side: "left" | "right" }[];
  surfaceAt(location: TrackLocation): GroundSurface;

  /** Distance from (x, z) to the nearest centreline sample, or Infinity beyond `reachM`. */
  distanceToTrack(x: number, z: number, reachM: number): number;
}

/** Gravel's rolling resistance on each wheel in it, N: four wheels decelerate the car ~0.75 g. */
export const GRAVEL_DRAG_N = 1500;

// A corner is anywhere tighter than this; gentler bends keep the straights' grass.
const CORNER_RADIUS_M = 300;

// Hairpins get asphalt runoff, the modern choice where cars arrive slowly.
const HAIRPIN_RADIUS_M = 30;

// Gravel starts a little before the corner and runs well past it, where cars run wide.
const GRAVEL_BEFORE_M = 30;
const GRAVEL_AFTER_M = 90;
const RUNOFF_M: Record<Runoff, number> = { grass: 10, gravel: 20, asphalt: 16 };

// Barriers keep this far from any part of the track, and from their own side's
// centreline at least the kerb plus this.
const MIN_CLEARANCE_M = 2;
const SMOOTH_SAMPLES = 12;

/** A lookup of centreline samples by 20 m grid cell, for "how close is the track" checks. */
function sampleGrid(track: TrackGeometry) {
  const cell = 20;
  const cells = new Map<string, number[]>();
  const key = (cx: number, cz: number) => `${String(cx)},${String(cz)}`;
  for (let i = 0; i < track.count; i += 1) {
    const k = key(Math.floor((track.x[i] ?? 0) / cell), Math.floor((track.z[i] ?? 0) / cell));
    cells.set(k, [...(cells.get(k) ?? []), i]);
  }

  /** Nearest centreline distance from (x, z), searching `reach` metres around it. */
  return (x: number, z: number, reach: number): number => {
    const span = Math.ceil(reach / cell);
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = Number.POSITIVE_INFINITY;
    for (let dx = -span; dx <= span; dx += 1) {
      for (let dz = -span; dz <= span; dz += 1) {
        for (const i of cells.get(key(cx + dx, cz + dz)) ?? []) {
          best = Math.min(best, Math.hypot((track.x[i] ?? 0) - x, (track.z[i] ?? 0) - z));
        }
      }
    }

    return best;
  };
}

/** Runoff for one side: gravel or asphalt on the outside of each corner, grass elsewhere. */
function runoffFor(track: TrackGeometry, sign: 1 | -1): Runoff[] {
  const n = track.count;
  const runoff = Array.from({ length: n }, (): Runoff => "grass");
  const before = Math.round(GRAVEL_BEFORE_M / track.spacingM);
  const after = Math.round(GRAVEL_AFTER_M / track.spacingM);

  // A left-hand corner (positive curvature) runs wide to the right, and vice versa.
  const outside = (i: number) => -sign * (track.curvature[i] ?? 0) > 1 / CORNER_RADIUS_M;
  let i = 0;
  while (i < n) {
    if (!outside(i) || outside((i - 1 + n) % n)) {
      i += 1;
      continue;
    }

    let end = i;
    let tightest = 0;
    while (outside(end % n) && end < i + n) {
      tightest = Math.max(tightest, Math.abs(track.curvature[end % n] ?? 0));
      end += 1;
    }

    const kind: Runoff = tightest > 1 / HAIRPIN_RADIUS_M ? "asphalt" : "gravel";
    for (let k = i - before; k < end + after; k += 1) {
      const j = ((k % n) + n) % n;

      // Asphalt wins where zones overlap: it is only chosen where cars arrive slowly.
      if (runoff[j] !== "asphalt") {
        runoff[j] = kind;
      }
    }

    i = end;
  }

  // A track that is one endless corner never has an entry; treat it all as corner.
  if (!runoff.some((r) => r !== "grass") && Array.from({ length: n }, (_, k) => k).every(outside)) {
    runoff.fill("gravel");
  }

  return runoff;
}

/** Tightest curvature toward this side within the smoothing window; 0 on an outside. */
function insideCurvature(track: TrackGeometry, i: number, sign: 1 | -1): number {
  let tightest = 0;
  for (let k = -SMOOTH_SAMPLES; k <= SMOOTH_SAMPLES; k += 1) {
    tightest = Math.max(tightest, (track.curvature[(i + k + track.count) % track.count] ?? 0) * sign);
  }

  return tightest;
}

/** The painted runoff's outer edge: its width, cut short by the barrier and inside bends. */
function runoffExtent(track: TrackGeometry, runoff: Runoff[], barrierM: Float64Array, sign: 1 | -1) {
  const edge = track.halfWidthM + track.kerbWidthM;

  return Float64Array.from(runoff, (r, i) => {
    const inside = insideCurvature(track, i, sign);
    const barrier = barrierM[i] ?? Number.NaN;
    let extent = edge + RUNOFF_M[r];
    if (inside > 0) {
      extent = Math.min(extent, 0.5 / inside);
    }

    if (!Number.isNaN(barrier)) {
      extent = Math.min(extent, barrier);
    }

    return Math.max(edge, extent);
  });
}

function barrierFor(track: TrackGeometry, runoff: Runoff[], sign: 1 | -1, near: ReturnType<typeof sampleGrid>) {
  const n = track.count;
  const edge = track.halfWidthM + track.kerbWidthM;
  const closest = edge + MIN_CLEARANCE_M;
  const limit = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let wanted = edge + RUNOFF_M[runoff[i] ?? "grass"];

    // On the inside of a bend an offset past the radius folds the line back on itself.
    const tightest = insideCurvature(track, i, sign);
    if (tightest > 0) {
      wanted = Math.min(wanted, 0.5 / tightest);
    }

    const x = track.x[i] ?? 0;
    const z = track.z[i] ?? 0;
    const lx = (track.tz[i] ?? 0) * sign;
    const lz = -(track.tx[i] ?? 0) * sign;

    // Pull in until no other part of the circuit is within the kerb plus clearance.
    let offset = wanted;
    while (offset >= closest && near(x + lx * offset, z + lz * offset, edge + closest) < closest - 1e-6) {
      offset -= 0.5;
    }

    limit[i] = offset >= closest ? offset : Number.NaN;
  }

  // Moving minimum, then moving average: never further out than any limit in reach,
  // and smooth enough not to zig-zag between samples.
  const windowed = (values: Float64Array, pick: (window: number[]) => number) =>
    Float64Array.from(values, (_, i) => {
      const window: number[] = [];
      for (let k = -SMOOTH_SAMPLES; k <= SMOOTH_SAMPLES; k += 1) {
        window.push(values[(i + k + n) % n] ?? Number.NaN);
      }

      return pick(window);
    });
  const minimum = windowed(limit, (w) => (w.some(Number.isNaN) ? Number.NaN : Math.min(...w)));
  const smooth = windowed(minimum, (w) => (w.some(Number.isNaN) ? Number.NaN : w.reduce((a, b) => a + b) / w.length));

  // Where the average dropped a sample that had a limit, keep the (safe) minimum.
  return Float64Array.from(smooth, (v, i) => (Number.isNaN(v) ? (minimum[i] ?? Number.NaN) : v));
}

function runsOf(track: TrackGeometry, barrierM: Float64Array, sign: 1 | -1, side: "left" | "right") {
  const n = track.count;
  const point = (i: number) => {
    const offset = (barrierM[i] ?? 0) * sign;

    return { x: (track.x[i] ?? 0) + (track.tz[i] ?? 0) * offset, z: (track.z[i] ?? 0) - (track.tx[i] ?? 0) * offset };
  };

  const has = (i: number) => !Number.isNaN(barrierM[((i % n) + n) % n] ?? Number.NaN);
  if (Array.from({ length: n }, (_, i) => i).every(has)) {
    return [{ points: Array.from({ length: n }, (_, i) => point(i)), closed: true, side }];
  }

  // Start just after a gap so a run that wraps past sample 0 stays whole.
  const first = Array.from({ length: n }, (_, i) => i).find((i) => has(i) && !has(i - 1)) ?? 0;
  const runs: { points: { x: number; z: number }[]; closed: boolean; side: "left" | "right" }[] = [];
  let current: { x: number; z: number }[] = [];
  for (let k = 0; k < n; k += 1) {
    const i = (first + k) % n;
    if (has(i)) {
      current.push(point(i));
    } else if (current.length > 0) {
      runs.push({ points: current, closed: false, side });
      current = [];
    }
  }

  if (current.length > 1) {
    runs.push({ points: current, closed: false, side });
  }

  return runs.filter((run) => run.points.length > 1);
}

/**
 * Lays out what surrounds the circuit: runoff by corner and barriers that keep clear of
 * every part of the track. Deterministic, so physics and rendering agree.
 */
export function buildTrackside(track: TrackGeometry): Trackside {
  const near = sampleGrid(track);
  const edges = ([1, -1] as const).map((sign) => {
    const runoff = runoffFor(track, sign);
    const barrierM = barrierFor(track, runoff, sign, near);

    return { runoff, barrierM, runoffM: runoffExtent(track, runoff, barrierM, sign) };
  });
  const [left, right] = edges as [TracksideEdge, TracksideEdge];

  return {
    left,
    right,
    barriers: [...runsOf(track, left.barrierM, 1, "left"), ...runsOf(track, right.barrierM, -1, "right")],
    distanceToTrack: near,
    surfaceAt(location) {
      if (location.surface !== "grass") {
        return location.surface;
      }

      // The same extent the renderer paints, so what a wheel feels is what is drawn.
      const edge = location.lateralM > 0 ? left : right;
      const reach = edge.runoffM[location.index] ?? 0;

      return Math.abs(location.lateralM) <= reach ? (edge.runoff[location.index] ?? "grass") : "grass";
    },
  };
}
