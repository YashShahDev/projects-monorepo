import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Collects page exceptions and console errors; driver performance warnings are ignored. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });

  return errors;
}

/**
 * Installs Playwright's paused fake clock, which also holds `requestAnimationFrame`, so
 * no frame (and no physics step) runs until the test calls `page.clock.runFor`.
 */
export async function freezeFrames(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
}

export async function openGame(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
}

export interface ScenePixels {
  sky: number;
  grass: number;
  road: number;
  car: number;
}

/**
 * Classifies screenshot pixels by the greybox palette. The WebGL drawing buffer is not
 * preserved, so the compositor screenshot is decoded in the page instead.
 */
export async function scenePixels(page: Page): Promise<ScenePixels> {
  const png = (await page.locator("#view").screenshot()).toString("base64");

  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("2D canvas unavailable");
    }

    context.drawImage(image, 0, 0);
    const { data: rgba } = context.getImageData(0, 0, image.width, image.height);
    const counts = { sky: 0, grass: 0, road: 0, car: 0 };
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b] = [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0];
      if (r > 150 && g < 80 && b < 80) {
        counts.car += 1;
      } else if (b > 170 && b > r + 30) {
        counts.sky += 1;
      } else if (g > r + 25 && g > b + 10) {
        counts.grass += 1;
      } else if (Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && r > 50 && r < 150) {
        counts.road += 1;
      }
    }

    return counts;
  }, png);
}

/** Reads the on-screen speed readout, km/h. */
export async function readSpeed(page: Page): Promise<number> {
  return Number(await page.locator("#speed").textContent());
}
