import RAPIER from "@dimforge/rapier3d-compat";
import type { CarDefinition } from "../content/car.ts";
import type { Vec3 } from "../content/validate.ts";
import { initPhysics } from "./physics.ts";
import { createPowertrain } from "./powertrain.ts";
import type { Pose, Quat } from "./physics.ts";
import { PHYSICS_VERSION } from "./version.ts";

/** Normalized driver requests. `steer` is -1 (full left) to +1 (full right). */
export interface DriverControls {
  throttle: number;
  brake: number;
  steer: number;
}

export const NO_CONTROLS: Readonly<DriverControls> = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
});

/** Driver aids; each can be toggled independently and is recorded with lap times. */
export interface DriverAssists {
  steering: boolean;
  abs: boolean;
  traction: boolean;
}

export const ALL_ASSISTS: Readonly<DriverAssists> = Object.freeze({
  steering: true,
  abs: true,
  traction: true,
});

export interface WheelState {
  /** Metres from the chassis connection point along the suspension direction. */
  suspensionLength: number;
  steerRad: number;
  spinRad: number;
  inContact: boolean;
}

export interface VehicleSnapshot {
  physicsVersion: string;
  simSeconds: number;
  position: Vec3;
  rotation: Quat;
  linearVelocity: Vec3;
  /** Radians per second in world axes; +y turns toward +x (the driver's left). */
  angularVelocity: Vec3;
  /** Signed speed along the chassis forward axis, m/s. */
  speedMps: number;
  /** Order: front-left, front-right, rear-left, rear-right. */
  wheels: WheelState[];
  applied: DriverControls;
  gear: number;
  rpm: number;
  assists: DriverAssists;
}

export interface StartPose {
  position: Vec3;
  /** Radians about +y; 0 faces +z. */
  headingRad: number;
}

export interface VehicleSimulation {
  readonly stepSeconds: number;
  readonly car: CarDefinition;
  step(controls: DriverControls): void;
  setAssists(assists: DriverAssists): void;
  reset(): void;
  snapshot(): VehicleSnapshot;
  dispose(): void;
}

export interface VehicleOptions {
  start: StartPose;
  /** Half-size of the flat ground collider; the ground's top is y = 0. */
  groundHalfExtentM?: number;
  /** Defaults to every assist on. */
  assists?: DriverAssists;
  /** Multiplier on tyre friction for the surface at a ground position; default 1. */
  gripAt?: (x: number, z: number, wheel: number) => number;
}

// Share of the tyre's grip budget the assists allow before intervening.
const ASSIST_GRIP_MARGIN = 0.9;
// Front slip angle at peak cornering force, measured from fixed-lock sweeps at
// 100–250 km/h with the shipped tyre settings.
const PEAK_SLIP_RAD = 0.015;
const GRAVITY = 9.81;
const AIR_DENSITY_KG_M3 = 1.225;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function headingQuat(headingRad: number): Quat {
  return { x: 0, y: Math.sin(headingRad / 2), z: 0, w: Math.cos(headingRad / 2) };
}

export async function createVehicleSimulation(
  car: CarDefinition,
  options: VehicleOptions,
): Promise<VehicleSimulation> {
  await initPhysics();
  return buildVehicleSimulation(car, options);
}

