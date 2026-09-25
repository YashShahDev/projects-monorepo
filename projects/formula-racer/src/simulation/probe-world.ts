import RAPIER from "@dimforge/rapier3d-compat";
import type { ProbeScene, Vec3 } from "../content/probe-scene.ts";

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

/** Rapier stays behind this interface; consumers only see plain poses. */
export interface ProbeWorld {
  /** Seconds advanced by each `step()`. */
  readonly timestep: number;
  readonly steps: number;
  step(): void;
  boxPose(): Pose;
  dispose(): void;
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

export async function createProbeWorld(scene: ProbeScene): Promise<ProbeWorld> {
  await initPhysics();
  const world = new RAPIER.World(scene.gravity);
  const ground = scene.ground.halfExtents;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(ground.x, ground.y, ground.z).setTranslation(0, -ground.y, 0),
  );
  const box = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, scene.box.dropHeight, 0),
  );
  const size = scene.box.halfExtents;
  world.createCollider(RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z), box);

  let steps = 0;
  let disposed = false;
  const assertLive = (): void => {
    // Rapier's own error after free() is an unrelated-looking TypeError.
    if (disposed) throw new Error("probe world used after dispose()");
  };
  return {
    timestep: world.timestep,
    get steps() {
      return steps;
    },
    step() {
      assertLive();
      world.step();
      steps += 1;
    },
    boxPose() {
      assertLive();
      const { x, y, z } = box.translation();
      const rotation = box.rotation();
      return {
        position: { x, y, z },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      world.free();
    },
  };
}
