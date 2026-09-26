import type { GearboxDefinition } from "../content/car.ts";

/** -1 is reverse. */
export type Gear = number;

export const REVERSE: Gear = -1;

export type ShiftRequest = "up" | "down";

/** Automatic shifts itself; manual shifts only when the driver asks. */
export type GearboxMode = "automatic" | "manual";

export interface GearState {
  gear: Gear;
  rpm: number;
}

export interface Gearbox {
  /** `speedMps` is signed: negative while rolling backwards. */
  update(speedMps: number): GearState;

  /** A driver's shift, applied on the next update. */
  request(shift: ShiftRequest): void;
  setMode(mode: GearboxMode): void;
  reset(): void;
}

// Reverse is geared so the engine reaches the redline at this speed, which caps it.
const REVERSE_TOP_KMH = 30;

// Below this the car counts as stopped, so selecting R cannot throw it backwards.
const STANDSTILL_MPS = 1 / 3.6;

export function createGearbox(box: GearboxDefinition): Gearbox {
  const tops = box.gearTopSpeedsKmh.map((kmh) => kmh / 3.6);
  const topFor = (gear: Gear) => (gear === REVERSE ? REVERSE_TOP_KMH / 3.6 : (tops[gear - 1] ?? 1));
  const rpmIn = (gear: Gear, speedMps: number) => (box.redlineRpm * Math.abs(speedMps)) / topFor(gear);
  let gear: Gear = 1;
  let pending: ShiftRequest | undefined;
  let mode: GearboxMode = "automatic";

  return {
    update(speedMps) {
      const stopped = Math.abs(speedMps) < STANDSTILL_MPS;
      if (pending === "down" && gear === 1 && stopped) {
        gear = REVERSE;
      } else if (pending === "up" && gear === REVERSE && stopped) {
        gear = 1;
      } else if (mode === "manual" && gear !== REVERSE) {
        if (pending === "up" && gear < tops.length) {
          gear += 1;
        } else if (pending === "down" && gear > 1 && rpmIn(gear - 1, speedMps) <= box.redlineRpm) {
          gear -= 1;
        }
      }

      pending = undefined;

      // Step one gear at a time so a sudden speed change still reads as a sequence of shifts.
      if (mode === "automatic" && gear !== REVERSE) {
        if (gear < tops.length && rpmIn(gear, speedMps) >= box.upshiftRpm) {
          gear += 1;
        } else if (gear > 1 && rpmIn(gear, speedMps) < box.downshiftRpm) {
          gear -= 1;
        }
      }

      const rpm = Math.min(box.redlineRpm, Math.max(box.idleRpm, rpmIn(gear, speedMps)));

      return { gear, rpm };
    },
    request(shift) {
      pending = shift;
    },
    setMode(next) {
      mode = next;
    },
    reset() {
      gear = 1;
      pending = undefined;
    },
  };
}
