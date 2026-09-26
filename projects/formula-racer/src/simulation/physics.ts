import RAPIER from "@dimforge/rapier3d-compat";
import type { Vec3 } from "../content/validate.ts";

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Vec3;
  rotation: Quat;
}

let ready: Promise<void> | undefined;

/** Loads the WASM module once; a failed load may be retried. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });

  return ready;
}
