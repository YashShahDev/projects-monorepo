import { describe, expect, test } from "bun:test";
import { QUALITY_PRESETS, qualitySettings } from "../src/rendering/quality.ts";
import { createPreferences } from "../src/app/preferences.ts";
import type { StorageLike } from "../src/app/lap-store.ts";
import { parseLiveries } from "../src/content/livery.ts";
import shipped from "../public/assets/cars/liveries.json";

const liveries = parseLiveries(shipped);
const memory = (): StorageLike => {
  const data = new Map<string, string>();

  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("graphics quality presets", () => {
  test("are low, medium and high, in that order", () => {
    expect(QUALITY_PRESETS).toEqual(["low", "medium", "high"]);
  });

  test("raise resolution and draw distance from low to high", () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const [low, medium, high] = QUALITY_PRESETS.map((q) => qualitySettings(q, dpr));
      expect(low?.pixelRatio).toBeLessThan(medium?.pixelRatio ?? 0);
      expect(medium?.pixelRatio).toBeLessThanOrEqual(high?.pixelRatio ?? 0);
      expect(low?.drawDistanceM).toBeLessThan(medium?.drawDistanceM ?? 0);
      expect(medium?.drawDistanceM).toBeLessThan(high?.drawDistanceM ?? 0);
    }
  });

  test("render low below native resolution and cap the others", () => {
    expect(qualitySettings("low", 1).pixelRatio).toBeCloseTo(0.6, 6);
    expect(qualitySettings("low", 2).pixelRatio).toBeCloseTo(0.6, 6);
    expect(qualitySettings("medium", 1).pixelRatio).toBe(1);
    expect(qualitySettings("medium", 3).pixelRatio).toBe(1.5);
    expect(qualitySettings("high", 3).pixelRatio).toBe(2);
  });

  test("draw the car at a coarser level of detail on lower presets", () => {
    expect(QUALITY_PRESETS.map((q) => qualitySettings(q, 1).carLod)).toEqual([2, 1, 0]);
  });

  test("keep the whole of Harbour Park in view on high", () => {
    expect(qualitySettings("high", 1).drawDistanceM).toBeGreaterThanOrEqual(4000);
  });
});

describe("quality preference", () => {
  test("defaults to medium and remembers a choice alongside the livery", () => {
    const storage = memory();
    const prefs = createPreferences(storage, liveries);
    expect(prefs.quality()).toBe("medium");
    prefs.setLivery("nightjar");
    prefs.setQuality("low");
    const reloaded = createPreferences(storage, liveries);
    expect(reloaded.quality()).toBe("low");
    expect(reloaded.livery().id).toBe("nightjar");
  });

  test("keeps a livery saved before quality existed", () => {
    const storage = memory();
    storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, livery: "tidewater" }));
    const prefs = createPreferences(storage, liveries);
    expect(prefs.livery().id).toBe("tidewater");
    expect(prefs.quality()).toBe("medium");
  });

  test("ignores an unknown preset, saved or chosen", () => {
    const storage = memory();
    storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, livery: "tidewater", quality: "ultra" }));
    const prefs = createPreferences(storage, liveries);
    expect(prefs.quality()).toBe("medium");
    prefs.setQuality("ultra");
    expect(prefs.quality()).toBe("medium");
  });
});
