import * as THREE from "three";
import type { BoundCarModel } from "./car-model-view.ts";

export const GHOST_MODES = ["off", "best", "last"] as const;
export type GhostMode = (typeof GHOST_MODES)[number];

export const isGhostMode = (value: unknown): value is GhostMode => GHOST_MODES.some((mode) => mode === value);

export interface GhostView {
  readonly object: THREE.Object3D;

  /** Hides the ghost when there is no pose. `y` is the live car's ride height. */
  update(pose: { x: number; z: number; heading: number } | undefined, y: number): void;
  dispose(): void;
}

// `instanceof` on the generic class widens its type arguments to `any`.
const isMesh = (object: THREE.Object3D): object is THREE.Mesh => object instanceof THREE.Mesh;

/**
 * A copy of the car's coarsest level of detail, drawn with one material. It shares the
 * model's geometry; a car seen at a distance, or see-through, shows little detail anyway.
 */
function coarseCopy(model: BoundCarModel, material: THREE.Material, name: string): THREE.Object3D {
  const root = model.root.clone(true);
  root.traverse((object) => {
    if (isMesh(object)) {
      object.material = material;
    }

    const levels = object.children
      .map((child) => /_LOD(\d+)$/u.exec(child.name))
      .map((match) => (match ? Number(match[1]) : -1));
    const coarsest = Math.max(...levels, -1);
    if (coarsest >= 0) {
      object.children.forEach((child, i) => {
        child.visible = levels[i] === coarsest;
      });
    }
  });
  root.name = name;
  root.visible = false;

  return root;
}

function poseView(root: THREE.Object3D, material: THREE.Material): GhostView {
  const up = new THREE.Vector3(0, 1, 0);

  return {
    object: root,
    update(pose, y) {
      root.visible = pose !== undefined;
      if (pose) {
        root.position.set(pose.x, y, pose.z);
        root.quaternion.setFromAxisAngle(up, pose.heading);
      }
    },
    dispose() {
      // The geometry belongs to the car model, which disposes of it.
      material.dispose();
    },
  };
}

/** A see-through copy of the car. */
export function createGhostView(model: BoundCarModel): GhostView {
  const material = new THREE.MeshBasicMaterial({
    color: 0x9fd4ff,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const root = coarseCopy(model, material, "ghost");
  root.renderOrder = 1;

  return poseView(root, material);
}

/** One colour per opponent, in grid order; the map uses them too. */
export const OPPONENT_COLOURS = [0x3b82f6, 0x2fb56a, 0xf2b134] as const;

/** An AI opponent: the ghost's shape, solid and lit, in one colour per car. */
export function createOpponentView(model: BoundCarModel, color: number): GhostView {
  const material = new THREE.MeshLambertMaterial({ color });

  return poseView(coarseCopy(model, material, "opponent"), material);
}
