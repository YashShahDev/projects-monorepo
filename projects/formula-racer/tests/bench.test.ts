import { describe, expect, test } from "bun:test";
import { createBenchRecorder, parseBenchOptions } from "../src/app/bench.ts";

describe("bench options", () => {
  test("are off without ?bench and default to a 10 s warm-up and a 120 s run", () => {
    expect(parseBenchOptions("")).toBeUndefined();
    expect(parseBenchOptions("?track=harbour")).toBeUndefined();
    expect(parseBenchOptions("?bench")).toEqual({ warmupSeconds: 10, seconds: 120 });
  });

  test("accept shorter runs for tests and reject nonsense", () => {
    expect(parseBenchOptions("?bench&warmupSeconds=0.5&benchSeconds=2")).toEqual({ warmupSeconds: 0.5, seconds: 2 });
    expect(() => parseBenchOptions("?bench&benchSeconds=0")).toThrow("benchSeconds must be between 0.1 and 600");
    expect(() => parseBenchOptions("?bench&warmupSeconds=x")).toThrow("warmupSeconds must be between 0 and 600");
  });
});

describe("bench recorder", () => {
  const sample = (frameMs: number, paused = false) => ({
    frameMs,
    simMs: 1,
    renderMs: 2,
    drawCalls: 10,
    triangles: 1000,
    metres: 1,
    paused,
  });

  test("discards the warm-up, measures for the run length, then stops", () => {
    const bench = createBenchRecorder({ warmupSeconds: 0.1, seconds: 0.2 });
    const phases = Array.from({ length: 20 }, () => bench.record(sample(20)));

    // 5 warm-up frames of 20 ms reach 0.1 s; 10 more measure 0.2 s.
    expect(phases.filter((p) => p === "warmup")).toHaveLength(5);
    expect(phases.filter((p) => p === "measuring")).toHaveLength(9);
    expect(phases.slice(14).every((p) => p === "done")).toBe(true);
    const result = bench.result();
    expect(result.frames.frames).toBe(10);
    expect(result.measuredSeconds).toBeCloseTo(0.2, 9);
    expect(result.distanceM).toBe(10);
    expect(result.drawCalls).toBe(10);
    expect(result.triangles).toBe(1000);
    expect(result.renderMs.medianMs).toBe(2);
  });

  test("paused frames are not measured, and are counted so the run can be rejected", () => {
    const bench = createBenchRecorder({ warmupSeconds: 0, seconds: 0.1 });
    bench.record(sample(20));
    for (let i = 0; i < 50; i += 1) {
      expect(bench.record(sample(20, true))).toBe("measuring");
    }

    const phases = Array.from({ length: 4 }, () => bench.record(sample(20)));
    expect(phases.at(-1)).toBe("done");
    const result = bench.result();
    expect(result.frames.frames).toBe(5);
    expect(result.pausedFrames).toBe(50);
  });
});
