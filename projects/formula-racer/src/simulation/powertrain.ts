import type { PowertrainDefinition } from "../content/car.ts";
import { createGearbox } from "./gearbox.ts";

export interface PowertrainState {
  /** Total drive force at the driven wheels, N. */
  driveForceN: number;
  gear: number;
  rpm: number;
}

export interface Powertrain {
  update(throttle: number, speedMps: number, dtSeconds: number): PowertrainState;
  reset(): void;
}

const EPSILON = 1e-9;

function share(curve: [number, number][], rpm: number): number {
  const first = curve[0];
  const last = curve.at(-1);
  if (!first || !last) {
    return 1;
  }

  if (rpm <= first[0]) {
    return first[1];
  }

  if (rpm >= last[0]) {
    return last[1];
  }

  for (let i = 1; i < curve.length; i += 1) {
    const [r1, s1] = curve[i] ?? last;
    const [r0, s0] = curve[i - 1] ?? first;
    if (rpm <= r1) {
      return s0 + ((s1 - s0) * (rpm - r0)) / (r1 - r0);
    }
  }

  return last[1];
}

export function createPowertrain(def: PowertrainDefinition): Powertrain {
  const gearbox = createGearbox(def.gearbox);
  let cutSeconds = 0;
  let gear = 1;

  return {
    update(throttle, speedMps, dtSeconds) {
      const state = gearbox.update(speedMps);
      if (state.gear > gear) {
        cutSeconds = def.shiftTimeS;
      }

      gear = state.gear;
      if (cutSeconds > EPSILON) {
        cutSeconds -= dtSeconds;

        return { driveForceN: 0, ...state };
      }

      const powerW = def.maxPowerW * share(def.powerCurve, state.rpm);
      const driveForceN =
        throttle * Math.min(def.maxDriveForceN, powerW / Math.max(Math.abs(speedMps), 1));

      return { driveForceN, ...state };
    },
    reset() {
      gearbox.reset();
      cutSeconds = 0;
      gear = 1;
    },
  };
}
