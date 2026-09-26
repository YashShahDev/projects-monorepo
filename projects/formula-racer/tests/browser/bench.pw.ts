import { expect, test } from "@playwright/test";
import { parseBenchReport } from "../../tools/bench.ts";
import { freezeFrames, lowQuality } from "./helpers.ts";

test("@smoke the bench route drives itself and reports frame and render statistics", async ({ page }) => {
  // The fake clock drives the frames, so a loaded machine cannot starve the route.
  await lowQuality(page);
  await freezeFrames(page);

  // The countdown holds the car for 3 s, so a 3.2 s warm-up measures it driving.
  await page.goto("./?bench&warmupSeconds=3.2&benchSeconds=2");
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
  await page.clock.runFor(5_500);
  const pre = page.locator("#bench-report");
  await expect(pre).toBeVisible();
  const report = parseBenchReport(JSON.parse((await pre.textContent()) ?? ""));
  expect(report.route).toBe("harbour-autopilot-v1");
  expect(report.quality).toBe("low");
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
