import { afterEach, describe, expect, test } from "bun:test";
import type { TrackDefinition } from "../src/content/track.ts";
import { kerbMeshes } from "../src/simulation/kerbs.ts";
import type { Kerb, KerbMesh, KerbType } from "../src/simulation/kerbs.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { createVehicleSimulation, NO_CONTROLS } from "../src/simulation/vehicle.ts";
import type { DriverControls, VehicleSimulation, VehicleSnapshot } from "../src/simulation/vehicle.ts";
import { car, kmh, run } from "./support/vehicle.ts";

const sims: VehicleSimulation[] = [];
afterEach(() => {
  sims.splice(0).forEach((sim) => {
    sim.dispose();
  });
});

const open = async (start: { x: number; z: number; headingRad: number }, kerbs: readonly KerbMesh[]) => {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: start.x, y: 0, z: start.z }, headingRad: start.headingRad },
    kerbs,
  });
  sims.push(sim);

  return sim;
};

// A long, thin loop whose first side runs straight up +z along x = 0, so a kerb on its
// left lies in x ∈ [6, 6 + width] from z = 200 to 2600.
const straight = (() => {
  const definition: TrackDefinition = {
    version: 1,
    id: "straight",
    name: "Straight",
    widthM: 12,
    kerbWidthM: 1.5,

    // Points every 200 m keep the spline straight between the ends.
    controlPoints: [
      ...Array.from({ length: 18 }, (_, i) => ({ x: 0, z: -400 + i * 200 })),
      { x: -200, z: 3300 },
      ...Array.from({ length: 18 }, (_, i) => ({ x: -400, z: 3000 - i * 200 })),
      { x: -200, z: -700 },
    ],
    startDistanceM: 0,
    surfaceGrip: { road: 1, kerb: 1, grass: 1, gravel: 0.5 },
    activeAeroZones: [],
    setting: "circuit",
    lighting: "day",
  };

  return buildTrackGeometry(definition);
})();

const kerbAlong = (type: KerbType, widthM = 1.2): KerbMesh[] => {
  const heightM = { flat: 0.03, stepped: 0.05, sausage: 0.075 }[type];
  const kerb: Kerb = {
    side: "left",
    fromM: straight.locate(0, 200).distanceM,
    toM: straight.locate(0, 2600).distanceM,
    type,
    widthM,
    heightM,
  };

  return kerbMeshes(straight, [kerb]);
};

const upness = (s: VehicleSnapshot) => 1 - 2 * (s.rotation.x ** 2 + s.rotation.z ** 2);

describe("a car on a kerb", () => {
  test("rests higher by the kerb's height where all four wheels stand on it", async () => {
    const plateau: KerbMesh = {
      kerb: { side: "left", fromM: 0, toM: 10, type: "flat", widthM: 10, heightM: 0.05 },
      fromM: 0,
      toM: 10,
      positions: Float32Array.from([-5, 0.05, -5, 5, 0.05, -5, 5, 0.05, 5, -5, 0.05, 5]),
      columns: 2,
      indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
      x: 0,
      z: 0,
      radiusM: 7.1,
    };
    const onRoad = await open({ x: 0, z: 0, headingRad: 0 }, []);
    const onKerb = await open({ x: 0, z: 0, headingRad: 0 }, [plateau]);
    run(onRoad, NO_CONTROLS, 2);
    run(onKerb, NO_CONTROLS, 2);
    expect(onKerb.snapshot().position.y - onRoad.snapshot().position.y).toBeCloseTo(0.05, 2);
    for (const wheel of onKerb.snapshot().wheels) {
      expect(wheel.contact?.y).toBeCloseTo(0.05, 3);
    }
  });
});

