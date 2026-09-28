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

test("the gearbox mode defaults to automatic, is remembered, and ignores unknown values", () => {
  const storage = memory();
  const prefs = createPreferences(storage, liveries);
  expect(prefs.gearboxMode()).toBe("automatic");
  prefs.setGearboxMode("manual");
  expect(createPreferences(storage, liveries).gearboxMode()).toBe("manual");
  storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, gearboxMode: "sequential" }));
  expect(createPreferences(storage, liveries).gearboxMode()).toBe("automatic");
});

test("the racing line defaults to off, is remembered, and ignores unknown values", () => {
  const storage = memory();
  const prefs = createPreferences(storage, liveries);
  expect(prefs.racingLine()).toBe("off");
  prefs.setRacingLine("braking");
  prefs.setRacingLine("rainbow");
  expect(createPreferences(storage, liveries).racingLine()).toBe("braking");
});

test("the ghost races the best lap by default, and the choice is remembered", () => {
  const storage = memory();
  const prefs = createPreferences(storage, liveries);
  expect(prefs.ghost()).toBe("best");
  prefs.setGhost("last");
  prefs.setGhost("everyone");
  expect(createPreferences(storage, liveries).ghost()).toBe("last");
});

test("the energy mode defaults to balanced, is remembered, and ignores unknown values", () => {
  const storage = memory();
  const prefs = createPreferences(storage, liveries);
  expect(prefs.energyMode()).toBe("balanced");
  prefs.setEnergyMode("attack");
  prefs.setEnergyMode("turbo");
  expect(createPreferences(storage, liveries).energyMode()).toBe("attack");
});

test("opponents default to none at Club level; the count stays 0 to 3 and the level a real one", () => {
  const storage = memory();
  const prefs = createPreferences(storage, liveries);
  expect(prefs.opponents()).toEqual({ count: 0, level: "club" });
  prefs.setOpponents("3", "ace");
  prefs.setOpponents("4", "pro");
  prefs.setOpponents("2", "legend");
  prefs.setOpponents("1.5", "pro");
  expect(createPreferences(storage, liveries).opponents()).toEqual({ count: 3, level: "ace" });
  storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, opponents: -1, opponentLevel: "god" }));
  expect(createPreferences(storage, liveries).opponents()).toEqual({ count: 0, level: "club" });
});

test("the volume defaults to 25%, is remembered, and ignores values outside 0 to 100", () => {
  const storage = memory();
  const prefs = createPreferences(storage, liveries);
  expect(prefs.volume()).toBe(25);
  prefs.setVolume("60");
  prefs.setVolume("101");
  prefs.setVolume("-5");
  prefs.setVolume("");
  prefs.setVolume("loud");
  expect(createPreferences(storage, liveries).volume()).toBe(60);
  prefs.setVolume("0");
  expect(createPreferences(storage, liveries).volume()).toBe(0);
  storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, volume: 250 }));
  expect(createPreferences(storage, liveries).volume()).toBe(25);
});
