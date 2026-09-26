import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, freezeFrames, lowQuality, openGame } from "./helpers.ts";

const guide = (page: Page) =>
  page.evaluate(() => {
    const app = window.__formulaRacerTest;
    if (!app) {
      throw new Error("test hooks missing");
    }

    return app.state().guide;
  });

test("@smoke the racing line is off by default, shows the road ahead when on, and hides again", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(1_000);
  await expect.poll(() => guide(page)).toEqual({ mode: "off", shownPoints: 0 });

  const choose = async (label: string) => {
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Paused" }).getByLabel("Racing line").selectOption({ label });
    await page.keyboard.press("Escape");
    await page.clock.runFor(200);
  };

  await choose("Full");
  const full = await guide(page);
  expect(full?.mode).toBe("full");

  // 300 m of line at 2 m spacing.
  expect(full?.shownPoints ?? 0).toBeGreaterThan(100);

  // On the grid, the braking zones are only the part of the next corner's approach.
  await choose("Braking zones");
  const braking = await guide(page);
  expect(braking?.shownPoints ?? 0).toBeLessThan(full?.shownPoints ?? 0);

  await choose("Off");
  expect(await guide(page)).toEqual({ mode: "off", shownPoints: 0 });
  const saved = await page.evaluate(() => localStorage.getItem("formula-racer:prefs"));
  expect(JSON.parse(saved ?? "{}")).toMatchObject({ racingLine: "off" });
  expect(errors).toEqual([]);
});

test("@smoke the corner preview gives the speed to carry through the next corner", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_000);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(2_000);
  await expect(page.locator("#corner-preview")).toBeVisible();
  await expect(page.locator("#corner-speed")).toHaveText(/^\d+ km\/h$/u);
});
