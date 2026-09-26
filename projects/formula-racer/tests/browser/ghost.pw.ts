import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, freezeFrames, lowQuality, openGame } from "./helpers.ts";

const drive = (page: Page, seconds: number) =>
  page.evaluate((s) => {
    const app = window.__formulaRacerTest;
    if (!app) {
      throw new Error("development test hooks are not installed");
    }

    return app.drive(s);
  }, seconds);

test("@dev after a lap, its ghost races the next one with a live delta, and is saved", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page, "./?track=test-loop");

  // Through the countdown and into the first lap: no ghost exists yet.
  let state = await drive(page, 5);
  expect(state.ghost).toEqual({ mode: "best", visible: false, deltaS: undefined });
  await expect(page.locator("#delta")).toBeHidden();

  for (let i = 0; i < 20 && state.laps.length === 0; i += 1) {
    state = await drive(page, 5);
  }

  expect(state.laps[0]?.valid).toBe(true);
  state = await drive(page, 3);
  expect(state.ghost.visible).toBe(true);

  // The ghost's lap began from a standing start and this one is flying, so the car is
  // ahead of it, by the seconds the launch cost.
  expect(state.ghost.deltaS ?? 0).toBeLessThan(-0.5);
  expect(state.ghost.deltaS ?? -99).toBeGreaterThan(-5);
  await expect(page.locator("#delta")).toHaveText(/^−\d+\.\d\d$/u);
  await expect(page.locator("#delta")).toHaveClass(/ahead/u);

  // The best lap's ghost is written after the frame that recorded it.
  await page.clock.runFor(100);
  const savedKeys = await page.evaluate(() => {
    const parsed: unknown = JSON.parse(localStorage.getItem("formula-racer:ghosts") ?? "{}");

    return typeof parsed === "object" && parsed !== null && "order" in parsed ? parsed.order : undefined;
  });
  expect(savedKeys).toHaveLength(1);

  // Off hides it.
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Paused" }).getByLabel("Ghost").selectOption("off");
  await page.keyboard.press("Escape");
  state = await drive(page, 0.1);
  expect(state.ghost.visible).toBe(false);
  await expect(page.locator("#delta")).toBeHidden();
  expect(errors).toEqual([]);
});
