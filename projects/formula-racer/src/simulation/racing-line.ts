import type { CarDefinition } from "../content/car.ts";
import type { TrackGeometry } from "./track-geometry.ts";

const GRAVITY = 9.81;
const AIR_DENSITY_KG_M3 = 1.225;

// The profile uses this share of the tyre's quoted friction. With it, every corner
// speed stays under the steady lateral g the car held in the P6-C5 measurements
// (1.84 g at 100 km/h, 3.24 g at 200), where the full figure would promise 2.23 and 3.53.
const GRIP_USE = 0.8;

// Half the car's width (half track plus half a tyre), and a margin from the edge.
const TYRE_HALF_WIDTH_M = 0.2;
const EDGE_MARGIN_M = 0.3;

// The profile never plans above this; power and drag cap the car well below it.
const TOP_SPEED_MPS = 120;

// Seconds of travel before a braking zone that count as the lift warning.
export const LIFT_WARNING_S = 0.6;

export interface LineLimits {
  massKg: number;

  /** Tyre friction the profile plans on. */
  mu: number;

  /** Downforce and drag per (m/s)², N. */
  downforceK: number;
  dragK: number;
  maxPowerW: number;
  maxDriveForceN: number;
  maxBrakeForceN: number;

  /** How far the line's centre stays from the track edge, metres. */
  clearanceM: number;
}

export function lineLimits(car: CarDefinition): LineLimits {
  return {
    massKg: car.massKg,
    mu: car.wheels.frictionCoefficient * GRIP_USE,
    downforceK: 0.5 * AIR_DENSITY_KG_M3 * car.aero.downforceAreaM2,
    dragK: 0.5 * AIR_DENSITY_KG_M3 * car.aero.dragAreaM2,
    maxPowerW: car.powertrain.maxPowerW,
    maxDriveForceN: car.powertrain.maxDriveForceN,
    maxBrakeForceN: car.brakes.maxForceN,
    clearanceM: car.wheels.halfTrack + TYRE_HALF_WIDTH_M + EDGE_MARGIN_M,
  };
}

/** Total grip the tyres give at a speed, as an acceleration, m/s². */
const gripMps2 = (l: LineLimits, v: number): number => l.mu * (GRAVITY + (l.downforceK * v * v) / l.massKg);

/** Deceleration the profile plans on when braking in a straight line at `v`, m/s². */
export function brakingDecelMps2(l: LineLimits, v: number): number {
  return Math.min(gripMps2(l, v), l.maxBrakeForceN / l.massKg) + (l.dragK * v * v) / l.massKg;
}

export type GuidePhase = "go" | "lift" | "brake";

export interface RacingLine {
  count: number;
  x: Float64Array;
  z: Float64Array;

  /** Lateral offset from the centreline per centreline sample; positive is left. */
  offsetM: Float64Array;

  /** Distance from each point to the next along the line, metres. */
  stepM: Float64Array;

  /** Signed curvature of the line, 1/m; positive turns left. */
  curvature: Float64Array;

  /** The fastest speed the car can carry at each point, m/s. */
  speedMps: Float64Array;
  phase: GuidePhase[];
}

// Coarse levels first: the long, smooth parts of the line barely move under
// Gauss–Seidel on a fine grid, so each level starts from the coarser one's answer.
const LEVELS: { every: number; sweeps: number }[] = [
  { every: 8, sweeps: 3000 },
  { every: 2, sweeps: 800 },
  { every: 1, sweeps: 300 },
];

/**
 * Minimises the sum of squared second differences of the line's points (its squared
 * curvature, on an even spacing) over offsets within ±`bound`, by projected
 * Gauss–Seidel. Each offset's objective is a parabola with curvature 6, so the exact
 * coordinate minimum is one step, clamped to the bound.
 */
function relax(
  cx: number[],
  cz: number[],
  nx: number[],
  nz: number[],
  offset: number[],
  bound: number,
  sweeps: number,
) {
  const m = cx.length;
  const px = (i: number) => (cx[i] ?? 0) + (offset[i] ?? 0) * (nx[i] ?? 0);
  const pz = (i: number) => (cz[i] ?? 0) + (offset[i] ?? 0) * (nz[i] ?? 0);
  const wrap = (i: number) => (i + m) % m;
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    for (let j = 0; j < m; j += 1) {
      let gradient = 0;
      for (const [i, weight] of [
        [wrap(j - 1), 1],
        [j, -2],
        [wrap(j + 1), 1],
      ] as const) {
        const [a, c] = [wrap(i - 1), wrap(i + 1)];
        const rx = px(a) - 2 * px(i) + px(c);
        const rz = pz(a) - 2 * pz(i) + pz(c);
        gradient += weight * (rx * (nx[j] ?? 0) + rz * (nz[j] ?? 0));
      }

      offset[j] = Math.max(-bound, Math.min(bound, (offset[j] ?? 0) - gradient / 6));
    }
  }
}

