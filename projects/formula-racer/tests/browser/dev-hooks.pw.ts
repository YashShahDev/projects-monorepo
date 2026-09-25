import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ProbeApp, ProbeAppState } from "../../src/app/probe-app.ts";
import { openGame } from "./helpers.ts";

type Call = { name: "pause" | "state" | "dispose" } | { name: "step"; count: number };

function hook(page: Page, call: Call): Promise<ProbeAppState | undefined> {
  return page.evaluate((call) => {
    const app = (window as unknown as { __formulaRacerTest: ProbeApp }).__formulaRacerTest;
    if (call.name === "step") return app.step(call.count);
    if (call.name === "state") return app.state();
    app[call.name]();
    return undefined;
  }, call);
}

async function state(page: Page, call: Call = { name: "state" }): Promise<ProbeAppState> {
  const result = await hook(page, call);
  if (!result) throw new Error(`${call.name} returned no state`);
  return result;
}

test("@dev test hooks pause and step the simulation deterministically", async ({ page }) => {
  await openGame(page);
  await hook(page, { name: "pause" });
  const paused = await state(page);
  await page.waitForTimeout(200);
  const still = await state(page);
  expect(still.steps).toBe(paused.steps);
  expect(still.frames).toBeGreaterThan(paused.frames);

  const one = await state(page, { name: "step", count: 1 });
  expect(one.steps).toBe(paused.steps + 1);
  expect(one.box.position.y).toBeLessThan(paused.box.position.y);

  const settled = await state(page, { name: "step", count: 300 });
  expect(settled.box.position.y).toBeCloseTo(0.5, 2);
});

test("@dev dispose frees the world and stops the frame loop", async ({ page }) => {
  await openGame(page);
  await hook(page, { name: "dispose" });
  await expect(hook(page, { name: "state" })).rejects.toThrow("probe world used after dispose()");
  // A loop still running against the freed world would raise a "Frame failed" alert.
  await page.waitForTimeout(300);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
