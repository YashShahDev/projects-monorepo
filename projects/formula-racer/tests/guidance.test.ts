import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { guidance, guideTint, gripShare } from "../src/simulation/guidance.ts";
import type { Guidance } from "../src/simulation/guidance.ts";
import { buildRacingLine, lineLimits } from "../src/simulation/racing-line.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { car } from "./support/vehicle.ts";

const harbour = buildTrackGeometry(
  parseTrack(JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"))),
);
const limits = lineLimits(car);
const line = buildRacingLine(harbour, limits);
const n = line.count;

// The heaviest braking zone on the lap: where the profile loses the most speed.
const zone = (() => {
  let best = { start: 0, lossMps: 0 };
  for (let i = 0; i < n; i += 1) {
    if (line.phase[i] !== "brake" || line.phase[(i - 1 + n) % n] === "brake") {
      continue;
    }

    let end = i;
    while (line.phase[end % n] === "brake") {
      end += 1;
    }

    const lossMps = (line.speedMps[i] ?? 0) - (line.speedMps[end % n] ?? 0);
    if (lossMps > best.lossMps) {
      best = { start: i, lossMps };
    }
  }

  return best;
})();

// 200 m before that zone starts, on the line.
const before = (zone.start - 100 + n) % n;
const onLine = (speedMps: number, share = 1) =>
  guidance({ x: line.x[before] ?? 0, z: line.z[before] ?? 0, index: before, speedMps, gripShare: share }, line, limits);

const firstBrakeM = (g: Guidance) => {
  const k = g.phase.indexOf("brake");

  return k < 0 ? Infinity : (g.aheadM[k] ?? Infinity);
};

const brakeWork = (g: Guidance) => g.pedal.reduce((sum, p, k) => sum + Math.max(0, -p) * (g.stepM[k] ?? 0), 0);

describe("guidance", () => {
  test("covers the next 300 m of line from the car", () => {
    const g = onLine(line.speedMps[before] ?? 0);
    expect(g.index[0]).toBe(before);
    expect(g.aheadM[0]).toBe(0);
    expect(g.aheadM.at(-1) ?? 0).toBeGreaterThan(295);
    expect(g.aheadM.at(-1) ?? 0).toBeLessThan(305);
    for (const p of g.pedal) {
      expect(Math.abs(p)).toBeLessThanOrEqual(1);
    }
  });

  test("at the line's own speed, shows throttle, then a lift, then the braking zone", () => {
    expect(zone.lossMps).toBeGreaterThan(15);
    const g = onLine(line.speedMps[before] ?? 0);
    expect(g.phase[0]).toBe("go");
    const brake = g.phase.indexOf("brake");
    expect(brake).toBeGreaterThan(0);

    // The zone begins where the profile's does, within a few metres.
    expect(Math.abs(firstBrakeM(g) - 200)).toBeLessThan(8);
    expect(g.phase[brake - 1]).toBe("lift");

    // Braking from high speed uses the full pedal.
    expect(Math.min(...g.pedal)).toBeLessThan(-0.9);
  });

  test("a car faster than the line brakes earlier and harder", () => {
    const planned = onLine(line.speedMps[before] ?? 0);
    const fast = onLine((line.speedMps[before] ?? 0) + 12);
    expect(firstBrakeM(fast)).toBeLessThan(firstBrakeM(planned) - 20);
    expect(brakeWork(fast)).toBeGreaterThan(brakeWork(planned) * 1.1);
  });

  test("a slower car is told to brake later and less, never before the zone", () => {
    const planned = onLine(line.speedMps[before] ?? 0);
    const slow = onLine((line.speedMps[before] ?? 0) * 0.5);
    expect(firstBrakeM(slow)).toBeGreaterThanOrEqual(firstBrakeM(planned));
    expect(brakeWork(slow)).toBeLessThan(brakeWork(planned));
  });

  test("with less grip under the car, it shows the brakes sooner", () => {
    const speed = line.speedMps[before] ?? 0;
    const grippy = onLine(speed, 1);
    const onGrass = onLine(speed, 0.6);
    expect(firstBrakeM(onGrass)).toBeLessThan(firstBrakeM(grippy) - 20);
  });

  test("off the line, it bends back to it, over a longer run at speed", () => {
    const i = before;
    const j = (i + 1) % n;
    const [dx, dz] = [(line.x[j] ?? 0) - (line.x[i] ?? 0), (line.z[j] ?? 0) - (line.z[i] ?? 0)];
    const length = Math.hypot(dx, dz);

    // 3 m to the left of the line (left of travel along (dx, dz) is (dz, −dx)).
    const [x, z] = [(line.x[i] ?? 0) + (3 * dz) / length, (line.z[i] ?? 0) - (3 * dx) / length];
    const away = (g: Guidance) =>
      Array.from(g.index, (p, k) => Math.hypot((g.x[k] ?? 0) - (line.x[p] ?? 0), (g.z[k] ?? 0) - (line.z[p] ?? 0)));
    const rejoinM = (g: Guidance) => g.aheadM[away(g).findIndex((d) => d < 0.01)] ?? Infinity;

    const slow = guidance({ x, z, index: i, speedMps: 30, gripShare: 1 }, line, limits);
    const gaps = away(slow);
    expect(gaps[0]).toBeCloseTo(3, 1);
    gaps.slice(1).forEach((gap, k) => {
      expect(gap).toBeLessThanOrEqual((gaps[k] ?? 0) + 1e-9);
    });
    expect(rejoinM(slow)).toBeGreaterThanOrEqual(55);
    expect(rejoinM(slow)).toBeLessThanOrEqual(65);

    const quick = guidance({ x, z, index: i, speedMps: 80, gripShare: 1 }, line, limits);
    expect(rejoinM(quick)).toBeGreaterThan(110);
    expect(rejoinM(quick)).toBeLessThanOrEqual(125);
  });

  test("on the line, it is the line", () => {
    const g = onLine(40);
    g.index.forEach((p, k) => {
      expect(g.x[k]).toBeCloseTo(line.x[p] ?? 0, 6);
      expect(g.z[k]).toBeCloseTo(line.z[p] ?? 0, 6);
    });
  });
});

describe("guide colours", () => {
  const brightness = ([r, g, b]: readonly number[]) => (r ?? 0) + (g ?? 0) + (b ?? 0);

  test("green deepens with throttle and red with brake; a lift is yellow", () => {
    const [light, full] = [guideTint(0.2, "go"), guideTint(1, "go")];
    expect(full[1]).toBeGreaterThan(full[0] + 0.3);
    expect(brightness(full)).toBeGreaterThan(brightness(light));

    const [soft, hard] = [guideTint(-0.2, "brake"), guideTint(-1, "brake")];
    expect(hard[0]).toBeGreaterThan(hard[1] + 0.4);
    expect(hard[0] - hard[1]).toBeGreaterThan(soft[0] - soft[1]);

    const lift = guideTint(0, "lift");
    expect(lift[0]).toBeGreaterThan(0.8);
    expect(lift[1]).toBeGreaterThan(0.6);
    expect(lift[2]).toBeLessThan(0.3);
  });

  // Screenshot tests count strong red with little green as the car.
  test("the brake red never looks like the car's", () => {
    for (const pedal of [-0.05, -0.5, -1]) {
      expect(guideTint(pedal, "brake")[1]).toBeGreaterThan(80 / 255);
    }
  });
});

describe("grip share", () => {
  const road = { road: 1, kerb: 0.9, grass: 0.6, gravel: 0.5 };

  test("is the tyres' mean grip against the road's, lower for a sliding tyre", () => {
    expect(gripShare(["road", "road", "road", "road"], ["none", "none", "none", "none"], road)).toBe(1);
    expect(gripShare(["grass", "grass", "road", "road"], ["none", "none", "none", "none"], road)).toBeCloseTo(0.8, 9);
    expect(gripShare(["road", "road", "road", "road"], ["sliding", "none", "none", "none"], road)).toBeLessThan(1);
    expect(gripShare(["asphalt", "road", "road", "road"], ["none", "none", "none", "none"], road)).toBe(1);
  });
});
