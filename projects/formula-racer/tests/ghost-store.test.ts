import { expect, test } from "bun:test";
import { createGhostStore } from "../src/app/ghost-store.ts";
import type { StorageLike } from "../src/app/lap-store.ts";
import { createGhostRecorder } from "../src/simulation/ghost.ts";

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();

  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
};

const lap = (seconds: number) => {
  const recorder = createGhostRecorder();
  recorder.begin({ timeS: 0, x: 0, z: 0, heading: 0, progressM: 0 });

  return recorder.finish({ timeS: seconds, x: 0, z: 100, heading: 0, progressM: 100 });
};

test("a saved ghost comes back after a reload", () => {
  const storage = memory();
  createGhostStore(storage).save("harbour|p3.9", lap(81.25));
  expect(createGhostStore(storage).get("harbour|p3.9")?.lapTimeS).toBeCloseTo(81.25, 3);
  expect(createGhostStore(storage).get("other")).toBeUndefined();
});

test("keeps the twelve most recently saved ghosts", () => {
  const storage = memory();
  const store = createGhostStore(storage);
  for (let i = 0; i < 14; i += 1) {
    store.save(`key${String(i)}`, lap(60 + i));
  }

  const reloaded = createGhostStore(storage);
  expect(reloaded.get("key0")).toBeUndefined();
  expect(reloaded.get("key1")).toBeUndefined();
  expect(reloaded.get("key2")?.lapTimeS).toBeCloseTo(62, 3);
  expect(reloaded.get("key13")?.lapTimeS).toBeCloseTo(73, 3);

  // Saving an existing key again makes it the newest, not a second copy.
  reloaded.save("key2", lap(50));
  reloaded.save("new", lap(55));
  const again = createGhostStore(storage);
  expect(again.get("key2")?.lapTimeS).toBeCloseTo(50, 3);
  expect(again.get("key3")).toBeUndefined();
});

test("ignores saves from another format and anything malformed", () => {
  const storage = memory();
  storage.setItem("formula-racer:ghosts", JSON.stringify({ version: 99, order: ["a"], ghosts: { a: "x" } }));
  expect(createGhostStore(storage).get("a")).toBeUndefined();
  storage.setItem("formula-racer:ghosts", "{not json");
  expect(createGhostStore(storage).get("a")).toBeUndefined();
});

test("keeps ghosts for this visit when storage refuses to save them", () => {
  const refusing: StorageLike = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const store = createGhostStore(refusing);
  store.save("harbour", lap(70));
  expect(store.get("harbour")?.lapTimeS).toBeCloseTo(70, 3);
  expect(createGhostStore(undefined).get("harbour")).toBeUndefined();
});

test("when a newer ghost cannot be saved, the older one for its key is not left behind", () => {
  const storage = memory();
  const store = createGhostStore(storage);
  store.save("harbour", lap(100));
  store.save("riviera", lap(120));

  // Storage now refuses anything larger than it holds, as when a quota is reached.
  const full = storage.data.get("formula-racer:ghosts")?.length ?? 0;
  const tight: StorageLike = {
    getItem: (k) => storage.getItem(k),
    setItem: (k, v) => {
      if (v.length > full) {
        throw new Error("QuotaExceededError");
      }

      storage.setItem(k, v);
    },
  };
  const again = createGhostStore(tight);
  const longer = createGhostRecorder();
  longer.begin({ timeS: 0, x: 0, z: 0, heading: 0, progressM: 0 });
  for (let i = 1; i < 900; i += 1) {
    longer.sample({ timeS: i * 0.1, x: 0, z: i, heading: 0, progressM: i });
  }

  again.save("harbour", longer.finish({ timeS: 90, x: 0, z: 900, heading: 0, progressM: 900 }));
  expect(again.get("harbour")?.lapTimeS).toBeCloseTo(90, 3);

  const reloaded = createGhostStore(storage);
  expect(reloaded.get("harbour")).toBeUndefined();
  expect(reloaded.get("riviera")?.lapTimeS).toBeCloseTo(120, 3);
});
