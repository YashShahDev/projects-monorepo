import { describe, expect, test } from "bun:test";
import type { DriverAssists, DriverControls, VehicleSnapshot } from "../src/simulation/vehicle.ts";
import { car, settledVehicle, timeTo } from "./support/vehicle.ts";

const NONE: DriverAssists = { steering: false, abs: false, traction: false };

const yaw = (s: VehicleSnapshot) => 2 * Math.atan2(s.rotation.y, s.rotation.w);

/**
 * Slip angle at the rear axle, degrees. Unsteered rear wheels that grip roll along the
 * heading, so this stays near zero until the rear starts to slide.
 */
function rearSlipDeg(s: VehicleSnapshot): number {
  const h = yaw(s);
  const v = s.linearVelocity;
  const along = v.x * Math.sin(h) + v.z * Math.cos(h);
  const left = v.x * Math.cos(h) - v.z * Math.sin(h) + s.angularVelocity.y * car.wheels.rearAxleZ;

  return Math.abs((Math.atan2(left, Math.abs(along)) * 180) / Math.PI);
}

/** Angle between where the car points and where it travels, degrees. */
function sideslipDeg(s: VehicleSnapshot): number {
  const v = s.linearVelocity;
  let d = Math.atan2(v.x, v.z) - yaw(s);
  while (d > Math.PI) {
    d -= 2 * Math.PI;
  }

  while (d < -Math.PI) {
    d += 2 * Math.PI;
  }

  return Math.abs((d * 180) / Math.PI);
}

interface Manoeuvre {
  fromKmh: number;

  /** Held after reaching `fromKmh` and before `controls`, to settle into a corner. */
  settle?: DriverControls;
  controls: DriverControls;
  seconds: number;
  frictionCoefficient?: number;
}

async function drive(assists: DriverAssists, m: Manoeuvre) {
  const mu = m.frictionCoefficient ?? car.wheels.frictionCoefficient;
  const sim = await settledVehicle({ ...car, wheels: { ...car.wheels, frictionCoefficient: mu } });
  sim.setAssists(NONE);
  timeTo(sim, m.fromKmh, 60);
  for (let t = 0; m.settle && t < 1; t += sim.stepSeconds) {
    sim.step(m.settle);
  }

  sim.setAssists(assists);
  const start = sim.snapshot();
  let maxSideslipDeg = 0;
  let maxRearSlipDeg = 0;
  for (let t = 0; t < m.seconds; t += sim.stepSeconds) {
    sim.step(m.controls);
    const s = sim.snapshot();
    if (s.speedMps < 3) {
      continue;
    }

    maxSideslipDeg = Math.max(maxSideslipDeg, sideslipDeg(s));
    maxRearSlipDeg = Math.max(maxRearSlipDeg, rearSlipDeg(s));
  }

  const end = sim.snapshot();
  sim.dispose();

  return {
    maxSideslipDeg,
    maxRearSlipDeg,
    turnedDeg: Math.abs(((yaw(end) - yaw(start)) * 180) / Math.PI),
    endKmh: end.speedMps * 3.6,
    distanceM: Math.hypot(end.position.x - start.position.x, end.position.z - start.position.z),
  };
}

// Braking hard with half lock below the speeds where downforce steadies the rear.
const trailBraking: Manoeuvre = {
  fromKmh: 120,
  controls: { throttle: 0, brake: 1, steer: 0.5 },
  seconds: 1.5,
};

describe("brake assist (ABS)", () => {
  test("braking hard while turning, keeps the car turning with the rear planted", async () => {
    const off = await drive(NONE, trailBraking);
    const on = await drive({ ...NONE, abs: true }, trailBraking);

    // Without ABS every wheel locks and the car ploughs straight on.
    expect(on.turnedDeg).toBeGreaterThan(off.turnedDeg * 3);
    expect(on.maxSideslipDeg).toBeLessThan(4);
  });

  test("costs little straight-line stopping distance", async () => {
    const stop = { fromKmh: 200, controls: { throttle: 0, brake: 1, steer: 0 }, seconds: 4 };
    const off = await drive(NONE, stop);
    const on = await drive({ ...NONE, abs: true }, stop);
    expect(Math.abs(on.endKmh)).toBeLessThan(1);
    expect(on.distanceM).toBeLessThan(off.distanceM * 1.15);
  });
});

describe("traction control", () => {
  // Low grip, as on grass or a cold track, is where flooring it can slide the rear.
  const powerOut: Manoeuvre = {
    fromKmh: 20,
    settle: { throttle: 0.15, brake: 0, steer: 0.5 },
    controls: { throttle: 1, brake: 0, steer: 0.5 },
    seconds: 1.5,
    frictionCoefficient: 0.5,
  };

  test("stops the rear sliding when flooring it out of a slow corner", async () => {
    const off = await drive(NONE, powerOut);
    const on = await drive({ ...NONE, traction: true }, powerOut);
    expect(off.maxRearSlipDeg).toBeGreaterThan(4);
    expect(on.maxRearSlipDeg).toBeLessThan(2);
  });
});

describe("steering assist", () => {
  const flatOut: Manoeuvre = {
    fromKmh: 250,
    controls: { throttle: 0, brake: 0, steer: 1 },
    seconds: 1.5,
  };

  test("full lock at high speed turns more and scrubs less speed than unassisted", async () => {
    const off = await drive(NONE, flatOut);
    const on = await drive({ ...NONE, steering: true }, flatOut);

    // Unassisted full lock saturates the front tyres: about 20° turned, 237 km/h left.
    expect(on.turnedDeg).toBeGreaterThan(off.turnedDeg + 3);
    expect(on.endKmh).toBeGreaterThan(off.endKmh + 5);
  });

  test("leaves full lock available at low speed", async () => {
    const sim = await settledVehicle();
    sim.setAssists({ ...NONE, steering: true });
    sim.step({ throttle: 0, brake: 0, steer: 1 });
    expect(Math.abs(sim.snapshot().wheels[0]?.steerRad ?? 0)).toBeCloseTo(car.steering.maxAngleRad, 5);
    sim.dispose();
  });
});
