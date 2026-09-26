import { expect, test } from "@playwright/test";
import { freezeFrames, lowQuality, openGame } from "./helpers.ts";

test("@smoke H opens the controls help over a paused game; Escape closes only the help", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.press("KeyH");
  const help = page.getByRole("dialog", { name: "Controls" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("row", { name: /Shift up/u })).toContainText("X");
  await expect(help.getByRole("row", { name: /Throttle/u })).toContainText("↑");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
});

test("@smoke the menu's Controls button opens the help and focus returns to it on close", async ({ page }) => {
  await lowQuality(page);
  await freezeFrames(page);
  await openGame(page);
  await page.keyboard.press("Escape");
  const button = page.getByRole("dialog", { name: "Paused" }).getByRole("button", { name: "Controls" });
  await button.click();
  const help = page.getByRole("dialog", { name: "Controls" });
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Close" }).click();
  await expect(help).toBeHidden();
  await expect(button).toBeFocused();
});
