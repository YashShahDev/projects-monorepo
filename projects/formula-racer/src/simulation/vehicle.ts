import * as RAPIER from "@dimforge/rapier3d-compat";
import type { CarDefinition } from "../content/car.ts";
import type { Vec3 } from "../content/validate.ts";
import { initPhysics } from "./physics.ts";
import { REVERSE } from "./gearbox.ts";
import type { GearboxMode, ShiftRequest } from "./gearbox.ts";
import { createPowertrain } from "./powertrain.ts";
import { createEnergySystem } from "./energy.ts";
import type { EnergyMode } from "./energy.ts";
import type { EnergyRules } from "../content/energy-rules.ts";
import type { Pose, Quat } from "./physics.ts";
import { PHYSICS_VERSION } from "./version.ts";

/** Normalized driver requests. `steer` is -1 (full left) to +1 (full right). */
export interface DriverControls {
  throttle: number;
  brake: number;
  steer: number;

  /** Request the full permitted ERS deployment (held Shift). */
  deploy?: boolean;

  /** A gear change requested on this step (a key press, not a held key). */
  shift?: ShiftRequest;
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

/**
 * What a tyre is doing on the surface: locked under braking, spinning under drive, or
 * sliding sideways past its grip. Each leaves a mark.
 */
export type WheelSlip = "none" | "locked" | "spinning" | "sliding";

export interface WheelState {
  /** Metres from the chassis connection point along the suspension direction. */
  suspensionLength: number;
  steerRad: number;
  spinRad: number;
  inContact: boolean;
  slip: WheelSlip;

  /** Where the tyre touches the ground; absent while it is in the air. */
  contact: Vec3 | undefined;
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

  /** Absent for a car without an energy system. */
  energy: EnergyTelemetry | undefined;
  wing: WingState;
}

export type WingMode = "corner" | "straight";

export interface WingState {
  /** The commanded mode; braking always commands Corner Mode. */
  mode: WingMode;

  /** 0 in Corner Mode, 1 fully in Straight Mode, between while moving. */
  opening: number;
}

export interface EnergyTelemetry {
  mode: EnergyMode;
  socJ: number;
  deployW: number;
  regenW: number;
  lapRechargeJ: number;
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
  setEnergyMode(mode: EnergyMode): void;
  setGearboxMode(mode: GearboxMode): void;

  /** Commands the wings; Straight Mode is refused while braking. */
  setWingMode(mode: WingMode): void;

  /** Starts a new lap's energy Recharge allowance. */
  newLap(): void;
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

  /** Hybrid energy rules; without them the car runs on the ICE alone. */
  energy?: EnergyRules;

  /** Multiplier on tyre friction for the surface at a ground position; default 1. */
  gripAt?: (x: number, z: number, wheel: number) => number;

  /** Rolling resistance a loose surface (gravel) puts on a wheel there, N; default 0. */
  dragAt?: (x: number, z: number, wheel: number) => number;

