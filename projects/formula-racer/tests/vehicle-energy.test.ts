import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCar } from "../src/content/car.ts";
import { parseEnergyRules } from "../src/content/energy-rules.ts";
import { createVehicleSimulation } from "../src/simulation/vehicle.ts";
import type { DriverControls, VehicleSimulation } from "../src/simulation/vehicle.ts";
import { car, kmh, run } from "./support/vehicle.ts";

const rules = parseEnergyRules(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/rules/energy-2026-c18.json"), "utf8")),
);

async function vehicle(withEnergy = true) {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
    ...(withEnergy ? { energy: rules } : {}),
  });
  run(sim, { throttle: 0, brake: 0, steer: 0 }, 1);

  return sim;
}

/** Seconds from `fromKmh` to `toKmh` holding `controls`. */
function timeBetween(sim: VehicleSimulation, fromKmh: number, toKmh: number, controls: DriverControls) {
  while (kmh(sim) < fromKmh) {
    sim.step({ throttle: 1, brake: 0, steer: 0 });
  }

  let t = 0;
  while (kmh(sim) < toKmh && t < 30) {
    sim.step(controls);
    t += sim.stepSeconds;
  }

  return t;
}

const flatOut: DriverControls = { throttle: 1, brake: 0, steer: 0 };

describe("vehicle energy", () => {
  test("ERS deployment adds to the ICE", async () => {
    const ice = await vehicle(false);
    const hybrid = await vehicle();
    const withoutErs = timeBetween(ice, 150, 250, flatOut);
    const withErs = timeBetween(hybrid, 150, 250, flatOut);
    expect(withErs).toBeLessThan(withoutErs * 0.85);
    ice.dispose();
    hybrid.dispose();
  });

  test("holding the deploy request out-accelerates Balanced", async () => {
    const balanced = await vehicle();
    const request = await vehicle();
    const b = timeBetween(balanced, 150, 250, flatOut);
    const r = timeBetween(request, 150, 250, { ...flatOut, deploy: true });
    expect(r).toBeLessThan(b);
    balanced.dispose();
    request.dispose();
  });

  test("snapshots report charge and power flow; deployment drains the store", async () => {
    const sim = await vehicle();
    const full = sim.snapshot().energy;
    expect(full?.socJ).toBe(rules.socWindowJ);
    run(sim, { ...flatOut, deploy: true }, 5);
    const after = sim.snapshot().energy;
    expect(after?.deployW).toBeGreaterThan(100_000);
    expect(after?.socJ ?? 0).toBeLessThan(rules.socWindowJ - 1_000_000);
    sim.dispose();
  });

  test("braking recharges without changing how hard the car brakes", async () => {
    const stop = async (withEnergy: boolean) => {
      const sim = await vehicle(withEnergy);

      // Same brake point for both cars, with the hybrid's store partly drained.
      timeBetween(sim, 0, 250, { ...flatOut, deploy: true });
      const soc = sim.snapshot().energy?.socJ ?? 0;
      const start = sim.snapshot().position.z;
      while (kmh(sim) > 60) {
        sim.step({ throttle: 0, brake: 1, steer: 0 });
      }

      const result = {
        distance: sim.snapshot().position.z - start,
        gainedJ: (sim.snapshot().energy?.socJ ?? 0) - soc,
      };
      sim.dispose();

      return result;
    };

    const plain = await stop(false);
    const hybrid = await stop(true);
    expect(hybrid.gainedJ).toBeGreaterThan(300_000);

    // Regeneration replaces part of the friction braking; the requested force is the
    // same, so the stopping distance matches to within a step's travel.
    expect(Math.abs(hybrid.distance - plain.distance)).toBeLessThan(1.5);
  });

  test("lift-off harvesting takes its energy from the car's motion", async () => {
    // Codex P3 review: Harvest gained 216 kJ while coasting exactly as fast as Balanced.
    // Near-zero drag, so the two cars' different speeds do not change their drag losses
    // and the kinetic-energy gap is the harvesting brake alone.
    const slippery = parseCar({
      ...car,
      aero: {
        ...car.aero,
        dragAreaM2: 0.02,
        straightMode: { ...car.aero.straightMode, dragAreaM2: 0.01 },
      },
    });
    const coast = async (mode: "balanced" | "harvest") => {
      const sim = await createVehicleSimulation(slippery, {
        start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
        energy: rules,
      });
      run(sim, { throttle: 0, brake: 0, steer: 0 }, 1);
      run(sim, { ...flatOut, deploy: true }, 6);
      sim.setEnergyMode(mode);
      const soc = sim.snapshot().energy?.socJ ?? 0;
      const kinetic = 0.5 * car.massKg * sim.snapshot().speedMps ** 2;
      run(sim, { throttle: 0, brake: 0, steer: 0 }, 2);
      const result = {
        gainedJ: (sim.snapshot().energy?.socJ ?? 0) - soc,
        kineticJ: kinetic - 0.5 * car.massKg * sim.snapshot().speedMps ** 2,
      };
      sim.dispose();

      return result;
    };

    const balanced = await coast("balanced");
    const harvest = await coast("harvest");
    expect(harvest.gainedJ).toBeGreaterThan(100_000);

    // The extra kinetic energy lost must at least pay for what was stored.
    expect(harvest.kineticJ - balanced.kineticJ).toBeGreaterThan(harvest.gainedJ);
  });

  test("braking harvests only the rear axle's braking, which the MGU-K drives", async () => {
    const sim = await vehicle();
    timeBetween(sim, 0, 150, { ...flatOut, deploy: true });
    sim.step({ throttle: 0, brake: 0.3, steer: 0 });
    const s = sim.snapshot();
    const rearBrakingW = 0.3 * car.brakes.maxForceN * (1 - car.brakes.frontBias) * Math.abs(s.speedMps);
    expect(s.energy?.regenW ?? 0).toBeCloseTo(rearBrakingW, -4);
    sim.dispose();
  });

  test("ABS-limited braking on a slippery surface harvests less", async () => {
    const harvest = async (grip: number) => {
      const sim = await createVehicleSimulation(car, {
        start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
        energy: rules,
        gripAt: () => grip,
      });
      run(sim, { throttle: 0, brake: 0, steer: 0 }, 1);
      timeBetween(sim, 0, 100, { ...flatOut, deploy: true });

      // One step, so both cars harvest at the same speed.
      sim.step({ throttle: 0, brake: 1, steer: 0 });
      const regen = sim.snapshot().energy?.regenW ?? 0;
      sim.dispose();

      return regen;
    };

    expect(await harvest(0.3)).toBeLessThan((await harvest(1)) * 0.5);
  });

  test("braking in Harvest stores no more than braking in Balanced: energy comes from motion", async () => {
    const stop = async (mode: "balanced" | "harvest") => {
      const sim = await vehicle();
      timeBetween(sim, 0, 200, { ...flatOut, deploy: true });
      sim.setEnergyMode(mode);
      const soc = sim.snapshot().energy?.socJ ?? 0;
      const start = sim.snapshot().position.z;
      while (kmh(sim) > 20) {
        sim.step({ throttle: 0, brake: 1, steer: 0 });
      }

      const result = { gainedJ: (sim.snapshot().energy?.socJ ?? 0) - soc, distance: sim.snapshot().position.z - start };
      sim.dispose();

      return result;
    };

    const balanced = await stop("balanced");
    const harvest = await stop("harvest");
    expect(harvest.gainedJ).toBeLessThanOrEqual(balanced.gainedJ + 1);
    expect(Math.abs(harvest.distance - balanced.distance)).toBeLessThan(0.5);
  });

  test("a stationary car harvests nothing", async () => {
    const sim = await vehicle();
    run(sim, { ...flatOut, deploy: true }, 3);
    run(sim, { throttle: 0, brake: 1, steer: 0 }, 6);
    sim.setEnergyMode("harvest");
    const soc = sim.snapshot().energy?.socJ ?? 0;
    run(sim, { throttle: 0, brake: 0, steer: 0 }, 2);
    expect(sim.snapshot().energy?.socJ ?? 0).toBeCloseTo(soc, -2);
    sim.dispose();
  });

  test("Harvest mode charges on lift-off", async () => {
    const sim = await vehicle();
    run(sim, { ...flatOut, deploy: true }, 5);
    sim.setEnergyMode("harvest");
    const before = sim.snapshot().energy?.socJ ?? 0;
    run(sim, { throttle: 0, brake: 0, steer: 0 }, 2);
    expect((sim.snapshot().energy?.socJ ?? 0) - before).toBeCloseTo(
      rules.liftOffHarvestW * 2 * rules.regenEfficiency,
      -4,
    );
    expect(sim.snapshot().energy?.mode).toBe("harvest");
    sim.dispose();
  });

  test("reset refills the store and restores the standing start", async () => {
    const sim = await vehicle();
    run(sim, { ...flatOut, deploy: true }, 5);
    sim.reset();
    expect(sim.snapshot().energy?.socJ).toBe(rules.socWindowJ);
    sim.dispose();
  });

  test("a new lap restores the Recharge allowance", async () => {
    const sim = await vehicle();
    run(sim, { ...flatOut, deploy: true }, 5);
    run(sim, { throttle: 0, brake: 1, steer: 0 }, 1);
    expect(sim.snapshot().energy?.lapRechargeJ ?? 0).toBeGreaterThan(0);
    sim.newLap();
    expect(sim.snapshot().energy?.lapRechargeJ).toBe(0);
    sim.dispose();
  });
});
