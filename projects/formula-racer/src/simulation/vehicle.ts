import RAPIER from "@dimforge/rapier3d-compat";
import type { CarDefinition } from "../content/car.ts";
import type { Vec3 } from "../content/validate.ts";
import { initPhysics } from "./probe-world.ts";
import type { Pose, Quat } from "./probe-world.ts";
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
  /** Signed speed along the chassis forward axis, m/s. */
  speedMps: number;
  /** Order: front-left, front-right, rear-left, rear-right. */
  wheels: WheelState[];
  applied: DriverControls;
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
  reset(): void;
  snapshot(): VehicleSnapshot;
  dispose(): void;
}

export interface VehicleOptions {
  start: StartPose;
  /** Half-size of the flat ground collider; the ground's top is y = 0. */
  groundHalfExtentM?: number;
}

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
  let disposed = false;
  const assertLive = (): void => {
    if (disposed) throw new Error("vehicle simulation used after dispose()");
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
      const p = car.powertrain;
      const drive = applied.throttle * Math.min(p.maxDriveForceN, p.maxPowerW / Math.max(speed, 1));
      const steerRad = -applied.steer * car.steering.maxAngleRad;
      const b = car.brakes;
      const brakeN = applied.brake * b.maxForceN;
      for (let i = 0; i < 4; i += 1) {
        const front = i < 2;
        vehicle.setWheelSteering(i, front ? steerRad : 0);
        // Rapier ignores a wheel's brake while it has engine force, so braking cuts drive.
        const engine = !front && brakeN === 0 ? drive / 2 : 0;
        vehicle.setWheelEngineForce(i, engine);
        const share = front ? b.frontBias : 1 - b.frontBias;
        // Rapier treats `brake` as the maximum rolling-friction impulse for this step.
        vehicle.setWheelBrake(i, (brakeN * share * stepSeconds) / 2);
      }
      vehicle.updateVehicle(stepSeconds);
      world.step();
      simSeconds += stepSeconds;
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
    },
    snapshot() {
      assertLive();
      const { x, y, z } = body.translation();
      const r = body.rotation();
      const v = body.linvel();
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
        speedMps: vehicle.currentVehicleSpeed(),
        wheels,
        applied: { ...applied },
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
