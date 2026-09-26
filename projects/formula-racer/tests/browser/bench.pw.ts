import { expect, test } from "@playwright/test";
import type { BenchReport } from "../../src/app/bench.ts";

test("@smoke the bench route drives itself and reports frame and render statistics", async ({ page }) => {
  // The countdown holds the car for 3 s, so a 3.2 s warm-up measures it driving.
  await page.goto("./?bench&warmupSeconds=3.2&benchSeconds=2");
  const pre = page.locator("#bench-report");
  await expect(pre).toBeVisible({ timeout: 30_000 });
  const report = JSON.parse((await pre.textContent()) ?? "") as BenchReport;
  expect(report.route).toBe("harbour-autopilot-v1");
  expect(report.quality).toBe("medium");
  expect(report.measuredSeconds).toBeGreaterThanOrEqual(2);
  expect(report.frames.frames).toBeGreaterThan(10);
  expect(report.frames.p95Ms).toBeGreaterThan(0);
  expect(report.simMs.frames).toBe(report.frames.frames);
  expect(report.drawCalls).toBeGreaterThan(0);
  expect(report.triangles).toBeGreaterThan(0);
  expect(report.drawingBuffer.width).toBeGreaterThan(0);
  expect(report.gl.renderer).not.toBe("");
  expect(report.distanceM).toBeGreaterThan(5);
});
