import type { CarDefinition } from "../content/car.ts";
import type { TrackDefinition } from "../content/track.ts";
import { createCameraRig } from "../rendering/camera-rig.ts";
import type { CameraMode, CameraView } from "../rendering/camera-rig.ts";
import { FixedStepper } from "../simulation/fixed-step.ts";
import { createGearbox } from "../simulation/gearbox.ts";
import { createInputSmoother } from "../simulation/input-smoothing.ts";
import type { DigitalInput } from "../simulation/input-smoothing.ts";
import { buildTrackGeometry } from "../simulation/track-geometry.ts";
import type { Surface, TrackGeometry } from "../simulation/track-geometry.ts";
import { createVehicleSimulation } from "../simulation/vehicle.ts";
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
}

export interface DrivingSession {
  readonly geometry: TrackGeometry;
  readonly stepSeconds: number;
  /** Advances by one displayed frame and returns the camera for it. */
  frame(frameSeconds: number, held: DigitalInput): CameraView;
  action(action: KeyAction): void;
  focusLost(): void;
  setAssists(assists: DriverAssists): void;
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
  const sim = await createVehicleSimulation(car, {
    start: {
      position: { x: start.x, y: 0, z: start.z },
      headingRad: Math.atan2(start.tx, start.tz),
    },
  });
  const stepper = new FixedStepper(sim.stepSeconds, MAX_STEPS_PER_FRAME);
  const smoother = createInputSmoother();
  const gearbox = createGearbox(car.powertrain.gearbox);
  const camera = createCameraRig();
  let paused = false;
  // The first frame after a pause reports the whole paused gap; it must not be simulated.
  let skipNextFrame = false;
  let cameraMode: CameraMode = "chase";
  let gear = gearbox.update(0);
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
          gear = gearbox.update(sim.snapshot().speedMps);
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
        sim.reset();
        smoother.reset();
        gearbox.reset();
        camera.reset();
        stepper.reset();
        gear = gearbox.update(0);
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
    snapshot: () => sim.snapshot(),
    state() {
      const snapshot = sim.snapshot();
      const location = locate();
      return {
        paused,
        simSeconds: snapshot.simSeconds,
        speedKmh: snapshot.speedMps * 3.6,
        gear: gear.gear,
        rpm: gear.rpm,
        lapDistanceM: location.distanceM,
        surface: location.surface,
        camera: cameraMode,
        assists: snapshot.assists,
      };
    },
    dispose() {
      sim.dispose();
    },
  };
}
