import {
  array,
  ContentError,
  extents,
  fetchJson,
  inRange,
  object,
  positive,
  text,
  vec3,
} from "./validate.ts";
import type { Vec3 } from "./validate.ts";

/**
 * Chassis frame: +z forward, +y up, so the driver's right is -x. SI units throughout.
 * Values are gameplay approximations of 2026-style proportions, not regulation data.
 */
export interface CarDefinition {
  version: 1;
  id: string;
  name: string;
  massKg: number;
  /** Relative to the chassis collider centre. */
  centerOfMass: Vec3;
  /** Principal moments about the chassis axes. */
  inertiaKgM2: Vec3;
  chassisHalfExtents: Vec3;
  wheels: {
    frontAxleZ: number;
    rearAxleZ: number;
    halfTrack: number;
    connectionY: number;
    radius: number;
    suspensionRestLength: number;
    maxSuspensionTravel: number;
    suspensionStiffness: number;
    suspensionCompression: number;
    suspensionRelaxation: number;
    maxSuspensionForceN: number;
    /** Peak tyre friction coefficient on the reference (road) surface. */
    frictionCoefficient: number;
    sideFrictionStiffness: number;
  };
  steering: { maxAngleRad: number };
  brakes: { maxForceN: number; frontBias: number };
  powertrain: { maxPowerW: number; maxDriveForceN: number; gearbox: GearboxDefinition };
  aero: {
    /** Drag coefficient × frontal area. */
    dragAreaM2: number;
    /** Lift coefficient × area, as downforce; zero is allowed. */
    downforceAreaM2: number;
    /** Share of downforce acting at the front axle. */
    frontShare: number;
  };
}

export interface GearboxDefinition {
  idleRpm: number;
  /** Automatic shift points; the gap between them stops the box hunting. */
  upshiftRpm: number;
  downshiftRpm: number;
  redlineRpm: number;
  /** Road speed at the redline in each gear, lowest first. */
  gearTopSpeedsKmh: number[];
}

function parseGearbox(value: unknown, source: string): GearboxDefinition {
  const g = object(value, source);
  const redlineRpm = positive(g.redlineRpm, `${source}.redlineRpm`);
  const upshiftRpm = inRange(g.upshiftRpm, `${source}.upshiftRpm`, 1, redlineRpm);
  const downshiftRpm = inRange(g.downshiftRpm, `${source}.downshiftRpm`, 1, upshiftRpm - 1);
  const idleRpm = inRange(g.idleRpm, `${source}.idleRpm`, 1, downshiftRpm);
  const gearTopSpeedsKmh = array(g.gearTopSpeedsKmh, `${source}.gearTopSpeedsKmh`, 1).map(
    (speed, i, all) => {
      const field = `${source}.gearTopSpeedsKmh[${String(i)}]`;
      const value = positive(speed, field);
      const below = i > 0 ? Number(all[i - 1]) : 0;
      if (i > 0 && !(value > below)) {
        throw new ContentError(`${field} must be greater than the gear below`);
      }
      // After an upshift the engine must still be above the downshift point.
      if (i > 0 && (upshiftRpm * below) / value <= downshiftRpm) {
        throw new ContentError(`${field} is too tall: an upshift would land below downshiftRpm`);
      }
      return value;
    },
  );
  return { idleRpm, upshiftRpm, downshiftRpm, redlineRpm, gearTopSpeedsKmh };
}

export function parseCar(value: unknown, source = "car"): CarDefinition {
  const root = object(value, source);
  if (root.version !== 1) throw new ContentError(`${source}.version must be 1`);
  const w = object(root.wheels, `${source}.wheels`);
  const p = (key: string) => positive(w[key], `${source}.wheels.${key}`);
  const steering = object(root.steering, `${source}.steering`);
  const brakes = object(root.brakes, `${source}.brakes`);
  const powertrain = object(root.powertrain, `${source}.powertrain`);
  const aero = object(root.aero, `${source}.aero`);
  const car: CarDefinition = {
    version: 1,
    id: text(root.id, `${source}.id`),
    name: text(root.name, `${source}.name`),
    massKg: positive(root.massKg, `${source}.massKg`),
    centerOfMass: vec3(root.centerOfMass, `${source}.centerOfMass`),
    inertiaKgM2: extents(root.inertiaKgM2, `${source}.inertiaKgM2`),
    chassisHalfExtents: extents(root.chassisHalfExtents, `${source}.chassisHalfExtents`),
    wheels: {
      frontAxleZ: p("frontAxleZ"),
      rearAxleZ: inRange(w.rearAxleZ, `${source}.wheels.rearAxleZ`, -10, 0),
      halfTrack: p("halfTrack"),
      connectionY: inRange(w.connectionY, `${source}.wheels.connectionY`, -2, 2),
      radius: p("radius"),
      suspensionRestLength: p("suspensionRestLength"),
      maxSuspensionTravel: p("maxSuspensionTravel"),
      suspensionStiffness: p("suspensionStiffness"),
      suspensionCompression: p("suspensionCompression"),
      suspensionRelaxation: p("suspensionRelaxation"),
      maxSuspensionForceN: p("maxSuspensionForceN"),
      frictionCoefficient: p("frictionCoefficient"),
      sideFrictionStiffness: p("sideFrictionStiffness"),
    },
    steering: {
      maxAngleRad: inRange(steering.maxAngleRad, `${source}.steering.maxAngleRad`, 0.01, 1),
    },
    brakes: {
      maxForceN: positive(brakes.maxForceN, `${source}.brakes.maxForceN`),
      frontBias: inRange(brakes.frontBias, `${source}.brakes.frontBias`, 0, 1),
    },
    powertrain: {
      maxPowerW: positive(powertrain.maxPowerW, `${source}.powertrain.maxPowerW`),
      maxDriveForceN: positive(powertrain.maxDriveForceN, `${source}.powertrain.maxDriveForceN`),
      gearbox: parseGearbox(powertrain.gearbox, `${source}.powertrain.gearbox`),
    },
    aero: {
      dragAreaM2: positive(aero.dragAreaM2, `${source}.aero.dragAreaM2`),
      downforceAreaM2: inRange(aero.downforceAreaM2, `${source}.aero.downforceAreaM2`, 0, 20),
      frontShare: inRange(aero.frontShare, `${source}.aero.frontShare`, 0, 1),
    },
  };
  return car;
}

export async function fetchCar(
  url: URL,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<CarDefinition> {
  return parseCar(await fetchJson(url, fetchImpl), url.pathname);
}
