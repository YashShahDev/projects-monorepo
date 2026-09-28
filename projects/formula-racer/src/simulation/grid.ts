import type { TrackGeometry } from "./track-geometry.ts";

/** Distance between grid slots along the track; slots ahead of the line alternate sides. */
export const GRID_GAP_M = 8;

/** Slots on a race grid: the player's and up to three opponents'. */
export const GRID_SLOTS = 4;

export interface GridSlot {
  x: number;
  z: number;
  headingRad: number;

  /** How far past the line the slot stands. */
  aheadM: number;
}

/**
 * Where a car on a grid slot stands, counted from the back: 0 is the time-trial start
 * on the line and the centreline, and each later slot stands one gap further ahead, on
 * alternating sides.
 */
export function gridSlot(track: TrackGeometry, startDistanceM: number, slot: number): GridSlot {
  const aheadM = slot * GRID_GAP_M;
  const p = track.pointAt(startDistanceM + aheadM);
  const sideM = slot === 0 ? 0 : (slot % 2 === 1 ? -1 : 1) * (track.halfWidthM / 2);

  // Left of travel is (tz, −tx).
  return { x: p.x + sideM * p.tz, z: p.z - sideM * p.tx, headingRad: Math.atan2(p.tx, p.tz), aheadM };
}
