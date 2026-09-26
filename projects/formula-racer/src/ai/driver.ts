import type { CarDefinition } from "../content/car.ts";
import type { TrackDefinition } from "../content/track.ts";
import type { Observation } from "../control/link.ts";
import { gripShare, guidance } from "../simulation/guidance.ts";
import { buildRacingLine, lineLimits } from "../simulation/racing-line.ts";
import type { RacingLine } from "../simulation/racing-line.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";
import type { DriverControls } from "../simulation/vehicle.ts";

export const AI_LEVELS = ["rookie", "club", "pro", "ace"] as const;
export type AiLevelName = (typeof AI_LEVELS)[number];

export const isAiLevel = (value: unknown): value is AiLevelName => AI_LEVELS.some((level) => level === value);

export interface AiLevel {
  label: string;

  /** Share of the car's planned grip the driver's line and speeds are built on. */
  gripUse: number;

  /** How far early it may brake, metres; varies smoothly round the lap. */
  brakeEarlyM: number;

  /** How far off the line it may drift at a corner, metres. */
  lineErrorM: number;

  /** Delay between what it sees and what it does, seconds. */
  reactionS: number;

  /** Pure pursuit looks this many seconds of travel ahead. */
  lookaheadS: number;

  /** Fastest the throttle opens, share per second. */
  throttleRate: number;
}

export const LEVELS: Record<AiLevelName, AiLevel> = {
  rookie: {
    label: "Rookie",
    gripUse: 0.8,
    brakeEarlyM: 14,
    lineErrorM: 0.9,
    reactionS: 0.25,
    lookaheadS: 0.8,
    throttleRate: 1.5,
  },
  club: {
    label: "Club",
    gripUse: 0.88,
    brakeEarlyM: 8,
    lineErrorM: 0.6,
    reactionS: 0.15,
    lookaheadS: 0.7,
    throttleRate: 2.5,
  },
  pro: {
    label: "Pro",
    gripUse: 0.95,
    brakeEarlyM: 3,
    lineErrorM: 0.3,
    reactionS: 0.08,
    lookaheadS: 0.6,
    throttleRate: 4,
  },
  ace: { label: "Ace", gripUse: 1, brakeEarlyM: 0, lineErrorM: 0, reactionS: 0.03, lookaheadS: 0.55, throttleRate: 8 },
};

export interface AiDriverOptions {
  car: CarDefinition;
  track: TrackDefinition;
  geometry: TrackGeometry;
  level: AiLevelName;
  seed: number;

  /** The line to follow; built from the car and the level's grip use when absent. */
  line?: RacingLine;

  /** Per-point grip for building that line, as `make tune-lines` saved it for the track. */
  gripScale?: Float64Array;
  stepSeconds?: number;
}

export interface AiDriver {
  readonly level: AiLevel;
  readonly line: RacingLine;

  /** Controls for the next simulation step, from what the car reports now. */
  decide(observation: Observation): DriverControls;
  reset(): void;
}

// Pure pursuit never looks nearer or further than these, metres.
const LOOKAHEAD_MIN_M = 8;
const LOOKAHEAD_MAX_M = 45;

// Further off its line than this, a driver plans on less grip and so slows: each metre
// beyond costs this share, down to the floor.
const OFF_LINE_M = 1;
const OFF_LINE_GRIP_PER_M = 0.2;
const OFF_LINE_GRIP_FLOOR = 0.6;

// Held at a standstill on the throttle this long, the car is stuck (nose in a wall) and
// backs out in reverse for a while before driving on.
const STUCK_S = 1;
const STUCK_SPEED_MPS = 1;
const BACK_OUT_S = 1.5;
const STOPPED_MPS = 0.3;

