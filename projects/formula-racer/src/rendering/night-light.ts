import type { Floodlight } from "./scenery-layout.ts";

/** How lit the ground is at night far from any tower, as a share of full brightness. */
export const NIGHT_AMBIENT = 0.22;

// Lamps hang this far out from their tower towards the road.
const LAMP_REACH_M = 6;
const GAIN = 1.1;

// Past this, a tower adds under 1% and is skipped.
const CUTOFF_M = 90;

/**
 * Light on the ground at (x, z), from 0 to 1. Each tower's lamps light the ground below
 * like a point source: inverse square with distance and the cosine of the angle of
 * incidence, which together fall as (height / distance)³.
 */
export function floodlitLevel(x: number, z: number, floodlights: readonly Floodlight[]): number {
  let level = NIGHT_AMBIENT;
  for (const tower of floodlights) {
    const toAim = Math.hypot(tower.aim.x - tower.x, tower.aim.z - tower.z);
    const reach = toAim > 0 ? Math.min(LAMP_REACH_M, toAim) / toAim : 0;
    const lx = tower.x + (tower.aim.x - tower.x) * reach;
    const lz = tower.z + (tower.aim.z - tower.z) * reach;
    const across = Math.hypot(x - lx, z - lz);
    if (across < CUTOFF_M) {
      level += GAIN * (tower.heightM / Math.hypot(across, tower.heightM)) ** 3;
    }
  }

  return Math.min(1, level);
}
