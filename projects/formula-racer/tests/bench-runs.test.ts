import { expect, test } from "bun:test";
import { isSoftwareRenderer, summarizeRuns } from "../tools/bench.ts";
import type { BenchReport } from "../src/app/bench.ts";

const frames = (p95Ms: number) => ({
  frames: 7200,
  medianMs: p95Ms / 2,
  p95Ms,
  p99Ms: p95Ms * 1.2,
  maxMs: p95Ms * 2,
  overBudget: p95Ms > 16.7 ? 500 : 0,
  budgetMs: 16.7,
});
const report = (
  p95Ms: number,
  renderer = "ANGLE (Intel, Mesa Intel(R) Arc(tm) Graphics, OpenGL 4.6)",
): BenchReport => ({
  route: "harbour-autopilot-v1",
  quality: "medium",
  pixelRatio: 1,
  drawingBuffer: { width: 1280, height: 720 },
  gl: { vendor: "Google Inc. (Intel)", renderer },
  userAgent: "Chrome/153",
  transferBytes: 3_000_000,
  measuredSeconds: 120,
  frames: frames(p95Ms),
  simMs: frames(2),
  renderMs: frames(6),
  drawCalls: 40,
  triangles: 60_000,
  distanceM: 5000,
});

test("takes the median pass for each figure and checks the 60 FPS target", () => {
  const summary = summarizeRuns([report(18), report(15), report(16)]);
  expect(summary.passes).toBe(3);
  expect(summary.p95Ms).toBe(16);
  expect(summary.worstP95Ms).toBe(18);
  expect(summary.meetsTarget).toBe(true);
  expect(summary.hardware).toBe(true);
  expect(summarizeRuns([report(20), report(19), report(17)]).meetsTarget).toBe(false);
});

test("never counts a software renderer as a hardware result", () => {
  expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(
    true,
  );
  expect(isSoftwareRenderer("llvmpipe (LLVM 17.0.6, 256 bits)")).toBe(true);
  expect(isSoftwareRenderer("ANGLE (Intel, Mesa Intel(R) Arc(tm) Graphics, OpenGL 4.6)")).toBe(false);
  const summary = summarizeRuns([report(10, "SwiftShader"), report(10), report(10)]);
  expect(summary.hardware).toBe(false);
  expect(summary.meetsTarget).toBe(false);
});

test("refuses to summarize runs of different routes or presets", () => {
  expect(() => summarizeRuns([report(10), { ...report(10), quality: "high" }])).toThrow("passes differ in quality");
  expect(() => summarizeRuns([])).toThrow("no passes");
});
