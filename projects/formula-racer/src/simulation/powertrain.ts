import type { PowertrainDefinition } from "../content/car.ts";
import { createGearbox, REVERSE } from "./gearbox.ts";
import type { GearboxMode, ShiftRequest } from "./gearbox.ts";

export interface PowertrainState {
  /** Total drive force at the driven wheels, N; negative in reverse. */
  driveForceN: number;
  gear: number;
  rpm: number;
}

export interface Powertrain {
  /** `speedMps` is signed: negative while rolling backwards. */
  update(throttle: number, speedMps: number, dtSeconds: number): PowertrainState;
  request(shift: ShiftRequest): void;
  setMode(mode: GearboxMode): void;
  reset(): void;
}

// The limiter restores drive only once the engine drops this far below the redline, so
// it cuts in and out like a real one rather than chattering every step.
const LIMITER_RELEASE = 0.97;

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
  const forceAt = (rpm: number, speedMps: number) =>
    Math.min(def.maxDriveForceN, (def.maxPowerW * share(def.powerCurve, rpm)) / Math.max(Math.abs(speedMps), 1));
  const gearbox = createGearbox(def.gearbox, forceAt);
  let cutSeconds = 0;
  let gear = 1;
  let limited = false;

  return {
    update(throttle, speedMps, dtSeconds) {
      const state = gearbox.update(speedMps);

      // Engaging or leaving reverse happens at a standstill, so only real shifts cut drive.
      if (state.gear !== gear && state.gear !== REVERSE && gear !== REVERSE) {
        cutSeconds = def.shiftTimeS;
      }

      gear = state.gear;
      const redline = def.gearbox.redlineRpm;
      limited = limited ? state.rpm >= redline * LIMITER_RELEASE : state.rpm >= redline - EPSILON;
      if (cutSeconds > EPSILON) {
        cutSeconds -= dtSeconds;

        return { driveForceN: 0, ...state };
      }

      if (limited) {
        return { driveForceN: 0, ...state };
      }

      const powerW = def.maxPowerW * share(def.powerCurve, state.rpm);
      const direction = gear === REVERSE ? -1 : 1;
      const driveForceN = direction * throttle * Math.min(def.maxDriveForceN, powerW / Math.max(Math.abs(speedMps), 1));

      return { driveForceN, ...state };
    },
    request(shift) {
      gearbox.request(shift);
    },
    setMode(mode) {
      gearbox.setMode(mode);
    },
    reset() {
      gearbox.reset();
      cutSeconds = 0;
      gear = 1;
      limited = false;
    },
  };
}