/** Synchronous construction for callers that have already awaited `initPhysics()`. */
export function buildVehicleSimulation(
  car: CarDefinition,
  options: VehicleOptions,
): VehicleSimulation {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const stepSeconds = world.timestep;
  const ground = options.groundHalfExtentM ?? 3000;
  world.createCollider(RAPIER.ColliderDesc.cuboid(ground, 1, ground).setTranslation(0, -1, 0));

  const w = car.wheels;
  const rideHeight = w.suspensionRestLength + w.radius - w.connectionY;
  const startPosition = { ...options.start.position, y: options.start.position.y + rideHeight };
  const startRotation = headingQuat(options.start.headingRad);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(startPosition.x, startPosition.y, startPosition.z)
      .setRotation(startRotation)
      .setCanSleep(false)
      .setAdditionalMassProperties(car.massKg, car.centerOfMass, car.inertiaKgM2, {
        x: 0,
        y: 0,
        z: 0,
        w: 1,
      }),
  );
  const half = car.chassisHalfExtents;
  // Mass comes from the body's explicit properties so the collider shape can change freely.
  world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(0), body);

  const vehicle = world.createVehicleController(body);
  vehicle.indexUpAxis = 1;
  // Rapier 0.21 names this setter `setIndexForwardAxis` (a property, not a method).
  vehicle.setIndexForwardAxis = 2;
  const wheelPoints: Vec3[] = [
    { x: w.halfTrack, y: w.connectionY, z: w.frontAxleZ },
    { x: -w.halfTrack, y: w.connectionY, z: w.frontAxleZ },
    { x: w.halfTrack, y: w.connectionY, z: w.rearAxleZ },
    { x: -w.halfTrack, y: w.connectionY, z: w.rearAxleZ },
  ];
  wheelPoints.forEach((point, i) => {
    vehicle.addWheel(
      point,
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      w.suspensionRestLength,
      w.radius,
    );
    vehicle.setWheelMaxSuspensionTravel(i, w.maxSuspensionTravel);
    vehicle.setWheelSuspensionStiffness(i, w.suspensionStiffness);
    vehicle.setWheelSuspensionCompression(i, w.suspensionCompression);
    vehicle.setWheelSuspensionRelaxation(i, w.suspensionRelaxation);
    vehicle.setWheelMaxSuspensionForce(i, w.maxSuspensionForceN);
    vehicle.setWheelFrictionSlip(i, w.frictionCoefficient);
    vehicle.setWheelSideFrictionStiffness(i, w.sideFrictionStiffness);
  });

  let simSeconds = 0;
  let applied: DriverControls = { ...NO_CONTROLS };
  const powertrain = createPowertrain(car.powertrain);
  let drivetrain = powertrain.update(0, 0, stepSeconds);
  let assists: DriverAssists = { ...(options.assists ?? ALL_ASSISTS) };
  let disposed = false;
  // Longitudinal force a wheel can add before it slides, from the last step's load and
  // cornering force. Rapier halves the forward impulse in its friction-circle test
  // (Bullet's fwdFactor), so its longitudinal budget is twice the lateral one.
  const surfaceGrip = [1, 1, 1, 1];
  const longitudinalBudgetN = (i: number): number => {
    const mu = w.frictionCoefficient * (surfaceGrip[i] ?? 1);
    const grip = ASSIST_GRIP_MARGIN * mu * (vehicle.wheelSuspensionForce(i) ?? 0);
    const side = (vehicle.wheelSideImpulse(i) ?? 0) / stepSeconds;
    return 2 * Math.sqrt(Math.max(0, grip * grip - side * side));
  };
  const assertLive = (): void => {
    if (disposed) throw new Error("vehicle simulation used after dispose()");
  };

  const localPoint = (x: number, y: number, z: number) => {
    const r = body.rotation();
    const t = body.translation();
    // Rotate by the chassis quaternion: v' = v + 2w(q×v) + 2q×(q×v).
    const cx = r.y * z - r.z * y;
    const cy = r.z * x - r.x * z;
    const cz = r.x * y - r.y * x;
    return {
      x: t.x + x + 2 * (r.w * cx + r.y * cz - r.z * cy),
      y: t.y + y + 2 * (r.w * cy + r.z * cx - r.x * cz),
      z: t.z + z + 2 * (r.w * cz + r.x * cy - r.y * cx),
    };
  };
  // Drag opposes the velocity; downforce presses along the chassis's down axis at each
  // axle, so it moves with pitch and roll and loads the tyres the vehicle controller reads.
  const applyAero = (dynamicPressure: number, downforceN: number): void => {
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > 1e-3) {
      const drag = (dynamicPressure * car.aero.dragAreaM2 * stepSeconds) / speed;
      body.applyImpulse({ x: -v.x * drag, y: -v.y * drag, z: -v.z * drag }, true);
    }
    if (downforceN <= 0) return;
    const origin = localPoint(0, 0, 0);
    const below = localPoint(0, -1, 0);
    const down = { x: below.x - origin.x, y: below.y - origin.y, z: below.z - origin.z };
    const shares: [number, number][] = [
      [w.frontAxleZ, car.aero.frontShare],
      [w.rearAxleZ, 1 - car.aero.frontShare],
    ];
    for (const [axleZ, share] of shares) {
      const impulse = downforceN * share * stepSeconds;
      body.applyImpulseAtPoint(
        { x: down.x * impulse, y: down.y * impulse, z: down.z * impulse },
        localPoint(0, w.connectionY, axleZ),
        true,
      );
    }
  };

  return {
    stepSeconds,
    car,
    step(controls) {
      assertLive();
      applied = {
        throttle: clamp(controls.throttle, 0, 1),
        brake: clamp(controls.brake, 0, 1),
        steer: clamp(controls.steer, -1, 1),
      };
      const speed = Math.abs(vehicle.currentVehicleSpeed());
      drivetrain = powertrain.update(applied.throttle, speed, stepSeconds);
      const drive = drivetrain.driveForceN;
      if (options.gripAt) {
        for (let i = 0; i < 4; i += 1) {
          const p = wheelPoints[i] ?? { x: 0, y: 0, z: 0 };
          const at = localPoint(p.x, p.y, p.z);
          surfaceGrip[i] = options.gripAt(at.x, at.z, i);
          vehicle.setWheelFrictionSlip(i, w.frictionCoefficient * (surfaceGrip[i] ?? 1));
        }
      }
      const a = car.aero;
      const dynamicPressure = 0.5 * AIR_DENSITY_KG_M3 * speed * speed;
      const downforceN = dynamicPressure * a.downforceAreaM2;
      let steerRad = -applied.steer * car.steering.maxAngleRad;
      if (assists.steering) {
        // Past the angle that already uses all the front grip, extra lock only scrubs
        // speed, so cap it at the kinematic angle for a limit corner plus peak slip.
        const wheelbase = w.frontAxleZ - w.rearAxleZ;
        const frontGrip = ((surfaceGrip[0] ?? 1) + (surfaceGrip[1] ?? 1)) / 2;
        const gripAccel = w.frictionCoefficient * frontGrip * (GRAVITY + downforceN / car.massKg);
        const limitRad = (wheelbase * gripAccel) / Math.max(speed * speed, 1) + PEAK_SLIP_RAD;
        steerRad = clamp(steerRad, -limitRad, limitRad);
      }
      const b = car.brakes;
      const brakeN = applied.brake * b.maxForceN;
      for (let i = 0; i < 4; i += 1) {
        const front = i < 2;
        vehicle.setWheelSteering(i, front ? steerRad : 0);
        // Rapier ignores a wheel's brake while it has engine force, so braking cuts drive.
        let engine = !front && brakeN === 0 ? drive / 2 : 0;
        if (assists.traction) engine = Math.min(engine, longitudinalBudgetN(i));
        vehicle.setWheelEngineForce(i, engine);
        const share = front ? b.frontBias : 1 - b.frontBias;
        let wheelBrakeN = (brakeN * share) / 2;
        if (assists.abs) wheelBrakeN = Math.min(wheelBrakeN, longitudinalBudgetN(i));
        // Rapier treats `brake` as the maximum rolling-friction impulse for this step.
        vehicle.setWheelBrake(i, wheelBrakeN * stepSeconds);
      }
      vehicle.updateVehicle(stepSeconds);
      applyAero(dynamicPressure, downforceN);
      world.step();
      simSeconds += stepSeconds;
    },
    setAssists(next) {
      assists = { ...next };
    },
    reset() {
      assertLive();
      body.setTranslation(startPosition, true);
      body.setRotation(startRotation, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
      applied = { ...NO_CONTROLS };
      powertrain.reset();
      drivetrain = powertrain.update(0, 0, stepSeconds);
    },
    snapshot() {
      assertLive();
      const { x, y, z } = body.translation();
      const r = body.rotation();
      const v = body.linvel();
      const omega = body.angvel();
      const wheels: WheelState[] = [0, 1, 2, 3].map((i) => ({
        suspensionLength: vehicle.wheelSuspensionLength(i) ?? w.suspensionRestLength,
        steerRad: vehicle.wheelSteering(i) ?? 0,
        spinRad: vehicle.wheelRotation(i) ?? 0,
        inContact: vehicle.wheelIsInContact(i),
      }));
      return {
        physicsVersion: PHYSICS_VERSION,
        simSeconds,
        position: { x, y, z },
        rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
        linearVelocity: { x: v.x, y: v.y, z: v.z },
        angularVelocity: { x: omega.x, y: omega.y, z: omega.z },
        speedMps: vehicle.currentVehicleSpeed(),
        wheels,
        applied: { ...applied },
        gear: drivetrain.gear,
        rpm: drivetrain.rpm,
        assists: { ...assists },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      world.removeVehicleController(vehicle);
      world.free();
    },
  };
}

export type { Pose };
