import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { GameApp, GameAppState } from "../../src/app/game-app.ts";
import { freezeFrames, openGame } from "./helpers.ts";

type Call = { name: "state" | "dispose" } | { name: "step"; count: number; throttle: boolean };

function hook(page: Page, call: Call): Promise<GameAppState | undefined> {
  return page.evaluate((call) => {
    const app = (window as unknown as { __formulaRacerTest: GameApp }).__formulaRacerTest;
    if (call.name === "step") return app.step(call.count, call.throttle);
    if (call.name === "state") return app.state();
    app.dispose();
    return undefined;
  }, call);
}

async function state(page: Page, call: Call = { name: "state" }): Promise<GameAppState> {
  const result = await hook(page, call);
  if (!result) throw new Error(`${call.name} returned no state`);
  return result;
}

test("@dev stepping with the hooks is deterministic across page loads", async ({ page }) => {
  const run = async () => {
    await openGame(page);
    return state(page, { name: "step", count: 120, throttle: true });
  };
  await freezeFrames(page);
  const first = await run();
  await page.reload();
  const second = await run();
  expect(first.speedKmh).toBeGreaterThan(60);
  expect(second.speedKmh).toBe(first.speedKmh);
  expect(second.lapDistanceM).toBe(first.lapDistanceM);
});

test("@dev losing focus pauses and releases held keys", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(1_000);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const paused = await state(page);
  expect(paused.paused).toBe(true);
  expect(paused.held.throttle).toBe(false);
  await page.keyboard.press("Escape");
  await page.clock.runFor(2_000);
  const coasting = await state(page);
  expect(coasting.paused).toBe(false);
  // No drag until P2-C3, so a released throttle coasts at a steady speed; the chassis
  // coming out of squat adds under 1 km/h. A still-held throttle would add ~50 km/h.
  expect(coasting.speedKmh).toBeLessThan(paused.speedKmh + 1.5);
});

test("@dev R resets to the grid", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  const grid = await state(page);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(2_000);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("KeyR");
  await page.clock.runFor(500);
  const reset = await state(page);
  expect(Math.abs(reset.speedKmh)).toBeLessThan(2);
  expect(Math.abs(reset.lapDistanceM - grid.lapDistanceM)).toBeLessThan(1);
});

test("@dev dispose frees the simulation and stops the frame loop", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await hook(page, { name: "dispose" });
  await expect(hook(page, { name: "state" })).rejects.toThrow(
    "vehicle simulation used after dispose()",
  );
  await page.clock.runFor(300);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
