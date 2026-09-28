import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, freezeFrames, lowQuality, openGame } from "./helpers.ts";

const step = (page: Page, count: number, throttle: boolean) =>
  page.evaluate(
    ([n, t]) => {
      const app = window.__formulaRacerTest;
      if (!app) {
        throw new Error("development test hooks are not installed");
      }

      return app.step(n, t);
    },
    [count, throttle] as const,
  );

test("@dev a wheelspin launch without traction control leaves tyre marks on the road", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page, "./?track=test-loop");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Paused" }).getByLabel("Traction control").uncheck();
  await page.keyboard.press("Escape");

  // Through the countdown on the grid: nothing slips.
  let state = await step(page, 30, false);
  for (let i = 0; i < 20 && state.countdownS > 0; i += 1) {
    state = await step(page, 30, false);
  }

  expect(state.countdownS).toBe(0);
  expect(state.marks.live).toBe(0);
  state = await step(page, 90, true);
  expect(state.marks.live).toBeGreaterThan(4);
  expect(errors).toEqual([]);
});
