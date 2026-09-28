import { array, ContentError, fetchJson, inRange, object, positive, text } from "./validate.ts";

/** Driver-selectable energy modes, from harvesting most to deploying most. */
export const ENERGY_MODES = ["harvest", "balanced", "attack", "qualifying"] as const;
export type EnergyMode = (typeof ENERGY_MODES)[number];

export function isEnergyMode(value: unknown): value is EnergyMode {
  return ENERGY_MODES.some((mode) => mode === value);
}

/** Gameplay: how one energy mode deploys and harvests. */
export interface EnergyModeRules {
  name: string;

  /** Share of permitted power deployed on full throttle without the deploy key. */
  deployShare: number;

  /** Charging power off throttle and off the brakes. */
  liftOffHarvestW: number;
}

/**
 * Versioned, sourced energy-management rules. Values come from the regulation named in
 * `source`, apart from the gameplay parameters marked below.
 */
export interface EnergyRules {
  version: 2;
  id: string;
  name: string;
  source: string;
  ersMaxPowerW: number;

  /** C5.2.11: MGU-K torque referenced to the crankshaft. */
  mgukMaxTorqueNm: number;

  /** [km/h, kW] points; permitted deployment is linear between them, zero past the last. */
  deployCurveKphKw: [number, number][];
  socWindowJ: number;
  rechargePerLapJ: number;
  standingStartDeployKph: number;

  /** Gameplay: fixed conversion losses at the energy store. */
  deployEfficiency: number;
  regenEfficiency: number;

  modes: Record<EnergyMode, EnergyModeRules>;
}

// Deployment searches the curve every step; real curves need a handful of points.
const MAX_CURVE_POINTS = 64;

export function parseEnergyRules(value: unknown, source = "energy rules"): EnergyRules {
  const root = object(value, source);
  if (root.version !== 2) {
    throw new ContentError(`${source}.version must be 2`);
  }

  const ersMaxPowerW = positive(root.ersMaxPowerW, `${source}.ersMaxPowerW`);
  const curve: [number, number][] = [];
  array(root.deployCurveKphKw, `${source}.deployCurveKphKw`, 2, MAX_CURVE_POINTS).forEach((point, i) => {
    const field = `${source}.deployCurveKphKw[${String(i)}]`;
    const pair = array(point, field, 2);
    const kph = inRange(pair[0], `${field}[0]`, 0, 500);
    const kw = inRange(pair[1], `${field}[1]`, 0, ersMaxPowerW / 1000);

    // Deployment is interpolated between points, so a curve starting above 0 km/h would
    // be extrapolated below it, possibly to negative power.
    if (i === 0 && kph !== 0) {
      throw new ContentError(`${field} must start at 0 km/h`);
    }

    const before = curve.at(-1);
    if (before && !(kph > before[0])) {
      throw new ContentError(`${field} speed must be greater than the point before`);
    }

    curve.push([kph, kw]);
  });

  const modes = object(root.modes, `${source}.modes`);
  const mode = (id: EnergyMode): EnergyModeRules => {
    const field = `${source}.modes.${id}`;
    const row = object(modes[id], field);

    return {
      name: text(row.name, `${field}.name`),
      deployShare: inRange(row.deployShare, `${field}.deployShare`, 0, 1),
      liftOffHarvestW: inRange(row.liftOffHarvestW, `${field}.liftOffHarvestW`, 0, ersMaxPowerW),
    };
  };

  return {
    version: 2,
    id: text(root.id, `${source}.id`),
    name: text(root.name, `${source}.name`),
    source: text(root.source, `${source}.source`),
    ersMaxPowerW,
    mgukMaxTorqueNm: positive(root.mgukMaxTorqueNm, `${source}.mgukMaxTorqueNm`),
    deployCurveKphKw: curve,
    socWindowJ: positive(root.socWindowJ, `${source}.socWindowJ`),
    rechargePerLapJ: positive(root.rechargePerLapJ, `${source}.rechargePerLapJ`),
    standingStartDeployKph: inRange(root.standingStartDeployKph, `${source}.standingStartDeployKph`, 0, 200),
    deployEfficiency: inRange(root.deployEfficiency, `${source}.deployEfficiency`, 0.5, 1),
    regenEfficiency: inRange(root.regenEfficiency, `${source}.regenEfficiency`, 0.5, 1),
    modes: {
      harvest: mode("harvest"),
      balanced: mode("balanced"),
      attack: mode("attack"),
      qualifying: mode("qualifying"),
    },
  };
}

export async function fetchEnergyRules(
  url: URL,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<EnergyRules> {
  return parseEnergyRules(await fetchJson(url, fetchImpl), url.pathname);
}
