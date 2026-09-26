import { parseCar } from "../content/car.ts";
import type { CarDefinition } from "../content/car.ts";
import type { TrackDefinition } from "../content/track.ts";
import { createCameraRig } from "../rendering/camera-rig.ts";
import type { CameraMode, CameraView } from "../rendering/camera-rig.ts";
import { FixedStepper } from "../simulation/fixed-step.ts";
import { createLapTimer } from "../simulation/lap-timer.ts";
import type { CurrentLap, LapRecord } from "../simulation/lap-timer.ts";
import { createInputSmoother } from "../simulation/input-smoothing.ts";
import type { DigitalInput } from "../simulation/input-smoothing.ts";
import { buildTrackGeometry } from "../simulation/track-geometry.ts";
import type { Surface, TrackGeometry } from "../simulation/track-geometry.ts";
import { buildVehicleSimulation, createVehicleSimulation } from "../simulation/vehicle.ts";
import type { VehicleOptions } from "../simulation/vehicle.ts";
import type { DriverAssists, VehicleSnapshot } from "../simulation/vehicle.ts";
import type { Pose } from "../simulation/physics.ts";
import type { KeyAction } from "./keyboard.ts";
import type { EnergyRules } from "../content/energy-rules.ts";
import type { EnergyMode } from "../simulation/energy.ts";
import type { EnergyTelemetry, WingState } from "../simulation/vehicle.ts";

/** A completed lap and the conditions it was driven under. */
export interface SessionLap extends LapRecord {
  physicsVersion: string;
  assists: DriverAssists;
  tuned: boolean;
}

export interface SessionState {
  paused: boolean;
  simSeconds: number;
  speedKmh: number;
  gear: number;
  rpm: number;
  lapDistanceM: number;
  surface: Surface;
  camera: CameraMode;
  assists: DriverAssists;
  physicsVersion: string;

  /** The running car differs from the shipped definition; laps should say so. */
  tuned: boolean;

  /** A tuning change is waiting for the next reset. */
  pendingTuning: boolean;

  /** Seconds of the standing-start countdown left; the car is held until it is zero. */
  countdownS: number;

  /** The lap being timed, once the countdown ends. */
  lap: CurrentLap | undefined;
  laps: SessionLap[];
  energy: EnergyTelemetry | undefined;
  wing: WingState;
}

export interface SessionOptions {
  energy?: EnergyRules;
}

export interface FrameView {
  car: VehicleSnapshot;
  camera: CameraView;
}

export interface DrivingSession {
  readonly geometry: TrackGeometry;
  readonly stepSeconds: number;

  /**
   * Advances by one displayed frame and returns what to draw: the car interpolated
   * between the last two simulation steps, and the camera following that same pose.
   */
  frame(frameSeconds: number, held: DigitalInput): FrameView;
  action(action: KeyAction): void;
  focusLost(): void;
  setAssists(assists: DriverAssists): void;

  /**
   * Validates a change to the car and applies it on the next reset, since changing mass,
   * springs or aero under a moving car would be a discontinuity, not a tuning result.
   */
  retune(patch: Partial<CarDefinition>): void;

  /** The car definition currently being driven. */
  car(): CarDefinition;
  snapshot(): VehicleSnapshot;
  state(): SessionState;
  dispose(): void;
}

const MAX_STEPS_PER_FRAME = 8;
const COUNTDOWN_S = 3;
const SECTORS = 3;

const poseOf = (s: VehicleSnapshot): Pose => ({ position: s.position, rotation: s.rotation });

/** Linear position and normalized-lerp rotation; steps are too short for nlerp to drift. */
function blend(a: Pose, b: Pose, t: number): Pose {
  const lerp = (x: number, y: number) => x + (y - x) * t;

  // Take the short way round: q and -q are the same rotation.
  const sign =
    a.rotation.x * b.rotation.x +
      a.rotation.y * b.rotation.y +
      a.rotation.z * b.rotation.z +
      a.rotation.w * b.rotation.w <
    0
      ? -1
      : 1;
  const q = {
    x: lerp(a.rotation.x, sign * b.rotation.x),
    y: lerp(a.rotation.y, sign * b.rotation.y),
    z: lerp(a.rotation.z, sign * b.rotation.z),
    w: lerp(a.rotation.w, sign * b.rotation.w),
  };
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;

  return {
    position: {
      x: lerp(a.position.x, b.position.x),
      y: lerp(a.position.y, b.position.y),
      z: lerp(a.position.z, b.position.z),
    },
    rotation: { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n },
  };
}

