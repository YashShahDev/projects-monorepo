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

// Softens the friction circle's square root at the grip limit, m/s².
const SPARE_SOFTENING = 0.5;

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

  /**
   * The profile's estimated lap at each step of the build: the minimum-curvature line,
   * then each accepted minimum-time step.
   */
  lapTimesS: number[];
}

// Second differences of the line's points: Σ|p(i−1) − 2p(i) + p(i+1)|² is its squared
// curvature summed on an even spacing, and it is exactly quadratic in the lateral
// offsets. Its Hessian is DᵀD, whose stencil is 6, −4, 1 at distances 0, 1, 2, weighted
// by how the normals at the two points align.
const STENCIL = [6, -4, 1];

// ADMM brings the offsets near the answer and finds which points sit at the edges; an
// active-set polish then solves exactly on that set.
const ADMM_RHO = 1;
const ADMM_ITERATIONS = 400;
const POLISH_ROUNDS = 60;

// Keeps the system positive definite where a long straight barely fixes its offsets.
const REGULARISE = 1e-9;

type Solve = (b: Float64Array) => Float64Array;

/** Gaussian elimination, for systems too short for the banded solver. */
function denseSolver(m: number, entry: (r: number, s: number) => number): Solve {
  const a = Array.from({ length: m }, (_row, r) => Float64Array.from({ length: m }, (_column, c) => entry(r, c)));

  return (b) => {
    const rows = a.map((row, r) => Float64Array.from([...row, b[r] ?? 0]));
    for (let c = 0; c < m; c += 1) {
      const pivot = rows[c] ?? new Float64Array(m + 1);
      for (let r = c + 1; r < m; r += 1) {
        const row = rows[r] ?? new Float64Array(m + 1);
        const f = (row[c] ?? 0) / (pivot[c] ?? 1);
        for (let k = c; k <= m; k += 1) {
          row[k] = (row[k] ?? 0) - f * (pivot[k] ?? 0);
        }
      }
    }

    const x = new Float64Array(m);
    for (let r = m - 1; r >= 0; r -= 1) {
      const row = rows[r] ?? new Float64Array(m + 1);
      let sum = row[m] ?? 0;
      for (let k = r + 1; k < m; k += 1) {
        sum -= (row[k] ?? 0) * (x[k] ?? 0);
      }

      x[r] = sum / (row[r] ?? 1);
    }

    return x;
  };
}

/** LDLᵀ of a symmetric positive-definite matrix with two sub-diagonals, no wrap. */
function bandedSolver(k: number, entry: (r: number, s: number) => number): Solve {
  const d = new Float64Array(k);
  const a = new Float64Array(k);
  const b = new Float64Array(k);
  for (let i = 0; i < k; i += 1) {
    b[i] = i >= 2 ? entry(i, i - 2) / (d[i - 2] ?? 1) : 0;
    a[i] = i >= 1 ? (entry(i, i - 1) - (b[i] ?? 0) * (d[i - 2] ?? 0) * (a[i - 1] ?? 0)) / (d[i - 1] ?? 1) : 0;
    d[i] = entry(i, i) - (a[i] ?? 0) ** 2 * (d[i - 1] ?? 0) - (b[i] ?? 0) ** 2 * (d[i - 2] ?? 0);
  }

  return (r) => {
    const y = new Float64Array(k);
    for (let i = 0; i < k; i += 1) {
      y[i] = (r[i] ?? 0) - (a[i] ?? 0) * (y[i - 1] ?? 0) - (b[i] ?? 0) * (y[i - 2] ?? 0);
    }

    for (let i = 0; i < k; i += 1) {
      y[i] = (y[i] ?? 0) / (d[i] ?? 1);
    }

    for (let i = k - 1; i >= 0; i -= 1) {
      y[i] = (y[i] ?? 0) - (a[i + 1] ?? 0) * (y[i + 1] ?? 0) - (b[i + 2] ?? 0) * (y[i + 2] ?? 0);
    }

    return y;
  };
}

/**
 * Solves A x = b for a symmetric positive-definite A whose entries vanish beyond two
 * places either side of the diagonal, wrapping round as a closed loop does. The last two
 * unknowns are split off so the rest is a plain band, and a 2×2 Schur complement
 * couples them back: O(m) to factor and to solve.
 */
