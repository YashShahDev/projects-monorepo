import * as THREE from "three";
import { GUIDE_AHEAD_M, guidance, guideTint } from "../simulation/guidance.ts";
import type { LineLimits, RacingLine } from "../simulation/racing-line.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";

export const GUIDE_MODES = ["off", "braking", "full"] as const;
export type GuideMode = (typeof GUIDE_MODES)[number];

export const isGuideMode = (value: unknown): value is GuideMode => GUIDE_MODES.some((mode) => mode === value);

export interface GuideState {
  mode: GuideMode;

  /** Points of the line drawn on the last update. */
  shownPoints: number;

  /** Chevrons drawn on the last update. */
  chevrons: number;

  /** Height of the ribbon's top above the road, metres. */
  heightM: number;
}

export interface GuideCar {
  position: { x: number; z: number };
  speedMps: number;
  gripShare: number;
}

export interface GuideView {
  readonly object: THREE.Object3D;
  update(car: GuideCar, mode: GuideMode): GuideState;
  dispose(): void;
}

const WIDTH_M = 0.9;
const HEIGHT_M = 0.12;
const ALPHA = 0.85;

// The ribbon's sides are shaded darker than its top, so it reads as a raised strip.
const SIDE_SHADE = 0.55;

const CHEVRON_EVERY_M = 8;
const CHEVRON_LENGTH_M = 0.7;
const CHEVRON_THICKNESS_M = 0.22;
const CHEVRON_LIFT_M = 0.01;

// Fade in over the first metres so the ribbon does not start under the car.
const FADE_IN_M = 8;

// Vertices per ribbon point: left foot, left top, right top, right foot.
const RIBBON_VERTICES = 4;
const CHEVRON_VERTICES = 6;

function dynamicMesh(name: string, vertices: number, indices: number) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
  const colour = new THREE.BufferAttribute(new Float32Array(vertices * 4), 4);
  const index = new THREE.BufferAttribute(new Uint32Array(indices), 1);
  for (const attribute of [position, colour, index]) {
    attribute.setUsage(THREE.DynamicDrawUsage);
  }

  geometry.setAttribute("position", position);
  geometry.setAttribute("color", colour);
  geometry.setIndex(index);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;

  return { mesh, geometry, material, position, colour, index };
}

/**
 * The racing line ahead of the car as a raised ribbon with chevrons pointing the way.
 * Each point is placed and coloured by `guidance` from the car's state this frame: it
 * bends back to the line from wherever the car is, and shows the pedal the car needs.
 */
export function createGuideView(track: TrackGeometry, line: RacingLine, limits: LineLimits): GuideView {
  let shortest = Infinity;
  for (const step of line.stepM) {
    shortest = Math.min(shortest, Math.max(step, 0.1));
  }

  const capacity = Math.ceil(GUIDE_AHEAD_M / shortest) + 2;
  const chevronCapacity = Math.ceil(GUIDE_AHEAD_M / CHEVRON_EVERY_M) + 2;
  const ribbon = dynamicMesh("racing-line", capacity * RIBBON_VERTICES, capacity * 18);
  const arrows = dynamicMesh("racing-line-chevrons", chevronCapacity * CHEVRON_VERTICES, chevronCapacity * 12);
  const group = new THREE.Group();
  group.name = "racing-guide";
  group.add(ribbon.mesh, arrows.mesh);

  let hint: number | undefined;

  const hide = (mode: GuideMode): GuideState => {
    group.visible = false;

    return { mode, shownPoints: 0, chevrons: 0, heightM: HEIGHT_M };
  };

  return {
    object: group,
    update(car, mode) {
      if (mode === "off") {
        return hide(mode);
      }

      group.visible = true;
      hint = track.locate(car.position.x, car.position.z, hint).index;
      const guide = guidance(
        { x: car.position.x, z: car.position.z, index: hint, speedMps: car.speedMps, gripShare: car.gripShare },
        line,
        limits,
      );
      const count = guide.index.length;
      const shown = (k: number) => mode === "full" || guide.phase[k] !== "go";
      const positions = ribbon.position.array;
      const colours = ribbon.colour.array;
      const indices = ribbon.index.array;
      let shownPoints = 0;
      let triangles = 0;
      for (let k = 0; k < count; k += 1) {
        const [a, b] = [Math.max(0, k - 1), Math.min(count - 1, k + 1)];
        const dx = (guide.x[b] ?? 0) - (guide.x[a] ?? 0);
        const dz = (guide.z[b] ?? 0) - (guide.z[a] ?? 0);
        const length = Math.hypot(dx, dz) || 1;

        // Left of travel along (dx, dz) is (dz, −dx).
        const [lx, lz] = [((dz / length) * WIDTH_M) / 2, ((-dx / length) * WIDTH_M) / 2];
        const [x, z] = [guide.x[k] ?? 0, guide.z[k] ?? 0];
        positions.set(
          [x + lx, 0, z + lz, x + lx, HEIGHT_M, z + lz, x - lx, HEIGHT_M, z - lz, x - lx, 0, z - lz],
          k * 12,
        );

        const [r, g, bl] = guideTint(guide.pedal[k] ?? 0, guide.phase[k] ?? "go");
        const alpha = shown(k) ? ALPHA * Math.min(1, (guide.aheadM[k] ?? 0) / FADE_IN_M) : 0;
        const side = [r * SIDE_SHADE, g * SIDE_SHADE, bl * SIDE_SHADE, alpha] as const;
        colours.set([...side, r, g, bl, alpha, r, g, bl, alpha, ...side], k * 16);
        shownPoints += shown(k) ? 1 : 0;

        if (k + 1 < count && shown(k) && shown(k + 1)) {
          const [p, q] = [k * RIBBON_VERTICES, (k + 1) * RIBBON_VERTICES];

          // Left side, top, right side: each a quad between this point and the next.
          for (const [u, v] of [
            [0, 1],
            [1, 2],
            [2, 3],
          ] as const) {
            indices.set([p + u, q + u, p + v, p + v, q + u, q + v], triangles * 3);
            triangles += 2;
          }
        }
      }

      ribbon.geometry.setDrawRange(0, triangles * 3);
      ribbon.position.needsUpdate = true;
      ribbon.colour.needsUpdate = true;
      ribbon.index.needsUpdate = true;

      const chevrons = placeChevrons(arrows, guide, shown);

      return { mode, shownPoints, chevrons, heightM: HEIGHT_M };
    },
    dispose() {
      for (const part of [ribbon, arrows]) {
        part.geometry.dispose();
        part.material.dispose();
      }
    },
  };
}

