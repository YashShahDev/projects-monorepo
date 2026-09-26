import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnergyRules } from "../src/content/energy-rules.ts";
import { createEnergySystem, permittedDeployW } from "../src/simulation/energy.ts";
import type { EnergyInput } from "../src/simulation/energy.ts";

const raw = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../public/assets/rules/energy-2026-c18.json"), "utf8"),
) as Record<string, unknown>;
const rules = parseEnergyRules(raw);
const kmh = (v: number) => v / 3.6;
const DT = 1 / 60;
const cruise = (over: Partial<EnergyInput> = {}): EnergyInput => ({
  speedMps: kmh(200),
  throttle: 1,
  brakePowerW: 0,
  mode: "balanced",
  deployRequest: false,
  dtS: DT,
  ...over,
});

/** A system past the 50 km/h standing-start threshold. */
function rolling() {
  const energy = createEnergySystem(rules);
  energy.update(cruise({ speedMps: kmh(60) }));
  return energy;
}

describe("energy rules content", () => {
  test("the shipped rules name their regulation source", () => {
    expect(rules.source).toContain("Section C Technical Issue 18");
    expect(rules.socWindowJ).toBe(4_000_000);
  });

  test("rejects a deployment curve whose speeds do not increase", () => {
    expect(() =>
      parseEnergyRules({
        ...raw,
        deployCurveKphKw: [
          [0, 350],
          [290, 350],
          [200, 0],
        ],
      }),
    ).toThrow("energy rules.deployCurveKphKw[2] speed must be greater than the point before");
  });

  test("rejects a curve that allows more than the ERS maximum", () => {
    expect(() =>
      parseEnergyRules({
        ...raw,
        deployCurveKphKw: [
          [0, 400],
          [345, 0],
        ],
      }),
    ).toThrow("energy rules.deployCurveKphKw[0][1]");
  });
});

describe("permitted deployment (C5.2.8 i)", () => {
  test.each([
    [100, 350],
    [290, 350],
    // 1800 - 5 * 300 = 300 kW
    [300, 300],
    // 6900 - 20 * 342 = 60 kW
    [342, 60],
    [345, 0],
    [360, 0],
  ])("at %d km/h up to %d kW", (speedKmh, kw) => {
    expect(permittedDeployW(rules, kmh(speedKmh)) / 1000).toBeCloseTo(kw, 6);
  });
});

