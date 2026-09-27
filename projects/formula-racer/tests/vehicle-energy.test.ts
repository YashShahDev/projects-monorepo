import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCar } from "../src/content/car.ts";
import { parseEnergyRules } from "../src/content/energy-rules.ts";
import { createVehicleSimulation, SLIDING_GRIP } from "../src/simulation/vehicle.ts";
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
  test("the rev limiter holds a manual gear at its redline speed, ERS or not", async () => {
    const hybrid = await vehicle();
    hybrid.setGearboxMode("manual");
    run(hybrid, { ...flatOut, deploy: true }, 10);
    const firstGearTopKmh = car.powertrain.gearbox.gearTopSpeedsKmh[0] ?? 0;
    expect(hybrid.snapshot().gear).toBe(1);
    expect(kmh(hybrid)).toBeLessThan(firstGearTopKmh + 3);
    hybrid.dispose();
  });

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

    // Only what reaches the road: through the traction-limited launch the rear tyres
    // have no grip to spare, so that part of the run deploys (and drains) nothing.
    expect(after?.socJ ?? 0).toBeLessThan(rules.socWindowJ - 500_000);
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

  test("with ABS off, a locked rear tyre on a slippery surface harvests only what it grips", async () => {
    const harvest = async (grip: number) => {
      const sim = await createVehicleSimulation(car, {
        start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
        energy: rules,
        gripAt: () => grip,
        assists: { steering: true, abs: false, traction: true },
      });
      run(sim, { throttle: 0, brake: 0, steer: 0 }, 1);
      timeBetween(sim, 0, 100, { ...flatOut, deploy: true });
      sim.step({ throttle: 0, brake: 1, steer: 0 });
      const regen = sim.snapshot().energy?.regenW ?? 0;
      sim.dispose();

      return regen;
    };

    expect(await harvest(0.3)).toBeLessThan((await harvest(1)) * 0.5);
  });

  // Energy only moves through the rear tyres, so neither deployment nor harvesting may
  // pass more power than they can transmit: all four tyres' grip is a generous bound.
  describe("on a slippery surface, the ERS moves only the power the tyres transmit", () => {
    const onIce = async (options: { abs?: boolean } = {}) => {
      let grip = 1;
      const sim = await createVehicleSimulation(car, {
        start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
        energy: rules,
        gripAt: () => grip,
        assists: { steering: true, abs: options.abs ?? true, traction: true },
      });
      run(sim, { throttle: 0, brake: 0, steer: 0 }, 1);

      return {
        sim,
        slippery: (to: number) => {
          grip = to;
        },
      };
    };

    // The store starts full, with no room to harvest into: deploy most of it away, then
    // brake to the test speed.
    const drainedAt = (sim: VehicleSimulation, targetKmh: number) => {
      run(sim, { ...flatOut, deploy: true }, 15);
      while (kmh(sim) > targetKmh) {
        sim.step({ throttle: 0, brake: 1, steer: 0 });
      }

      const s = sim.snapshot().energy;
      expect(s?.socJ ?? Infinity).toBeLessThan(rules.socWindowJ * 0.8);
    };

    const downforceN = (v: number) => 0.5 * 1.225 * car.aero.downforceAreaM2 * v * v;
    const allTyresN = (grip: number, v: number) =>
      car.wheels.frictionCoefficient * grip * (car.massKg * 9.81 + downforceN(v));

    test("deployment", async () => {
      const { sim, slippery } = await onIce();
      timeBetween(sim, 0, 70, flatOut);
      slippery(0.15);
      let worst = 0;
      for (let k = 0; k < 30; k += 1) {
        sim.step({ ...flatOut, deploy: true });
        const s = sim.snapshot();
        worst = Math.max(worst, (s.energy?.deployW ?? 0) / (allTyresN(0.15, s.speedMps) * s.speedMps));
      }

      sim.dispose();
      expect(worst).toBeLessThanOrEqual(1);
    });

    test("lift-off harvesting", async () => {
      const { sim, slippery } = await onIce();
      drainedAt(sim, 70);
      sim.setEnergyMode("harvest");
      slippery(0.15);
      let worst = 0;
      for (let k = 0; k < 30; k += 1) {
        sim.step({ throttle: 0, brake: 0, steer: 0 });
        const s = sim.snapshot();
        worst = Math.max(worst, (s.energy?.regenW ?? 0) / (allTyresN(0.15, s.speedMps) * s.speedMps));
      }

      sim.dispose();
      expect(worst).toBeLessThanOrEqual(1);
    });

    // A locked tyre brakes at sliding grip. At 40 km/h downforce is a few per cent of
    // the weight, and braking moves load off the rear, so the rear's static share of the
    // weight at sliding grip bounds what it can harvest.
    test("a locked rear tyre with ABS off", async () => {
      const { sim, slippery } = await onIce({ abs: false });
      drainedAt(sim, 40);
      slippery(0.3);
      sim.step({ throttle: 0, brake: 1, steer: 0 });
      sim.step({ throttle: 0, brake: 1, steer: 0 });
      const s = sim.snapshot();
      expect(s.wheels[2]?.slip).toBe("locked");
      const rearShare = car.wheels.frontAxleZ / (car.wheels.frontAxleZ - car.wheels.rearAxleZ);
      const rearSlidingN =
        SLIDING_GRIP * car.wheels.frictionCoefficient * 0.3 * (rearShare * car.massKg * 9.81 + downforceN(s.speedMps));
      expect(s.energy?.regenW ?? 0).toBeLessThanOrEqual(rearSlidingN * s.speedMps);
      sim.dispose();
    });
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
      rules.modes.harvest.liftOffHarvestW * 2 * rules.regenEfficiency,
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