/** Periodic Catmull-Rom through evenly spaced `coarse` values, sampled `every` times per gap. */
function refine(coarse: number[], n: number, every: number): number[] {
  const m = coarse.length;
  const at = (i: number) => coarse[((i % m) + m) % m] ?? 0;

  return Array.from({ length: n }, (_, k) => {
    const i = Math.floor(k / every);
    const t = k / every - i;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];

    return (
      0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 + p3 - 3 * p2) * t * t * t)
    );
  });
}

function solveOffsets(geometry: TrackGeometry, bound: number): number[] {
  const n = geometry.count;
  let offset: number[] | undefined;
  let previousEvery = 0;
  for (const { every, sweeps } of LEVELS) {
    // A level only runs when the lap divides evenly into its spacing.
    if (n % every !== 0) {
      continue;
    }

    const indices = Array.from({ length: n / every }, (_, j) => j * every);
    const cx = indices.map((i) => geometry.x[i] ?? 0);
    const cz = indices.map((i) => geometry.z[i] ?? 0);

    // The left normal of a tangent (tx, tz) is (tz, −tx).
    const nx = indices.map((i) => geometry.tz[i] ?? 0);
    const nz = indices.map((i) => -(geometry.tx[i] ?? 0));
    const start = offset ? refine(offset, indices.length, previousEvery / every) : indices.map(() => 0);
    const clamped = start.map((o) => Math.max(-bound, Math.min(bound, o)));
    relax(cx, cz, nx, nz, clamped, bound, sweeps);
    offset = clamped;
    previousEvery = every;
  }

  return offset ?? Array.from({ length: n }, () => 0);
}

/** Signed curvature through the points `k` samples either side. */
function curvatureAt(x: Float64Array, z: Float64Array, i: number, k: number): number {
  const n = x.length;
  const [a, c] = [(i - k + n) % n, (i + k) % n];
  const [ax, az, bx, bz, cx, cz] = [x[a] ?? 0, z[a] ?? 0, x[i] ?? 0, z[i] ?? 0, x[c] ?? 0, z[c] ?? 0];

  // Turning from +z toward +x is a left turn (positive), so the cross product is taken
  // as (b − a) × (c − b) with that sign.
  const cross = (bz - az) * (cx - bx) - (bx - ax) * (cz - bz);
  const lengths = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az);

  return lengths > 1e-9 ? (2 * cross) / lengths : 0;
}

function speedProfile(l: LineLimits, curvature: Float64Array, stepM: Float64Array): Float64Array {
  const n = curvature.length;
  const m = l.massKg;
  const cornerLimit = Float64Array.from(curvature, (k) => {
    // v²·|κ| ≤ μ(g + k_df·v²/m), solved for v.
    const denominator = Math.abs(k) - (l.mu * l.downforceK) / m;

    return denominator <= 0 ? TOP_SPEED_MPS : Math.min(TOP_SPEED_MPS, Math.sqrt((l.mu * GRAVITY) / denominator));
  });

  // Longitudinal grip left over from cornering, on a friction circle.
  const spare = (v: number, i: number) => {
    const grip = gripMps2(l, v);
    const lateral = v * v * Math.abs(curvature[i] ?? 0);

    return Math.sqrt(Math.max(0, grip * grip - lateral * lateral));
  };

  // Both passes start at the slowest corner, where the profile must equal its limit,
  // so neither needs to be run round the lap seam again.
  let start = 0;
  cornerLimit.forEach((v, i) => {
    if (v < (cornerLimit[start] ?? Infinity)) {
      start = i;
    }
  });

  const forward = Float64Array.from(cornerLimit);
  for (let t = 0; t < n - 1; t += 1) {
    const i = (start + t) % n;
    const j = (i + 1) % n;
    const v = forward[i] ?? 0;
    const drive = Math.min(l.maxDriveForceN, l.maxPowerW / Math.max(v, 1)) / m;
    const accel = Math.min(drive, spare(v, i)) - (l.dragK * v * v) / m;
    const reach = Math.sqrt(Math.max(0, v * v + 2 * accel * (stepM[i] ?? 0)));
    forward[j] = Math.min(cornerLimit[j] ?? 0, reach);
  }

  const backward = Float64Array.from(cornerLimit);
  for (let t = 0; t < n - 1; t += 1) {
    const i = (start - t + n) % n;
    const p = (i - 1 + n) % n;
    const v = backward[i] ?? 0;
    const decel = Math.min(spare(v, i), l.maxBrakeForceN / m) + (l.dragK * v * v) / m;
    const reach = Math.sqrt(v * v + 2 * decel * (stepM[p] ?? 0));
    backward[p] = Math.min(cornerLimit[p] ?? 0, reach);
  }

  return forward.map((v, i) => Math.min(v, backward[i] ?? 0));
}