function cyclicBandedSolver(m: number, entry: (r: number, s: number) => number): Solve {
  if (m < 7) {
    return denseSolver(m, entry);
  }

  const k = m - 2;
  const inner = bandedSolver(k, entry);

  // The only inner rows coupled to the last two unknowns: two at each end.
  const edge = [0, 1, k - 2, k - 1];
  const column = (j: number) => {
    const c = new Float64Array(k);
    for (const i of edge) {
      c[i] = entry(i, j);
    }

    return c;
  };

  const w = [inner(column(k)), inner(column(k + 1))];
  const s = [0, 1].map((p) =>
    [0, 1].map((q) => entry(k + p, k + q) - edge.reduce((sum, i) => sum + entry(k + p, i) * (w[q]?.[i] ?? 0), 0)),
  );
  const [s00, s01, s10, s11] = [s[0]?.[0] ?? 1, s[0]?.[1] ?? 0, s[1]?.[0] ?? 0, s[1]?.[1] ?? 1];
  const det = s00 * s11 - s01 * s10;

  return (b) => {
    const y = inner(b.subarray(0, k));
    const r0 = (b[k] ?? 0) - edge.reduce((sum, i) => sum + entry(k, i) * (y[i] ?? 0), 0);
    const r1 = (b[k + 1] ?? 0) - edge.reduce((sum, i) => sum + entry(k + 1, i) * (y[i] ?? 0), 0);
    const x0 = (s11 * r0 - s01 * r1) / det;
    const x1 = (s00 * r1 - s10 * r0) / det;
    const x = new Float64Array(m);
    for (let i = 0; i < k; i += 1) {
      x[i] = (y[i] ?? 0) - (w[0]?.[i] ?? 0) * x0 - (w[1]?.[i] ?? 0) * x1;
    }

    x[k] = x0;
    x[k + 1] = x1;

    return x;
  };
}

/** The line's squared-curvature sum as ½xᵀHx + qᵀx in its offsets x. */
function curvatureSystem(geometry: TrackGeometry) {
  const n = geometry.count;

  // The left normal of a tangent (tx, tz) is (tz, −tx).
  const nx = Float64Array.from({ length: n }, (_, i) => geometry.tz[i] ?? 0);
  const nz = Float64Array.from({ length: n }, (_, i) => -(geometry.tx[i] ?? 0));
  const wrap = (i: number) => ((i % n) + n) % n;
  const hessian = (i: number, j: number) => {
    const apart = Math.min(wrap(i - j), wrap(j - i));
    const weight = STENCIL[apart];
    if (weight === undefined) {
      return 0;
    }

    return weight * ((nx[i] ?? 0) * (nx[j] ?? 0) + (nz[i] ?? 0) * (nz[j] ?? 0)) + (apart === 0 ? REGULARISE : 0);
  };

  // The linear term: each normal against DᵀD applied to the centreline.
  const q = Float64Array.from({ length: n }, (_, i) => {
    let [gx, gz] = [0, 0];
    for (let o = -2; o <= 2; o += 1) {
      const w = STENCIL[Math.abs(o)] ?? 0;
      gx += w * (geometry.x[wrap(i + o)] ?? 0);
      gz += w * (geometry.z[wrap(i + o)] ?? 0);
    }

    return gx * (nx[i] ?? 0) + gz * (nz[i] ?? 0);
  });

  return { n, nx, nz, wrap, hessian, q };
}

/**
 * The offsets within ±`bound` that minimise the line's summed squared curvature: a
 * convex quadratic programme with box bounds (the minimum-curvature line of Braghin et
 * al., 2008, and Heilmeier et al., 2020), solved to convergence.
 */
