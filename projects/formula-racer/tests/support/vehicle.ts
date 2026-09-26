import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCar } from "../../src/content/car.ts";
import type { CarDefinition } from "../../src/content/car.ts";
import { createVehicleSimulation, NO_CONTROLS } from "../../src/simulation/vehicle.ts";
import type { DriverControls, VehicleSimulation } from "../../src/simulation/vehicle.ts";

export const car: CarDefinition = parseCar(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../public/assets/cars/fr26.json"), "utf8"),
  ),
);

export async function settledVehicle(definition: CarDefinition = car): Promise<VehicleSimulation> {
  const sim = await createVehicleSimulation(definition, {
    start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
  });
  run(sim, NO_CONTROLS, 1);

  return sim;
}

export function run(sim: VehicleSimulation, controls: DriverControls, seconds: number): void {
  const steps = Math.round(seconds / sim.stepSeconds);
  for (let i = 0; i < steps; i += 1) {
    sim.step(controls);
  }
}

export const kmh = (sim: VehicleSimulation): number => sim.snapshot().speedMps * 3.6;

/** Seconds of full throttle to reach `targetKmh`, or Infinity within the time limit. */
export function timeTo(sim: VehicleSimulation, targetKmh: number, limitSeconds = 30): number {
  for (let t = 0; t < limitSeconds; t += sim.stepSeconds) {
    if (kmh(sim) >= targetKmh) {
      return t;
    }

    sim.step({ throttle: 1, brake: 0, steer: 0 });
  }

  return Number.POSITIVE_INFINITY;
}
