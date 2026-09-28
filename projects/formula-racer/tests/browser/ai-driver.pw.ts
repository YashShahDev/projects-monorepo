import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, freezeFrames, lowQuality, openGame } from "./helpers.ts";

const state = (page: Page) =>
  page.evaluate(() => {
    const app = window.__formulaRacerTest;
    if (!app) {
      throw new Error("test hooks missing");
    }

    const s = app.state();

    return { aiDriving: s.aiDriving, speedKmh: s.speedKmh, distanceM: s.lapDistanceM };
  });

test("@smoke I hands the car to the AI driver and takes it back", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_500);
  expect(await state(page)).toMatchObject({ aiDriving: false });

  await page.keyboard.press("KeyI");
  await expect(page.locator("#ai-driving")).toBeVisible();
  await page.clock.runFor(6_000);
  const driven = await state(page);
  expect(driven.aiDriving).toBe(true);

  // No key is held: the AI drove it off the grid and up to speed.
  expect(driven.speedKmh).toBeGreaterThan(100);

  await page.keyboard.press("KeyI");
  await expect(page.locator("#ai-driving")).toBeHidden();
  await page.clock.runFor(2_000);
  const back = await state(page);
  expect(back.aiDriving).toBe(false);

  // Back with the player, who holds nothing: the car coasts down.
  expect(back.speedKmh).toBeLessThan(driven.speedKmh - 10);
  expect(errors).toEqual([]);
});
