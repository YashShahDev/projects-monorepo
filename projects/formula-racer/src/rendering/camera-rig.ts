import type { Vec3 } from "../content/validate.ts";
import type { Quat } from "../simulation/physics.ts";

export interface CarPose {
  position: Vec3;
  rotation: Quat;
}

export interface CameraView {
  position: Vec3;
  target: Vec3;

  /** Vertical field of view. */
  fovDeg: number;
}

/** `tcam` is the onboard view from above the airbox; `far` is a higher, wider chase. */
export type CameraMode = "chase" | "cockpit" | "tcam" | "far";

/** Camera points in the chassis frame, from the car model's anchor nodes. */
export interface CameraAnchors {
  /** Where the chase camera aims: above the engine cover. */
  chase: Vec3;

  /** The driver's eye point. */
  cockpit: Vec3;
}

// Used until a model supplies its own anchors, e.g. in simulation-only tests.
export const DEFAULT_ANCHORS: CameraAnchors = { chase: { x: 0, y: 0.5, z: 0 }, cockpit: { x: 0, y: 0.6, z: 1.2 } };

export interface CameraRig {
  update(car: CarPose, dtSeconds: number): CameraView;

  /** Advances to the next mode and returns it. */
  cycle(): CameraMode;

  /** Drops smoothing history, e.g. after the car is reset. */
  reset(): void;
}

const MODES: CameraMode[] = ["chase", "cockpit", "tcam", "far"];

// A wide cockpit angle keeps the corner in view past the halo; the far chase narrows
// so the car does not shrink to a dot.
const FOV_DEG: Record<CameraMode, number> = { chase: 60, cockpit: 72, tcam: 66, far: 52 };

const CHASE: Record<"chase" | "far", { distanceM: number; heightM: number }> = {
  chase: { distanceM: 6, heightM: 2.2 },
  far: { distanceM: 11, heightM: 4 },
};

// The T-cam pod sits on the airbox, above and behind the driver's head.
const TCAM_OFFSET: Vec3 = { x: 0, y: 0.45, z: -0.7 };
const TCAM_DIP_M = 1.2;
const LOOK_AHEAD_M = 4;
// The chase view follows the car's position exactly (a lagging camera loses a fast car)
// and only its heading with lag, so turns read as the car rotating in the frame.
const HEADING_LAG_S = 0.3;

/** Heading about +y from the chassis's +z axis, ignoring pitch and roll. */
function headingOf(q: Quat): number {
  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
}

/** Rotates `v` by the unit quaternion `q`. */
function rotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 (q × v); v' = v + w t + q × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);

  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

const COCKPIT_LOOK_M = 20;

export function createCameraRig(anchors: CameraAnchors = DEFAULT_ANCHORS): CameraRig {
  let mode: CameraMode = "chase";
  let heading: number | undefined;

  return {
    update(car, dtSeconds) {
      const actual = headingOf(car.rotation);
      heading ??= actual;

      let delta = actual - heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));

      // Exponential decay per elapsed time, so the path does not depend on frame rate.
      heading += delta * (1 - Math.exp(-dtSeconds / HEADING_LAG_S));
      const p = car.position;
      const fovDeg = FOV_DEG[mode];
      if (mode === "cockpit" || mode === "tcam") {
        // Rigid with the chassis, so pitch and roll show as they do to a driver.
        const c = anchors.cockpit;
        const local = mode === "tcam" ? { x: c.x + TCAM_OFFSET.x, y: c.y + TCAM_OFFSET.y, z: c.z + TCAM_OFFSET.z } : c;
        const dip = mode === "tcam" ? TCAM_DIP_M : 0;
        const eye = rotate(car.rotation, local);
        const ahead = rotate(car.rotation, { ...local, y: local.y - dip, z: local.z + COCKPIT_LOOK_M });

        return {
          position: { x: p.x + eye.x, y: p.y + eye.y, z: p.z + eye.z },
          target: { x: p.x + ahead.x, y: p.y + ahead.y, z: p.z + ahead.z },
          fovDeg,
        };
      }

      const { distanceM, heightM } = CHASE[mode];

      const fx = Math.sin(heading);
      const fz = Math.cos(heading);

      // The chase anchor turns with the lagged heading, like the camera itself.
      const a = anchors.chase;
      const ax = a.x * fz + a.z * fx;
      const az = -a.x * fx + a.z * fz;

      return {
        position: {
          x: p.x - fx * distanceM,
          y: p.y + heightM,
          z: p.z - fz * distanceM,
        },
        target: { x: p.x + ax + fx * LOOK_AHEAD_M, y: p.y + a.y, z: p.z + az + fz * LOOK_AHEAD_M },
        fovDeg,
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