function solveOffsets(geometry: TrackGeometry, bound: number): Float64Array {
  if (bound <= 0) {
    return new Float64Array(geometry.count);
  }

  const { n, wrap, hessian, q } = curvatureSystem(geometry);
  const gradientAt = (x: Float64Array, i: number) => {
    let g = q[i] ?? 0;
    for (let o = -2; o <= 2; o += 1) {
      g += hessian(i, wrap(i + o)) * (x[wrap(i + o)] ?? 0);
    }

    return g;
  };

  const objective = (x: Float64Array) => {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      sum += (x[i] ?? 0) * (0.5 * (gradientAt(x, i) - (q[i] ?? 0)) + (q[i] ?? 0));
    }

    return sum;
  };

  const clamp = (v: number) => Math.max(-bound, Math.min(bound, v));

  // ADMM on ½xᵀHx + qᵀx over the box: one banded factorisation, many cheap solves.
  const admm = cyclicBandedSolver(n, (r, c) => hessian(r, c) + (r === c ? ADMM_RHO : 0));
  let z = new Float64Array(n);
  const u = new Float64Array(n);
  for (let iteration = 0; iteration < ADMM_ITERATIONS; iteration += 1) {
    const x = admm(Float64Array.from({ length: n }, (_, i) => ADMM_RHO * ((z[i] ?? 0) - (u[i] ?? 0)) - (q[i] ?? 0)));
    z = Float64Array.from({ length: n }, (_, i) => clamp((x[i] ?? 0) + (u[i] ?? 0)));
    for (let i = 0; i < n; i += 1) {
      u[i] = (u[i] ?? 0) + (x[i] ?? 0) - (z[i] ?? 0);
    }
  }

  // Polish: fix the points ADMM put at an edge, solve the rest exactly, then move points
  // on or off the edges by the KKT conditions until nothing changes.
  const edge = bound * (1 - 1e-6);
  const side = Int8Array.from(z, (v) => {
    if (Math.abs(v) < edge) {
      return 0;
    }

    return v > 0 ? 1 : -1;
  });
  let best = z;
  let bestObjective = objective(z);
  const tolerance = 1e-9 * Math.max(1, ...q.map(Math.abs));
  for (let round = 0; round < POLISH_ROUNDS; round += 1) {
    const free: number[] = [];
    const x = new Float64Array(n);
    side.forEach((sd, i) => {
      if (sd === 0) {
        free.push(i);
      } else {
        x[i] = sd * bound;
      }
    });
    if (free.length > 0) {
      const rhs = Float64Array.from(free, (i) => {
        let r = -(q[i] ?? 0);
        for (let o = -2; o <= 2; o += 1) {
          const j = wrap(i + o);
          r -= side[j] === 0 ? 0 : hessian(i, j) * (x[j] ?? 0);
        }

        return r;
      });
      const solved = cyclicBandedSolver(free.length, (r, c) => hessian(free[r] ?? 0, free[c] ?? 0))(rhs);
      free.forEach((i, r) => {
        x[i] = solved[r] ?? 0;
      });
    }

    let changed = false;
    for (let i = 0; i < n; i += 1) {
      const v = x[i] ?? 0;
      const g = gradientAt(x, i);
      if (side[i] === 0 && Math.abs(v) > bound) {
        side[i] = v > 0 ? 1 : -1;
        changed = true;
      } else if ((side[i] === 1 && g > tolerance) || (side[i] === -1 && g < -tolerance)) {
        side[i] = 0;
        changed = true;
      }
    }

    const feasible = Float64Array.from(x, clamp);
    const value = objective(feasible);
    if (value < bestObjective) {
      best = feasible;
      bestObjective = value;
    }

    if (!changed) {
      break;
    }
  }

  return best;
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

interface Profile {
  speedMps: Float64Array;
  lapTimeS: number;

  /** ∂(lap time)/∂|κ| at each point, s·m: how much its curvature costs. */
  timePerCurvature: Float64Array;

  /** ∂(lap time)/∂(step length) from each point to the next, s/m. */
  timePerStep: Float64Array;
}

/**
 * The fastest speed profile along a path (a quasi-steady lap simulation on the g-g-v
 * envelope: grip grows with downforce, shared between cornering and speed changes on a
 * friction circle), its lap time, and that lap time's gradient in each point's
 * curvature and step length, by reverse-mode differentiation through the forward and
 * backward passes.
 */
