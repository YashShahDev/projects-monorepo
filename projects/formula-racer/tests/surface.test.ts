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
  for (let t = 0; t < 10 && kmh(sim) > 1; t += sim.stepSeconds) {
    sim.step({ throttle: 0, brake: 1, steer: 0 });
  }

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
    expect(track.surfaceGrip.gravel).toBeLessThan(track.surfaceGrip.kerb);
    expect(() => parseTrack({ ...raw, surfaceGrip: { road: 1, kerb: 0.9, grass: 0.4 } })).toThrow(
      "track.surfaceGrip.gravel",
    );
    expect(() => parseTrack({ ...raw, surfaceGrip: { road: 1, kerb: 0.9, grass: 0 } })).toThrow(
      "track.surfaceGrip.grass",
    );
  });
});

describe("rolling resistance and barriers", () => {
  async function coast(dragN: number) {
    const sim = await createVehicleSimulation(car, {
      start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
      dragAt: () => dragN,
    });
    run(sim, { throttle: 0, brake: 0, steer: 0 }, 1);
    timeTo(sim, 100);
    run(sim, { throttle: 0, brake: 0, steer: 0 }, 2);
    const left = kmh(sim);
    sim.dispose();

    return left;
  }

  test("a draggy surface such as gravel slows a coasting car", async () => {
    // 1500 N per wheel is 0.76 g on the 800 kg car: from ~100 km/h, 2 s sheds ~55 km/h.
    const free = await coast(0);
    const gravel = await coast(1500);
    expect(free - gravel).toBeGreaterThan(40);
  });

  test("a barrier stops the car instead of letting it through", async () => {
    const sim = await createVehicleSimulation(car, {
      start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
      barriers: [
        {
          points: [
            { x: -20, z: 60 },
            { x: 20, z: 60 },
          ],
          closed: false,

          // Heading +x along the wall, the track (−z) is on its left: its outside is right.
          outside: "right",
        },
      ],
    });
    run(sim, { throttle: 1, brake: 0, steer: 0 }, 6);
    expect(sim.snapshot().position.z).toBeLessThan(60);
    sim.dispose();
  });
});

test("the car stops at the barrier's drawn face, not 0.3 m short of it", async () => {
  const sim = await createVehicleSimulation(car, {
    start: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 },
    barriers: [
      {
        points: [
          { x: -20, z: 30 },
          { x: 20, z: 30 },
        ],
        closed: false,
        outside: "right",
      },
    ],
  });
  run(sim, { throttle: 0.4, brake: 0, steer: 0 }, 8);

  // The chassis box's front (half-length 2.5 m) rests against the face at z = 30.
  const front = sim.snapshot().position.z + car.chassisHalfExtents.z;
  expect(front).toBeGreaterThan(29.9);
  expect(front).toBeLessThan(30.1);
  sim.dispose();
});

describe("surface grip in a session", () => {
  let sessions: DrivingSession[] = [];
  afterEach(() => {
    for (const s of sessions) {
      s.dispose();
    }

    sessions = [];
  });

  // Flat out from the grid, the car runs straight past turn 1 and into its gravel trap.
  async function flatOut(trackGravel: number) {
    const s = await createDrivingSession(car, {
      ...track,
      surfaceGrip: { ...track.surfaceGrip, gravel: trackGravel },
    });
    sessions.push(s);
    const held = { throttle: true, brake: false, left: false, right: false, deploy: false };
    let firstGravel: number | undefined;

    // 3 s standing-start countdown, then flat out past turn 1.
    for (let t = 0; t < 12; t += 1 / 60) {
      s.frame(1 / 60, held);
      if (firstGravel === undefined && s.state().surface === "gravel") {
        firstGravel = t;
      }
    }

    // Brake hard on whatever surface the car ended up on.
    const before = s.state().speedKmh;
    const brake = { ...held, throttle: false, brake: true };
    for (let t = 0; t < 1; t += 1 / 60) {
      s.frame(1 / 60, brake);
    }

    return { firstGravel, shed: before - s.state().speedKmh };
  }

  test("the session applies the track's gravel grip under the wheels", async () => {
    // At speed downforce gives even the shipped 0.5 gravel more grip than the brakes
    // can use, so braking would match the road; a near-ice value isolates the wiring
    // from track content to tyres. Gravel drag is the same in both runs.
    const ice = await flatOut(0.1);
    const asRoad = await flatOut(1);
    expect(ice.firstGravel).toBeDefined();
    expect(ice.shed).toBeLessThan(asRoad.shed * 0.5);
  });

  test("running straight on at turn 1 ends in the gravel, held by the barrier", async () => {
    const s = await createDrivingSession(car, track);
    sessions.push(s);
    const held = { throttle: true, brake: false, left: false, right: false, deploy: false };
    const surfaces = new Set<string>();
    let widest = 0;
    for (let t = 0; t < 16; t += 1 / 60) {
      s.frame(1 / 60, held);
      surfaces.add(s.state().surface);
      const { x, z } = s.snapshot().position;
      widest = Math.max(widest, Math.abs(s.geometry.locate(x, z).lateralM));
    }

    expect(surfaces).toContain("gravel");
    const location = s.geometry.locate(s.snapshot().position.x, s.snapshot().position.z);
    const edge = location.lateralM > 0 ? s.trackside.left : s.trackside.right;
    expect(widest).toBeLessThan((edge.barrierM[location.index] ?? 0) + 1);
  });
});