export async function createDrivingSession(
  car: CarDefinition,
  track: TrackDefinition,
  sessionOptions: SessionOptions = {},
): Promise<DrivingSession> {
  const geometry = buildTrackGeometry(track);
  const start = geometry.pointAt(track.startDistanceM);

  // One lookup hint per wheel keeps each locate to a short windowed search.
  const wheelHints: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  const options: VehicleOptions = {
    ...(sessionOptions.energy ? { energy: sessionOptions.energy } : {}),
    start: {
      position: { x: start.x, y: 0, z: start.z },
      headingRad: Math.atan2(start.tx, start.tz),
    },
    gripAt: (x, z, wheel) => {
      const location = geometry.locate(x, z, wheelHints[wheel]);
      wheelHints[wheel] = location.index;

      return track.surfaceGrip[location.surface];
    },
  };
  let sim = await createVehicleSimulation(car, options);
  const stock = JSON.stringify(car);
  let current = car;
  let pending: CarDefinition | undefined;
  const stepper = new FixedStepper(sim.stepSeconds, MAX_STEPS_PER_FRAME);
  const smoother = createInputSmoother();
  const camera = createCameraRig();
  let paused = false;
  const lapTimer = createLapTimer({ lengthM: geometry.lengthM, sectors: SECTORS });
  const laps: SessionLap[] = [];

  // Counted in whole steps so the countdown ends on the same step at any frame rate.
  const TYRE_HALF_WIDTH_M = 0.2;
  const innerWheelOffsetM = car.wheels.halfTrack + TYRE_HALF_WIDTH_M;
  const countdownSteps = Math.round(COUNTDOWN_S / sim.stepSeconds);
  let countdownLeft = countdownSteps;

  // Pose before the latest step and how far the display is between the two.
  let previous = poseOf(sim.snapshot());
  let alpha = 1;

  // The first frame after a pause reports the whole paused gap; it must not be simulated.
  let skipNextFrame = false;
  let cameraMode: CameraMode = "chase";

  // Kept here too so a rebuilt (retuned) vehicle starts in the driver's mode.
  let energyMode: EnergyMode = "balanced";
  let hint: number | undefined;

  const locate = () => {
    const { position } = sim.snapshot();
    const location = geometry.locate(position.x, position.z, hint);
    hint = location.index;

    return location;
  };

  const session: DrivingSession = {
    geometry,
    stepSeconds: sim.stepSeconds,
    frame(frameSeconds, held) {
      if (skipNextFrame) {
        skipNextFrame = false;
      } else if (!paused) {
        const plan = stepper.advance(frameSeconds);

        // Input is smoothed per simulation step, not per frame, so the render rate
        // cannot change what the car does.
        for (let i = 0; i < plan.steps; i += 1) {
          previous = poseOf(sim.snapshot());
          const speed = sim.snapshot().speedMps;
          const controls = smoother.update(held, speed, sim.stepSeconds);
          if (countdownLeft > 0) {
            // Held on the brakes; steering still responds so the grid feels live.
            sim.step({ throttle: 0, brake: 1, steer: controls.steer });
            countdownLeft -= 1;
            if (countdownLeft === 0) {
              lapTimer.start(sim.snapshot().simSeconds, locate().distanceM);
            }

            continue;
          }

          // Straight Mode only on throttle, off the brakes, inside an activation zone.
          const here = locate().distanceM;
          const inZone = track.activeAeroZones.some((z) => here >= z.startM && here <= z.endM);
          sim.setWingMode(
            inZone && controls.throttle > 0 && controls.brake === 0 ? "straight" : "corner",
          );
          sim.step(controls);
          const location = locate();
          const before = lapTimer.laps().length;

          // Track limits: the lap stays valid until all four wheels are past the kerb,
          // i.e. the inner wheels' outer edges are beyond it.
          const withinLimits =
            Math.abs(location.lateralM) - innerWheelOffsetM <=
            geometry.halfWidthM + geometry.kerbWidthM;
          lapTimer.update(sim.snapshot().simSeconds, location.distanceM, withinLimits);
          const done = lapTimer.laps();
          if (done.length > before) {
            sim.newLap();
          }

          for (const record of done.slice(before)) {
            laps.push({
              ...record,
              physicsVersion: sim.snapshot().physicsVersion,
              assists: sim.snapshot().assists,
              tuned: JSON.stringify(current) !== stock,
            });
          }
        }

        alpha = plan.alpha;
      }

      const latest = sim.snapshot();
      const car = { ...latest, ...blend(previous, poseOf(latest), alpha) };

      return { car, camera: camera.update(car, frameSeconds) };
    },
    action(action) {
      if (action === "pause") {
        paused = !paused;
        skipNextFrame = !paused;
        stepper.reset();
      } else if (action === "reset") {
        if (pending) {
          const assists = sim.snapshot().assists;
          sim.dispose();
          current = pending;
          pending = undefined;
          sim = buildVehicleSimulation(current, { ...options, assists });
          sim.setEnergyMode(energyMode);
        } else {
          sim.reset();
        }

        smoother.reset();
        previous = poseOf(sim.snapshot());
        alpha = 1;
        camera.reset();
        stepper.reset();
        hint = undefined;
        lapTimer.abort();
        countdownLeft = countdownSteps;
      } else if (action === "energyMode") {
        const next: EnergyMode = sim.snapshot().energy?.mode === "harvest" ? "balanced" : "harvest";
        energyMode = next;
        sim.setEnergyMode(next);
      } else {
        cameraMode = camera.cycle();
      }
    },
    focusLost() {
      paused = true;
    },
    setAssists(assists) {
      sim.setAssists(assists);

      // A lap must be driven under one assist set to be compared fairly.
      session.action("reset");
    },
    retune(patch) {
      pending = parseCar({ ...(pending ?? current), ...patch });
    },
    car: () => current,
    snapshot: () => sim.snapshot(),
    state() {
      const snapshot = sim.snapshot();
      const location = locate();

      return {
        paused,
        simSeconds: snapshot.simSeconds,
        speedKmh: snapshot.speedMps * 3.6,
        gear: snapshot.gear,
        rpm: snapshot.rpm,
        lapDistanceM: location.distanceM,
        surface: location.surface,
        camera: cameraMode,
        assists: snapshot.assists,
        physicsVersion: snapshot.physicsVersion,
        tuned: JSON.stringify(current) !== stock,
        pendingTuning: pending !== undefined,
        countdownS: countdownLeft * sim.stepSeconds,
        lap: lapTimer.current(),
        laps: laps.map((lap) => ({ ...lap })),
        energy: snapshot.energy,
        wing: snapshot.wing,
      };
    },
    dispose() {
      sim.dispose();
    },
  };

  return session;
}
