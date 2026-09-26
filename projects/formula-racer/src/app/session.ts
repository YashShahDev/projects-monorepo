import { parseCar } from "../content/car.ts";
import type { CarDefinition } from "../content/car.ts";
import type { TrackDefinition } from "../content/track.ts";
import { createCameraRig } from "../rendering/camera-rig.ts";
import type { CameraMode, CameraView } from "../rendering/camera-rig.ts";
import { FixedStepper } from "../simulation/fixed-step.ts";
import { createInputSmoother } from "../simulation/input-smoothing.ts";
import type { DigitalInput } from "../simulation/input-smoothing.ts";
import { buildTrackGeometry } from "../simulation/track-geometry.ts";
import type { Surface, TrackGeometry } from "../simulation/track-geometry.ts";
import { buildVehicleSimulation, createVehicleSimulation } from "../simulation/vehicle.ts";
import type { VehicleOptions } from "../simulation/vehicle.ts";
import type { DriverAssists, VehicleSnapshot } from "../simulation/vehicle.ts";
import type { KeyAction } from "./keyboard.ts";

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
}

export interface DrivingSession {
  readonly geometry: TrackGeometry;
  readonly stepSeconds: number;
  /** Advances by one displayed frame and returns the camera for it. */
  frame(frameSeconds: number, held: DigitalInput): CameraView;
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

export async function createDrivingSession(
  car: CarDefinition,
  track: TrackDefinition,
): Promise<DrivingSession> {
  const geometry = buildTrackGeometry(track);
  const start = geometry.pointAt(track.startDistanceM);
  // One lookup hint per wheel keeps each locate to a short windowed search.
  const wheelHints: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  const options: VehicleOptions = {
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
  // The first frame after a pause reports the whole paused gap; it must not be simulated.
  let skipNextFrame = false;
  let cameraMode: CameraMode = "chase";
  let hint: number | undefined;

  const locate = () => {
    const { position } = sim.snapshot();
    const location = geometry.locate(position.x, position.z, hint);
    hint = location.index;
    return location;
  };

  return {
    geometry,
    stepSeconds: sim.stepSeconds,
    frame(frameSeconds, held) {
      if (skipNextFrame) {
        skipNextFrame = false;
      } else if (!paused) {
        const { steps } = stepper.advance(frameSeconds);
        // Input is smoothed per simulation step, not per frame, so the render rate
        // cannot change what the car does.
        for (let i = 0; i < steps; i += 1) {
          const speed = sim.snapshot().speedMps;
          sim.step(smoother.update(held, speed, sim.stepSeconds));
        }
      }
      return camera.update(sim.snapshot(), frameSeconds);
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
        } else {
          sim.reset();
        }
        smoother.reset();
        camera.reset();
        stepper.reset();
        hint = undefined;
      } else {
        cameraMode = camera.cycle();
      }
    },
    focusLost() {
      paused = true;
    },
    setAssists(assists) {
      sim.setAssists(assists);
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
      };
    },
    dispose() {
      sim.dispose();
    },
  };
}
