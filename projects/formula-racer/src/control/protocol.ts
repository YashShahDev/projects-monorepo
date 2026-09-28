import { ALL_ASSISTS } from "../simulation/vehicle.ts";
import type { DriverAssists, DriverControls } from "../simulation/vehicle.ts";
import { ENERGY_MODES, isEnergyMode } from "../content/energy-rules.ts";
import type { EnergyMode } from "../content/energy-rules.ts";
import { GEARBOX_MODES, isGearboxMode } from "../simulation/gearbox.ts";
import type { GearboxMode } from "../simulation/gearbox.ts";

/** Bumped whenever a message, observation or event changes shape or meaning. */
export const CONTROL_VERSION = 1;

/** Most simulation steps one `step` message may ask for (10 simulated seconds). */
export const MAX_STEPS_PER_MESSAGE = 600;

export interface ResetRequest {
  type: "reset";
  track: string | undefined;
  seed: number;
  assists: DriverAssists;
  gearbox: GearboxMode;
  energyMode: EnergyMode;
  maxLaps: number;
  maxSeconds: number;
}

export interface StepRequest {
  type: "step";
  controls: DriverControls;
  steps: number;
}

export type ControlRequest = ResetRequest | StepRequest | { type: "close" };

/** A request that cannot be carried out; the reply says why, and the link stays usable. */
export class ControlError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function numberIn(message: Record<string, unknown>, key: string, min: number, max: number, fallback?: number) {
  const value = message[key];
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ControlError(`${key} must be a number from ${min} to ${max}, got ${JSON.stringify(value)}`);
  }

  return value;
}

function integerIn(message: Record<string, unknown>, key: string, min: number, max: number, fallback: number) {
  const value = numberIn(message, key, min, max, fallback);
  if (!Number.isInteger(value)) {
    throw new ControlError(`${key} must be a whole number, got ${value}`);
  }

  return value;
}

function assistsFrom(value: unknown): DriverAssists {
  if (value === undefined) {
    return { ...ALL_ASSISTS };
  }

  if (!isObject(value)) {
    throw new ControlError("assists must be an object of steering, abs and traction");
  }

  const assists = { ...ALL_ASSISTS };
  for (const key of Object.keys(value)) {
    const flag = value[key];
    if ((key !== "steering" && key !== "abs" && key !== "traction") || typeof flag !== "boolean") {
      throw new ControlError(`assists.${key} is not a known assist flag (steering, abs, traction: true or false)`);
    }

    assists[key] = flag;
  }

  return assists;
}

/** Checks one incoming message and gives it defaults; throws `ControlError` if it is malformed. */
export function parseRequest(message: unknown): ControlRequest {
  if (!isObject(message)) {
    throw new ControlError("a message must be a JSON object with a type");
  }

  if (message.type === "close") {
    return { type: "close" };
  }

  if (message.type === "reset") {
    const { track, gearbox = "automatic", energyMode = "balanced" } = message;
    if (track !== undefined && typeof track !== "string") {
      throw new ControlError("track must be a track id");
    }

    if (!isGearboxMode(gearbox)) {
      throw new ControlError(`gearbox must be one of ${GEARBOX_MODES.join(", ")}`);
    }

    if (!isEnergyMode(energyMode)) {
      throw new ControlError(`energyMode must be one of ${ENERGY_MODES.join(", ")}`);
    }

    return {
      type: "reset",
      track,
      seed: integerIn(message, "seed", 0, 2 ** 32 - 1, 0),
      assists: assistsFrom(message.assists),
      gearbox,
      energyMode,
      maxLaps: integerIn(message, "maxLaps", 1, 100, 1),
      maxSeconds: numberIn(message, "maxSeconds", 1, 7200, 600),
    };
  }

  if (message.type === "step") {
    const { shift, deploy = false } = message;
    if (shift !== undefined && shift !== "up" && shift !== "down") {
      throw new ControlError('shift must be "up" or "down"');
    }

    if (typeof deploy !== "boolean") {
      throw new ControlError("deploy must be true or false");
    }

    const controls: DriverControls = {
      throttle: numberIn(message, "throttle", 0, 1),
      brake: numberIn(message, "brake", 0, 1),
      steer: numberIn(message, "steer", -1, 1),
      deploy,
      ...(shift === undefined ? {} : { shift }),
    };

    return { type: "step", controls, steps: integerIn(message, "steps", 1, MAX_STEPS_PER_MESSAGE, 1) };
  }

  throw new ControlError(`unknown message type ${JSON.stringify(message.type)}; expected reset, step or close`);
}
