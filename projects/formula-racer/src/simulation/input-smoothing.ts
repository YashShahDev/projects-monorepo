import type { DriverControls } from "./vehicle.ts";

/** On/off requests, as from a keyboard. */
export interface DigitalInput {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
}

export interface InputSmoother {
  update(input: DigitalInput, speedMps: number, dtSeconds: number): DriverControls;
  reset(): void;
}

// Full lock in 0.25 s and back to centre in half that: quick enough to catch a slide,
// slow enough that a tap is a small correction rather than a jolt.
const STEER_IN_PER_S = 4;
const STEER_OUT_PER_S = 8;
// Speed at which a held key gives about 70% lock; above it the lock keeps shrinking so
// a keyboard's all-or-nothing input stays drivable at 300 km/h.
const LOCK_HALF_SPEED_MPS = 30;

export function createInputSmoother(): InputSmoother {
  let steer = 0;
  return {
    update(input, speedMps, dtSeconds) {
      const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const lock = 1 / Math.sqrt(1 + (speedMps / LOCK_HALF_SPEED_MPS) ** 2);
      const target = direction * lock;
      const returning = Math.abs(target) < Math.abs(steer) || target * steer < 0;
      const rate = (returning ? STEER_OUT_PER_S : STEER_IN_PER_S) * dtSeconds;
      steer += Math.max(-rate, Math.min(rate, target - steer));
      return { throttle: input.throttle ? 1 : 0, brake: input.brake ? 1 : 0, steer };
    },
    reset() {
      steer = 0;
    },
  };
}
