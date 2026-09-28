import { SLIDING_GRIP } from "./vehicle.ts";
import type { WheelSlip } from "./vehicle.ts";
import { GRAVITY, LIFT_WARNING_S } from "./racing-line.ts";
import type { GuidePhase, LineLimits, RacingLine } from "./racing-line.ts";
import { gripSurface } from "./trackside.ts";
import type { GroundSurface } from "./trackside.ts";
import type { TrackDefinition } from "../content/track.ts";

/** How far ahead of the car the guide plans and draws. */
export const GUIDE_AHEAD_M = 300;

// The rejoin curve's length is this many seconds of travel, within these bounds.
const REJOIN_S = 1.5;
const REJOIN_MIN_M = 60;
const REJOIN_MAX_M = 120;

// Throttle below this share reads as a lift, and brake below this as no brake at all.
const LIFT_SHARE = 0.2;
const BRAKE_DEADBAND = 0.02;

export interface GuidanceInput {
  x: number;
  z: number;

  /** The line point nearest the car. */
  index: number;
  speedMps: number;

  /** The grip the tyres have now against clean road; see `gripShare`. */
  gripShare: number;
}

/** The line ahead of the car, as the car should drive it from where it is now. */
export interface Guidance {
  /** The line point each guide point follows. */
  index: Int32Array;

  /** On the line, except where it bends from the car back onto it. */
  x: Float64Array;
  z: Float64Array;
  aheadM: Float64Array;
  stepM: Float64Array;

  /** The pedal each point needs: throttle share up to 1, brake share down to −1. */
  pedal: Float64Array;
  phase: GuidePhase[];
}

/** The tyres' mean grip against clean road, cut for any tyre that is slipping. */
export function gripShare(
  surfaces: readonly GroundSurface[],
  slips: readonly WheelSlip[],
  surfaceGrip: TrackDefinition["surfaceGrip"],
): number {
  let sum = 0;
  surfaces.forEach((surface, wheel) => {
    const grip = surfaceGrip[gripSurface(surface)] / surfaceGrip.road;
    sum += grip * ((slips[wheel] ?? "none") === "none" ? 1 : SLIDING_GRIP);
  });

  return surfaces.length > 0 ? sum / surfaces.length : 1;
}

/**
 * Plans the next `GUIDE_AHEAD_M` of the racing line from the car's state now.
 *
 * Each point's target is the line's speed, lowered to what the grip available now
 * carries through that point's curvature. Braking back from those targets gives the
 * fastest the car may be at each point; then the car is run forward from its own speed,
 * on full power where it can be and braking just hard enough to keep under that
 * envelope. The pedal each step takes is the guide's colour there.
 */
export function guidance(input: GuidanceInput, line: RacingLine, limits: LineLimits): Guidance {
  const n = line.count;
  const m = limits.massKg;
  const share = Math.max(input.gripShare, 0.05);
  const grip = (v: number, mu: number) => mu * (GRAVITY + (limits.downforceK * v * v) / m);
  const spare = (v: number, k: number, mu: number) => Math.sqrt(Math.max(0, grip(v, mu) ** 2 - (v * v * k) ** 2));
  const drive = (v: number) => Math.min(limits.maxDriveForceN, limits.maxPowerW / Math.max(v, 1)) / m;
  const drag = (v: number) => (limits.dragK * v * v) / m;
  const brake = limits.maxBrakeForceN / m;

  const points: number[] = [];
  const ahead: number[] = [];
  for (let i = input.index, s = 0; s <= GUIDE_AHEAD_M; i = (i + 1) % n) {
    points.push(i);
    ahead.push(s);
    s += line.stepM[i] ?? 1;
  }

  const count = points.length;
  const index = Int32Array.from(points);
  const aheadM = Float64Array.from(ahead);
  const stepM = Float64Array.from(points, (i) => line.stepM[i] ?? 0);
  const bend = Float64Array.from(points, (i) => Math.abs(line.curvature[i] ?? 0));
  const mu = Float64Array.from(points, (i) => share * limits.mu * (line.gripScale[i] ?? 1));

  // The fastest steady speed the grip now holds on each point's curvature.
  const cornerMps = (k: number, pointMu: number) => {
    const room = k - (pointMu * limits.downforceK) / m;

    return room > 0 ? Math.sqrt((pointMu * GRAVITY) / room) : Infinity;
  };

  const envelope = new Float64Array(count);
  for (let k = count - 1; k >= 0; k -= 1) {
    const target = Math.min(line.speedMps[points[k] ?? 0] ?? 0, cornerMps(bend[k] ?? 0, mu[k] ?? 0));
    if (k === count - 1) {
      envelope[k] = target;
      continue;
    }

    const next = envelope[k + 1] ?? 0;
    const reach = Math.sqrt(
      next * next + 2 * (Math.min(spare(next, bend[k] ?? 0, mu[k] ?? 0), brake) + drag(next)) * (stepM[k] ?? 0),
    );
    envelope[k] = Math.min(target, reach);
  }

  const pedal = new Float64Array(count);
  let v = input.speedMps;
  for (let k = 0; k < count; k += 1) {
    const ds = Math.max(stepM[k] ?? 0, 1e-6);
    const k2 = bend[k] ?? 0;
    const next = k + 1 < count ? (envelope[k + 1] ?? 0) : Infinity;
    const power = Math.min(drive(v), spare(v, k2, mu[k] ?? 0));
    const full = Math.sqrt(Math.max(0, v * v + 2 * (power - drag(v)) * ds));
    if (full <= next) {
      pedal[k] = drive(v) > 0 ? power / drive(v) : 0;
      v = full;
    } else {
      // The acceleration that arrives exactly on the envelope, with drag counted in.
      const wanted = (next * next - v * v) / (2 * ds) + drag(v);
      if (wanted >= 0) {
        pedal[k] = Math.min(1, wanted / Math.max(drive(v), 1e-6));
        v = next;
      } else {
        pedal[k] = Math.max(-1, wanted / brake);
        const decel = Math.min(-wanted, Math.min(spare(v, k2, mu[k] ?? 0), brake)) + drag(v);
        v = Math.sqrt(Math.max(0, v * v - 2 * decel * ds));
      }
    }
  }

  const phase: GuidePhase[] = Array.from(pedal, (p): GuidePhase => {
    if (p < -BRAKE_DEADBAND) {
      return "brake";
    }

    return p < LIFT_SHARE ? "lift" : "go";
  });

  // Warn of each braking zone with a lift over the travel just before it.
  let nextBrakeM = Infinity;
  for (let k = count - 1; k >= 0; k -= 1) {
    if (phase[k] === "brake") {
      nextBrakeM = aheadM[k] ?? 0;
    } else if (phase[k] === "go" && nextBrakeM - (aheadM[k] ?? 0) <= input.speedMps * LIFT_WARNING_S) {
      phase[k] = "lift";
    }
  }

  const [x, z] = rejoin(input, line, points, aheadM);

  return { index, x, z, aheadM, stepM, pedal, phase };
}

