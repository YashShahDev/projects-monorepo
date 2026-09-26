import { expect, test } from "@playwright/test";
import { collectErrors, freezeFrames, openGame, readSpeed, scenePixels } from "./helpers.ts";

test("@smoke starts on the grid and renders sky, grass, road and car", async ({ page }, info) => {
  const errors = collectErrors(page);
  await openGame(page);
  await expect(page.locator("#view")).toBeVisible();
  const pixels = await scenePixels(page);
  expect(pixels.sky).toBeGreaterThan(10_000);
  expect(pixels.grass).toBeGreaterThan(5_000);
  expect(pixels.road).toBeGreaterThan(10_000);
  expect(pixels.car).toBeGreaterThan(500);
  await expect(page.locator("#gear")).toHaveText("1");
  const startup = await page.evaluate(() => performance.getEntriesByName("formula-racer:startup")[0]?.duration);
  expect(startup).toBeGreaterThan(0);

  // Reported for the checkpoint record; headless software rendering is not a benchmark.
  info.annotations.push({ type: "startup-ms", description: String(Math.round(startup ?? 0)) });
  expect(errors).toEqual([]);
});

test("@smoke the countdown holds the car, then the lap clock runs", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.down("ArrowUp");

  // Mid-second, clear of the boundary: the first frame has no previous timestamp.
  await page.clock.runFor(1_500);
  await expect(page.locator("#countdown")).toHaveText("2");
  expect(await readSpeed(page)).toBe(0);
  await page.clock.runFor(2_000);
  await expect(page.locator("#countdown")).toBeHidden();
  await expect(page.locator("#lap-time")).toHaveText(/^0:00\.[1-9]\d\d$/);
});

test("@smoke holding the throttle drives off and shifts up", async ({ page }) => {
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_000);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(3_000);
  expect(await readSpeed(page)).toBeGreaterThan(80);
  expect(Number(await page.locator("#gear").textContent())).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test("@smoke Escape pauses the car and shows it", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_000);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(1_000);
  await page.keyboard.press("Escape");
  await expect(page.locator("#paused")).toBeVisible();
  const held = await readSpeed(page);
  await page.clock.runFor(1_000);
  expect(await readSpeed(page)).toBe(held);
  await page.keyboard.press("Escape");
  await expect(page.locator("#paused")).toBeHidden();
});

test("@smoke E switches the energy mode and Shift deploys from the battery", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await expect(page.locator("#energy-mode")).toHaveText("Balanced");
  await expect(page.locator("#charge")).toHaveText("100%");
  await page.keyboard.press("KeyE");
  await expect(page.locator("#energy-mode")).toHaveText("Harvest");
  await page.keyboard.press("KeyE");
  await page.clock.runFor(3_000);
  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowUp");

  // Still inside the main-straight zone (40–260 m from a 150 m grid slot).
  await page.clock.runFor(2_000);
  await expect(page.locator("#wing")).toHaveText("Straight");
  expect(Number((await page.locator("#charge").textContent())?.replace("%", ""))).toBeLessThan(97);
});

test("@smoke running wide onto the grass marks the lap invalid", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_000);
  await expect(page.locator("#lap-time")).not.toHaveClass(/invalid/);

  // Flat out without steering: straight on at turn 1 and onto the grass.
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(9_000);
  await expect(page.locator("#lap-time")).toHaveClass(/invalid/);
});