function phases(speed: Float64Array, stepM: Float64Array): GuidePhase[] {
  const n = speed.length;
  const phase: GuidePhase[] = Array.from({ length: n }, (_, i) =>
    (speed[(i + 1) % n] ?? 0) < (speed[i] ?? 0) - 0.05 ? "brake" : "go",
  );
  for (let i = 0; i < n; i += 1) {
    if (phase[i] !== "brake" || phase[(i - 1 + n) % n] === "brake") {
      continue;
    }

    // Walk back from the start of each braking zone through the lift window.
    const window = (speed[i] ?? 0) * LIFT_WARNING_S;
    let covered = 0;
    for (let k = (i - 1 + n) % n; covered < window && phase[k] === "go"; k = (k - 1 + n) % n) {
      phase[k] = "lift";
      covered += stepM[k] ?? 0;
    }
  }

  return phase;
}

export function buildRacingLine(geometry: TrackGeometry, limits: LineLimits): RacingLine {
  const n = geometry.count;
  const bound = Math.max(0, geometry.halfWidthM - limits.clearanceM);
  const offsetM = Float64Array.from(solveOffsets(geometry, bound));
  const x = Float64Array.from(
    { length: n },
    (_, i) => (geometry.x[i] ?? 0) + (offsetM[i] ?? 0) * (geometry.tz[i] ?? 0),
  );
  const z = Float64Array.from(
    { length: n },
    (_, i) => (geometry.z[i] ?? 0) - (offsetM[i] ?? 0) * (geometry.tx[i] ?? 0),
  );
  const stepM = Float64Array.from({ length: n }, (_, i) => {
    const j = (i + 1) % n;

    return Math.hypot((x[j] ?? 0) - (x[i] ?? 0), (z[j] ?? 0) - (z[i] ?? 0));
  });

  // Over ±2 samples, so the curvature reads the line's shape rather than the offset's
  // interpolation noise.
  const curvature = Float64Array.from({ length: n }, (_, i) => curvatureAt(x, z, i, 2));
  const speedMps = speedProfile(limits, curvature, stepM);

  return { count: n, x, z, offsetM, stepM, curvature, speedMps, phase: phases(speedMps, stepM) };
}

export interface GuideInput {
  /** The car's speed now. */
  speedMps: number;

  /** How far ahead of the car this point of the line is. */
  aheadM: number;

  /** The profile's speed at this point. */
  targetMps: number;
  decelMps2: number;
  liftS: number;

  /** The profile's own phase at this point. */
  phase: GuidePhase;
}

/**
 * Colour of one point of the guide ahead of the car: the profile's own phase, raised
 * to "brake" when the car is too fast to reach the point's speed without braking now,
 * and to "lift" when it will be within `liftS` of having to.
 */
export function guideColour(input: GuideInput): GuidePhase {
  const { speedMps: v, targetMps: target } = input;
  const needM = v > target ? (v * v - target * target) / (2 * input.decelMps2) : 0;
  if (needM > 0 && needM >= input.aheadM) {
    return "brake";
  }

  if (needM > 0 && needM >= input.aheadM - v * input.liftS && input.phase === "go") {
    return "lift";
  }

  return input.phase;
}

/** The slowest the profile goes between two lap distances (either may pass the lap line). */
export function slowestBetween(line: RacingLine, spacingM: number, fromM: number, toM: number): number {
  const n = line.count;
  let slowest = Infinity;
  for (let k = Math.round(fromM / spacingM); k <= Math.round(toM / spacingM); k += 1) {
    slowest = Math.min(slowest, line.speedMps[((k % n) + n) % n] ?? Infinity);
  }

  return slowest;
}
