import { afterEach, describe, expect, test } from "bun:test";
import { createDrivingSession } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { parseCar } from "../src/content/car.ts";
import { parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { NO_CONTROLS } from "../src/simulation/vehicle.ts";
import { readJsonObject } from "./support/json.ts";
import { car, kmh, run, settledVehicle, timeTo } from "./support/vehicle.ts";

const raw = readJsonObject("public/assets/tracks/harbour.json");
const track = parseTrack(raw);
const geometry = buildTrackGeometry(track);

describe("active aero content", () => {
  test("Harbour Park's zones lie on its two long straights", () => {
    expect(track.activeAeroZones.length).toBe(2);
    for (const zone of track.activeAeroZones) {
      for (let d = zone.startM; d <= zone.endM; d += geometry.spacingM) {
        const i = Math.floor(d / geometry.spacingM) % geometry.count;
        expect(Math.abs(geometry.curvature[i] ?? 0)).toBeLessThan(1 / 1000);
      }
    }
  });

  test("a zone must end after it starts", () => {
    expect(() => parseTrack({ ...raw, activeAeroZones: [{ startM: 500, endM: 400 }] })).toThrow(
      "track.activeAeroZones[0].endM",
    );
  });

  test("Straight Mode must shed drag", () => {
    expect(() =>
      parseCar({
        ...car,
        aero: { ...car.aero, straightMode: { dragAreaM2: 2, downforceAreaM2: 1 } },
      }),
    ).toThrow("car.aero.straightMode.dragAreaM2");
  });
});

describe("active aero in the vehicle", () => {
  test("Straight Mode cuts drag, so a coasting car keeps more speed", async () => {
    const coast = async (straight: boolean) => {
      const sim = await settledVehicle();
      timeTo(sim, 250);
      if (straight) {
        sim.setWingMode("straight");
      }

      run(sim, NO_CONTROLS, 3);
      const v = kmh(sim);
      sim.dispose();

      return v;
    };

    expect(await coast(true)).toBeGreaterThan((await coast(false)) + 5);
  });

  test("the wings take 400 ms to move", async () => {
    const sim = await settledVehicle();
    sim.setWingMode("straight");
    run(sim, NO_CONTROLS, 0.2);
    expect(sim.snapshot().wing.opening).toBeCloseTo(0.5, 1);
    run(sim, NO_CONTROLS, 0.25);
    expect(sim.snapshot().wing.opening).toBe(1);
  });

  test("braking returns the wings to Corner Mode", async () => {
    const sim = await settledVehicle();
    sim.setWingMode("straight");
    run(sim, NO_CONTROLS, 0.5);
    run(sim, { throttle: 0, brake: 1, steer: 0 }, 0.5);
    expect(sim.snapshot().wing).toEqual({ mode: "corner", opening: 0 });
  });
});

describe("active aero in a session", () => {
  let session: DrivingSession | undefined;
  afterEach(() => session?.dispose());
  const idle = { throttle: false, brake: false, left: false, right: false, deploy: false };

  test("opens in a zone on throttle and closes under braking", async () => {
    session = await createDrivingSession(car, track);
    for (let t = 0; t < 3; t += 1 / 60) {
      session.frame(1 / 60, idle);
    }

    // From the grid at 150 m the car is inside the main-straight zone.
    for (let t = 0; t < 1; t += 1 / 60) {
      session.frame(1 / 60, { ...idle, throttle: true });
    }

    expect(session.state().wing.mode).toBe("straight");
    for (let t = 0; t < 0.5; t += 1 / 60) {
      session.frame(1 / 60, { ...idle, brake: true });
    }

    expect(session.state().wing.mode).toBe("corner");
  });

  test("stays closed outside a zone", async () => {
    session = await createDrivingSession(car, { ...track, activeAeroZones: [] });
    for (let t = 0; t < 3; t += 1 / 60) {
      session.frame(1 / 60, idle);
    }

    for (let t = 0; t < 1; t += 1 / 60) {
      session.frame(1 / 60, { ...idle, throttle: true });
    }

    expect(session.state().wing.mode).toBe("corner");
  });
});
