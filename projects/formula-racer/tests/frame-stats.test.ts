import { expect, test } from "bun:test";
import { summarizeFrames } from "../src/app/frame-stats.ts";

test("reports median, p95, p99, max and frames over the 60 FPS budget", () => {
  // 1…100 ms: nearest-rank percentiles land on whole values.
  const frames = Array.from({ length: 100 }, (_, i) => i + 1);
  expect(summarizeFrames(frames.reverse())).toEqual({
    frames: 100,
    medianMs: 50,
    p95Ms: 95,
    p99Ms: 99,
    maxMs: 100,

    // Only frames that spanned a missed refresh (≥ 1.5 × 16.7 ms = 25.05 ms): 26…100.
    overBudget: 75,
    budgetMs: 16.7,
  });
});

test("vsync-quantised 60 FPS frames jittering around 16.7 ms miss no refresh", () => {
  // What the GPU-backed runs record: timestamps rounded to 0.1 ms around the refresh.
  const frames = Array.from({ length: 600 }, (_, i) => [16.6, 16.7, 16.70000000001164, 16.8][i % 4] ?? 16.7);
  expect(summarizeFrames(frames).overBudget).toBe(0);
});

test("a frame that spans two refreshes misses one", () => {
  expect(summarizeFrames([16.7, 33.3, 16.7]).overBudget).toBe(1);
});

test("a steady 60 FPS run misses no frames", () => {
  const summary = summarizeFrames(Array.from({ length: 600 }, () => 1000 / 60));
  expect(summary.p95Ms).toBeCloseTo(16.67, 2);
  expect(summary.overBudget).toBe(0);
});

test("one frame reports itself and an empty run reports zeros", () => {
  expect(summarizeFrames([12]).p95Ms).toBe(12);
  expect(summarizeFrames([])).toEqual({
    frames: 0,
    medianMs: 0,
    p95Ms: 0,
    p99Ms: 0,
    maxMs: 0,
    overBudget: 0,
    budgetMs: 16.7,
  });
});
