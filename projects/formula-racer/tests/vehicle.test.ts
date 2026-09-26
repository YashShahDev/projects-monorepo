import { describe, expect, test } from "bun:test";
import { FixedStepper } from "../src/simulation/fixed-step.ts";
import { NO_CONTROLS } from "../src/simulation/vehicle.ts";
import { PHYSICS_VERSION } from "../src/simulation/version.ts";
import { kmh, run, settledVehicle, timeTo } from "./support/vehicle.ts";

describe("vehicle simulation", () => {
  test("rests on all four wheels without drifting", async () => {
    const sim = await settledVehicle();
    const before = sim.snapshot();
    run(sim, NO_CONTROLS, 5);
    const after = sim.snapshot();
    expect(after.wheels.every((wheel) => wheel.inContact)).toBe(true);
    const drift = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
    expect(drift).toBeLessThan(0.05);
    expect(after.physicsVersion).toBe(PHYSICS_VERSION);
    sim.dispose();
  });

  test("full throttle reaches 100 km/h in an F1-like time", async () => {
    const sim = await settledVehicle();
    const seconds = timeTo(sim, 100);
    expect(seconds).toBeGreaterThan(1.6);
    expect(seconds).toBeLessThan(3.2);
    sim.dispose();
  });

  test("braking from 200 km/h stops the car in a bounded distance", async () => {
    const sim = await settledVehicle();
    timeTo(sim, 200);
    const start = sim.snapshot().position.z;
    let seconds = 0;
    while (sim.snapshot().speedMps > 0.5 && seconds < 10) {
      sim.step({ throttle: 0, brake: 1, steer: 0 });
      seconds += sim.stepSeconds;
    }

    const distance = sim.snapshot().position.z - start;
    expect(distance).toBeGreaterThan(30);
    expect(distance).toBeLessThan(160);
    sim.dispose();
  });

  test.each([
    ["right", 1, -1],
    ["left", -1, 1],
  ])("steering %s turns toward the driver's %s", async (_name, steer, sign) => {
    const sim = await settledVehicle();
    run(sim, { throttle: 0.5, brake: 0, steer }, 3);
    expect(Math.sign(sim.snapshot().position.x)).toBe(sign);
    sim.dispose();
  });

  test("reports yaw rate with the chassis's sign convention", async () => {
    const sim = await settledVehicle();
    run(sim, { throttle: 0.4, brake: 0, steer: -1 }, 2);

    // Steering left turns toward +x, a positive rotation about +y.
    expect(sim.snapshot().angularVelocity.y).toBeGreaterThan(0.1);
    sim.dispose();
  });

  test("controls are clamped to their normalized ranges", async () => {
    const sim = await settledVehicle();
    sim.step({ throttle: 4, brake: -1, steer: -9 });
    expect(sim.snapshot().applied).toEqual({ throttle: 1, brake: 0, steer: -1 });
    sim.dispose();
  });

  test("reset returns the car to the start at rest", async () => {
    const sim = await settledVehicle();
    const start = sim.snapshot().position;
    run(sim, { throttle: 1, brake: 0, steer: 0.3 }, 4);
    sim.reset();
    run(sim, NO_CONTROLS, 1);
    const after = sim.snapshot();
    expect(Math.hypot(after.position.x - start.x, after.position.z - start.z)).toBeLessThan(0.05);
    expect(Math.abs(kmh(sim))).toBeLessThan(1);
    sim.dispose();
  });

  test("reset clears the vehicle controller's cached speed and gear", async () => {
    // Codex P2 review: Rapier's controller kept ~86 m/s after a reset.
    const sim = await settledVehicle();
    run(sim, { throttle: 1, brake: 0, steer: 0 }, 10);
    sim.reset();
    expect(Math.abs(sim.snapshot().speedMps)).toBeLessThan(0.01);
    sim.step(NO_CONTROLS);
    const after = sim.snapshot();
    expect(Math.abs(after.speedMps)).toBeLessThan(0.5);
    expect(after.gear).toBe(1);
    sim.dispose();
  });

  test("identical input produces identical trajectories", async () => {
    const drive = async () => {
      const sim = await settledVehicle();
      run(sim, { throttle: 1, brake: 0, steer: 0.4 }, 3);
      run(sim, { throttle: 0, brake: 0.7, steer: -0.2 }, 1);
      const snapshot = sim.snapshot();
      sim.dispose();

      return snapshot;
    };

    expect(await drive()).toEqual(await drive());
  });

  test("behaviour does not depend on the render frame rate", async () => {
    const at = async (hz: number) => {
      const sim = await settledVehicle();
      const stepper = new FixedStepper(sim.stepSeconds, 8);
      for (let frame = 0; frame < hz * 3; frame += 1) {
        const controls = frame < hz * 2 ? { throttle: 1, brake: 0, steer: 0.3 } : NO_CONTROLS;
        const { steps } = stepper.advance(1 / hz);
        for (let i = 0; i < steps; i += 1) {
          sim.step(controls);
        }
      }

      const snapshot = sim.snapshot();
      sim.dispose();

      return snapshot;
    };

    const reference = await at(60);
    for (const hz of [30, 144]) {
      expect(await at(hz)).toEqual(reference);
    }
  });

  test("using a disposed simulation fails clearly", async () => {
    const sim = await settledVehicle();
    sim.dispose();
    sim.dispose();
    expect(() => {
      sim.step(NO_CONTROLS);
    }).toThrow("vehicle simulation used after dispose()");
    expect(() => sim.snapshot()).toThrow("vehicle simulation used after dispose()");
  });
});
