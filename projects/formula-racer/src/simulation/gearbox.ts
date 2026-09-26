import type { GearboxDefinition } from "../content/car.ts";

/** -1 is reverse. */
export type Gear = number;

export const REVERSE: Gear = -1;

export type ShiftRequest = "up" | "down";

/**
 * Automatic shifts itself. Manual shifts only when the driver asks. Hybrid takes the
 * driver's shifts and steps in only at the limiter or when the engine would bog down.
 */
export type GearboxMode = "automatic" | "hybrid" | "manual";

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

// Hybrid lets the driver short-shift down to this fraction of the automatic downshift
// point, and steps in below it: an engine under half its downshift speed is bogging.
const HYBRID_BOG_SHARE = 0.5;

// Below this the car counts as stopped, so selecting R cannot throw it backwards.
const STANDSTILL_MPS = 1 / 3.6;

export function createGearbox(box: GearboxDefinition): Gearbox {
  const tops = box.gearTopSpeedsKmh.map((kmh) => kmh / 3.6);
  const topFor = (gear: Gear) => (gear === REVERSE ? REVERSE_TOP_KMH / 3.6 : (tops[gear - 1] ?? 1));
  const rpmIn = (gear: Gear, speedMps: number) => (box.redlineRpm * Math.abs(speedMps)) / topFor(gear);
  let gear: Gear = 1;
  let pending: ShiftRequest | undefined;
  let mode: GearboxMode = "automatic";
  const downshiftAt = () => (mode === "hybrid" ? box.downshiftRpm * HYBRID_BOG_SHARE : box.downshiftRpm);

  return {
    update(speedMps) {
      const stopped = Math.abs(speedMps) < STANDSTILL_MPS;
      if (pending === "down" && gear === 1 && stopped) {
        gear = REVERSE;
      } else if (pending === "up" && gear === REVERSE && stopped) {
        gear = 1;
      } else if (mode !== "automatic" && gear !== REVERSE) {
        const bogs = mode === "hybrid" && rpmIn(gear + 1, speedMps) < downshiftAt();
        if (pending === "up" && gear < tops.length && !bogs) {
          gear += 1;
        } else if (pending === "down" && gear > 1 && rpmIn(gear - 1, speedMps) <= box.redlineRpm) {
          gear -= 1;
        }
      }

      pending = undefined;

      // Step one gear at a time so a sudden speed change still reads as a sequence of shifts.
      if (mode !== "manual" && gear !== REVERSE) {
        const upshiftAt = mode === "hybrid" ? box.redlineRpm : box.upshiftRpm;
        if (gear < tops.length && rpmIn(gear, speedMps) >= upshiftAt) {
          gear += 1;
        } else if (gear > 1 && rpmIn(gear, speedMps) < downshiftAt()) {
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
