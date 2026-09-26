import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDrivingSession } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { parseTrack } from "../src/content/track.ts";
import { createVehicleSimulation } from "../src/simulation/vehicle.ts";
import { car, kmh, run, timeTo } from "./support/vehicle.ts";

const raw = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"),
) as Record<string, unknown>;
const track = parseTrack(raw);

async function stoppingDistance(grip: number) {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
    gripAt: () => grip,
  });
  run(sim, { throttle: 0, brake: 0, steer: 0 }, 1);
  timeTo(sim, 150);
  const start = sim.snapshot().position.z;
  for (let t = 0; t < 10 && kmh(sim) > 1; t += sim.stepSeconds)
    sim.step({ throttle: 0, brake: 1, steer: 0 });
  const distance = sim.snapshot().position.z - start;
  sim.dispose();
  return distance;
}

describe("surface grip", () => {
  test("low grip under the wheels lengthens braking", async () => {
    expect(await stoppingDistance(0.45)).toBeGreaterThan((await stoppingDistance(1)) * 1.6);
  });

  test("track content carries a grip multiplier per surface", () => {
    expect(track.surfaceGrip.road).toBe(1);
    expect(track.surfaceGrip.grass).toBeLessThan(track.surfaceGrip.kerb);
    expect(() => parseTrack({ ...raw, surfaceGrip: { road: 1, kerb: 0.9, grass: 0 } })).toThrow(
      "track.surfaceGrip.grass",
    );
  });
});

describe("surface grip in a session", () => {
  let sessions: DrivingSession[] = [];
  afterEach(() => {
    for (const s of sessions) s.dispose();
    sessions = [];
  });

  // Flat out from the grid, the car runs straight past turn 1 and onto the grass.
  async function flatOut(trackGrass: number) {
    const s = await createDrivingSession(car, {
      ...track,
      surfaceGrip: { ...track.surfaceGrip, grass: trackGrass },
    });
    sessions.push(s);
    const held = { throttle: true, brake: false, left: false, right: false, deploy: false };
    let firstGrass: number | undefined;
    // 3 s standing-start countdown, then flat out past turn 1.
    for (let t = 0; t < 12; t += 1 / 60) {
      s.frame(1 / 60, held);
      if (firstGrass === undefined && s.state().surface === "grass") firstGrass = t;
    }
    // Brake hard on whatever surface the car ended up on.
    const before = s.state().speedKmh;
    const brake = { ...held, throttle: false, brake: true };
    for (let t = 0; t < 1; t += 1 / 60) s.frame(1 / 60, brake);
    return { firstGrass, shed: before - s.state().speedKmh };
  }

  test("the session applies the track's grass grip under the wheels", async () => {
    // At ~300 km/h downforce gives even the shipped 0.45 grass more grip than the
    // brakes can use, so braking would match the road; a near-ice value isolates the
    // wiring from track content to tyres.
    const ice = await flatOut(0.1);
    const asRoad = await flatOut(1);
    expect(ice.firstGrass).toBeDefined();
    expect(ice.shed).toBeLessThan(asRoad.shed * 0.5);
  });
});
