import { expect, test } from "@playwright/test";
import { collectErrors, freezeFrames, openGame, lowQuality } from "./helpers.ts";

test("@smoke the map tracks the car and the next corner is previewed on approach", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page);
  const dot = page.locator("#map-car");
  const at = async () => [Number(await dot.getAttribute("cx")), Number(await dot.getAttribute("cy"))];
  await page.clock.runFor(3_000);
  const grid = await at();
  await expect(page.locator("#throttle-bar")).toHaveAttribute("style", /scaleX\(0(\.0+)?\)/);

  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(2_000);
  await expect(page.locator("#throttle-bar")).toHaveAttribute("style", /scaleX\(1(\.0+)?\)/);
  const moved = await at();
  expect(Math.hypot((moved[0] ?? 0) - (grid[0] ?? 0), (moved[1] ?? 0) - (grid[1] ?? 0))).toBeGreaterThan(2);

  // Harbour's turn 1 is a right-hander a few hundred metres from the grid.
  await expect(page.locator("#corner-preview")).toBeVisible();
  await expect(page.locator("#corner-label")).toHaveText(/^Turn 1 · Right · (\d+ m|now)$/);
  expect(Number(await page.locator("#rpm").textContent())).toBeGreaterThan(4000);
  expect(errors).toEqual([]);
});

test("@smoke restarting mid-lap does not read as a huge deceleration", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_000);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(2_500);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("KeyR");
  await page.clock.runFor(100);
  const g = Number((await page.locator("#g-force").textContent())?.replace(" g", ""));
  expect(g).toBeLessThan(1);
});
