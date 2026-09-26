import { describe, expect, test } from "bun:test";
import { parseCar } from "../src/content/car.ts";
import type { CarDefinition } from "../src/content/car.ts";
import { NO_CONTROLS } from "../src/simulation/vehicle.ts";
import { car, kmh, run, settledVehicle, timeTo } from "./support/vehicle.ts";

const yaw = (q: { y: number; w: number }) => 2 * Math.atan2(q.y, q.w);
const NONE = { steering: false, abs: false, traction: false };

describe("aerodynamics", () => {
  test("drag bounds top speed near 340 km/h", async () => {
    // 700 kW against CdA 1.36 balances near 340 km/h. The shipped ICE alone is 400 kW,
    // so this checks the drag model with the power stated explicitly.
    const sim = await settledVehicle(
      parseCar({ ...car, powertrain: { ...car.powertrain, maxPowerW: 700_000 } }),
    );
    // 24 s of full throttle covers about 2 km, inside the 3 km test ground.
    run(sim, { throttle: 1, brake: 0, steer: 0 }, 20);
    const top = kmh(sim);
    run(sim, { throttle: 1, brake: 0, steer: 0 }, 4);
    expect(top).toBeGreaterThan(320);
    expect(top).toBeLessThan(360);
    // Settled: another 4 s adds almost nothing.
    expect(kmh(sim) - top).toBeLessThan(2);
    sim.dispose();
  });

  test("a coasting car slows as drag predicts", async () => {
    // Drag alone: 1/v = 1/v0 + (rho * CdA / 2m) * t. From 55.6 m/s over 3 s with
    // CdA 1.36 and 800 kg that gives 47.3 m/s, 170.4 km/h.
    const sim = await settledVehicle();
    timeTo(sim, 200);
    run(sim, NO_CONTROLS, 3);
    expect(kmh(sim)).toBeGreaterThan(165);
    expect(kmh(sim)).toBeLessThan(176);
    sim.dispose();
  });

  test("the suspension holds the chassis off the ground at top speed", async () => {
    const sim = await settledVehicle();
    run(sim, { throttle: 1, brake: 0, steer: 0 }, 20);
    const bottomM = sim.snapshot().position.y - car.chassisHalfExtents.y;
    expect(bottomM).toBeGreaterThan(0.03);
    sim.dispose();
  });

  test("downforce lets the car corner harder at speed", async () => {
    const turned = async (definition: CarDefinition) => {
      const sim = await settledVehicle(definition);
      sim.setAssists(NONE);
      timeTo(sim, 220, 60);
      const start = yaw(sim.snapshot().rotation);
      // Hold speed roughly constant through a long corner at a fixed lock.
      run(sim, { throttle: 0.5, brake: 0, steer: 0.12 }, 2);
      const end = sim.snapshot();
      sim.dispose();
      return Math.abs(yaw(end.rotation) - start);
    };
    const noDownforce = parseCar({
      ...car,
      aero: {
        ...car.aero,
        downforceAreaM2: 0,
        straightMode: { ...car.aero.straightMode, downforceAreaM2: 0 },
      },
    });
    expect(await turned(car)).toBeGreaterThan((await turned(noDownforce)) * 1.15);
  });

  test("content rejects a car without a positive drag area", () => {
    expect(() => parseCar({ ...car, aero: { ...car.aero, dragAreaM2: 0 } })).toThrow(
      "car.aero.dragAreaM2 must be positive",
    );
  });

  test.each([
    [180, 0.038],
    [250, 0.03],
  ])("stays stable through a fast corner at %d km/h", async (fromKmh, lockRad) => {
    const sim = await settledVehicle();
    sim.setAssists(NONE);
    timeTo(sim, fromKmh, 60);
    const start = yaw(sim.snapshot().rotation);
    const steer = lockRad / car.steering.maxAngleRad;
    run(sim, { throttle: 0, brake: 0, steer }, 1.5);
    const end = sim.snapshot();
    sim.dispose();
    // A car that grips turns about as far as the kinematic path v * lock / wheelbase;
    // one that spins turns far more (118° against 53° with 45% front downforce).
    const kinematic =
      ((fromKmh / 3.6) * lockRad * 1.5) / (car.wheels.frontAxleZ - car.wheels.rearAxleZ);
    expect(Math.abs(yaw(end.rotation) - start)).toBeLessThan(kinematic * 1.25);
  });
});
