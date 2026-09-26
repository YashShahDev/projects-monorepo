import { expect, test } from "bun:test";
import { createVehicleSimulation, NO_CONTROLS } from "../src/simulation/vehicle.ts";
import type { DriverAssists, VehicleSimulation, WheelSlip } from "../src/simulation/vehicle.ts";
import { car, kmh, run, timeTo } from "./support/vehicle.ts";

const ALL_OFF: DriverAssists = { steering: false, abs: false, traction: false };

async function vehicle(grip = 1, assists = ALL_OFF): Promise<VehicleSimulation> {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
    groundHalfExtentM: 5_000,
    assists,
    gripAt: () => grip,
  });
  run(sim, NO_CONTROLS, 1);

  return sim;
}

/** Every slip state each wheel showed while driving with `controls` for `seconds`. */
function slipsWhile(sim: VehicleSimulation, controls: typeof NO_CONTROLS, seconds: number): Set<WheelSlip>[] {
  const seen = [0, 1, 2, 3].map(() => new Set<WheelSlip>());
  for (let t = 0; t < seconds; t += sim.stepSeconds) {
    sim.step(controls);
    sim.snapshot().wheels.forEach((w, i) => seen[i]?.add(w.slip));
  }

  return seen;
}

test("cruising on a straight, no tyre slips, and each wheel reports where it touches", async () => {
  const sim = await vehicle();
  timeTo(sim, 150);
  const seen = slipsWhile(sim, { throttle: 0.3, brake: 0, steer: 0 }, 1);
  expect(seen.map((s) => [...s])).toEqual([["none"], ["none"], ["none"], ["none"]]);

  const { position, wheels } = sim.snapshot();
  for (const wheel of wheels) {
    expect(wheel.contact).toBeDefined();
    expect(Math.hypot((wheel.contact?.x ?? 99) - position.x, (wheel.contact?.z ?? 99) - position.z)).toBeLessThan(3);
  }

  sim.dispose();
});

test("full braking without ABS locks the wheels", async () => {
  const sim = await vehicle();
  timeTo(sim, 200);
  const seen = slipsWhile(sim, { throttle: 0, brake: 1, steer: 0 }, 0.5);
  expect(seen.some((s) => s.has("locked"))).toBe(true);
  expect(seen.every((s) => !s.has("spinning"))).toBe(true);
  sim.dispose();
});

test("full throttle on low grip without traction control spins the rear wheels only", async () => {
  const sim = await vehicle(0.5);
  const seen = slipsWhile(sim, { throttle: 1, brake: 0, steer: 0 }, 1);
  expect(seen[2]?.has("spinning")).toBe(true);
  expect(seen[3]?.has("spinning")).toBe(true);
  expect(seen[0]?.has("spinning")).toBe(false);
  expect(kmh(sim)).toBeGreaterThan(5);
  sim.dispose();
});

test("a wheel off the ground leaves no mark position", async () => {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: 0, y: 5, z: 0 }, headingRad: 0 },
    assists: ALL_OFF,
  });
  sim.step(NO_CONTROLS);
  for (const wheel of sim.snapshot().wheels) {
    expect(wheel.inContact).toBe(false);
    expect(wheel.contact).toBeUndefined();
    expect(wheel.slip).toBe("none");
  }

  sim.dispose();
});

test("full lock at speed without the steering assist slides the tyres sideways", async () => {
  const sim = await vehicle();
  timeTo(sim, 150);
  const seen = slipsWhile(sim, { throttle: 0, brake: 0, steer: 1 }, 0.6);
  expect(seen.some((s) => s.has("sliding"))).toBe(true);
  sim.dispose();
});

test("cornering at the limit with the steering assist leaves no marks", async () => {
  const sim = await vehicle(1, { steering: true, abs: true, traction: true });
  timeTo(sim, 100);
  const seen = slipsWhile(sim, { throttle: 0.5, brake: 0, steer: 1 }, 1.5);
  expect(seen.map((s) => [...s])).toEqual([["none"], ["none"], ["none"], ["none"]]);
  sim.dispose();
});
