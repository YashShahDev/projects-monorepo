import { expect, test } from "@playwright/test";
import { collectErrors, freezeFrames, openGame, readSpeed, scenePixels, lowQuality } from "./helpers.ts";

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

test("@smoke the road shows right beside the car, not the grass under it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame(page);

  // The strips either side of the car, just ahead of the camera, are the start straight.
  for (const [left, right] of [
    [0.27, 0.37],
    [0.63, 0.73],
  ]) {
    const near = await scenePixels(page, { left: left ?? 0, right: right ?? 1, top: 0.72, bottom: 0.95 });
    expect(near.road).toBeGreaterThan(near.grass * 4);
  }
});

test("@smoke the countdown holds the car, then the lap clock runs", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.down("ArrowUp");

  // Mid-second, clear of the boundary: the first frame has no previous timestamp.
  await page.clock.runFor(1_500);
  await expect(page.locator("#countdown")).toHaveText("2");
  expect(await readSpeed(page)).toBe(0);
  await page.clock.runFor(2_000);
  await expect(page.locator("#countdown")).toBeHidden();
  await expect(page.locator("#lap-time")).toHaveText(/^0:00\.[1-9]\d\d$/u);
});

test("@smoke holding the throttle drives off and shifts up", async ({ page }) => {
  await lowQuality(page);
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
  await lowQuality(page);
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
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  await expect(page.locator("#energy-mode")).toHaveText("Balanced");
  await expect(page.locator("#charge")).toHaveText("100%");
  for (const mode of ["Attack", "Qualifying", "Harvest", "Balanced"]) {
    await page.keyboard.press("KeyE");
    await expect(page.locator("#energy-mode")).toHaveText(mode);
  }

  await page.clock.runFor(3_000);
  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowUp");

  // The rear tyres have no grip to spare for the ERS until about 130 km/h, 3.2 s from
  // the lights; 3.8 s is still inside the main-straight zone (40–260 m from a 150 m
  // grid slot).
  await page.clock.runFor(3_800);
  await expect(page.locator("#wing")).toHaveText("Straight");
  expect(Number((await page.locator("#charge").textContent())?.replace("%", ""))).toBeLessThan(100);
});

test("@smoke a battery meter shows the charge the readout gives", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  const meter = page.getByRole("meter", { name: "Battery" });
  await expect(meter).toHaveAttribute("value", "100");
  await page.clock.runFor(3_000);
  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(3_800);
  const shown = Number((await page.locator("#charge").textContent())?.replace("%", ""));
  expect(shown).toBeLessThan(100);
  await expect(meter).toHaveAttribute("value", String(shown));
});

test("@smoke running wide onto the grass marks the lap invalid", async ({ page }) => {
  // Twelve seconds of driving is about 700 rendered frames of the full scene, which takes
  // over 30 s when the machine is busy.
  test.setTimeout(60_000);
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_000);
  await expect(page.locator("#lap-time")).not.toHaveClass(/invalid/u);

  // Flat out without steering: straight on at turn 1 and onto the grass.
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(9_000);
  await expect(page.locator("#lap-time")).toHaveClass(/invalid/u);
});

test("@smoke the energy mode chosen in the menu applies and is remembered", async ({ page }) => {
  // No lowQuality here: its saved preferences would replace the choice on reload.
  await openGame(page);
  await page.keyboard.press("Escape");
  await page.locator("#energy-select").selectOption("qualifying");
  await expect(page.locator("#energy-mode")).toHaveText("Qualifying");
  await page.reload();
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#energy-mode")).toHaveText("Qualifying");
  await expect(page.locator("#energy-select")).toHaveValue("qualifying");
});