function lapProfile(l: LineLimits, curvature: Float64Array, stepM: Float64Array): Profile {
  const n = curvature.length;
  const m = l.massKg;
  const bend = Float64Array.from(curvature, Math.abs);
  const limitAt = (k: number) => {
    // v²·|κ| ≤ μ(g + k_df·v²/m), solved for v.
    const denominator = k - (l.mu * l.downforceK) / m;

    return denominator <= 0 ? TOP_SPEED_MPS : Math.min(TOP_SPEED_MPS, Math.sqrt((l.mu * GRAVITY) / denominator));
  };

  // Longitudinal grip left over from cornering, on a friction circle. Its square root
  // is softened by ε: still zero at the grip limit, but with a finite slope there, so
  // the lap time's gradient stays finite at a corner's slowest point.
  const spare = (v: number, k: number) => {
    const grip = gripMps2(l, v);
    const lateral = v * v * k;

    return Math.sqrt(Math.max(0, grip * grip - lateral * lateral) + SPARE_SOFTENING ** 2) - SPARE_SOFTENING;
  };

  const onPower = (v: number, k: number, ds: number) => {
    const drive = Math.min(l.maxDriveForceN, l.maxPowerW / Math.max(v, 1)) / m;
    const accel = Math.min(drive, spare(v, k)) - (l.dragK * v * v) / m;

    return Math.sqrt(Math.max(0, v * v + 2 * accel * ds));
  };

  const onBrakes = (v: number, k: number, ds: number) => {
    const decel = Math.min(spare(v, k), l.maxBrakeForceN / m) + (l.dragK * v * v) / m;

    return Math.sqrt(v * v + 2 * decel * ds);
  };

  const limit = Float64Array.from(bend, limitAt);

  // Both passes start at the slowest corner, where the profile must equal its limit,
  // so neither needs to be run round the lap seam again.
  let start = 0;
  limit.forEach((v, i) => {
    if (v < (limit[start] ?? Infinity)) {
      start = i;
    }
  });

  const forward = Float64Array.from(limit);
  const forwardAtLimit = new Uint8Array(n).fill(1);
  for (let t = 0; t < n - 1; t += 1) {
    const i = (start + t) % n;
    const j = (i + 1) % n;
    const reach = onPower(forward[i] ?? 0, bend[i] ?? 0, stepM[i] ?? 0);
    if (reach < (limit[j] ?? 0)) {
      forward[j] = reach;
      forwardAtLimit[j] = 0;
    }
  }

  const backward = Float64Array.from(limit);
  const backwardAtLimit = new Uint8Array(n).fill(1);
  for (let t = 0; t < n - 1; t += 1) {
    const i = (start - t + n) % n;
    const p = (i - 1 + n) % n;
    const reach = onBrakes(backward[i] ?? 0, bend[i] ?? 0, stepM[p] ?? 0);
    if (reach < (limit[p] ?? 0)) {
      backward[p] = reach;
      backwardAtLimit[p] = 0;
    }
  }

  const speedMps = forward.map((v, i) => Math.min(v, backward[i] ?? 0));
  let lapTimeS = 0;
  const perSpeed = new Float64Array(n);
  const timePerStep = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const mean = Math.max(((speedMps[i] ?? 0) + (speedMps[j] ?? 0)) / 2, 1e-6);
    lapTimeS += (stepM[i] ?? 0) / mean;
    timePerStep[i] = 1 / mean;

    // d(ds / mean)/dv at either end.
    const share = -(stepM[i] ?? 0) / (2 * mean * mean);
    perSpeed[i] = (perSpeed[i] ?? 0) + share;
    perSpeed[j] = (perSpeed[j] ?? 0) + share;
  }

  // Reverse mode: send each speed's sensitivity back through whichever pass set it,
  // down to the corner limits and the friction circle's use of each curvature.
  const byForward = new Float64Array(n);
  const byBackward = new Float64Array(n);
  speedMps.forEach((v, i) => {
    if (v === forward[i]) {
      byForward[i] = perSpeed[i] ?? 0;
    } else {
      byBackward[i] = perSpeed[i] ?? 0;
    }
  });

  const byLimit = new Float64Array(n);
  const timePerCurvature = new Float64Array(n);

  // Central differences, one-sided only where the curvature is too small to step down.
  const h = 1e-7;
  const down = (k: number) => Math.min(h, k);
  const partials = (f: (v: number, k: number, ds: number) => number, v: number, k: number, ds: number) => {
    const hv = 1e-6 * Math.max(1, v);

    return {
      dv: (f(v + hv, k, ds) - f(v - hv, k, ds)) / (2 * hv),
      dk: (f(v, k + h, ds) - f(v, k - down(k), ds)) / (h + down(k)),
      dds: (f(v, k, ds + 1e-4) - f(v, k, Math.max(0, ds - 1e-4))) / (1e-4 + Math.min(1e-4, ds)),
    };
  };

  for (let t = n - 2; t >= 0; t -= 1) {
    const i = (start + t) % n;
    const j = (i + 1) % n;
    const g = byForward[j] ?? 0;
    if (forwardAtLimit[j] === 1) {
      byLimit[j] = (byLimit[j] ?? 0) + g;
    } else if (g !== 0) {
      const { dv, dk, dds } = partials(onPower, forward[i] ?? 0, bend[i] ?? 0, stepM[i] ?? 0);
      byForward[i] = (byForward[i] ?? 0) + g * dv;
      timePerCurvature[i] = (timePerCurvature[i] ?? 0) + g * dk;
      timePerStep[i] = (timePerStep[i] ?? 0) + g * dds;
    }
  }

  byLimit[start] = (byLimit[start] ?? 0) + (byForward[start] ?? 0);
  for (let t = n - 2; t >= 0; t -= 1) {
    const i = (start - t + n) % n;
    const p = (i - 1 + n) % n;
    const g = byBackward[p] ?? 0;
    if (backwardAtLimit[p] === 1) {
      byLimit[p] = (byLimit[p] ?? 0) + g;
    } else if (g !== 0) {
      const { dv, dk, dds } = partials(onBrakes, backward[i] ?? 0, bend[i] ?? 0, stepM[p] ?? 0);
      byBackward[i] = (byBackward[i] ?? 0) + g * dv;
      timePerCurvature[i] = (timePerCurvature[i] ?? 0) + g * dk;
      timePerStep[p] = (timePerStep[p] ?? 0) + g * dds;
    }
  }

  byLimit[start] = (byLimit[start] ?? 0) + (byBackward[start] ?? 0);
  byLimit.forEach((g, i) => {
    if (g !== 0) {
      const k = bend[i] ?? 0;
      const slope = (limitAt(k + h) - limitAt(k - down(k))) / (h + down(k));
      timePerCurvature[i] = (timePerCurvature[i] ?? 0) + g * slope;
    }
  });

  return { speedMps, lapTimeS, timePerCurvature, timePerStep };
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

