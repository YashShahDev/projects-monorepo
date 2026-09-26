import { expect, test } from "@playwright/test";
import { collectErrors, freezeFrames, openGame, scenePixels } from "./helpers.ts";

test("@smoke loads the first catalog track by default", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await expect(page.locator("#track-name")).toHaveText("Harbour Park");
});

test("@smoke the track query loads the small test map", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page, "./?track=test-loop");
  await expect(page.locator("#track-name")).toHaveText("Test Loop");
  const pixels = await scenePixels(page);
  expect(pixels.road).toBeGreaterThan(10_000);
  expect(pixels.car).toBeGreaterThan(500);
  expect(errors).toEqual([]);
});

test("@dev the test map's geometry drives the session", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page, "./?track=test-loop");
  const lapDistanceM = await page.evaluate(() => {
    const app = window.__formulaRacerTest;
    if (!app) {
      throw new Error("development test hooks are not installed");
    }

    return app.state().lapDistanceM;
  });

  // The grid sits at the track's own start distance, not Harbour Park's 150 m.
  expect(lapDistanceM).toBeCloseTo(60, 0);
});

test("@smoke an unknown track names the available ones and offers a reload", async ({ page }) => {
  await page.goto("./?track=nowhere");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText('unknown track "nowhere"; available: harbour, test-loop');
  await expect(alert.getByRole("button", { name: "Reload" })).toBeVisible();
});
