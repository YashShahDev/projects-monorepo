import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, freezeFrames, lowQuality, openGame } from "./helpers.ts";

const send = (page: Page, message: unknown) =>
  page.evaluate(async (m) => {
    const api = window.formulaRacer;
    if (!api) {
      throw new Error("window.formulaRacer missing");
    }

    const reply = await api.control.send(m);

    return reply.type === "observation"
      ? {
          type: reply.type,
          speedMps: reply.observation.speedMps,
          simSeconds: reply.observation.simSeconds,
          done: reply.done,
        }
      : reply;
  }, message);

const simSeconds = (page: Page) =>
  page.evaluate(() => {
    const app = window.__formulaRacerTest;
    if (!app) {
      throw new Error("test hooks missing");
    }

    return app.state().simSeconds;
  });

test("@smoke ?control lets outside software drive the car the page shows", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page, "./?control");

  // Without the window API the page would not be controllable at all.
  expect(await page.evaluate(() => typeof window.formulaRacer?.control.send)).toBe("function");
  expect(await send(page, { type: "reset" })).toMatchObject({ type: "observation", simSeconds: 0 });

  // The keyboard does not drive while outside software has the car.
  const held = await simSeconds(page);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(1_000);
  await page.keyboard.up("ArrowUp");
  expect(await simSeconds(page)).toBe(held);

  const driven = await send(page, { type: "step", throttle: 1, brake: 0, steer: 0, steps: 120 });
  expect(driven).toMatchObject({ type: "observation", done: false });
  expect(driven.type === "observation" ? driven.speedMps : 0).toBeGreaterThan(20);
  expect(await send(page, { type: "step", throttle: 3, brake: 0, steer: 0 })).toMatchObject({ type: "error" });
  expect(await send(page, { type: "reset", track: "riviera" })).toMatchObject({ type: "error" });

  // After close the keyboard has the car again.
  expect(await send(page, { type: "close" })).toMatchObject({ type: "closed" });
  const before = await simSeconds(page);
  await page.clock.runFor(1_000);
  expect(await simSeconds(page)).toBeGreaterThan(before + 0.5);
  expect(errors).toEqual([]);
});

test("@smoke without ?control there is no control API", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  expect(await page.evaluate(() => window.formulaRacer)).toBeUndefined();
});
