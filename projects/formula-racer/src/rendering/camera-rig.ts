import type { Vec3 } from "../content/validate.ts";
import type { Quat } from "../simulation/probe-world.ts";

export interface CarPose {
  position: Vec3;
  rotation: Quat;
}

export interface CameraView {
  position: Vec3;
  target: Vec3;
}

export type CameraMode = "chase" | "nose";

export interface CameraRig {
  update(car: CarPose, dtSeconds: number): CameraView;
  /** Advances to the next mode and returns it. */
  cycle(): CameraMode;
  /** Drops smoothing history, e.g. after the car is reset. */
  reset(): void;
}

const MODES: CameraMode[] = ["chase", "nose"];
const CHASE_DISTANCE_M = 6;
const CHASE_HEIGHT_M = 2.2;
const LOOK_AHEAD_M = 4;
// The chase view follows the car's position exactly (a lagging camera loses a fast car)
// and only its heading with lag, so turns read as the car rotating in the frame.
const HEADING_LAG_S = 0.3;

/** Heading about +y from the chassis's +z axis, ignoring pitch and roll. */
function headingOf(q: Quat): number {
  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
}

export function createCameraRig(): CameraRig {
  let mode: CameraMode = "chase";
  let heading: number | undefined;
  return {
    update(car, dtSeconds) {
      const actual = headingOf(car.rotation);
      if (heading === undefined) heading = actual;
      let delta = actual - heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      // Exponential decay per elapsed time, so the path does not depend on frame rate.
      heading += delta * (1 - Math.exp(-dtSeconds / HEADING_LAG_S));
      const p = car.position;
      if (mode === "nose") {
        const fx = Math.sin(actual);
        const fz = Math.cos(actual);
        return {
          position: { x: p.x + fx * 1.2, y: p.y + 0.6, z: p.z + fz * 1.2 },
          target: { x: p.x + fx * 20, y: p.y + 0.4, z: p.z + fz * 20 },
        };
      }
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      return {
        position: {
          x: p.x - fx * CHASE_DISTANCE_M,
          y: p.y + CHASE_HEIGHT_M,
          z: p.z - fz * CHASE_DISTANCE_M,
        },
        target: { x: p.x + fx * LOOK_AHEAD_M, y: p.y + 0.5, z: p.z + fz * LOOK_AHEAD_M },
      };
    },
    cycle() {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? "chase";
      return mode;
    },
    reset() {
      heading = undefined;
    },
  };
}
