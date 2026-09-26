import * as THREE from "three";
import { brakingDecelMps2, guideColour, LIFT_WARNING_S } from "../simulation/racing-line.ts";
import type { GuidePhase, LineLimits, RacingLine } from "../simulation/racing-line.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";

export const GUIDE_MODES = ["off", "braking", "full"] as const;
export type GuideMode = (typeof GUIDE_MODES)[number];

export const isGuideMode = (value: unknown): value is GuideMode => GUIDE_MODES.some((mode) => mode === value);

export interface GuideState {
  mode: GuideMode;

  /** Points of the line drawn on the last update. */
  shownPoints: number;
}

export interface GuideView {
  readonly object: THREE.Object3D;
  update(position: { x: number; z: number }, speedMps: number, mode: GuideMode): GuideState;
  dispose(): void;
}

const AHEAD_M = 300;
const WIDTH_M = 0.9;
const HEIGHT_M = 0.03;
const ALPHA = 0.8;

// The red keeps its green channel up so screenshot tests never count it as the car.
const COLOURS: Record<GuidePhase, THREE.Color> = {
  go: new THREE.Color(0x2fd05a),
  lift: new THREE.Color(0xf2c230),
  brake: new THREE.Color(0xf25a4a),
};

/**
 * The racing line as a coloured strip on the road. Only the stretch ahead of the car is
 * drawn; each of its points is coloured by `guideColour` for the car's current speed.
 */
export function createGuideView(track: TrackGeometry, line: RacingLine, limits: LineLimits): GuideView {
  const n = line.count;
  const positions = new Float32Array(n * 2 * 3);
  const colours = new Float32Array(n * 2 * 4);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const dx = (line.x[j] ?? 0) - (line.x[(i - 1 + n) % n] ?? 0);
    const dz = (line.z[j] ?? 0) - (line.z[(i - 1 + n) % n] ?? 0);
    const length = Math.hypot(dx, dz) || 1;

    // Left of travel along (dx, dz) is (dz, −dx).
    const [lx, lz] = [((dz / length) * WIDTH_M) / 2, ((-dx / length) * WIDTH_M) / 2];
    const [x, z] = [line.x[i] ?? 0, line.z[i] ?? 0];
    positions.set([x - lx, HEIGHT_M, z - lz, x + lx, HEIGHT_M, z + lz], i * 6);
  }

  const index: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const [a, b] = [i * 2, ((i + 1) % n) * 2];

    // The second edge lies to the left of the first, so this winding faces up.
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colour = new THREE.BufferAttribute(colours, 4);
  colour.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("color", colour);
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -6;
  material.polygonOffsetUnits = -6;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "racing-line";
  mesh.frustumCulled = false;

  let shown: number[] = [];
  let hint: number | undefined;

  return {
    object: mesh,
    update(position, speedMps, mode) {
      for (const i of shown) {
        colours[i * 8 + 3] = 0;
        colours[i * 8 + 7] = 0;
      }

      shown = [];
      mesh.visible = mode !== "off";
      if (mode !== "off") {
        hint = track.locate(position.x, position.z, hint).index;
        let ahead = 0;
        for (let i = hint; ahead < AHEAD_M; i = (i + 1) % n) {
          const phase = guideColour({
            speedMps,
            aheadM: ahead,
            targetMps: line.speedMps[i] ?? 0,
            decelMps2: brakingDecelMps2(limits, line.speedMps[i] ?? 0),
            liftS: LIFT_WARNING_S,
            phase: line.phase[i] ?? "go",
          });
          ahead += line.stepM[i] ?? 1;
          if (mode === "braking" && phase === "go") {
            continue;
          }

          // Fade in over the first few metres so the strip does not start under the car.
          const alpha = ALPHA * Math.min(1, ahead / 8);
          const { r, g, b } = COLOURS[phase];
          colours.set([r, g, b, alpha, r, g, b, alpha], i * 8);
          shown.push(i);
        }
      }

      colour.needsUpdate = true;

      return { mode, shownPoints: shown.length };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