/** Bends the guide from the car's position onto the line, smoothly, over a run that grows with speed. */
function rejoin(input: GuidanceInput, line: RacingLine, points: number[], aheadM: Float64Array) {
  const n = line.count;
  const x = Float64Array.from(points, (i) => line.x[i] ?? 0);
  const z = Float64Array.from(points, (i) => line.z[i] ?? 0);
  const lengthM = Math.min(REJOIN_MAX_M, Math.max(REJOIN_MIN_M, input.speedMps * REJOIN_S));
  const i0 = points[0] ?? 0;
  const gapX = input.x - (line.x[i0] ?? 0);
  const gapZ = input.z - (line.z[i0] ?? 0);
  points.forEach((i, k) => {
    const t = Math.min(1, (aheadM[k] ?? 0) / lengthM);
    const weight = 1 - t * t * (3 - 2 * t);
    if (weight <= 0) {
      return;
    }

    // Carry the car's sideways gap along the line's own normal, so the curve follows the road.
    const [a, b] = [(i - 1 + n) % n, (i + 1) % n];
    const [dx, dz] = [(line.x[b] ?? 0) - (line.x[a] ?? 0), (line.z[b] ?? 0) - (line.z[a] ?? 0)];
    const length = Math.hypot(dx, dz) || 1;
    const [lx, lz] = [dz / length, -dx / length];
    const [ax, az] = [
      (line.x[(i0 + 1) % n] ?? 0) - (line.x[(i0 - 1 + n) % n] ?? 0),
      (line.z[(i0 + 1) % n] ?? 0) - (line.z[(i0 - 1 + n) % n] ?? 0),
    ];
    const startLength = Math.hypot(ax, az) || 1;
    const lateral = (gapX * az - gapZ * ax) / startLength;
    x[k] = (x[k] ?? 0) + weight * lateral * lx;
    z[k] = (z[k] ?? 0) + weight * lateral * lz;
  });

  return [x, z] as const;
}

type Rgb = readonly [number, number, number];

const mix = (from: Rgb, to: Rgb, t: number): Rgb => [
  from[0] + (to[0] - from[0]) * t,
  from[1] + (to[1] - from[1]) * t,
  from[2] + (to[2] - from[2]) * t,
];

const GREEN_LIGHT: Rgb = [0.3, 0.55, 0.35];
const GREEN_FULL: Rgb = [0.15, 0.95, 0.35];
const YELLOW: Rgb = [0.95, 0.76, 0.19];

// The brake red keeps its green channel up so screenshot tests never count it as the car.
const RED_LIGHT: Rgb = [0.92, 0.5, 0.38];
const RED_FULL: Rgb = [1, 0.34, 0.26];

/** Colour of one guide point: deeper green for more throttle, deeper red for more brake. */
export function guideTint(pedal: number, phase: GuidePhase): Rgb {
  const amount = Math.min(1, Math.abs(pedal));
  if (phase === "brake") {
    return mix(RED_LIGHT, RED_FULL, amount);
  }

  return phase === "lift" ? YELLOW : mix(GREEN_LIGHT, GREEN_FULL, amount);
}