  /**
   * Solid walls, 1.2 m tall, whose track-facing face runs along these ground lines. The
   * wall's thickness lies on the `outside`, reckoned facing along the points.
   */
  barriers?: { points: { x: number; z: number }[]; closed: boolean; outside: "left" | "right" }[];
}

const BARRIER_HALF_HEIGHT_M = 0.6;
const BARRIER_HALF_THICKNESS_M = 0.3;

// Share of the tyre's grip the assists let braking or drive use, with cornering.
const ASSIST_GRIP_MARGIN = 0.9;
// ABS holds the rear tyres further back, as brake distribution does on a road car: a
// light rear braking at its limit has too little grip left to hold the car's tail
// when the driver brakes into a turn.
const ABS_REAR_GRIP_SHARE = 0.7;
// A locked or spinning slick carries about three quarters of its peak grip.
const SLIDING_GRIP = 0.75;

// A tyre sliding sideways enough to mark. Assisted cornering at the limit peaks near 6°
// at the front (100 km/h) and 2° at the rear; full lock at 150 km/h without the assist
// reaches 20°.
const SLIDE_ANGLE_RAD = 0.14;
const SLIDE_MIN_SPEED_MPS = 3;
// Front slip angle at peak cornering force, measured from fixed-lock sweeps at
// 100–250 km/h with the shipped tyre settings.
const PEAK_SLIP_RAD = 0.015;
const GRAVITY = 9.81;
const AIR_DENSITY_KG_M3 = 1.225;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function headingQuat(headingRad: number): Quat {
  return { x: 0, y: Math.sin(headingRad / 2), z: 0, w: Math.cos(headingRad / 2) };
}

export async function createVehicleSimulation(car: CarDefinition, options: VehicleOptions): Promise<VehicleSimulation> {
  await initPhysics();

  return buildVehicleSimulation(car, options);
}

/** Synchronous construction for callers that have already awaited `initPhysics()`. */
export function buildVehicleSimulation(car: CarDefinition, options: VehicleOptions): VehicleSimulation {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const stepSeconds = world.timestep;
  const ground = options.groundHalfExtentM ?? 3000;
  world.createCollider(RAPIER.ColliderDesc.cuboid(ground, 1, ground).setTranslation(0, -1, 0));

  for (const barrier of options.barriers ?? []) {
    const { points } = barrier;
    const segments = barrier.closed ? points.length : points.length - 1;
    for (let i = 0; i < segments; i += 1) {
      const a = points[i] ?? { x: 0, z: 0 };
      const b = points[(i + 1) % points.length] ?? a;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-3) {
        continue;
      }

      // Left of travel along (dx, dz) is (dz, −dx); the centre sits half a thickness out.
      const sign = barrier.outside === "left" ? 1 : -1;
      const out = (BARRIER_HALF_THICKNESS_M * sign) / length;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(BARRIER_HALF_THICKNESS_M, BARRIER_HALF_HEIGHT_M, length / 2)
          .setTranslation(
            (a.x + b.x) / 2 + (b.z - a.z) * out,
            BARRIER_HALF_HEIGHT_M,
            (a.z + b.z) / 2 - (b.x - a.x) * out,
          )
          .setRotation(headingQuat(Math.atan2(b.x - a.x, b.z - a.z)))
          .setFriction(0.3)
          .setRestitution(0.1),
      );
    }
  }

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

  const wheelPoints: Vec3[] = [
    { x: w.halfTrack, y: w.connectionY, z: w.frontAxleZ },
    { x: -w.halfTrack, y: w.connectionY, z: w.frontAxleZ },
    { x: w.halfTrack, y: w.connectionY, z: w.rearAxleZ },
    { x: -w.halfTrack, y: w.connectionY, z: w.rearAxleZ },
  ];
  const createController = () => {
    const controller = world.createVehicleController(body);
    controller.indexUpAxis = 1;

    // Rapier 0.21 names this setter `setIndexForwardAxis` (a property, not a method).
    controller.setIndexForwardAxis = 2;
    wheelPoints.forEach((point, i) => {
      controller.addWheel(point, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, w.suspensionRestLength, w.radius);
      controller.setWheelMaxSuspensionTravel(i, w.maxSuspensionTravel);
      controller.setWheelSuspensionStiffness(i, w.suspensionStiffness);
      controller.setWheelSuspensionCompression(i, w.suspensionCompression);
      controller.setWheelSuspensionRelaxation(i, w.suspensionRelaxation);
      controller.setWheelMaxSuspensionForce(i, w.maxSuspensionForceN);
      controller.setWheelFrictionSlip(i, w.frictionCoefficient);
      controller.setWheelSideFrictionStiffness(i, w.sideFrictionStiffness);
    });

    return controller;
  };

  let vehicle = createController();

  let simSeconds = 0;
  let applied: DriverControls = { ...NO_CONTROLS };
  const powertrain = createPowertrain(car.powertrain);
  let wingMode: WingMode = "corner";
  let wingOpening = 0;
  const dragAreaM2 = () => car.aero.dragAreaM2 + (car.aero.straightMode.dragAreaM2 - car.aero.dragAreaM2) * wingOpening;
  const rules = options.energy;
  const energy = rules ? createEnergySystem(rules) : undefined;
  let energyMode: EnergyMode = "balanced";
  let deployRequest = false;
  let flow = { deployW: 0, regenW: 0 };
  let drivetrain = powertrain.update(0, 0, stepSeconds);
  let assists: DriverAssists = { ...(options.assists ?? ALL_ASSISTS) };
  let disposed = false;

  // Rapier halves the forward impulse in its friction-circle test (Bullet's fwdFactor),
  // which lets a tyre brake or drive with twice its cornering grip and keep most of
  // its cornering grip while it does. The car applies the true circle itself: it caps
  // each wheel's lengthways force, and shrinks Rapier's circle to leave only the grip
  // that force does not use (see `frictionSlipFor`).
  const surfaceGrip = [1, 1, 1, 1];
  const peakGripN = (i: number): number =>
    w.frictionCoefficient * (surfaceGrip[i] ?? 1) * (vehicle.wheelSuspensionForce(i) ?? 0);

  /**
   * Lengthways force the tyre can add to the last step's cornering force while using
   * no more than `share` of its grip.
   */
  const tyreBudgetN = (i: number, share = 1): number => {
    const grip = share * peakGripN(i);
    const side = (vehicle.wheelSideImpulse(i) ?? 0) / stepSeconds;

    return Math.sqrt(Math.max(0, grip * grip - side * side));
  };

  // A wheel asked for more than its budget locks (braking) or spins (driving), and
  // slides at sliding grip until the demand drops to what a sliding tyre carries. The
  // sliding force goes lengthways, so a locked wheel barely steers.
  const sliding = [false, false, false, false];
  const updateSliding = (i: number, wantedN: number): void => {
    sliding[i] = sliding[i] === true ? wantedN > SLIDING_GRIP * peakGripN(i) : wantedN > tyreBudgetN(i);
  };

  // Rapier passes (L/2)² + S² ≤ (slip·N)²; this slip makes that L² + S² ≤ (μN)².
  const frictionSlipFor = (mu: number, lengthwaysN: number, loadN: number): number =>
    Math.sqrt(Math.max(0, mu * mu - 0.75 * (lengthwaysN / loadN) ** 2));

  // A locked tyre's force points against its contact's velocity, whichever way the
  // wheel points. Rapier brakes along the wheel's rolling direction and shares an
  // overloaded friction circle by the forces asked of it, either of which would let a
  // locked, steered wheel steer; so a locked wheel's friction is applied here instead.
  const locked = [false, false, false, false];
  const spinning = [false, false, false, false];
  const LOCK_MIN_SPEED_MPS = 0.5;
  const applyLockedFriction = (i: number, mu: number): void => {
    const contact = vehicle.wheelContactPoint(i);
    if (!contact || !vehicle.wheelIsInContact(i)) {
      return;
    }

    const v = body.velocityAtPoint(contact);
    const speed = Math.hypot(v.x, v.z);
    const impulse = (mu * (vehicle.wheelSuspensionForce(i) ?? 0) * stepSeconds) / Math.max(speed, 1e-6);
    body.applyImpulseAtPoint({ x: -v.x * impulse, y: 0, z: -v.z * impulse }, contact, true);
  };

  const assertLive = (): void => {
    if (disposed) {
      throw new Error("vehicle simulation used after dispose()");
    }
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
      const drag = (dynamicPressure * dragAreaM2() * stepSeconds) / speed;
      body.applyImpulse({ x: -v.x * drag, y: -v.y * drag, z: -v.z * drag }, true);
    }

    if (downforceN <= 0) {
      return;
    }

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

  // Loose surfaces pull on each wheel touching them, against the car's ground motion,
  // but never enough to push it backwards.
  const applySurfaceDrag = (): void => {
    if (!options.dragAt) {
      return;
    }

    let dragN = 0;
    for (let i = 0; i < 4; i += 1) {
      if (vehicle.wheelIsInContact(i)) {
        const p = wheelPoints[i] ?? { x: 0, y: 0, z: 0 };
        const at = localPoint(p.x, p.y, p.z);
        dragN += options.dragAt(at.x, at.z, i);
      }
    }

    const v = body.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (dragN <= 0 || speed < 1e-3) {
      return;
    }

    const impulse = Math.min(dragN * stepSeconds, car.massKg * speed) / speed;
    body.applyImpulse({ x: -v.x * impulse, y: 0, z: -v.z * impulse }, true);
  };

  return {
    stepSeconds,
    car,
    step(controls) {
      assertLive();
      deployRequest = controls.deploy === true;
      applied = {
        throttle: clamp(controls.throttle, 0, 1),
        brake: clamp(controls.brake, 0, 1),
        steer: clamp(controls.steer, -1, 1),
      };
      const signedSpeed = vehicle.currentVehicleSpeed();
      const speed = Math.abs(signedSpeed);
      if (controls.shift) {
        powertrain.request(controls.shift);
      }

      drivetrain = powertrain.update(applied.throttle, signedSpeed, stepSeconds);
      if (options.gripAt) {
        for (let i = 0; i < 4; i += 1) {
          const p = wheelPoints[i] ?? { x: 0, y: 0, z: 0 };
          const at = localPoint(p.x, p.y, p.z);
          surfaceGrip[i] = options.gripAt(at.x, at.z, i);
        }
      }

      const b = car.brakes;
      const brakeN = applied.brake * b.maxForceN;
      const wheelBrakeN = [0, 1, 2, 3].map((i) => {
        const share = i < 2 ? b.frontBias : 1 - b.frontBias;
        const wanted = (brakeN * share) / 2;

        return assists.abs
          ? Math.min(wanted, tyreBudgetN(i, i < 2 ? ASSIST_GRIP_MARGIN : ABS_REAR_GRIP_SHARE))
          : wanted;
      });
      let drive = drivetrain.driveForceN;

      // The ERS is not used in reverse: it neither deploys nor harvests.
      flow = { deployW: 0, regenW: 0 };
      if (energy && rules && drivetrain.gear !== REVERSE) {
        const v = Math.max(speed, 1);

        // The MGU-K drives the rear axle, so it can only take over braking the rear tyres
        // are delivering: none from a wheel in the air, and no more than the tyre grips,
        // whether ABS holds the wheel back or it locks.
        const rearBrakingN = [2, 3].reduce(
          (sum, i) => sum + (vehicle.wheelIsInContact(i) ? Math.min(wheelBrakeN[i] ?? 0, tyreBudgetN(i)) : 0),
          0,
        );

        // C5.2.11 caps MGU-K torque at the crankshaft, so its power at engine speed.
        const mgukLimitW = rules.mgukMaxTorqueNm * ((drivetrain.rpm * 2 * Math.PI) / 60);
        const result = energy.update({
          speedMps: speed,

          // Rapier drops engine force on a braking wheel, so braking also stops deployment.
          throttle: brakeN > 0 ? 0 : applied.throttle,
          brakePowerW: rearBrakingN * speed,
          braking: brakeN > 0,
          mode: energyMode,
          deployRequest,
          dtS: stepSeconds,
          limitW: mgukLimitW,
          regenLimitW: mgukLimitW,
        });
        flow = result;

        // Lift-off harvesting brakes through the drivetrain: the energy it stores must
        // leave the car's motion.
        drive += (result.deployW - result.engineBrakeW) / v;
      }

      const a = car.aero;
      const dynamicPressure = 0.5 * AIR_DENSITY_KG_M3 * speed * speed;
      if (applied.brake > 0) {
        wingMode = "corner";
      }

      const target = wingMode === "straight" ? 1 : 0;
      const move = stepSeconds / a.wingTransitionS;
      wingOpening += Math.max(-move, Math.min(move, target - wingOpening));

      // Snap once within float noise of the end so "fully open" is exact.
      if (Math.abs(target - wingOpening) < 1e-9) {
        wingOpening = target;
      }

      const downforceN =
        dynamicPressure * (a.downforceAreaM2 + (a.straightMode.downforceAreaM2 - a.downforceAreaM2) * wingOpening);
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

      for (let i = 0; i < 4; i += 1) {
        const front = i < 2;
        vehicle.setWheelSteering(i, front ? steerRad : 0);

        // Rapier ignores a wheel's brake while it has engine force, so braking cuts drive.
        let engine = !front && brakeN === 0 ? drive / 2 : 0;
        if (assists.traction) {
          // Limit the size of the force, so reverse and engine braking are held too.
          engine = Math.sign(engine) * Math.min(Math.abs(engine), tyreBudgetN(i, ASSIST_GRIP_MARGIN));
        }

        // Braking cuts drive, so a wheel is either braked or driven.
        const braking = (wheelBrakeN[i] ?? 0) > 0;
        const wanted = braking ? (wheelBrakeN[i] ?? 0) : Math.abs(engine);
        updateSliding(i, wanted);
        const mu = w.frictionCoefficient * (surfaceGrip[i] ?? 1) * (sliding[i] === true ? SLIDING_GRIP : 1);
        const loadN = Math.max(vehicle.wheelSuspensionForce(i) ?? 0, 1);
        const lengthwaysN = Math.min(wanted, mu * loadN);
        locked[i] = braking && sliding[i] === true && speed > LOCK_MIN_SPEED_MPS;
        spinning[i] = !braking && engine !== 0 && sliding[i] === true;
        vehicle.setWheelFrictionSlip(i, locked[i] === true ? 0 : frictionSlipFor(mu, lengthwaysN, loadN));
        vehicle.setWheelEngineForce(i, braking ? 0 : Math.sign(engine) * lengthwaysN);

        // Regeneration blends with the friction brakes (brake-by-wire), so the wheel's
        // total braking is the same either way. Rapier treats `brake` as the maximum
        // rolling-friction impulse for this step.
        vehicle.setWheelBrake(i, (braking && locked[i] !== true ? lengthwaysN : 0) * stepSeconds);
      }

      vehicle.updateVehicle(stepSeconds);
      for (let i = 0; i < 4; i += 1) {
        if (locked[i] === true) {
          applyLockedFriction(i, w.frictionCoefficient * (surfaceGrip[i] ?? 1) * SLIDING_GRIP);
        }
      }

      applyAero(dynamicPressure, downforceN);
      applySurfaceDrag();
      world.step();
      simSeconds += stepSeconds;
    },
    setAssists(next) {
      assists = { ...next };
    },
    setEnergyMode(mode) {
      energyMode = mode;
    },
    setGearboxMode(mode) {
      powertrain.setMode(mode);
    },
    setWingMode(mode) {
      wingMode = mode === "straight" && applied.brake > 0 ? "corner" : mode;
    },
    newLap() {
      energy?.newLap();
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

      // The controller caches speed, suspension and wheel spin from its last update;
      // a fresh one makes a reset behave like a new start.
      world.removeVehicleController(vehicle);
      vehicle = createController();
      surfaceGrip.fill(1);
      sliding.fill(false);
      locked.fill(false);
      spinning.fill(false);
      powertrain.reset();
      drivetrain = powertrain.update(0, 0, stepSeconds);
      energy?.reset();
      flow = { deployW: 0, regenW: 0 };
      wingMode = "corner";
      wingOpening = 0;
    },
    snapshot() {
      assertLive();
      const { x, y, z } = body.translation();
      const r = body.rotation();
      const v = body.linvel();
      const omega = body.angvel();
      const t = body.translation();
      const wheels: WheelState[] = [0, 1, 2, 3].map((i) => {
        const steer = vehicle.wheelSteering(i) ?? 0;
        const point = vehicle.wheelContactPoint(i);
        const contact = vehicle.wheelIsInContact(i) && point ? { x: point.x, y: point.y, z: point.z } : undefined;
        let slip: WheelSlip = "none";
        if (contact && locked[i] === true) {
          slip = "locked";
        } else if (contact && spinning[i] === true) {
          slip = "spinning";
        } else if (contact) {
          const axle = localPoint(Math.cos(steer), 0, -Math.sin(steer));
          const at = body.velocityAtPoint(contact);
          const across = at.x * (axle.x - t.x) + at.y * (axle.y - t.y) + at.z * (axle.z - t.z);
          const moving = Math.hypot(at.x, at.z);
          const sideways = moving > SLIDE_MIN_SPEED_MPS && Math.abs(across) > moving * Math.sin(SLIDE_ANGLE_RAD);
          slip = sideways ? "sliding" : "none";
        }

        return {
          suspensionLength: vehicle.wheelSuspensionLength(i) ?? w.suspensionRestLength,
          steerRad: steer,
          spinRad: vehicle.wheelRotation(i) ?? 0,
          inContact: vehicle.wheelIsInContact(i),
          slip,
          contact,
        };
      });

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
        wing: { mode: wingMode, opening: wingOpening },
        energy: energy && {
          mode: energyMode,
          ...energy.state(),
          deployW: flow.deployW,
          regenW: flow.regenW,
        },
        assists: { ...assists },
      };
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      world.removeVehicleController(vehicle);
      world.free();
    },
  };
}

export type { Pose };
