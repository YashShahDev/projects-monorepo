import type { Livery } from "../content/livery.ts";
import { isQualityPreset } from "../rendering/quality.ts";
import type { QualityPreset } from "../rendering/quality.ts";
import type { StorageLike } from "./lap-store.ts";

export interface Preferences {
  livery(): Livery;

  /** Ignores ids that are not in the livery list. */
  setLivery(id: string): void;
  quality(): QualityPreset;

  /** Ignores values that are not a preset. */
  setQuality(preset: string): void;
  sound(): boolean;
  setSound(on: boolean): void;
}

const STORAGE_KEY = "formula-racer:prefs";
const SCHEMA = 1;

/**
 * Player choices that do not affect timing. Storage problems only lose the choice
 * between visits, so they are not reported the way lost lap times are.
 */
export function createPreferences(storage: StorageLike | undefined, liveries: readonly Livery[]): Preferences {
  const fallback = liveries[0];
  if (!fallback) {
    throw new Error("createPreferences needs at least one livery");
  }

  const byId = (id: unknown) => liveries.find((l) => l.id === id);
  let current = fallback;
  let quality: QualityPreset = "medium";
  let sound = true;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const saved = raw
      ? (JSON.parse(raw) as { version?: unknown; livery?: unknown; quality?: unknown; sound?: unknown })
      : undefined;
    if (saved?.version === SCHEMA) {
      current = byId(saved.livery) ?? fallback;

      // Quality and sound were added within schema 1, so older saves simply lack them.
      quality = isQualityPreset(saved.quality) ? saved.quality : quality;
      sound = typeof saved.sound === "boolean" ? saved.sound : sound;
    }
  } catch {
    // Unreadable or blocked: start from the defaults.
  }

  const save = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA, livery: current.id, quality, sound }));
    } catch {
      // Quota or revoked permission: the choice still holds for this visit.
    }
  };

  return {
    livery: () => current,
    setLivery(id) {
      const livery = byId(id);
      if (!livery) {
        return;
      }

      current = livery;
      save();
    },
    quality: () => quality,
    setQuality(preset) {
      if (!isQualityPreset(preset)) {
        return;
      }

      quality = preset;
      save();
    },
    sound: () => sound,
    setSound(on) {
      sound = on;
      save();
    },
  };
}
