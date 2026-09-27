import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { lapKey } from "../../src/app/lap-store.ts";
import { PHYSICS_VERSION } from "../../src/simulation/version.ts";
import { collectErrors, freezeFrames, lowQuality, openGame } from "./helpers.ts";

// Only the player's own laps are records: not the benchmark's, nor the AI driver's.
const key = lapKey({
  trackId: "test-loop",
  physicsVersion: PHYSICS_VERSION,
  assists: { steering: true, abs: true, traction: true },
});

const saved = (page: Page) =>
  page.evaluate(() => ({
    laps: localStorage.getItem("formula-racer:laps"),
    ghosts: localStorage.getItem("formula-racer:ghosts"),
  }));

const lapsDone = (page: Page) => page.evaluate(() => window.__formulaRacerTest?.state().laps.length ?? 0);

test("@dev a benchmark lap never replaces the player's best", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await page.addInitScript(
    ([storageKey, lap]) => {
      localStorage.setItem("formula-racer:laps", JSON.stringify({ version: 1, bests: { [storageKey]: lap } }));
    },
    [key, { timeS: 99, sectorsS: [33, 33, 33] }] as const,
  );
  await freezeFrames(page);
  await openGame(page, "./?bench&track=test-loop&warmupSeconds=1&benchSeconds=600");
  const before = await saved(page);
  for (let i = 0; i < 30 && (await lapsDone(page)) === 0; i += 1) {
    await page.evaluate(() => window.__formulaRacerTest?.drive(5));
  }

  expect(await lapsDone(page)).toBeGreaterThan(0);
  await page.clock.runFor(200);
  expect(await saved(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("@dev a lap the AI driver drove is not the player's record", async ({ page }) => {
  await lowQuality(page);
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page, "./?track=test-loop");
  test.setTimeout(180_000);
  await page.keyboard.press("KeyI");
  for (let i = 0; i < 20 && (await lapsDone(page)) === 0; i += 1) {
    await page.clock.runFor(5_000);
  }

  expect(await lapsDone(page)).toBeGreaterThan(0);
  await page.clock.runFor(200);
  const { laps, ghosts } = await saved(page);
  expect(JSON.parse(laps ?? "{}")).not.toHaveProperty(["bests", key]);
  expect(ghosts).toBeNull();
  expect(errors).toEqual([]);
});
