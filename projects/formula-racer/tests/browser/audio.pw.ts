import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { GameAppState } from "../../src/app/game-app.ts";
import { collectErrors, freezeFrames, openGame } from "./helpers.ts";

const hooks = (page: Page, steps: number, throttle: boolean): Promise<GameAppState> =>
  page.evaluate(
    ([count, held]) => {
      const app = window.__formulaRacerTest;
      if (!app) {
        throw new Error("development test hooks are not installed");
      }

      return app.step(count, held);
    },
    [steps, throttle] as const,
  );

test("@dev the engine sound follows the throttle", async ({ page }) => {
  const errors = collectErrors(page);
  await freezeFrames(page);
  await openGame(page);

  // A key press is the user gesture that lets the page start audio.
  await page.keyboard.press("ArrowLeft");
  const idle = (await hooks(page, 1, false)).sound;
  const driving = (await hooks(page, 300, true)).sound;
  expect(idle.enabled).toBe(true);
  expect(driving.engineGain).toBeGreaterThan(idle.engineGain);
  expect(driving.engineHz).toBeGreaterThan(idle.engineHz);
  expect(driving.output).toBe("running");
  expect(errors).toEqual([]);
});

test("@dev the Sound option mutes the car and is remembered", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.press("Escape");
  const sound = page.getByRole("dialog", { name: "Paused" }).getByLabel("Sound");
  await expect(sound).toBeChecked();
  await sound.uncheck();
  expect((await hooks(page, 1, false)).sound.enabled).toBe(false);

  // The output fades before it suspends, so muting does not click.
  expect((await hooks(page, 1, false)).sound.output).not.toBe("suspended");
  await page.clock.runFor(500);
  await expect.poll(async () => (await hooks(page, 1, false)).sound.output).toBe("suspended");
  await page.reload();
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#sound")).not.toBeChecked();
  expect((await hooks(page, 1, false)).sound.enabled).toBe(false);
});

test("@dev the Volume slider starts at 25%, sets the output level, and is remembered", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.press("Escape");
  const volume = page.getByRole("dialog", { name: "Paused" }).getByRole("slider", { name: "Volume" });
  await expect(volume).toHaveValue("25");
  const quiet = (await hooks(page, 1, false)).sound;
  expect(quiet.volume).toBe(25);

  await volume.fill("80");
  const loud = (await hooks(page, 1, false)).sound;
  expect(loud.volume).toBe(80);
  expect(loud.level).toBeCloseTo(quiet.level * (80 / 25), 6);

  await volume.fill("0");
  expect((await hooks(page, 1, false)).sound.level).toBe(0);

  await volume.fill("40");
  await page.reload();
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#volume")).toHaveValue("40");
  expect((await hooks(page, 1, false)).sound.volume).toBe(40);
});

test("@smoke the game still starts when audio cannot be created", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", {
      value: function BlockedAudioContext() {
        throw new Error("NotAllowedError: audio is blocked");
      },
    });
  });
  await openGame(page);
  await expect(page.locator("#speed")).toHaveText("0");
});
