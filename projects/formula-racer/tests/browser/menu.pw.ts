import { expect, test } from "@playwright/test";
import { lapKey } from "../../src/app/lap-store.ts";
import { PHYSICS_VERSION } from "../../src/simulation/version.ts";
import { collectErrors, freezeFrames, openGame, readSpeed, scenePixels } from "./helpers.ts";

const allAssists = { steering: true, abs: true, traction: true };
const key = lapKey({ trackId: "harbour", physicsVersion: PHYSICS_VERSION, assists: allAssists });

test("@smoke Escape opens the pause menu; Resume continues", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.press("Escape");
  const menu = page.getByRole("dialog", { name: "Paused" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Resume" }).click();
  await expect(menu).toBeHidden();
});

test("@smoke switching an assist off restarts on the grid", async ({ page }) => {
  await freezeFrames(page);
  await openGame(page);
  await page.clock.runFor(3_000);
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(1_500);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("Escape");
  const menu = page.getByRole("dialog", { name: "Paused" });
  await menu.getByLabel("Traction control").uncheck();

  // Escape still resumes with focus on the checkbox.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.clock.runFor(500);
  expect(await readSpeed(page)).toBe(0);
  await expect(page.locator("#countdown")).toBeVisible();
});

test("@smoke a saved best lap is shown after loading", async ({ page }) => {
  await page.addInitScript(
    ([storageKey, lap]) => {
      localStorage.setItem(
        "formula-racer:laps",
        JSON.stringify({ version: 1, bests: { [storageKey]: lap } }),
      );
    },
    [key, { timeS: 92.3456, sectorsS: [30, 31, 31.3456] }] as const,
  );
  await openGame(page);
  await expect(page.locator("#best-lap")).toHaveText("1:32.345");
});

test("@smoke corrupt saved data does not stop the game", async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem("formula-racer:laps", "{broken"));
  await openGame(page);
  await expect(page.locator("#storage-note")).toContainText("reset");
  await expect(page.locator("#best-lap")).toHaveText("–");
  expect(errors).toEqual([]);
});

test("@smoke blocked storage keeps playing and says bests are not saved", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await openGame(page);
  await expect(page.locator("#storage-note")).toContainText("not saved");
});

test("@smoke the chosen livery repaints the car and is remembered", async ({ page }) => {
  await openGame(page);
  const red = (await scenePixels(page)).car;
  expect(red).toBeGreaterThan(500);
  await page.keyboard.press("Escape");
  const livery = page.getByRole("dialog", { name: "Paused" }).getByLabel("Livery");
  await expect(livery).toHaveValue("vermilion");
  await livery.selectOption({ label: "Tidewater #12" });
  await page.keyboard.press("Escape");

  // The red-car pixel class stops matching the body once the paint is teal; a few
  // red-kerb edge pixels still count.
  await expect.poll(async () => (await scenePixels(page)).car).toBeLessThan(red / 10);
  await page.reload();
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#livery")).toHaveValue("tidewater");
});