// Minimum-time descent after the minimum-curvature line: at most this many steps, each
// kept only if the estimated lap falls.
const REFINE_ITERATIONS = 80;

// The first trial step moves no offset further than this; later ones adapt.
const FIRST_STEP_M = 0.5;
const STEP_GROWTH = 1.5;
const STEP_HALVINGS = 12;

// Damping in the step's metric, the curvature Hessian. It sets how smooth each step is:
// with this much, shapes shorter than about 100 m are damped, which keeps the steps in
// the region where the lap time's gradient still holds (the hairpin's speed goes as
// 1/√κ, so a rough step overshoots).
const METRIC_DAMPING = 0.0001;

/** Everything about a line that follows from its offsets. */
function lineFrom(geometry: TrackGeometry, limits: LineLimits, offsetM: Float64Array) {
  const n = geometry.count;
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

  return { x, z, offsetM, stepM, curvature, profile: lapProfile(limits, curvature, stepM) };
}

type Line = ReturnType<typeof lineFrom>;

/** ∂(estimated lap)/∂(offset) at each point, through its step lengths and curvatures. */
function lapGradient(geometry: TrackGeometry, line: Line): Float64Array {
  const n = geometry.count;
  const { x, z, stepM, curvature, profile } = line;
  const nx = (i: number) => geometry.tz[i] ?? 0;
  const nz = (i: number) => -(geometry.tx[i] ?? 0);
  const gradient = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const length = Math.max(stepM[i] ?? 0, 1e-9);
    const [ux, uz] = [((x[j] ?? 0) - (x[i] ?? 0)) / length, ((z[j] ?? 0) - (z[i] ?? 0)) / length];
    const perStep = profile.timePerStep[i] ?? 0;
    gradient[j] = (gradient[j] ?? 0) + perStep * (ux * nx(j) + uz * nz(j));
    gradient[i] = (gradient[i] ?? 0) - perStep * (ux * nx(i) + uz * nz(i));
  }

  // Curvature at i is a circle through i − 2, i and i + 2; move each along its normal.
  const h = 1e-3;
  for (let i = 0; i < n; i += 1) {
    const perBend = (profile.timePerCurvature[i] ?? 0) * Math.sign(curvature[i] ?? 0);
    if (perBend === 0) {
      continue;
    }

    for (const a of [(i - 2 + n) % n, i, (i + 2) % n]) {
      const [x0, z0] = [x[a] ?? 0, z[a] ?? 0];
      x[a] = x0 + h * nx(a);
      z[a] = z0 + h * nz(a);
      const up = curvatureAt(x, z, i, 2);
      x[a] = x0 - h * nx(a);
      z[a] = z0 - h * nz(a);
      const down = curvatureAt(x, z, i, 2);
      x[a] = x0;
      z[a] = z0;
      gradient[a] = (gradient[a] ?? 0) + (perBend * (up - down)) / (2 * h);
    }
  }

  return gradient;
}