/** Lays a chevron every `CHEVRON_EVERY_M` along the shown ribbon, tip forward, a shade lighter. */
function placeChevrons(
  arrows: ReturnType<typeof dynamicMesh>,
  guide: ReturnType<typeof guidance>,
  shown: (k: number) => boolean,
): number {
  const positions = arrows.position.array;
  const colours = arrows.colour.array;
  const indices = arrows.index.array;
  const count = guide.index.length;
  const y = HEIGHT_M + CHEVRON_LIFT_M;
  let placed = 0;
  let nextM = FADE_IN_M;
  for (let k = 0; k + 1 < count && placed * CHEVRON_VERTICES < arrows.position.count; k += 1) {
    const ahead = guide.aheadM[k] ?? 0;
    if (ahead < nextM || !shown(k)) {
      continue;
    }

    nextM = ahead + CHEVRON_EVERY_M;
    const dx = (guide.x[k + 1] ?? 0) - (guide.x[k] ?? 0);
    const dz = (guide.z[k + 1] ?? 0) - (guide.z[k] ?? 0);
    const length = Math.hypot(dx, dz) || 1;
    const [fx, fz] = [dx / length, dz / length];
    const [lx, lz] = [(fz * WIDTH_M) / 2, (-fx * WIDTH_M) / 2];
    const [tx, tz] = [guide.x[k] ?? 0, guide.z[k] ?? 0];
    const back = CHEVRON_LENGTH_M;
    const thick = CHEVRON_THICKNESS_M;

    // Tip outer and inner, left arm outer and inner, right arm outer and inner.
    positions.set(
      [
        tx,
        y,
        tz,
        tx - fx * thick,
        y,
        tz - fz * thick,
        tx - fx * back + lx,
        y,
        tz - fz * back + lz,
        tx - fx * (back + thick) + lx,
        y,
        tz - fz * (back + thick) + lz,
        tx - fx * back - lx,
        y,
        tz - fz * back - lz,
        tx - fx * (back + thick) - lx,
        y,
        tz - fz * (back + thick) - lz,
      ],
      placed * CHEVRON_VERTICES * 3,
    );

    const [r, g, b] = guideTint(guide.pedal[k] ?? 0, guide.phase[k] ?? "go");
    const lighter = [(1 + r) / 2, (1 + g) / 2, (1 + b) / 2, 0.95] as const;
    for (let v = 0; v < CHEVRON_VERTICES; v += 1) {
      colours.set(lighter, (placed * CHEVRON_VERTICES + v) * 4);
    }

    const o = placed * CHEVRON_VERTICES;
    indices.set([o + 2, o, o + 1, o + 2, o + 1, o + 3, o + 4, o + 1, o, o + 4, o + 5, o + 1], placed * 12);
    placed += 1;
  }

  arrows.geometry.setDrawRange(0, placed * 12);
  arrows.position.needsUpdate = true;
  arrows.colour.needsUpdate = true;
  arrows.index.needsUpdate = true;

  return placed;
}
