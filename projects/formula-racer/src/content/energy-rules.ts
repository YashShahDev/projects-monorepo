import { array, ContentError, fetchJson, inRange, object, positive, text } from "./validate.ts";

/**
 * Versioned, sourced energy-management rules. Values come from the regulation named in
 * `source`, apart from the gameplay parameters marked below.
 */
export interface EnergyRules {
  version: 1;
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

  /** Gameplay: share of permitted power Balanced mode deploys without a request. */
  balancedDeployShare: number;

  /** Gameplay: charging power in Harvest mode off throttle. */
  liftOffHarvestW: number;
}

export function parseEnergyRules(value: unknown, source = "energy rules"): EnergyRules {
  const root = object(value, source);
  if (root.version !== 1) {
    throw new ContentError(`${source}.version must be 1`);
  }

  const ersMaxPowerW = positive(root.ersMaxPowerW, `${source}.ersMaxPowerW`);
  const curve = array(root.deployCurveKphKw, `${source}.deployCurveKphKw`, 2).map((point, i, all): [number, number] => {
    const field = `${source}.deployCurveKphKw[${String(i)}]`;
    const pair = array(point, field, 2);
    const kph = inRange(pair[0], `${field}[0]`, 0, 500);
    const kw = inRange(pair[1], `${field}[1]`, 0, ersMaxPowerW / 1000);
    const before = i > 0 ? Number((all[i - 1] as unknown[] | undefined)?.[0]) : -1;
    if (!(kph > before)) {
      throw new ContentError(`${field} speed must be greater than the point before`);
    }

    return [kph, kw];
  });

  return {
    version: 1,
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
    balancedDeployShare: inRange(root.balancedDeployShare, `${source}.balancedDeployShare`, 0, 1),
    liftOffHarvestW: inRange(root.liftOffHarvestW, `${source}.liftOffHarvestW`, 0, ersMaxPowerW),
  };
}

export async function fetchEnergyRules(
  url: URL,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<EnergyRules> {
  return parseEnergyRules(await fetchJson(url, fetchImpl), url.pathname);
}
