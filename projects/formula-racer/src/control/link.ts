import type { DrivingSession } from "../app/session.ts";
import type { Quat } from "../simulation/physics.ts";
import type { GroundSurface } from "../simulation/trackside.ts";
import type { DriverControls, WheelSlip } from "../simulation/vehicle.ts";
import type { Vec3 } from "../content/validate.ts";
import type { EnergyMode } from "../content/energy-rules.ts";
import type { ResetRequest } from "./protocol.ts";

/** The track ahead is sampled this many times, this far apart. */
export const AHEAD_SAMPLES = 32;
export const AHEAD_SPACING_M = 10;

export interface Observation {
  simSeconds: number;
  position: Vec3;
  rotation: Quat;

  /** Heading about +y; 0 faces +z, and positive turns toward +x. */
  yawRad: number;
  velocity: Vec3;

  /** Along the chassis's forward axis; negative in reverse. */
  speedMps: number;
  yawRateRadS: number;
  gear: number;
  rpm: number;

  /** Front-left, front-right, rear-left, rear-right. */
  wheels: { inContact: boolean; slip: WheelSlip; surface: GroundSurface }[];
  track: {
    id: string;
    lengthM: number;
    halfWidthM: number;

    /** Along the centreline from the start line. */
    distanceM: number;

    /** From the centreline; positive is left. */
    lateralM: number;

    /** Car heading less the track's; positive points left of it. */
    headingErrorRad: number;
    ahead: {
      spacingM: number;

      /** Signed centreline curvature, 1/m; positive turns left. */
      curvature: number[];

      /** Distance from the centreline to the barrier each side; null where there is none. */
      leftBarrierM: (number | null)[];
      rightBarrierM: (number | null)[];
    };
  };
  lap: {
    completed: number;

    /** The lap being timed; null before the start and between episodes. */
    elapsedS: number | null;
    sector: number | null;
    valid: boolean | null;
    lastLapS: number | null;
    bestLapS: number | null;
  };
  energy: { mode: EnergyMode; socJ: number; deployW: number; regenW: number } | null;
}

export type ControlEvent =
  | { type: "reset" }
  | { type: "sector"; sector: number; elapsedS: number }
  | { type: "lap"; timeS: number; valid: boolean; sectorsS: number[] }
  | { type: "offTrack" }
  | { type: "backOnTrack" };

export interface StepResult {
  observation: Observation;
  events: ControlEvent[];
  done: boolean;
}

export interface ControlLink {
  /** Starts an episode on the link's session, driving through the start countdown. */
  start(request: ResetRequest): StepResult;
  step(controls: DriverControls, steps: number): StepResult;
  observe(): Observation;
}

const ON_TRACK: readonly GroundSurface[] = ["road", "kerb"];

const yawOf = (q: Quat) => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const orNull = (value: number | undefined) => (value === undefined || Number.isNaN(value) ? null : value);

