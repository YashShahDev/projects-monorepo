import { expect, test } from "bun:test";
import { createPreferences } from "../src/app/preferences.ts";
import type { StorageLike } from "../src/app/lap-store.ts";
import { parseLiveries } from "../src/content/livery.ts";
import shipped from "../public/assets/cars/liveries.json";

const liveries = parseLiveries(shipped);
const memory = (): StorageLike => {
  const data = new Map<string, string>();

  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
};

test("sound defaults to on and a muted choice is remembered with the others", () => {
  const storage = memory();
  const prefs = createPreferences(storage, liveries);
  expect(prefs.sound()).toBe(true);
  prefs.setQuality("high");
  prefs.setSound(false);
  const reloaded = createPreferences(storage, liveries);
  expect(reloaded.sound()).toBe(false);
  expect(reloaded.quality()).toBe("high");
});

test("sound stays on for saves without it or with a non-boolean value", () => {
  const storage = memory();
  storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, livery: "tidewater" }));
  expect(createPreferences(storage, liveries).sound()).toBe(true);
  storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, sound: "off" }));
  expect(createPreferences(storage, liveries).sound()).toBe(true);
});
