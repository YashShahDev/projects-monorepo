import type { EnergyRules } from "../content/energy-rules.ts";

export type EnergyMode = "balanced" | "harvest";

export interface EnergyInput {
  speedMps: number;
  throttle: number;
  /** Braking power the driver asks for, W; regeneration takes what it can first. */
  brakePowerW: number;
  mode: EnergyMode;
  /** Driver holding the deploy key: the full permitted power instead of the mode's share. */
  deployRequest: boolean;
  dtS: number;
}

export interface EnergyFlow {
  deployW: number;
  regenW: number;
  /** The share of requested braking left to the friction brakes. */
  frictionBrakeW: number;
  socJ: number;
  /** Recharge counted against this lap's limit. */
  lapRechargeJ: number;
}

export interface EnergySystem {
  update(input: EnergyInput): EnergyFlow;
  /** Starts a new lap's Recharge allowance. */
  newLap(): void;
  /** Back to a full store and a standing start. */
  reset(): void;
  state(): { socJ: number; lapRechargeJ: number };
}

/** C5.2.8 (i): permitted ERS-K propulsion power at a road speed. */
export function permittedDeployW(rules: EnergyRules, speedMps: number): number {
  const kph = Math.abs(speedMps) * 3.6;
  const curve = rules.deployCurveKphKw;
  const last = curve.at(-1);
  if (!last || kph >= last[0]) return 0;
  for (let i = 1; i < curve.length; i += 1) {
    const [k1, p1] = curve[i] ?? last;
    const [k0, p0] = curve[i - 1] ?? last;
    if (kph <= k1)
      return Math.min(rules.ersMaxPowerW, (p0 + ((p1 - p0) * (kph - k0)) / (k1 - k0)) * 1000);
  }
  return 0;
}

export function createEnergySystem(rules: EnergyRules): EnergySystem {
  let socJ = rules.socWindowJ;
  let lapRechargeJ = 0;
  let launched = false;
  return {
    update({ speedMps, throttle, brakePowerW, mode, deployRequest, dtS }) {
      if (Math.abs(speedMps) * 3.6 >= rules.standingStartDeployKph) launched = true;
      let deployW = 0;
      if (launched && throttle > 0 && mode !== "harvest") {
        const share = deployRequest ? 1 : rules.balancedDeployShare;
        deployW = throttle * share * permittedDeployW(rules, speedMps);
        // Never draw more than is stored.
        deployW = Math.min(deployW, (socJ * rules.deployEfficiency) / dtS);
      }
      const liftOff = mode === "harvest" && throttle === 0 ? rules.liftOffHarvestW : 0;
      const wanted = Math.min(rules.ersMaxPowerW, brakePowerW + liftOff);
      const roomJ = Math.min(
        (rules.socWindowJ - (socJ - (deployW * dtS) / rules.deployEfficiency)) /
          rules.regenEfficiency,
        rules.rechargePerLapJ - lapRechargeJ,
      );
      const regenW = Math.max(0, Math.min(wanted, roomJ / dtS));
      // Regeneration serves the requested braking first; only braking beyond it is friction.
      const frictionBrakeW = Math.max(0, brakePowerW - Math.min(regenW, brakePowerW));
      socJ += regenW * dtS * rules.regenEfficiency - (deployW * dtS) / rules.deployEfficiency;
      socJ = Math.min(rules.socWindowJ, Math.max(0, socJ));
      lapRechargeJ += regenW * dtS;
      return { deployW, regenW, frictionBrakeW, socJ, lapRechargeJ };
    },
    newLap() {
      lapRechargeJ = 0;
    },
    reset() {
      socJ = rules.socWindowJ;
      lapRechargeJ = 0;
      launched = false;
    },
    state: () => ({ socJ, lapRechargeJ }),
  };
}
