export const QUALITY_PRESETS = ["low", "medium", "high"] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

export interface QualitySettings {
  /** Drawing-buffer pixels per CSS pixel. */
  pixelRatio: number;

  /** Camera far plane, metres. */
  drawDistanceM: number;

  /** Car model level of detail; 0 is the finest. */
  carLod: number;

  /** Trackside trees, most of the scenery's vertices. */
  trees: boolean;
}

export const isQualityPreset = (value: unknown): value is QualityPreset =>
  QUALITY_PRESETS.includes(value as QualityPreset);

// Hypothesis, not yet measured: fill rate limits integrated GPUs, so presets mostly
// trade resolution; Low renders below native even on a 1× display. P5-C1's `make bench`
// runs on the reference laptop decide whether that holds.
export function qualitySettings(preset: QualityPreset, devicePixelRatio: number): QualitySettings {
  switch (preset) {
    case "low":
      return { pixelRatio: 0.6, drawDistanceM: 1500, carLod: 2, trees: false };
    case "medium":
      return { pixelRatio: Math.min(devicePixelRatio, 1.5), drawDistanceM: 3000, carLod: 1, trees: true };
    case "high":
      return { pixelRatio: Math.min(devicePixelRatio, 2), drawDistanceM: 4000, carLod: 0, trees: true };
  }
}
