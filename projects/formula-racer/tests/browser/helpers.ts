import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Collects page exceptions and console errors; driver performance warnings are ignored. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

export async function openGame(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#status")).toBeHidden({ timeout: 20_000 });
}

export interface ScenePixels {
  sky: number;
  ground: number;
  box: number;
  /** Mean row of box-coloured pixels, 0 at the top of the image. */
  boxRow: number;
}

/**
 * Classifies screenshot pixels by the probe scene's colours. The WebGL drawing buffer is
 * not preserved, so the compositor screenshot is decoded in the page instead.
 */
export async function scenePixels(page: Page): Promise<ScenePixels> {
  const png = (await page.locator("#view").screenshot()).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    context.drawImage(image, 0, 0);
    const { data: rgba, width } = context.getImageData(0, 0, image.width, image.height);
    const counts = { sky: 0, ground: 0, box: 0, boxRow: 0 };
    let boxRows = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const [r, g, b] = [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0];
      if (r > 120 && g < 80 && b < 80) {
        counts.box += 1;
        boxRows += Math.floor(i / 4 / width);
      } else if (b > 170 && b > r + 30) counts.sky += 1;
      else if (Math.abs(r - g) < 25 && b > r && r < 110) counts.ground += 1;
    }
    counts.boxRow = counts.box ? boxRows / counts.box : Number.NaN;
    return counts;
  }, png);
}
