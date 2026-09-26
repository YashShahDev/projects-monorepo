import { describe, expect, test } from "bun:test";
import { createLapStore, lapKey } from "../src/app/lap-store.ts";
import type { StorageLike } from "../src/app/lap-store.ts";

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const allAssists = { steering: true, abs: true, traction: true };
const key = lapKey({ trackId: "harbour", physicsVersion: "p3.1", assists: allAssists });
const lap = (timeS: number, over: Partial<{ valid: boolean; tuned: boolean }> = {}) => ({
  timeS,
  sectorsS: [timeS / 3, timeS / 3, timeS / 3],
  valid: true,
  tuned: false,
  ...over,
});

describe("lap store", () => {
  test("keeps the fastest valid lap per key", () => {
    const store = createLapStore(memoryStorage());
    expect(store.record(key, lap(100)).isBest).toBe(true);
    expect(store.record(key, lap(101)).isBest).toBe(false);
    expect(store.record(key, lap(99.5)).isBest).toBe(true);
    expect(store.best(key)?.timeS).toBe(99.5);
  });

  test("invalid and tuned laps never become bests", () => {
    const store = createLapStore(memoryStorage());
    expect(store.record(key, lap(90, { valid: false })).isBest).toBe(false);
    expect(store.record(key, lap(90, { tuned: true })).isBest).toBe(false);
    expect(store.best(key)).toBeUndefined();
  });

  test("physics versions and assist sets keep separate bests", () => {
    const store = createLapStore(memoryStorage());
    store.record(key, lap(100));
    const noTc = lapKey({
      trackId: "harbour",
      physicsVersion: "p3.1",
      assists: { ...allAssists, traction: false },
    });
    const newer = lapKey({ trackId: "harbour", physicsVersion: "p3.2", assists: allAssists });
    expect(new Set([key, noTc, newer]).size).toBe(3);
    expect(store.best(noTc)).toBeUndefined();
    expect(store.best(newer)).toBeUndefined();
  });

  test("bests survive a reload", () => {
    const storage = memoryStorage();
    createLapStore(storage).record(key, lap(98));
    const reloaded = createLapStore(storage);
    expect(reloaded.best(key)?.timeS).toBe(98);
    expect(reloaded.status).toEqual({ persistent: true, recovered: false });
  });

  test("corrupt saved data is discarded, reported, and cleanly replaced", () => {
    const storage = memoryStorage({ "formula-racer:laps": "{not json" });
    const store = createLapStore(storage);
    expect(store.status).toEqual({ persistent: true, recovered: true });
    expect(store.best(key)).toBeUndefined();
    store.record(key, lap(97));
    expect(createLapStore(storage).best(key)?.timeS).toBe(97);
  });

  test("data from another schema version or shape is not trusted", () => {
    for (const saved of [
      { version: 2, bests: {} },
      { version: 1, bests: { [key]: { timeS: "fast" } } },
      { version: 1, bests: { [key]: { timeS: -5, sectorsS: [] } } },
    ]) {
      const store = createLapStore(memoryStorage({ "formula-racer:laps": JSON.stringify(saved) }));
      expect(store.best(key)).toBeUndefined();
      expect(store.status.recovered).toBe(true);
    }
  });

  test("unavailable storage falls back to memory for the session", () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    for (const storage of [blocked, undefined]) {
      const store = createLapStore(storage);
      expect(store.status.persistent).toBe(false);
      expect(store.record(key, lap(100)).isBest).toBe(true);
      expect(store.best(key)?.timeS).toBe(100);
    }
  });

  test("a failed write (quota) keeps the best in memory and reports it", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = createLapStore(storage);
    store.record(key, lap(100));
    expect(store.best(key)?.timeS).toBe(100);
    expect(store.status.persistent).toBe(false);
  });
});
