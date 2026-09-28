/**
 * Prints the car's measured driving envelope: acceleration, braking, top speed,
 * steady cornering g, left/right symmetry and sideslip under power. Run with
 * `bun run tools/characterize.ts`. The numbers set P6-C5's physics targets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCar } from "../src/content/car.ts";
import { parseEnergyRules } from "../src/content/energy-rules.ts";
import { createVehicleSimulation, NO_CONTROLS } from "../src/simulation/vehicle.ts";
import type { DriverAssists, DriverControls, VehicleSimulation } from "../src/simulation/vehicle.ts";

const root = resolve(import.meta.dirname, "..");
const car = parseCar(JSON.parse(readFileSync(resolve(root, "public/assets/cars/fr26.json"), "utf8")));
const energy = parseEnergyRules(
  JSON.parse(readFileSync(resolve(root, "public/assets/rules/energy-2026-c18.json"), "utf8")),
);

const ON: DriverAssists = { steering: true, abs: true, traction: true };
const OFF: DriverAssists = { steering: false, abs: false, traction: false };

async function vehicle(grip: number, assists: DriverAssists, withEnergy = true): Promise<VehicleSimulation> {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
    groundHalfExtentM: 20_000,
    assists,
    gripAt: () => grip,
    ...(withEnergy ? { energy } : {}),
  });
  for (let i = 0; i < 60; i += 1) {
    sim.step(NO_CONTROLS);
  }

  return sim;
}

const kmh = (sim: VehicleSimulation) => sim.snapshot().speedMps * 3.6;
const heading = (sim: VehicleSimulation) => {
  const q = sim.snapshot().rotation;

  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
};

function accelerate(sim: VehicleSimulation, target: number, limit = 60): number {
  let t = 0;
  while (kmh(sim) < target && t < limit) {
    sim.step({ throttle: 1, brake: 0, steer: 0 });
    t += sim.stepSeconds;
  }

  return t;
}

/** Holds a speed with a simple throttle/brake controller while applying `steer`. */
function hold(sim: VehicleSimulation, targetKmh: number, steer: number, seconds: number): void {
  for (let t = 0; t < seconds; t += sim.stepSeconds) {
    const err = targetKmh - kmh(sim);
    const c: DriverControls = {
      throttle: Math.max(0, Math.min(1, err * 0.2)),
      brake: Math.max(0, Math.min(1, -err * 0.1)),
      steer,
    };
    sim.step(c);
  }
}

function lateralG(sim: VehicleSimulation): number {
  const s = sim.snapshot();
  const v = Math.hypot(s.linearVelocity.x, s.linearVelocity.z);

  return (v * Math.abs(s.angularVelocity.y)) / 9.81;
}

/** Sideslip: angle between the velocity and the chassis heading, degrees. */
function sideslipDeg(sim: VehicleSimulation): number {
  const s = sim.snapshot();
  const h = heading(sim);
  const vx = s.linearVelocity.x,
    vz = s.linearVelocity.z;
  if (Math.hypot(vx, vz) < 1) {
    return 0;
  }

  const along = vx * Math.sin(h) + vz * Math.cos(h);
  const across = vx * Math.cos(h) - vz * Math.sin(h);

  return (Math.atan2(across, along) * 180) / Math.PI;
}

const out: Record<string, string> = {};
for (const grip of [1, 0.5]) {
  for (const [name, assists] of [
    ["assists on", ON],
    ["assists off", OFF],
  ] as const) {
    const tag = `grip ${grip}, ${name}`;
    let sim = await vehicle(grip, assists);
    const t100 = accelerate(sim, 100);
    const t200 = t100 + accelerate(sim, 200);
    const t300 = t200 + accelerate(sim, 300, 60);
    out[`${tag}: 0-100 / 0-200 / 0-300 s`] = [t100, t200, t300].map((t) => t.toFixed(2)).join(" / ");
    sim.dispose();

    for (const from of [100, 200]) {
      sim = await vehicle(grip, assists);
      accelerate(sim, from);
      const p0 = sim.snapshot().position;
      const h0 = heading(sim);
      let t = 0;
      while (kmh(sim) > 1 && t < 20) {
        sim.step({ throttle: 0, brake: 1, steer: 0 });
        t += sim.stepSeconds;
      }

      const p1 = sim.snapshot().position;
      const drift = ((heading(sim) - h0) * 180) / Math.PI;
      out[`${tag}: ${from}-0 m / s / heading°`] =
        `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} / ${t.toFixed(2)} / ${drift.toFixed(2)}`;
      sim.dispose();
    }

    for (const speed of [100, 200]) {
      const g: number[] = [];
      for (const dir of [1, -1]) {
        let best = 0;
        for (const steer of [0.05, 0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 0.8, 1]) {
          sim = await vehicle(grip, assists, false);
          accelerate(sim, speed);
          hold(sim, speed, dir * steer, 3);
          if (Math.abs(kmh(sim) - speed) < speed * 0.1) {
            best = Math.max(best, lateralG(sim));
          }

          sim.dispose();
        }

        g.push(best);
      }

      out[`${tag}: max steady lateral g at ${speed} (right / left)`] = g.map((x) => x.toFixed(2)).join(" / ");
    }

    // Power oversteer: turn at 60 km/h, then floor it.
    sim = await vehicle(grip, assists);
    accelerate(sim, 60);
    hold(sim, 60, 0.4, 1.5);
    let worst = 0;
    for (let t = 0; t < 1.5; t += sim.stepSeconds) {
      sim.step({ throttle: 1, brake: 0, steer: 0.4 });
      worst = Math.max(worst, Math.abs(sideslipDeg(sim)));
    }

    out[`${tag}: peak sideslip° flooring out of a 60 km/h turn`] = worst.toFixed(1);
    sim.dispose();
  }
}

{
  const sim = await vehicle(1, ON);
  sim.setWingMode("straight");
  accelerate(sim, 999, 60);
  out["top speed km/h (Straight Mode, 60 s)"] = kmh(sim).toFixed(1);
  sim.dispose();
}

for (const [k, v] of Object.entries(out)) {
  console.log(`${k.padEnd(60)} ${v}`);
}
