import { expect, test } from "@playwright/test";
import { openGame } from "./helpers.ts";

test("@prod production builds expose no test hooks or tuning panel", async ({ page }) => {
  await openGame(page);
  expect(await page.evaluate(() => "__formulaRacerTest" in window)).toBe(false);
  await page.keyboard.press("F2");
  await expect(page.getByRole("form", { name: "Tuning" })).toHaveCount(0);
});

test("a missing content file shows a recoverable error", async ({ page }) => {
  await page.route("**/assets/tracks/harbour.json", (route) => route.fulfill({ status: 404 }));
  await page.goto("./");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Could not load game content");
  await expect(alert).toContainText("assets/tracks/harbour.json: HTTP 404");
  await page.unroute("**/assets/tracks/harbour.json");
  await alert.getByRole("button", { name: "Reload" }).click();
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
});

test("invalid content names the failing field", async ({ page }) => {
  await page.route("**/assets/tracks/harbour.json", (route) =>
    route.fulfill({ json: { version: 9 } }),
  );
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("harbour.json.version must be 1");
});

test("missing WebGL2 is reported instead of a blank page", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === "webgl2" ? null : Reflect.apply(original, this, [type, ...rest]);
      },
    });
  });
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("WebGL2 is not available");
});

test("a WebAssembly failure is reported as a physics startup error", async ({ page }) => {
  await page.addInitScript(() => {
    WebAssembly.instantiate = () => Promise.reject(new Error("blocked by test"));
  });
  await page.goto("./");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Physics engine (WebAssembly) failed to start");
  await expect(alert).toContainText("blocked by test");
});

test("a lost graphics context stops the loop and asks for a reload", async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#view");
    canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.getByRole("alert")).toContainText("graphics context was lost");
});
