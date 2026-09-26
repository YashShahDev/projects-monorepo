import { parseCar } from "../content/car.ts";
import type { CarDefinition } from "../content/car.ts";
import type { TrackDefinition } from "../content/track.ts";
import { ContentError } from "../content/validate.ts";
import { createCameraRig } from "../rendering/camera-rig.ts";
import type { CameraAnchors, CameraMode, CameraView } from "../rendering/camera-rig.ts";
import { FixedStepper } from "../simulation/fixed-step.ts";
import { createLapTimer } from "../simulation/lap-timer.ts";
import type { CurrentLap, LapRecord } from "../simulation/lap-timer.ts";
import { createInputSmoother } from "../simulation/input-smoothing.ts";
import type { DigitalInput } from "../simulation/input-smoothing.ts";
import { buildTrackGeometry } from "../simulation/track-geometry.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";
import { buildTrackside, GRAVEL_DRAG_N } from "../simulation/trackside.ts";
import type { GroundSurface, Trackside } from "../simulation/trackside.ts";
import { buildVehicleSimulation, createVehicleSimulation } from "../simulation/vehicle.ts";
import type {
  VehicleOptions,
  DriverAssists,
  VehicleSnapshot,
  EnergyTelemetry,
  WingState,
} from "../simulation/vehicle.ts";
import type { Pose } from "../simulation/physics.ts";
import type { KeyAction } from "./keyboard.ts";
import type { EnergyRules } from "../content/energy-rules.ts";
import type { EnergyMode } from "../simulation/energy.ts";
import type { GearboxMode, ShiftRequest } from "../simulation/gearbox.ts";

/** A completed lap and the conditions it was driven under. */
export interface SessionLap extends LapRecord {
  physicsVersion: string;
  assists: DriverAssists;
  gearboxMode: GearboxMode;
  tuned: boolean;
}

export interface SessionState {
  paused: boolean;
  simSeconds: number;
  speedKmh: number;
  gear: number;
  rpm: number;
  lapDistanceM: number;
  surface: GroundSurface;
  camera: CameraMode;
  assists: DriverAssists;
  gearboxMode: GearboxMode;
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

  /** From the car model; the rig's defaults stand in when there is none. */
  cameraAnchors?: CameraAnchors;
}

export interface FrameView {
  car: VehicleSnapshot;
  camera: CameraView;
}

export interface DrivingSession {
  readonly geometry: TrackGeometry;

  /** Runoff and barriers, shared with the renderer so what is drawn is what is felt. */
  readonly trackside: Trackside;
  readonly stepSeconds: number;

  /**
   * Advances by one displayed frame and returns what to draw: the car interpolated
   * between the last two simulation steps, and the camera following that same pose.
   */
  /**
   * `held` may be a function, called once per simulation step: a controller that reacts
   * to the car (the benchmark autopilot) then drives the same at any frame rate.
   */
  frame(frameSeconds: number, held: DigitalInput | (() => DigitalInput)): FrameView;
  action(action: KeyAction): void;
  focusLost(): void;
  setAssists(assists: DriverAssists): void;
  setGearboxMode(mode: GearboxMode): void;

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

/** Half a tyre's tread width, for track limits and kerb contact. */
export const TYRE_HALF_WIDTH_M = 0.2;
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

/**
 * Whether a car is within track limits: some tyre's inner edge is still on or inside the
 * kerb. Uses each tyre's own position, so a yawed or sliding car is judged fairly.
 */
export function tyresWithinLimits(
  geometry: TrackGeometry,
  tyres: readonly { x: number; z: number }[],
  tyreHalfWidthM: number,
  hints: (number | undefined)[] = [],
): boolean {
  const limit = geometry.halfWidthM + geometry.kerbWidthM;

  return tyres.some((tyre, i) => {
    const location = geometry.locate(tyre.x, tyre.z, hints[i]);

    return Math.abs(location.lateralM) - tyreHalfWidthM <= limit;
  });
}

export async function createDrivingSession(
  car: CarDefinition,
  track: TrackDefinition,
  sessionOptions: SessionOptions = {},
): Promise<DrivingSession> {
  const geometry = buildTrackGeometry(track);

  // The lap length is only known once the centreline is built, so a zone past it could
  // not be rejected when the track file was parsed; it would never activate.
  track.activeAeroZones.forEach((zone, i) => {
    if (zone.endM > geometry.lengthM) {
      throw new ContentError(
        `track.activeAeroZones[${String(i)}].endM is ${String(zone.endM)} m, past the ${String(Math.round(geometry.lengthM))} m lap`,
      );
    }
  });
  if (track.startDistanceM >= geometry.lengthM) {
    throw new ContentError(
      `track.startDistanceM is ${String(track.startDistanceM)} m, past the ${String(Math.round(geometry.lengthM))} m lap`,
    );
  }

  const start = geometry.pointAt(track.startDistanceM);
  const trackside = buildTrackside(geometry);

  // One lookup hint per wheel keeps each locate to a short windowed search.
  const wheelHints: (number | undefined)[] = [undefined, undefined, undefined, undefined];

  // Grip is looked up first each step; drag reuses its surface rather than locating again.
  const wheelSurfaces: GroundSurface[] = ["road", "road", "road", "road"];
  const options: VehicleOptions = {
    ...(sessionOptions.energy ? { energy: sessionOptions.energy } : {}),
    start: {
      position: { x: start.x, y: 0, z: start.z },
      headingRad: Math.atan2(start.tx, start.tz),
    },
    gripAt: (x, z, wheel) => {
      const location = geometry.locate(x, z, wheelHints[wheel]);
      wheelHints[wheel] = location.index;
      const surface = trackside.surfaceAt(location);
      wheelSurfaces[wheel] = surface;

      // Asphalt runoff is road surface, only outside the white lines.
      return track.surfaceGrip[surface === "asphalt" ? "road" : surface];
    },
    dragAt: (_x, _z, wheel) => (wheelSurfaces[wheel] === "gravel" ? GRAVEL_DRAG_N : 0),
    barriers: trackside.barriers.map((run) => ({ ...run, outside: run.side })),
  };
  let sim = await createVehicleSimulation(car, options);
  const stock = JSON.stringify(car);
  let current = car;
  let pending: CarDefinition | undefined;
  const stepper = new FixedStepper(sim.stepSeconds, MAX_STEPS_PER_FRAME);
  const smoother = createInputSmoother();
  const camera = createCameraRig(sessionOptions.cameraAnchors);
  let paused = false;
  const lapTimer = createLapTimer({ lengthM: geometry.lengthM, sectors: SECTORS });
  const laps: SessionLap[] = [];

  // Contact patches in the chassis frame, front-left first as physics orders them.
  const tyrePositions = (snapshot: VehicleSnapshot) => {
    const w = current.wheels;
    const { x, z } = snapshot.position;
    const q = snapshot.rotation;

    // Heading of the chassis's +z axis about +y.
    const yaw = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
    const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];

    return [
      [w.halfTrack, w.frontAxleZ],
      [-w.halfTrack, w.frontAxleZ],
      [w.halfTrack, w.rearAxleZ],
      [-w.halfTrack, w.rearAxleZ],
    ].map(([lx = 0, lz = 0]) => ({ x: x + lx * fz + lz * fx, z: z - lx * fx + lz * fz }));
  };

