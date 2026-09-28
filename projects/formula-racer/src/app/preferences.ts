import { AI_LEVELS } from "../ai/driver.ts";
import type { AiLevelName } from "../ai/driver.ts";
import { isEnergyMode } from "../content/energy-rules.ts";
import type { EnergyMode } from "../content/energy-rules.ts";
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

  /** Percent of full output, 0 to 100. */
  volume(): number;

  /** Ignores values that are not a whole number from 0 to 100. */
  setVolume(percent: string): void;
  gearboxMode(): GearboxMode;

  /** Ignores values that are not a gearbox mode. */
  setGearboxMode(mode: string): void;
  energyMode(): EnergyMode;

  /** Ignores values that are not an energy mode. */
  setEnergyMode(mode: string): void;
  racingLine(): GuideMode;

  /** Ignores values that are not a racing-line mode. */
  setRacingLine(mode: string): void;
  ghost(): GhostMode;

  /** Ignores values that are not a ghost mode. */
  setGhost(mode: string): void;
  opponents(): { count: number; level: AiLevelName };

  /** Ignores a count that is not 0 to 3, or a level that is not an AI level. */
  setOpponents(count: string, level: string): void;
}

const STORAGE_KEY = "formula-racer:prefs";

/** The frame budget is measured with this many opponents. */
export const MAX_OPPONENTS = 3;

const isOpponentCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_OPPONENTS;
const isVolume = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
const isAiLevel = (value: unknown): value is AiLevelName => AI_LEVELS.some((level) => level === value);
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
  let volume = 25;
  let gearboxMode: GearboxMode = "automatic";
  let energyMode: EnergyMode = "balanced";
  let racingLine: GuideMode = "off";
  let ghost: GhostMode = "best";
  let opponents = 0;
  let opponentLevel: AiLevelName = "club";
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
      volume = isVolume(saved.volume) ? saved.volume : volume;
      gearboxMode = isGearboxMode(saved.gearboxMode) ? saved.gearboxMode : gearboxMode;
      energyMode = isEnergyMode(saved.energyMode) ? saved.energyMode : energyMode;
      racingLine = isGuideMode(saved.racingLine) ? saved.racingLine : racingLine;
      ghost = isGhostMode(saved.ghost) ? saved.ghost : ghost;
      opponents = isOpponentCount(saved.opponents) ? saved.opponents : opponents;
      opponentLevel = isAiLevel(saved.opponentLevel) ? saved.opponentLevel : opponentLevel;
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
        JSON.stringify({
          version: SCHEMA,
          livery: current.id,
          quality,
          sound,
          volume,
          gearboxMode,
          energyMode,
          racingLine,
          ghost,
          opponents,
          opponentLevel,
        }),
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
    volume: () => volume,
    setVolume(percent) {
      const n = Number(percent);
      if (percent.trim() === "" || !isVolume(n)) {
        return;
      }

      volume = n;
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
    energyMode: () => energyMode,
    setEnergyMode(mode) {
      if (!isEnergyMode(mode) || mode === energyMode) {
        return;
      }

      energyMode = mode;
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
    opponents: () => ({ count: opponents, level: opponentLevel }),
    setOpponents(count, level) {
      const n = Number(count);
      if (count.trim() === "" || !isOpponentCount(n) || !isAiLevel(level)) {
        return;
      }

      opponents = n;
      opponentLevel = level;
      save();
    },
  };
}
