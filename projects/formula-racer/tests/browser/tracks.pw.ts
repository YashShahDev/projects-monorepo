import { expect, test } from "@playwright/test";
import { collectErrors, freezeFrames, openGame, scenePixels } from "./helpers.ts";

test("@smoke loads the first catalog track by default", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await expect(page.locator("#track-name")).toHaveText("Harbour Park");
});

test("@dev the Track menu lists the catalog and loads the chosen track, keeping other options", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page, "./?track=harbour&debug=1");
  await page.keyboard.press("Escape");
  const pick = page.getByRole("dialog", { name: "Paused" }).getByLabel("Track");
  await expect(pick).toHaveValue("harbour");
  await expect(pick.locator("option")).toHaveText([
    "Harbour Park",
    "Riviera Streets",
    "Ardennes Ring",
    "Royal Park",
    "Corniche Night",
    "Test Loop",
  ]);

  await pick.selectOption("test-loop");
  await expect(page).toHaveURL(/\?track=test-loop&debug=1$/u);
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#track-name")).toHaveText("Test Loop");
  await expect(page.locator("#track")).toHaveValue("test-loop");
  expect(errors).toEqual([]);
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
  await expect(alert).toContainText(
    'unknown track "nowhere"; available: harbour, riviera, ardennes, royal-park, corniche, test-loop',
  );
  await expect(alert.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("@smoke a night track has a dark sky, glowing floodlights and a lit road", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame(page, "./?track=corniche");
  await expect(page.locator("#track-name")).toHaveText("Corniche Night");
  const sky = await scenePixels(page, { left: 0, top: 0, right: 1, bottom: 0.2 });
  expect(sky.sky).toBe(0);
  expect(sky.dark).toBeGreaterThan(0.8 * 1280 * 720 * 0.2);

  const above = await scenePixels(page, { left: 0, top: 0, right: 1, bottom: 0.55 });
  expect(above.glow).toBeGreaterThan(20);

  // The strips either side of the car read as road, not as darkness.
  for (const [left, right] of [
    [0.27, 0.37],
    [0.63, 0.73],
  ]) {
    const near = await scenePixels(page, { left: left ?? 0, right: right ?? 1, top: 0.72, bottom: 0.95 });
    expect(near.road).toBeGreaterThan(near.dark * 4);
  }

  expect(errors).toEqual([]);
});