  // Counted in whole steps so the countdown ends on the same step at any frame rate.
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
  let gearboxMode: GearboxMode = "automatic";

  // A pressed shift key, applied on the next simulation step that drives the car.
  let pendingShift: ShiftRequest | undefined;
  let hint: number | undefined;

  const locate = () => {
    const { position } = sim.snapshot();
    const location = geometry.locate(position.x, position.z, hint);
    hint = location.index;

    return location;
  };

  const session: DrivingSession = {
    geometry,
    trackside,
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
          const input = typeof held === "function" ? held() : held;
          const controls = smoother.update(input, speed, sim.stepSeconds);
          if (countdownLeft > 0) {
            // Held on the brakes; steering still responds so the grid feels live.
            sim.step({ throttle: 0, brake: 1, steer: controls.steer });
            pendingShift = undefined;
            countdownLeft -= 1;
            if (countdownLeft === 0) {
              lapTimer.start(sim.snapshot().simSeconds, locate().distanceM);
            }

            continue;
          }

          // Straight Mode only on throttle, off the brakes, inside an activation zone.
          const here = locate().distanceM;
          const inZone = track.activeAeroZones.some((z) => here >= z.startM && here <= z.endM);
          sim.setWingMode(inZone && controls.throttle > 0 && controls.brake === 0 ? "straight" : "corner");
          sim.step(pendingShift ? { ...controls, shift: pendingShift } : controls);
          pendingShift = undefined;
          const location = locate();
          const before = lapTimer.laps().length;

          // Track limits: the lap stays valid until all four tyres are past the kerb.
          const withinLimits = tyresWithinLimits(
            geometry,
            tyrePositions(sim.snapshot()),
            TYRE_HALF_WIDTH_M,
            wheelHints,
          );
          lapTimer.update(sim.snapshot().simSeconds, location.distanceM, withinLimits);
          const done = lapTimer.laps();
          if (done.length > before) {
            sim.newLap();
          }

          for (const record of done.slice(before)) {
            laps.push({
              ...record,
              physicsVersion: sim.snapshot().physicsVersion,
              gearboxMode,
              assists: sim.snapshot().assists,
              tuned: JSON.stringify(current) !== stock,
            });
          }
        }

        alpha = plan.alpha;
      }

      const latest = sim.snapshot();
      const pose = { ...latest, ...blend(previous, poseOf(latest), alpha) };

      return { car: pose, camera: camera.update(pose, frameSeconds) };
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
          sim.setGearboxMode(gearboxMode);
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
        pendingShift = undefined;
      } else if (action === "shiftUp" || action === "shiftDown") {
        // A key pressed while paused must not shift the moment play resumes.
        pendingShift = undefined;
        if (!paused) {
          pendingShift = action === "shiftUp" ? "up" : "down";
        }
      } else if (action === "energyMode") {
        const next: EnergyMode = sim.snapshot().energy?.mode === "harvest" ? "balanced" : "harvest";
        energyMode = next;
        sim.setEnergyMode(next);
      } else {
        // Fails to compile if a new action reaches here unhandled.
        action satisfies "camera";
        cameraMode = camera.cycle();
      }
    },
    focusLost() {
      paused = true;
    },
    setGearboxMode(mode) {
      gearboxMode = mode;
      sim.setGearboxMode(mode);

      // Best laps are kept per gearbox mode, so a lap must be driven under one mode.
      session.action("reset");
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
        surface: trackside.surfaceAt(location),
        camera: cameraMode,
        assists: snapshot.assists,
        gearboxMode,
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
