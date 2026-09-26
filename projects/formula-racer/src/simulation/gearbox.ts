import type { GearboxDefinition } from "../content/car.ts";

export interface GearState {
  gear: number;
  rpm: number;
}

export interface Gearbox {
  update(speedMps: number): GearState;
  reset(): void;
}

export function createGearbox(box: GearboxDefinition): Gearbox {
  const tops = box.gearTopSpeedsKmh.map((kmh) => kmh / 3.6);
  const rpmIn = (gear: number, speedMps: number) => (box.redlineRpm * Math.abs(speedMps)) / (tops[gear - 1] ?? 1);
  let gear = 1;

  return {
    update(speedMps) {
      // Step one gear at a time so a sudden speed change still reads as a sequence of shifts.
      if (gear < tops.length && rpmIn(gear, speedMps) >= box.upshiftRpm) {
        gear += 1;
      } else if (gear > 1 && rpmIn(gear, speedMps) < box.downshiftRpm) {
        gear -= 1;
      }

      const rpm = Math.min(box.redlineRpm, Math.max(box.idleRpm, rpmIn(gear, speedMps)));

      return { gear, rpm };
    },
    reset() {
      gear = 1;
    },
  };
}
