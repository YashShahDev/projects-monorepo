import * as THREE from "three";
import { MAX_LAP_MARKS, MAX_MARKS } from "../simulation/tyre-marks.ts";
import type { TyreMark } from "../simulation/tyre-marks.ts";

export interface TyreMarksState {
  /** Live marks still visible. */
  live: number;

  /** The ghost's marks laid so far this lap. */
  ghost: number;
}

export interface TyreMarksView {
  readonly object: THREE.Object3D;

  /** New live marks, timed by session seconds; the oldest slots are reused. */
  add(marks: readonly TyreMark[]): void;
  update(nowS: number, ghost: { marks: readonly TyreMark[]; lapTimeS: number } | undefined): TyreMarksState;
  dispose(): void;
}

/** Seconds a live mark takes to fade away: about a lap. */
export const MARK_FADE_S = 90;

const WIDTH_M = 0.32;
const HEIGHT_M = 0.012;
const LIVE_ALPHA = 0.6;
const GHOST_ALPHA = 0.35;
const COLOUR = new THREE.Color(0x141414);

// Alphas are rewritten a few times a second, not every frame: a fade over 90 s shows
// no steps at that rate, and it keeps the upload small.
const REFADE_S = 0.25;

/**
 * Tyre marks as one batched mesh of dark strips: a region for the ghost's lap, whose
 * marks appear as the ghost reaches them, then the live ring.
 */
export function createTyreMarksView(): TyreMarksView {
  const slots = MAX_MARKS + MAX_LAP_MARKS;
  const positions = new Float32Array(slots * 4 * 3);
  const colours = new Float32Array(slots * 4 * 4);
  const born = new Float64Array(MAX_MARKS).fill(Number.NEGATIVE_INFINITY);
  const index = new Uint32Array(slots * 6);
  for (let k = 0; k < slots; k += 1) {
    const v = k * 4;

    // Vertices 0, 1 are one end (right, left), 2, 3 the other; this winding faces up.
    index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], k * 6);
  }

  for (let v = 0; v < slots * 4; v += 1) {
    colours.set([COLOUR.r, COLOUR.g, COLOUR.b, 0], v * 4);
  }

  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  const colour = new THREE.BufferAttribute(colours, 4);
  position.setUsage(THREE.DynamicDrawUsage);
  colour.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", colour);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -5;
  material.polygonOffsetUnits = -5;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "tyre-marks";
  mesh.frustumCulled = false;

  const place = (slot: number, m: TyreMark) => {
    const length = Math.hypot(m.bx - m.ax, m.bz - m.az) || 1;

    // Left of travel along (dx, dz) is (dz, −dx).
    const lx = (((m.bz - m.az) / length) * WIDTH_M) / 2;
    const lz = ((-(m.bx - m.ax) / length) * WIDTH_M) / 2;
    const [ay, by] = [HEIGHT_M, HEIGHT_M];
    positions.set(
      [m.ax - lx, ay, m.az - lz, m.ax + lx, ay, m.az + lz, m.bx - lx, by, m.bz - lz, m.bx + lx, by, m.bz + lz],
      slot * 12,
    );
  };

  const setAlpha = (slot: number, alpha: number) => {
    for (let v = 0; v < 4; v += 1) {
      colours[(slot * 4 + v) * 4 + 3] = alpha;
    }
  };

  let next = 0;
  let fadedAtS = Number.NEGATIVE_INFINITY;
  let live = 0;
  let ghostMarks: readonly TyreMark[] | undefined;
  let ghostShown = 0;

  return {
    object: mesh,
    add(marks) {
      for (const m of marks) {
        const slot = next % MAX_MARKS;
        place(MAX_LAP_MARKS + slot, m);
        born[slot] = m.timeS;
        next += 1;
      }

      if (marks.length > 0) {
        position.needsUpdate = true;
        fadedAtS = Number.NEGATIVE_INFINITY;
      }
    },
    update(nowS, ghost) {
      if (nowS - fadedAtS >= REFADE_S || nowS < fadedAtS) {
        fadedAtS = nowS;
        live = 0;
        for (let slot = 0; slot < Math.min(next, MAX_MARKS); slot += 1) {
          const alpha = LIVE_ALPHA * Math.max(0, 1 - (nowS - (born[slot] ?? 0)) / MARK_FADE_S);
          setAlpha(MAX_LAP_MARKS + slot, alpha);
          live += alpha > 0 ? 1 : 0;
        }

        colour.needsUpdate = true;
      }

      const marks = ghost?.marks.slice(0, MAX_LAP_MARKS);
      if (ghost?.marks !== ghostMarks) {
        ghostMarks = ghost?.marks;
        ghostShown = 0;
        (marks ?? []).forEach((m, k) => {
          place(k, m);
        });
        for (let k = 0; k < MAX_LAP_MARKS; k += 1) {
          setAlpha(k, 0);
        }

        position.needsUpdate = true;
        colour.needsUpdate = true;
      }

      // A lap's marks are in the order they were laid, so the shown ones are a prefix.
      const lapTimeS = ghost?.lapTimeS ?? Number.NEGATIVE_INFINITY;
      const firstUnlaid = (marks ?? []).findIndex((m) => m.timeS > lapTimeS);
      const shown = firstUnlaid < 0 ? (marks?.length ?? 0) : firstUnlaid;

      if (shown !== ghostShown) {
        for (let k = 0; k < MAX_LAP_MARKS; k += 1) {
          setAlpha(k, k < shown ? GHOST_ALPHA : 0);
        }

        ghostShown = shown;
        colour.needsUpdate = true;
      }

      // Only slots in use are drawn: the ghost's shown marks, then the live ring so far.
      const from = ghostShown > 0 ? 0 : MAX_LAP_MARKS;
      geometry.setDrawRange(from * 6, (MAX_LAP_MARKS + Math.min(next, MAX_MARKS) - from) * 6);
      mesh.visible = live > 0 || ghostShown > 0;

      return { live, ghost: ghostShown };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
