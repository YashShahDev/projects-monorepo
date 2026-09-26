import { summarizeFrames } from "./frame-stats.ts";
import type { FrameSummary } from "./frame-stats.ts";

export interface BenchOptions {
  warmupSeconds: number;
  seconds: number;
}

export interface BenchSample {
  frameMs: number;
  simMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;

  /** Distance the car covered during this frame. */
  metres: number;

  /** The session was paused, so the frame measured the pause screen, not driving. */
  paused: boolean;
}

export interface BenchResult {
  measuredSeconds: number;
  frames: FrameSummary;
  simMs: FrameSummary;
  renderMs: FrameSummary;

  /** Means over the measured frames. */
  drawCalls: number;
  triangles: number;
  distanceM: number;

  /** A run that was paused (the window lost focus) did not measure the route. */
  pausedFrames: number;
}

/** What `?bench` prints: the result plus what is needed to compare runs fairly. */
export interface BenchReport extends BenchResult {
  route: string;
  quality: string;
  pixelRatio: number;
  drawingBuffer: { width: number; height: number };
  gl: { vendor: string; renderer: string };
  userAgent: string;

  /** Bytes fetched for the page and its assets, as the browser reports them. */
  transferBytes: number;
}

export type BenchPhase = "warmup" | "measuring" | "done";

const seconds = (params: URLSearchParams, key: string, fallback: number, min: number): number => {
  const raw = params.get(key);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > 600) {
    throw new Error(`${key} must be between ${String(min)} and 600`);
  }

  return value;
};

/** `?bench` turns the benchmark route on; the durations are for short test runs. */
export function parseBenchOptions(search: string): BenchOptions | undefined {
  const params = new URLSearchParams(search);
  if (!params.has("bench")) {
    return undefined;
  }

  return { warmupSeconds: seconds(params, "warmupSeconds", 10, 0), seconds: seconds(params, "benchSeconds", 120, 0.1) };
}

export function createBenchRecorder(options: BenchOptions) {
  const frames: number[] = [];
  const sim: number[] = [];
  const render: number[] = [];
  let elapsedMs = 0;
  let measuredMs = 0;
  let drawCalls = 0;
  let triangles = 0;
  let distanceM = 0;
  let pausedFrames = 0;
  let done = false;

  return {
    record(sample: BenchSample): BenchPhase {
      if (done) {
        return "done";
      }

      if (sample.paused) {
        pausedFrames += 1;

        return elapsedMs <= options.warmupSeconds * 1000 ? "warmup" : "measuring";
      }

      elapsedMs += sample.frameMs;
      if (elapsedMs <= options.warmupSeconds * 1000) {
        return "warmup";
      }

      frames.push(sample.frameMs);
      sim.push(sample.simMs);
      render.push(sample.renderMs);
      drawCalls += sample.drawCalls;
      triangles += sample.triangles;
      distanceM += sample.metres;
      measuredMs += sample.frameMs;
      done = measuredMs >= options.seconds * 1000;

      return done ? "done" : "measuring";
    },
    result(): BenchResult {
      const n = Math.max(frames.length, 1);

      return {
        measuredSeconds: measuredMs / 1000,
        frames: summarizeFrames(frames),
        simMs: summarizeFrames(sim),
        renderMs: summarizeFrames(render),
        drawCalls: drawCalls / n,
        triangles: triangles / n,
        distanceM,
        pausedFrames,
      };
    },
  };
}