/** A smooth, repeatable wobble in [−1, 1] along the lap: two sines with seeded phases. */
function wobble(seed: number, salt: number) {
  const phase = (k: number) => {
    // Mulberry32-style integer hash; any fixed mixing will do.
    let t = (seed * 0x9e3779b1 + salt * 0x85ebca6b + k * 0xc2b2ae35) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return (((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * 2 * Math.PI;
  };

  const [a, b] = [phase(1), phase(2)];

  return (distanceM: number) => 0.6 * Math.sin(distanceM / 97 + a) + 0.4 * Math.sin(distanceM / 41 + b);
}

/**
 * A racing driver on the control API's observation. It steers by pure pursuit on its
 * racing line and takes its pedals from `guidance`: the throttle or brake the car
 * needs now to stay under the speeds the line can carry.
 */
export function createAiDriver(options: AiDriverOptions): AiDriver {
  const level = LEVELS[options.level];
  const { car, geometry: g } = options;
  const limits = lineLimits(car);
  const planned = { ...limits, mu: limits.mu * level.gripUse };
  const line = options.line ?? buildRacingLine(g, planned, options.gripScale ? { gripScale: options.gripScale } : {});
  const n = line.count;
  const wheelbase = car.wheels.frontAxleZ - car.wheels.rearAxleZ;
  const stepSeconds = options.stepSeconds ?? 1 / 60;
  const early = wobble(options.seed, 1);
  const drift = wobble(options.seed, 2);
  const delaySteps = Math.round(level.reactionS / stepSeconds);
  let queue: DriverControls[] = [];
  let throttle = 0;
  let hint: number | undefined;
  let stuckS = 0;
  let recovery: { phase: "back" | "stop"; leftS: number; shifted: boolean } | undefined;

  const reset = () => {
    queue = Array.from({ length: delaySteps }, () => ({ throttle: 0, brake: 0, steer: 0 }));
    throttle = 0;
    hint = undefined;
    stuckS = 0;
    recovery = undefined;
  };

  // Backs out of a wall: reverse with the wheel turned the other way, then stop and
  // select first again.
  const recover = (o: Observation, steer: number): DriverControls => {
    const r = recovery ?? { phase: "back", leftS: BACK_OUT_S, shifted: false };
    recovery = r;
    if (r.phase === "back") {
      const shift = r.shifted ? undefined : "down";
      r.shifted = true;
      r.leftS -= stepSeconds;
      if (r.leftS <= 0) {
        recovery = { phase: "stop", leftS: 0, shifted: false };
      }

      return { throttle: 0.6, brake: 0, steer: -steer, ...(shift ? { shift } : {}) };
    }

    if (Math.abs(o.speedMps) > STOPPED_MPS) {
      return { throttle: 0, brake: 1, steer: 0 };
    }

    recovery = undefined;
    stuckS = 0;
    queue = queue.map(() => ({ throttle: 0, brake: 0, steer: 0 }));

    return { throttle: 0, brake: 0, steer: 0, shift: "up" };
  };

  reset();

  const pursue = (o: Observation, index: number) => {
    const v = Math.max(o.speedMps, 0);
    const lookM = Math.min(LOOKAHEAD_MAX_M, Math.max(LOOKAHEAD_MIN_M, level.lookaheadS * v));
    let i = index;
    for (let s = 0; s < lookM; i = (i + 1) % n) {
      s += line.stepM[i] ?? 1;
    }

    // Drift sideways off the line by the level's error, along the line's normal.
    const [a, b] = [(i - 1 + n) % n, (i + 1) % n];
    const [dx, dz] = [(line.x[b] ?? 0) - (line.x[a] ?? 0), (line.z[b] ?? 0) - (line.z[a] ?? 0)];
    const length = Math.hypot(dx, dz) || 1;
    const room = g.halfWidthM - limits.clearanceM;
    const offset = Math.max(
      -room,
      Math.min(room, (line.offsetM[i] ?? 0) + level.lineErrorM * drift(o.track.distanceM)),
    );
    const shift = offset - (line.offsetM[i] ?? 0);
    const tx = (line.x[i] ?? 0) + (shift * dz) / length;
    const tz = (line.z[i] ?? 0) - (shift * dx) / length;

    // The target in the car's frame: forward (sin yaw, cos yaw), left (cos yaw, −sin yaw).
    const [fx, fz] = [Math.sin(o.yawRad), Math.cos(o.yawRad)];
    const [px, pz] = [tx - o.position.x, tz - o.position.z];
    const ahead = px * fx + pz * fz;
    const left = px * fz - pz * fx;
    const alpha = Math.atan2(left, ahead);
    const curvature = (2 * Math.sin(alpha)) / Math.max(Math.hypot(px, pz), 1);

    // Steer +1 is full right; a left turn is a negative command.
    return Math.max(-1, Math.min(1, -Math.atan(curvature * wheelbase) / car.steering.maxAngleRad));
  };

  return {
    level,
    line,
    reset,
    decide(o) {
      const location = g.locate(o.position.x, o.position.z, hint);
      hint = location.index;
      const steer = pursue(o, location.index);
      stuckS = Math.abs(o.speedMps) < STUCK_SPEED_MPS && throttle > 0.3 ? stuckS + stepSeconds : 0;
      if (recovery || stuckS > STUCK_S) {
        return recover(o, steer);
      }

      const offLineM = Math.hypot(
        o.position.x - (line.x[location.index] ?? 0),
        o.position.z - (line.z[location.index] ?? 0),
      );
      const offLine = Math.max(OFF_LINE_GRIP_FLOOR, 1 - OFF_LINE_GRIP_PER_M * Math.max(0, offLineM - OFF_LINE_M));

      // Braking early is the same as believing the corner is nearer than it is.
      const earlyM = level.brakeEarlyM * (0.5 + 0.5 * early(o.track.distanceM));
      const plan = guidance(
        {
          x: o.position.x,
          z: o.position.z,
          index: (location.index + Math.round(earlyM / g.spacingM)) % n,
          speedMps: Math.max(o.speedMps, 0),
          gripShare:
            offLine *
            gripShare(
              o.wheels.map((wheel) => wheel.surface),
              o.wheels.map((wheel) => wheel.slip),
              options.track.surfaceGrip,
            ),
        },
        line,
        planned,
      );
      const pedal = plan.pedal[0] ?? 0;
      const wanted = Math.max(0, pedal);
      throttle = wanted > throttle ? Math.min(wanted, throttle + level.throttleRate * stepSeconds) : wanted;
      queue.push({ throttle, brake: Math.max(0, -pedal), steer });

      return queue.shift() ?? { throttle: 0, brake: 0, steer: 0 };
    },
  };
}
