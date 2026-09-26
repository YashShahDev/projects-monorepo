import type { DriverAssists } from "../simulation/vehicle.ts";

/** The part of `Storage` used here, so tests can pass a fake or a throwing one. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredLap {
  timeS: number;
  sectorsS: number[];
}

export interface LapStoreStatus {
  /** Bests are being written to storage; false means this session only. */
  persistent: boolean;

  /** Saved data was unreadable or from another schema and was discarded. */
  recovered: boolean;
}

export interface LapStore {
  readonly status: LapStoreStatus;
  best(key: string): StoredLap | undefined;
  record(key: string, lap: StoredLap & { valid: boolean; tuned: boolean }): { isBest: boolean };
}

/** What to tell the player about saving; empty when bests are being saved normally. */
export function storageNotice(status: LapStoreStatus): string {
  if (!status.persistent) {
    return "Best laps are not saved in this browser.";
  }

  if (status.recovered) {
    return "Saved lap times were unreadable and have been reset.";
  }

  return "";
}

const STORAGE_KEY = "formula-racer:laps";
const SCHEMA = 1;

/**
 * Bests are only comparable under the same track, physics model and assists, so each
 * combination keeps its own.
 */
export function lapKey(parts: { trackId: string; physicsVersion: string; assists: DriverAssists }): string {
  const a = parts.assists;
  const flags = `${a.steering ? "S" : "-"}${a.abs ? "A" : "-"}${a.traction ? "T" : "-"}`;

  return `${parts.trackId}|${parts.physicsVersion}|${flags}`;
}

const isLap = (value: unknown): value is StoredLap => {
  const lap = value as Partial<StoredLap> | null;

  return (
    typeof lap === "object" &&
    lap !== null &&
    typeof lap.timeS === "number" &&
    Number.isFinite(lap.timeS) &&
    lap.timeS > 0 &&
    Array.isArray(lap.sectorsS) &&
    lap.sectorsS.every((s) => typeof s === "number" && Number.isFinite(s))
  );
};

/** Reads saved bests; anything malformed is discarded whole rather than half-trusted. */
function load(raw: string | null): { bests: Map<string, StoredLap>; recovered: boolean } {
  if (raw === null) {
    return { bests: new Map(), recovered: false };
  }

  try {
    const data = JSON.parse(raw) as { version?: unknown; bests?: unknown };
    if (data.version !== SCHEMA || typeof data.bests !== "object" || data.bests === null) {
      return { bests: new Map(), recovered: true };
    }

    const entries = Object.entries(data.bests as Record<string, unknown>);
    if (!entries.every(([, lap]) => isLap(lap))) {
      return { bests: new Map(), recovered: true };
    }

    return { bests: new Map(entries as [string, StoredLap][]), recovered: false };
  } catch {
    return { bests: new Map(), recovered: true };
  }
}

export function createLapStore(storage: StorageLike | undefined): LapStore {
  let persistent = storage !== undefined;
  let loaded: ReturnType<typeof load> = { bests: new Map(), recovered: false };
  try {
    if (storage) {
      loaded = load(storage.getItem(STORAGE_KEY));
    }
  } catch {
    // Storage exists but refuses access (privacy mode, blocked site data): keep bests
    // for this session only.
    persistent = false;
  }

  const { bests } = loaded;
  const status: LapStoreStatus = { persistent, recovered: loaded.recovered };

  const save = () => {
    if (!storage || !status.persistent) {
      return;
    }

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA, bests: Object.fromEntries(bests) }));
    } catch {
      // Quota or a revoked permission: the best still counts for this session.
      status.persistent = false;
    }
  };

  return {
    status,
    best: (key) => bests.get(key),
    record(key, lap) {
      if (!lap.valid || lap.tuned) {
        return { isBest: false };
      }

      const current = bests.get(key);
      if (current && current.timeS <= lap.timeS) {
        return { isBest: false };
      }

      bests.set(key, { timeS: lap.timeS, sectorsS: [...lap.sectorsS] });
      save();

      return { isBest: true };
    },
  };
}
