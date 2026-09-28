import { describe, expect, test } from "bun:test";
import { createVehicleSimulation, NO_CONTROLS } from "../src/simulation/vehicle.ts";
import type { DriverAssists, VehicleSimulation } from "../src/simulation/vehicle.ts";
import { car, kmh, run, timeTo } from "./support/vehicle.ts";

// Targets are public F1 figures with a gameplay tolerance: 0–100 km/h in about 2.6 s
// and 0–200 in 4.5–5.5 s, both grip-limited off the line; a slick-shod racing car on
// carbon brakes stops from 100 km/h in about 20 m.

const ALL_ON: DriverAssists = { steering: true, abs: true, traction: true };
const ALL_OFF: DriverAssists = { steering: false, abs: false, traction: false };

async function vehicle(assists: DriverAssists = ALL_ON, grip = 1): Promise<VehicleSimulation> {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
    groundHalfExtentM: 5_000,
    assists,
    gripAt: () => grip,
  });
  run(sim, NO_CONTROLS, 1);

  return sim;
}

const headingOf = (sim: VehicleSimulation): number => {
  const q = sim.snapshot().rotation;

  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
};

/** Brakes to a stop and returns the distance, metres. */
function stop(sim: VehicleSimulation, steer = 0): number {
  const start = sim.snapshot().position;
  for (let t = 0; kmh(sim) > 1 && t < 20; t += sim.stepSeconds) {
    sim.step({ throttle: 0, brake: 1, steer });
  }

  const end = sim.snapshot().position;

  return Math.hypot(end.x - start.x, end.z - start.z);
}

/** Largest angle between the car's velocity and its heading over `seconds`, degrees. */
function peakSideslip(sim: VehicleSimulation, steer: number, seconds: number): number {
  let worst = 0;
  for (let t = 0; t < seconds; t += sim.stepSeconds) {
    sim.step({ throttle: 1, brake: 0, steer });
    const { linearVelocity: v } = sim.snapshot();
    const h = headingOf(sim);
    const along = v.x * Math.sin(h) + v.z * Math.cos(h);
    const across = v.x * Math.cos(h) - v.z * Math.sin(h);
    worst = Math.max(worst, Math.abs((Math.atan2(across, along) * 180) / Math.PI));
  }

  return worst;
}

describe("straight-line envelope", () => {
  test("launches like an F1 car: grip-limited to 100 km/h, then pulls hard to 200", async () => {
    const sim = await vehicle();
    const to100 = timeTo(sim, 100);
    const to200 = to100 + timeTo(sim, 200);
    expect(to100).toBeGreaterThan(2.2);
    expect(to100).toBeLessThan(3.0);
    expect(to200).toBeGreaterThan(4.2);
    expect(to200).toBeLessThan(5.8);
    sim.dispose();
  });

  test("stops from 100 km/h in about 20 m, keeping its heading", async () => {
    const sim = await vehicle();
    timeTo(sim, 100);
    const heading = headingOf(sim);
    const distance = stop(sim);
    expect(distance).toBeGreaterThan(15);
    expect(distance).toBeLessThan(24);
    const oneDegree = Math.PI / 180;
    expect(Math.abs(headingOf(sim) - heading)).toBeLessThan(oneDegree);
    sim.dispose();
  });

  test("brakes harder at 200 km/h than at 100 km/h, as downforce loads the tyres", async () => {
    const sim = await vehicle();
    timeTo(sim, 200);
    const from200 = stop(sim);

    // With a constant deceleration the stop from 200 would be four times the one from
    // 100 (about 80 m); downforce makes it well under that.
    expect(from200).toBeGreaterThan(45);
    expect(from200).toBeLessThan(72);
    sim.dispose();
  });
});

describe("locking and spinning the wheels", () => {
  test.each([1, 0.5])("on grip %p, ABS stops shorter than locked wheels", async (grip) => {
    const withAbs = await vehicle(ALL_ON, grip);
    timeTo(withAbs, 100);
    const abs = stop(withAbs);
    const locked = await vehicle(ALL_OFF, grip);
    timeTo(locked, 100);
    const lockedDistance = stop(locked);
    expect(abs).toBeLessThan(lockedDistance * 0.95);

    // ...by the gap between peak and sliding grip, not by more.
    expect(abs).toBeGreaterThan(lockedDistance * 0.75);
    withAbs.dispose();
    locked.dispose();
  });

  test("locked wheels slide straight on; ABS keeps the car steerable", async () => {
    // Steering shows in where the car goes, not where it points: a locked car can spin
    // and still slide along its old path.
    const course = (sim: VehicleSimulation) => {
      const { x, z } = sim.snapshot().linearVelocity;

      return Math.atan2(x, z);
    };

    const turned = async (assists: DriverAssists) => {
      const sim = await vehicle(assists);
      timeTo(sim, 120);
      const before = course(sim);
      run(sim, { throttle: 0, brake: 1, steer: -0.6 }, 0.6);
      const change = Math.abs(course(sim) - before);
      sim.dispose();

      return change;
    };

    const abs = await turned({ ...ALL_OFF, abs: true });
    const locked = await turned(ALL_OFF);
    expect(abs).toBeGreaterThan(locked * 2);
  });

  test("flooring it out of a slow low-grip turn slides the rear without traction control", async () => {
    const slide = async (assists: DriverAssists) => {
      const sim = await vehicle(assists, 0.5);
      timeTo(sim, 60);
      run(sim, { throttle: 0.1, brake: 0, steer: 0.4 }, 1);
      const worst = peakSideslip(sim, 0.4, 1.5);
      sim.dispose();

      return worst;
    };

    const off = await slide(ALL_OFF);
    const on = await slide({ ...ALL_OFF, traction: true });
    expect(off).toBeGreaterThan(6);
    expect(on).toBeLessThan(off / 2);
  });
});

describe("symmetry", () => {
  test("a left turn mirrors a right turn", async () => {
    const lateral = async (steer: number) => {
      const sim = await vehicle();
      timeTo(sim, 150);
      run(sim, { throttle: 0.6, brake: 0, steer }, 2);
      const { x, z } = sim.snapshot().position;
      sim.dispose();

      return { x, z };
    };

    const right = await lateral(0.3);
    const left = await lateral(-0.3);
    expect(Math.abs(right.x + left.x)).toBeLessThan(Math.abs(right.x) * 0.02);
    expect(Math.abs(right.z - left.z)).toBeLessThan(Math.abs(right.z) * 0.02);
  });
});
