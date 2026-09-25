import { expect, test } from "@playwright/test";
import { collectErrors, freezeFrames, openGame, scenePixels } from "./helpers.ts";

test("@smoke starts without errors and renders sky, ground and box", async ({ page }, info) => {
  const errors = collectErrors(page);
  await openGame(page);
  await expect(page.locator("#view")).toBeVisible();
  const pixels = await scenePixels(page);
  expect(pixels.sky).toBeGreaterThan(10_000);
  expect(pixels.ground).toBeGreaterThan(10_000);
  expect(pixels.box).toBeGreaterThan(500);
  const startup = await page.evaluate(
    () => performance.getEntriesByName("formula-racer:startup")[0]?.duration,
  );
  expect(startup).toBeGreaterThan(0);
  // Reported for the checkpoint record; headless software rendering is not a benchmark.
  info.annotations.push({ type: "startup-ms", description: String(Math.round(startup ?? 0)) });
  expect(errors).toEqual([]);
});

test("@smoke physics advances the box onto the ground", async ({ page }) => {
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(50);
  const falling = await scenePixels(page);
  await page.clock.runFor(3_000);
  const resting = await scenePixels(page);
  // The box starts 4 m up and falls toward the camera's lower half.
  expect(resting.boxRow - falling.boxRow).toBeGreaterThan(50);
  await page.clock.runFor(1_000);
  const later = await scenePixels(page);
  expect(Math.abs(later.boxRow - resting.boxRow)).toBeLessThan(2);
  expect(errors).toEqual([]);
});