/** Drives a session for outside software: the observation, events and episode end. */
export function createControlLink(session: DrivingSession, trackId: string): ControlLink {
  const g = session.geometry;
  let hint: number | undefined;
  let episodeStartS = 0;
  let limits = { maxLaps: 1, maxSeconds: 600 };
  let lapsAtStart = 0;
  let wasOff = false;

  const observe = (): Observation => {
    const car = session.snapshot();
    const state = session.state();
    const location = g.locate(car.position.x, car.position.z, hint);
    hint = location.index;
    const yawRad = yawOf(car.rotation);
    const i = location.index;
    const trackHeading = Math.atan2(g.tx[i] ?? 0, g.tz[i] ?? 1);
    const every = Math.max(1, Math.round(AHEAD_SPACING_M / g.spacingM));
    const at = (k: number) => (i + k * every) % g.count;
    const sample = <T>(f: (j: number) => T) => Array.from({ length: AHEAD_SAMPLES }, (_, k) => f(at(k)));
    const surfaces = session.wheelSurfaces();
    const laps = state.laps.slice(lapsAtStart);
    const valid = laps.filter((lap) => lap.valid).map((lap) => lap.timeS);

    return {
      simSeconds: state.simSeconds - episodeStartS,
      position: { ...car.position },
      rotation: { ...car.rotation },
      yawRad,
      velocity: { ...car.linearVelocity },
      speedMps: car.speedMps,
      yawRateRadS: car.angularVelocity.y,
      gear: car.gear,
      rpm: car.rpm,
      wheels: car.wheels.map((wheel, w) => ({
        inContact: wheel.inContact,
        slip: wheel.slip,
        surface: surfaces[w] ?? "road",
      })),
      track: {
        id: trackId,
        lengthM: g.lengthM,
        halfWidthM: g.halfWidthM,
        distanceM: (location.distanceM - session.startDistanceM + g.lengthM) % g.lengthM,
        lateralM: location.lateralM,
        headingErrorRad: wrap(yawRad - trackHeading),
        ahead: {
          spacingM: every * g.spacingM,
          curvature: sample((j) => g.curvature[j] ?? 0),
          leftBarrierM: sample((j) => orNull(session.trackside.left.barrierM[j])),
          rightBarrierM: sample((j) => orNull(session.trackside.right.barrierM[j])),
        },
      },
      lap: {
        completed: laps.length,
        elapsedS: state.lap?.elapsedS ?? null,
        sector: state.lap?.sector ?? null,
        valid: state.lap?.valid ?? null,
        lastLapS: laps.at(-1)?.timeS ?? null,
        bestLapS: valid.length > 0 ? Math.min(...valid) : null,
      },
      energy: state.energy
        ? {
            mode: state.energy.mode,
            socJ: state.energy.socJ,
            deployW: state.energy.deployW,
            regenW: state.energy.regenW,
          }
        : null,
    };
  };

  const finished = () => {
    const state = session.state();

    return (
      state.laps.length - lapsAtStart >= limits.maxLaps || state.simSeconds - episodeStartS >= limits.maxSeconds - 1e-9
    );
  };

  return {
    observe,
    start(request) {
      session.setAssists(request.assists);
      session.setGearboxMode(request.gearbox);
      session.setEnergyMode(request.energyMode);
      session.action("reset");
      const hold = Math.round(session.state().countdownS / session.stepSeconds);
      for (let k = 0; k < hold; k += 1) {
        session.drive({ throttle: 0, brake: 0, steer: 0 });
      }

      const state = session.state();
      episodeStartS = state.simSeconds;
      lapsAtStart = state.laps.length;
      limits = { maxLaps: request.maxLaps, maxSeconds: request.maxSeconds };
      hint = undefined;
      wasOff = false;

      return { observation: observe(), events: [{ type: "reset" }], done: false };
    },
    step(controls, steps) {
      const events: ControlEvent[] = [];

      // A shift is one request, made on the first step only.
      const held: DriverControls = {
        throttle: controls.throttle,
        brake: controls.brake,
        steer: controls.steer,
        deploy: controls.deploy ?? false,
      };
      for (let k = 0; k < steps && !finished(); k += 1) {
        const before = session.state();
        session.drive(k === 0 ? controls : held);
        const after = session.state();
        for (const lap of after.laps.slice(before.laps.length)) {
          events.push({ type: "lap", timeS: lap.timeS, valid: lap.valid, sectorsS: [...lap.sectorsS] });
        }

        if (
          after.lap &&
          before.lap &&
          after.lap.sector !== before.lap.sector &&
          after.laps.length === before.laps.length
        ) {
          events.push({ type: "sector", sector: after.lap.sector, elapsedS: after.lap.elapsedS });
        }

        const off = session.wheelSurfaces().every((surface) => !ON_TRACK.includes(surface));
        if (off !== wasOff) {
          events.push({ type: off ? "offTrack" : "backOnTrack" });
          wasOff = off;
        }
      }

      return { observation: observe(), events, done: finished() };
    },
  };
}
