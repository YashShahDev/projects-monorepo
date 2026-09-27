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

// Past eight steps a frame the simulation drops the rest of the time, so the distance
// must come from where the car went, not its speed times the wall-clock frame.
test("@dev the bench distance is how far the car went, even through long frames", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await page.goto("./?bench&warmupSeconds=5&benchSeconds=2");
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
  const along = () => page.evaluate(() => window.__formulaRacerTest?.state().lapDistanceM ?? 0);
  await page.clock.runFor(5_000);
  const from = await along();
  const pre = page.locator("#bench-report");
  for (let i = 0; i < 10 && !(await pre.isVisible()); i += 1) {
    await page.clock.fastForward(500);
  }

  await expect(pre).toBeVisible();
  const report = parseBenchReport(JSON.parse((await pre.textContent()) ?? ""));
  const travelled = (await along()) - from;
  expect(travelled).toBeGreaterThan(5);
  expect(report.distanceM).toBeGreaterThan(travelled * 0.8);
  expect(report.distanceM).toBeLessThan(travelled * 1.2);
});
