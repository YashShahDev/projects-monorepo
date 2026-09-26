import { describe, expect, test } from "bun:test";
import { parseLiveries } from "../src/content/livery.ts";
import shipped from "../public/assets/cars/liveries.json";
import { createPreferences } from "../src/app/preferences.ts";
import type { StorageLike } from "../src/app/lap-store.ts";

const liveries = parseLiveries(shipped);
const clone = () => structuredClone(shipped) as { version: number; liveries: Record<string, unknown>[] };

describe("liveries", () => {
  test("ships three fictional liveries, the first matching the greybox red", () => {
    expect(liveries.map((l) => l.id)).toEqual(["vermilion", "tidewater", "nightjar"]);
    expect(liveries[0]?.paint).toBe("#d9352b");
  });
  test("are purely visual, so every livery performs the same", () => {
    const bad = clone();
    bad.liveries[1] = { ...bad.liveries[1], massKg: 790 };
    expect(() => parseLiveries(bad)).toThrow(
      "liveries.liveries[1].massKg is not a livery property (liveries are visual only)",
    );
  });
  test("rejects malformed colours and duplicate ids", () => {
    const colour = clone();
    colour.liveries[0] = { ...colour.liveries[0], paint: "red" };
    expect(() => parseLiveries(colour)).toThrow("liveries.liveries[0].paint must be a #rrggbb colour");
    const dup = clone();
    dup.liveries[2] = { ...dup.liveries[2], id: "vermilion" };
    expect(() => parseLiveries(dup)).toThrow("liveries.liveries[2].id vermilion is used twice");
  });
  test("needs at least one livery", () => {
    expect(() => parseLiveries({ version: 1, liveries: [] })).toThrow("liveries.liveries");
  });
});

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();

  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("preferences", () => {
  test("default to the first livery and remember a choice", () => {
    const storage = memory();
    const prefs = createPreferences(storage, liveries);
    expect(prefs.livery().id).toBe("vermilion");
    prefs.setLivery("nightjar");
    expect(createPreferences(storage, liveries).livery().id).toBe("nightjar");
  });
  test("fall back to the default for an unknown or corrupt saved livery", () => {
    const storage = memory();
    storage.setItem("formula-racer:prefs", JSON.stringify({ version: 1, livery: "retired" }));
    expect(createPreferences(storage, liveries).livery().id).toBe("vermilion");
    storage.setItem("formula-racer:prefs", "{broken");
    expect(createPreferences(storage, liveries).livery().id).toBe("vermilion");
  });
  test("keep working when storage is missing or refuses writes", () => {
    const prefs = createPreferences(undefined, liveries);
    prefs.setLivery("tidewater");
    expect(prefs.livery().id).toBe("tidewater");
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const quota = createPreferences(full, liveries);
    quota.setLivery("tidewater");
    expect(quota.livery().id).toBe("tidewater");
  });
  test("ignores an id that is not a livery", () => {
    const prefs = createPreferences(memory(), liveries);
    prefs.setLivery("missing");
    expect(prefs.livery().id).toBe("vermilion");
  });
});
