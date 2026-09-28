import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, freezeFrames, openGame } from "./helpers.ts";

const idle = (page: Page, steps: number) =>
  page.evaluate((n) => {
    const app = window.__formulaRacerTest;
    if (!app) {
      throw new Error("development test hooks are not installed");
    }

    return app.step(n, false);
  }, steps);

test("@dev opponents line up ahead, show on the map, drive off at the lights, and the position follows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const prefs = { version: 1, quality: "low", opponents: 3, opponentLevel: "ace" };
    localStorage.setItem("formula-racer:prefs", JSON.stringify(prefs));
  });
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page, "./?track=harbour");

  // The player starts at the back, with the field in view.
  let state = await idle(page, 1);
  expect(state.race).toEqual({ position: 4, cars: 4, drawn: 3 });
  await expect(page.locator("#position")).toHaveText("P4 / 4");
  await expect(page.locator("#track-map .opponent")).toHaveCount(3);
  const mapDot = () => page.locator("#track-map .opponent").first().getAttribute("cx");
  const onGrid = await mapDot();

  // Standing still after the lights, the player is passed by all three (60 Hz steps).
  state = await idle(page, 9 * 60);
  expect(state.countdownS).toBe(0);
  expect(state.race).toEqual({ position: 4, cars: 4, drawn: 3 });
  await expect(page.locator("#position")).toHaveText("P4 / 4");
  expect(await mapDot()).not.toBe(onGrid);

  // Turning them off in the menu restarts the lap on an empty track.
  await page.keyboard.press("Escape");
  await page.locator("#opponents").selectOption("0");
  await expect(page.locator("#position")).toBeHidden();
  await expect(page.locator("#track-map .opponent")).toHaveCount(0);
  expect(await page.evaluate(() => window.__formulaRacerTest?.state().race)).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem("formula-racer:prefs"))).toContain('"opponents":0');
  expect(errors).toEqual([]);
});