describe("crossing a kerb", () => {
  /**
   * Runs `approach` from rest on flat ground to find where the car reaches the speed,
   * then starts over, placed so that is where its front wheels meet the kerb's edge.
   */
  const cross = async (
    type: KerbType,
    targetKmh: number,
    angleDeg: number,
    approach: DriverControls,
    over: DriverControls,
  ) => {
    const angle = (angleDeg * Math.PI) / 180;
    const probe = await open({ x: 0, z: 0, headingRad: angle }, []);
    for (let t = 0; kmh(probe) < targetKmh; t += probe.stepSeconds) {
      if (t > 60) {
        throw new Error(`never reached ${String(targetKmh)} km/h`);
      }

      probe.step(approach);
    }

    const reached = probe.snapshot().position;
    const nose = car.wheels.frontAxleZ + 0.4;
    const sim = await open(
      {
        x: 6 - reached.x - nose * Math.sin(angle) - 0.3,
        z: 1400 - reached.z,
        headingRad: angle,
      },
      kerbAlong(type),
    );
    let speed = 0;
    for (let t = 0; kmh(sim) < targetKmh && t < 60; t += sim.stepSeconds) {
      sim.step(approach);
      speed = kmh(sim);
    }

    let touched = 0;
    let lowestUp = 1;
    let riseM = 0;
    const rideY = sim.snapshot().position.y;
    let airborne = 0;
    let airborneS = 0;
    const entry = speed;
    for (let t = 0; t < 3; t += sim.stepSeconds) {
      sim.step(over);
      const s = sim.snapshot();
      if (s.wheels.some((w) => (w.contact?.y ?? 0) > 0.005)) {
        touched += 1;
      }

      lowestUp = Math.min(lowestUp, upness(s));
      riseM = Math.max(riseM, s.position.y - rideY);
      airborne = s.wheels.every((w) => !w.inContact) ? airborne + sim.stepSeconds : 0;
      airborneS = Math.max(airborneS, airborne);
    }

    return { touched, lowestUp, riseM, airborneS, entry, exit: kmh(sim) };
  };

  const full: DriverControls = { throttle: 1, brake: 0, steer: 0 };
  const braking: DriverControls = { throttle: 0, brake: 1, steer: 0 };

  for (const type of ["flat", "stepped", "sausage"] as const) {
    for (const speedKmh of [50, 150, 250]) {
      for (const angleDeg of [5, 20, 45]) {
        test(`a ${type} kerb at ${String(speedKmh)} km/h and ${String(angleDeg)}° is felt but stays safe`, async () => {
          const result = await cross(type, speedKmh, angleDeg, full, full);
          expect(result.touched).toBeGreaterThan(0);
          expect(result.lowestUp).toBeGreaterThan(Math.cos((16 * Math.PI) / 180));
          expect(result.exit).toBeGreaterThan(result.entry * 0.9);
          if (type === "sausage") {
            // A sausage is there to upset a car that cuts across it, but never to launch it.
            expect(result.riseM).toBeLessThan(car.wheels.radius);
            expect(result.airborneS).toBeLessThanOrEqual(0.1);
          } else {
            expect(result.riseM).toBeLessThan(car.wheels.maxSuspensionTravel + { flat: 0.03, stepped: 0.05 }[type]);
            expect(result.airborneS).toBe(0);
          }
        }, 60_000);
      }
    }
  }

  test("braking hard across a sausage kerb stays upright and is not launched", async () => {
    const result = await cross("sausage", 200, 20, full, braking);
    expect(result.touched).toBeGreaterThan(0);
    expect(result.lowestUp).toBeGreaterThan(Math.cos((16 * Math.PI) / 180));
    expect(result.riseM).toBeLessThan(car.wheels.radius);
    expect(result.airborneS).toBeLessThanOrEqual(0.1);
    expect(result.exit).toBeLessThan(result.entry);
  }, 60_000);

  test("reversing over a stepped kerb climbs it too", async () => {
    const sim = await open({ x: 6 + 1.2 + 2.2, z: 1400, headingRad: Math.PI / 2 }, kerbAlong("stepped"));
    run(sim, NO_CONTROLS, 0.5);
    sim.step({ ...NO_CONTROLS, shift: "down" });
    let touched = 0;
    let lowestUp = 1;
    for (let t = 0; t < 4; t += sim.stepSeconds) {
      sim.step({ throttle: 0.4, brake: 0, steer: 0 });
      const s = sim.snapshot();
      touched += s.wheels.some((w) => (w.contact?.y ?? 0) > 0.005) ? 1 : 0;
      lowestUp = Math.min(lowestUp, upness(s));
    }

    expect(sim.snapshot().gear).toBe(-1);
    expect(sim.snapshot().position.x).toBeLessThan(6);
    expect(touched).toBeGreaterThan(0);
    expect(lowestUp).toBeGreaterThan(0.97);
  }, 60_000);
});

describe("the kerbs near the car", () => {
  test("are the only ones made solid, and a reset brings back the ones at the start", async () => {
    const meshes = kerbAlong("flat");
    const sim = await open({ x: 5, z: 300, headingRad: 0 }, meshes);
    const near = sim.kerbColliders();
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(meshes.length / 10);
    run(sim, { throttle: 1, brake: 0, steer: 0 }, 12);
    expect(sim.snapshot().position.z).toBeGreaterThan(600);
    sim.reset();
    sim.step(NO_CONTROLS);
    expect(sim.kerbColliders()).toBe(near);
  }, 60_000);
});
