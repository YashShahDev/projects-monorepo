import type { Livery } from "../content/livery.ts";
import { isRecord } from "../content/validate.ts";
import { isGhostMode } from "../rendering/ghost-view.ts";
import type { GhostMode } from "../rendering/ghost-view.ts";
import { isGuideMode } from "../rendering/guide-view.ts";
import type { GuideMode } from "../rendering/guide-view.ts";
import { isQualityPreset } from "../rendering/quality.ts";
import type { QualityPreset } from "../rendering/quality.ts";
import { isGearboxMode } from "../simulation/gearbox.ts";
import type { GearboxMode } from "../simulation/gearbox.ts";
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
  gearboxMode(): GearboxMode;

  /** Ignores values that are not a gearbox mode. */
  setGearboxMode(mode: string): void;
  racingLine(): GuideMode;

  /** Ignores values that are not a racing-line mode. */
  setRacingLine(mode: string): void;
  ghost(): GhostMode;

  /** Ignores values that are not a ghost mode. */
  setGhost(mode: string): void;
}

const STORAGE_KEY = "formula-racer:prefs";
const SCHEMA = 1;

/**
 * Player choices. The gearbox mode affects lap times, but best laps are kept per mode,
 * so it is safe to keep here. Storage problems only lose the choice
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
  let gearboxMode: GearboxMode = "automatic";
  let racingLine: GuideMode = "off";
  let ghost: GhostMode = "best";
  let newerSave = false;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
    const saved = isRecord(parsed) ? parsed : undefined;
    if (saved?.version === SCHEMA) {
      current = byId(saved.livery) ?? fallback;

      // Everything but the livery was added within schema 1, so older saves may lack it.
      quality = isQualityPreset(saved.quality) ? saved.quality : quality;
      sound = typeof saved.sound === "boolean" ? saved.sound : sound;
      gearboxMode = isGearboxMode(saved.gearboxMode) ? saved.gearboxMode : gearboxMode;
      racingLine = isGuideMode(saved.racingLine) ? saved.racingLine : racingLine;
      ghost = isGhostMode(saved.ghost) ? saved.ghost : ghost;
    }

    // A newer game version wrote this; keep it for that version rather than downgrade it.
    newerSave = typeof saved?.version === "number" && saved.version > SCHEMA;
  } catch {
    // Unreadable or blocked: start from the defaults.
  }

  const save = () => {
    if (newerSave) {
      return;
    }

    try {
      storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: SCHEMA, livery: current.id, quality, sound, gearboxMode, racingLine, ghost }),
      );
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
    gearboxMode: () => gearboxMode,
    setGearboxMode(mode) {
      if (!isGearboxMode(mode)) {
        return;
      }

      gearboxMode = mode;
      save();
    },
    racingLine: () => racingLine,
    setRacingLine(mode) {
      if (!isGuideMode(mode)) {
        return;
      }

      racingLine = mode;
      save();
    },
    ghost: () => ghost,
    setGhost(mode) {
      if (!isGhostMode(mode)) {
        return;
      }

      ghost = mode;
      save();
    },
  };
}