describe("energy system", () => {
  test("starts full and Balanced deploys its share, draining through the deploy efficiency", () => {
    const energy = rolling();
    const before = energy.state().socJ;
    expect(before).toBeCloseTo(rules.socWindowJ - (0.6 * 350_000 * DT) / 0.95, 3);
    const flow = energy.update(cruise());
    expect(flow.deployW).toBeCloseTo(0.6 * 350_000, 6);
    expect(before - flow.socJ).toBeCloseTo((0.6 * 350_000 * DT) / 0.95, 6);
  });

  test("holding Shift requests the full permitted power", () => {
    expect(rolling().update(cruise({ deployRequest: true })).deployW).toBeCloseTo(350_000, 6);
    expect(
      rolling().update(cruise({ deployRequest: true, speedMps: kmh(300) })).deployW,
    ).toBeCloseTo(300_000, 6);
  });

  test("no deployment off throttle, and none from a standing start below 50 km/h", () => {
    expect(rolling().update(cruise({ throttle: 0 })).deployW).toBe(0);
    const fresh = createEnergySystem(rules);
    expect(fresh.update(cruise({ speedMps: kmh(40) })).deployW).toBe(0);
    fresh.update(cruise({ speedMps: kmh(51) }));
    // Once past 50 km/h, deployment stays available even back below it.
    expect(fresh.update(cruise({ speedMps: kmh(40) })).deployW).toBeGreaterThan(0);
  });

  test("an empty battery stops deployment", () => {
    const energy = rolling();
    let flow = energy.update(cruise({ deployRequest: true }));
    for (let i = 0; i < 60 * 20 && flow.socJ > 0; i += 1)
      flow = energy.update(cruise({ deployRequest: true }));
    expect(flow.socJ).toBe(0);
    expect(energy.update(cruise({ deployRequest: true })).deployW).toBe(0);
  });

  test("braking regenerates up to the ERS limit and blends the rest to friction", () => {
    const energy = rolling();
    for (let i = 0; i < 120; i += 1) energy.update(cruise({ deployRequest: true }));
    const flow = energy.update(cruise({ throttle: 0, brakePowerW: 1_000_000 }));
    expect(flow.regenW).toBeCloseTo(350_000, 6);
    expect(flow.frictionBrakeW).toBeCloseTo(650_000, 6);
    const light = energy.update(cruise({ throttle: 0, brakePowerW: 100_000 }));
    expect(light.regenW).toBeCloseTo(100_000, 6);
    expect(light.frictionBrakeW).toBe(0);
  });

  test("a full battery sends all braking to friction", () => {
    const energy = createEnergySystem(rules);
    const flow = energy.update(cruise({ throttle: 0, brakePowerW: 500_000 }));
    expect(flow.regenW).toBe(0);
    expect(flow.frictionBrakeW).toBe(500_000);
  });

  test("Harvest deploys nothing and charges on lift-off", () => {
    const energy = rolling();
    for (let i = 0; i < 120; i += 1) energy.update(cruise({ deployRequest: true }));
    expect(energy.update(cruise({ mode: "harvest" })).deployW).toBe(0);
    expect(energy.update(cruise({ mode: "harvest", throttle: 0 })).regenW).toBeCloseTo(120_000, 6);
    expect(energy.update(cruise({ mode: "balanced", throttle: 0 })).regenW).toBe(0);
  });

  test("recharge stops at the per-lap limit until the next lap", () => {
    const energy = rolling();
    let lapRecharge = 0;
    // Alternate draining and braking until the lap's recharge allowance is used up.
    for (let i = 0; i < 60 * 120 && lapRecharge < rules.rechargePerLapJ; i += 1) {
      energy.update(cruise({ deployRequest: true }));
      lapRecharge = energy.update(cruise({ throttle: 0, brakePowerW: 2_000_000 })).lapRechargeJ;
    }
    expect(lapRecharge).toBeCloseTo(rules.rechargePerLapJ, 0);
    energy.update(cruise({ deployRequest: true }));
    expect(energy.update(cruise({ throttle: 0, brakePowerW: 2_000_000 })).regenW).toBe(0);
    energy.newLap();
    expect(energy.update(cruise({ throttle: 0, brakePowerW: 2_000_000 })).regenW).toBeGreaterThan(
      0,
    );
  });

  test("energy is conserved: charge change equals regen in minus deployment out", () => {
    const energy = rolling();
    const start = energy.state().socJ;
    let expected = start;
    // A deterministic mix of deploying, coasting and braking at varying speeds.
    for (let i = 0; i < 3000; i += 1) {
      const phase = i % 7;
      const flow = energy.update(
        cruise({
          speedMps: kmh(80 + ((i * 37) % 260)),
          throttle: phase < 3 ? 1 : 0,
          brakePowerW: phase >= 5 ? 800_000 : 0,
          deployRequest: phase === 1,
          mode: i % 500 < 250 ? "balanced" : "harvest",
        }),
      );
      expected +=
        flow.regenW * DT * rules.regenEfficiency - (flow.deployW * DT) / rules.deployEfficiency;
      expect(flow.socJ).toBeGreaterThanOrEqual(0);
      expect(flow.socJ).toBeLessThanOrEqual(rules.socWindowJ);
    }
    expect(energy.state().socJ).toBeCloseTo(expected, 3);
  });

  test("deployment never exceeds what the drivetrain can use", () => {
    const flow = rolling().update(cruise({ deployRequest: true, limitW: 50_000 }));
    expect(flow.deployW).toBe(50_000);
  });
});
