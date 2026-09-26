import type { CarDefinition } from "../content/car.ts";
import type { TrackDefinition } from "../content/track.ts";
import { createControlEnvironment } from "../control/environment.ts";
import type { ControlReply, SessionSource } from "../control/environment.ts";
import { buildRacingLine, lineLimits } from "../simulation/racing-line.ts";
import type { RacingLine } from "../simulation/racing-line.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";
import { createAiDriver } from "./driver.ts";

export interface LineMeasureOptions {
  car: CarDefinition;
  trackId: string;
  track: TrackDefinition;
  geometry: TrackGeometry;
  sources: SessionSource;
  seed: number;
}

export interface LineTuningOptions extends LineMeasureOptions {
  rounds: number;

  /** Where to start; all ones (the grip the line plans on) when absent. */
  gripScale?: Float64Array;
}

export interface TuningRound extends LineMeasure {
  /** Lowering grip where the car left the road, or raising lowered grip back toward 1. */
  kind: "lower" | "restore";

  /** Share of the grip scale taken away, or share of the way back to 1 given back. */
  step: number;
  kept: boolean;
}

export interface LineTuning {
  gripScale: Float64Array;
  line: RacingLine;
  measure: LineMeasure;

  /** What the starting line measured. */
  baseline: LineMeasure;
  rounds: TuningRound[];
}

// Three laps: a standing start and two flying laps, whose mean is the measure.
const LAPS = 3;
const MAX_SECONDS = 900;

// Leaving the road at a point is caused by the speed the line plans on the way in, so
// grip is taken away over the braking zone before it and a little after it.
const CAUSE_BEFORE_M = 150;
const CAUSE_AFTER_M = 20;
const LOWER_STEP = 0.1;
const SCALE_MIN = 0.6;

// Once clean, lowered points are raised back toward 1 by this share of the way, halved
// after each raise that loses the road or time, until it is smaller than the last.
const FIRST_RESTORE = 0.5;
const LAST_RESTORE = 1 / 16;

/** What three Ace laps on a line measured. */
export interface LineMeasure {
  /** No tyre ever left the road and kerbs, which also makes every lap valid. */
  clean: boolean;

  /** Simulation steps with a tyre off the road. */
  offRoadSteps: number;

  /** Mean flying lap, seconds; Infinity when the laps did not all finish. */
  lapS: number;
}

interface Run extends LineMeasure {
  /** Per centreline sample: a tyre was off the road there. */
  trouble: Uint8Array;
}

async function drive(options: LineMeasureOptions, line: RacingLine): Promise<Run> {
  const { geometry: g } = options;
  const n = g.count;
  const driver = createAiDriver({ ...options, level: "ace", line });
  const environment = createControlEnvironment(options.sources);
  const trouble = new Uint8Array(n);
  const laps: number[] = [];
  let offRoadSteps = 0;
  let reply: ControlReply = await environment.handle({
    type: "reset",
    track: options.trackId,
    seed: options.seed,
    maxLaps: LAPS,
    maxSeconds: MAX_SECONDS,
  });
  while (reply.type === "observation" && !reply.done) {
    reply = await environment.handle({ type: "step", ...driver.decide(reply.observation), steps: 1 });
    if (reply.type !== "observation") {
      break;
    }

    const o = reply.observation;
    const i = Math.round(o.track.distanceM / g.spacingM) % n;
    const offRoad = o.wheels.some((w) => w.surface !== "road" && w.surface !== "kerb");
    offRoadSteps += offRoad ? 1 : 0;
    if (offRoad) {
      trouble[i] = 1;
    }

    for (const event of reply.events) {
      if (event.type === "lap") {
        laps.push(event.timeS);
      }
    }
  }

  environment.close();
  const flying = laps.slice(1);
  const lapS = laps.length === LAPS ? flying.reduce((sum, t) => sum + t, 0) / flying.length : Infinity;

  return { clean: offRoadSteps === 0 && laps.length === LAPS, offRoadSteps, lapS, trouble };
}

/** Lowers the grip scale on the way into each point where the car was in trouble. */
function adjust(scale: Float64Array, trouble: Uint8Array, spacingM: number, step: number): Float64Array {
  const n = scale.length;
  const before = Math.round(CAUSE_BEFORE_M / spacingM);
  const after = Math.round(CAUSE_AFTER_M / spacingM);
  const lower = new Uint8Array(n);
  trouble.forEach((t, j) => {
    if (t === 1) {
      for (let d = -before; d <= after; d += 1) {
        lower[(j + d + n) % n] = 1;
      }
    }
  });

  return scale.map((s, i) => (lower[i] === 1 ? Math.max(SCALE_MIN, s * (1 - step)) : s));
}

/** A clean run beats one that left the road; then the faster, or the less time off the road. */
export function isBetter(a: LineMeasure, b: LineMeasure): boolean {
  if (a.clean !== b.clean) {
    return a.clean;
  }

  return a.clean ? a.lapS < b.lapS : a.offRoadSteps < b.offRoadSteps;
}

/** Drives three Ace laps on the line built with this grip scale. */
export async function measureLine(options: LineMeasureOptions, gripScale: Float64Array): Promise<LineMeasure> {
  const { clean, offRoadSteps, lapS } = await drive(
    options,
    buildRacingLine(options.geometry, lineLimits(options.car), { gripScale }),
  );

  return { clean, offRoadSteps, lapS };
}

/**
 * Improves a track's racing line from the Ace driver's laps, where the car shows it has
 * less grip than the line planned on. Each round rebuilds the line on a per-point grip
 * scale and drives three laps. While the car still puts a tyre off the road, each round
 * lowers the grip on the way into every place it did. Once it stays on, each round
 * gives some of that grip back, to find the least cut that keeps it on. A round's line
 * is kept only if it is better: clean beats not, then the faster mean flying lap (or,
 * while not clean, the fewer steps off the road). Everything is deterministic, so the
 * same options give the same result.
 */
export async function tuneLine(options: LineTuningOptions): Promise<LineTuning> {
  const { geometry: g } = options;
  const limits = lineLimits(options.car);
  const build = (gripScale: Float64Array) => buildRacingLine(g, limits, { gripScale });
  const first = options.gripScale ?? new Float64Array(g.count).fill(1);
  const firstLine = build(first);
  let best = { scale: first, line: firstLine, run: await drive(options, firstLine) };

  // Lowering carries on from the last try, kept or not, so it keeps moving.
  let current = best;
  const measured = ({ clean, offRoadSteps, lapS }: Run): LineMeasure => ({ clean, offRoadSteps, lapS });
  const baseline = measured(best.run);
  const rounds: TuningRound[] = [];
  let restore = FIRST_RESTORE;
  for (let r = 0; r < options.rounds; r += 1) {
    const kind = best.run.clean ? "restore" : "lower";
    const scale =
      kind === "lower"
        ? adjust(current.scale, current.run.trouble, g.spacingM, LOWER_STEP)
        : best.scale.map((s) => s + (1 - s) * restore);
    if (kind === "restore" && (restore < LAST_RESTORE || best.scale.every((s) => s === 1))) {
      break;
    }

    const line = build(scale);
    const run = await drive(options, line);
    const kept = isBetter(run, best.run);
    rounds.push({ kind, step: kind === "lower" ? LOWER_STEP : restore, ...measured(run), kept });
    if (kind === "lower") {
      current = { scale, line, run };
    }

    if (kept) {
      best = { scale, line, run };
    } else if (kind === "restore") {
      restore /= 2;
    }
  }

  return { gripScale: best.scale, line: best.line, measure: measured(best.run), baseline, rounds };
}
