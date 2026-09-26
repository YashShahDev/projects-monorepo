import type { Livery } from "../content/livery.ts";
import type { StorageLike } from "./lap-store.ts";

export interface Preferences {
  livery(): Livery;

  /** Ignores ids that are not in the livery list. */
  setLivery(id: string): void;
}

const STORAGE_KEY = "formula-racer:prefs";
const SCHEMA = 1;

/**
 * Player choices that do not affect timing. Storage problems only lose the choice
 * between visits, so they are not reported the way lost lap times are.
 */
export function createPreferences(
  storage: StorageLike | undefined,
  liveries: readonly Livery[],
): Preferences {
  const fallback = liveries[0];
  if (!fallback) {
    throw new Error("createPreferences needs at least one livery");
  }

  const byId = (id: unknown) => liveries.find((l) => l.id === id);
  let current = fallback;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as { version?: unknown; livery?: unknown }) : undefined;
    if (saved?.version === SCHEMA) {
      current = byId(saved.livery) ?? fallback;
    }
  } catch {
    // Unreadable or blocked: start from the defaults.
  }

  return {
    livery: () => current,
    setLivery(id) {
      const livery = byId(id);
      if (!livery) {
        return;
      }

      current = livery;
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA, livery: id }));
      } catch {
        // Quota or revoked permission: the choice still holds for this visit.
      }
    },
  };
}
