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
 * A see-through copy of the car. It shares the model's geometry, and keeps only the
 * coarsest level of detail: a translucent car shows little detail anyway.
 */
export function createGhostView(model: BoundCarModel): GhostView {
  const root = model.root.clone(true);
  const material = new THREE.MeshBasicMaterial({
    color: 0x9fd4ff,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
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
  root.name = "ghost";
  root.visible = false;
  root.renderOrder = 1;

  return {
    object: root,
    update(pose, y) {
      root.visible = pose !== undefined;
      if (pose) {
        root.position.set(pose.x, y, pose.z);
        root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.heading);
      }
    },
    dispose() {
      // The geometry belongs to the car model, which disposes of it.
      material.dispose();
    },
  };
}