/**
 * The racing line: the minimum-curvature line, then refined toward minimum time in the
 * way of Kapania, Subosits and Gerdes (2016), alternating the speed profile with a path
 * update. Here the update is a descent step on the profile's own estimated lap: its
 * exact gradient in the offsets, smoothed by the curvature Hessian as the metric, and
 * kept only if the lap falls. That moves apexes later where a straight follows, since
 * the exit speed is carried down it.
 */
export function buildRacingLine(
  geometry: TrackGeometry,
  limits: LineLimits,
  { iterations = REFINE_ITERATIONS }: { iterations?: number } = {},
): RacingLine {
  const bound = Math.max(0, geometry.halfWidthM - limits.clearanceM);
  let line = lineFrom(geometry, limits, solveOffsets(geometry, bound));
  const lapTimesS = [line.profile.lapTimeS];
  if (bound > 0 && iterations > 0) {
    const { n, hessian } = curvatureSystem(geometry);
    let scale = Number.NaN;
    for (let k = 0; k < iterations; k += 1) {
      // Points on an edge that the gradient pushes further out are held; the step is
      // solved for the rest, so clamping cannot undo it.
      const gradient = lapGradient(geometry, line);
      const free: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const o = line.offsetM[i] ?? 0;
        if (!(Math.abs(o) >= bound * (1 - 1e-9) && Math.sign(o) * (gradient[i] ?? 0) < 0)) {
          free.push(i);
        }
      }

      if (free.length === 0) {
        break;
      }

      const metric = cyclicBandedSolver(
        free.length,
        (r, c) => hessian(free[r] ?? 0, free[c] ?? 0) + (r === c ? METRIC_DAMPING : 0),
      );
      const step = metric(Float64Array.from(free, (i) => -(gradient[i] ?? 0)));
      const direction = new Float64Array(n);
      free.forEach((i, r) => {
        direction[i] = step[r] ?? 0;
      });
      const largest = Math.max(...direction.map(Math.abs));
      if (!(largest > 0)) {
        break;
      }

      if (Number.isNaN(scale)) {
        scale = FIRST_STEP_M / largest;
      }

      let accepted: Line | undefined;
      for (let halving = 0; halving <= STEP_HALVINGS && !accepted; halving += 1) {
        const current = line.offsetM;
        const trial = lineFrom(
          geometry,
          limits,
          current.map((o, i) => Math.max(-bound, Math.min(bound, o + scale * (direction[i] ?? 0)))),
        );
        if (trial.profile.lapTimeS < line.profile.lapTimeS) {
          accepted = trial;
        } else {
          scale /= 2;
        }
      }

      if (!accepted) {
        break;
      }

      line = accepted;
      lapTimesS.push(line.profile.lapTimeS);
      scale *= STEP_GROWTH;
    }
  }

  const { x, z, offsetM, stepM, curvature, profile } = line;
  const speedMps = profile.speedMps;

  return {
    count: geometry.count,
    x,
    z,
    offsetM,
    stepM,
    curvature,
    speedMps,
    phase: phases(speedMps, stepM),
    lapTimesS,
  };
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

/** Lap time the speed profile predicts: each step at the mean of its end speeds. */
export function estimatedLapTimeS(line: RacingLine): number {
  let total = 0;
  for (let i = 0; i < line.count; i += 1) {
    const mean = ((line.speedMps[i] ?? 0) + (line.speedMps[(i + 1) % line.count] ?? 0)) / 2;
    total += (line.stepM[i] ?? 0) / Math.max(mean, 1e-6);
  }

  return total;
}
