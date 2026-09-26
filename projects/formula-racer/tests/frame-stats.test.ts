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
    overBudget: 84,
    budgetMs: 16.7,
  });
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
