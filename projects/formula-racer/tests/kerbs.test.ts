import { describe, expect, test } from "bun:test";
import { parseTrack } from "../src/content/track.ts";
import { KERB_TYPES, kerbHeightM, kerbMeshes, planKerbs } from "../src/simulation/kerbs.ts";
import type { Kerb } from "../src/simulation/kerbs.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import type { TrackGeometry } from "../src/simulation/track-geometry.ts";
import { readJsonObject } from "./support/json.ts";

const load = (id: string) => {
  const track = parseTrack(readJsonObject(`public/assets/tracks/${id}.json`));

  return { track, geometry: buildTrackGeometry(track) };
};

const TRACKS = ["harbour", "riviera", "ardennes", "royal-park", "corniche", "test-loop"].map((id) => ({
  id,
  ...load(id),
}));

// Distance along the lap from a to b, going forwards.
const ahead = (g: TrackGeometry, a: number, b: number) => (((b - a) % g.lengthM) + g.lengthM) % g.lengthM;

const samplesOf = (g: TrackGeometry, kerb: Kerb) => {
  const out: number[] = [];
  for (let d = kerb.fromM; d <= kerb.toM; d += g.spacingM) {
    out.push(Math.round((((d % g.lengthM) + g.lengthM) % g.lengthM) / g.spacingM) % g.count);
  }

  return out;
};

describe("the kerb plan", () => {
  test.each(TRACKS)("$id: kerbs sit only where the track turns, never on a straight", ({ geometry }) => {
    const plan = planKerbs(geometry);
    expect(plan.kerbs.length).toBeGreaterThan(0);
    for (const kerb of plan.kerbs) {
      const turning = samplesOf(geometry, kerb).some((i) => Math.abs(geometry.curvature[i] ?? 0) > 1 / 300);
      expect(turning).toBe(true);
    }
  });

  test.each(TRACKS)("$id: kerbs on each side are separate, with gaps between them", ({ geometry }) => {
    const plan = planKerbs(geometry);
    for (const side of ["left", "right"] as const) {
      const own = plan.kerbs.filter((k) => k.side === side).sort((a, b) => a.fromM - b.fromM);
      const covered = own.reduce((sum, k) => sum + (k.toM - k.fromM), 0);
      expect(covered).toBeLessThan(0.6 * geometry.lengthM);
      own.forEach((kerb, i) => {
        expect(kerb.toM).toBeGreaterThan(kerb.fromM);
        const next = own[(i + 1) % own.length];
        if (next && next !== kerb) {
          expect(ahead(geometry, kerb.toM, next.fromM)).toBeGreaterThanOrEqual(2);
        }
      });
    }
  });

  test.each(TRACKS)("$id: every kerb fits the kerb band, at a real height", ({ geometry }) => {
    for (const kerb of planKerbs(geometry).kerbs) {
      expect(kerb.widthM).toBeGreaterThan(0.3);
      expect(kerb.widthM).toBeLessThanOrEqual(geometry.kerbWidthM);
      expect(kerb.heightM).toBeGreaterThanOrEqual(0.02);
      expect(kerb.heightM).toBeLessThanOrEqual(0.08);
    }
  });

  test.each(TRACKS)("$id: no kerb crosses the start line", ({ geometry, track }) => {
    for (const kerb of planKerbs(geometry, track.startDistanceM).kerbs) {
      expect(ahead(geometry, kerb.fromM, track.startDistanceM)).toBeGreaterThan(kerb.toM - kerb.fromM + 10);
    }
  });

  test("kerbs vary around a lap: more than one type, and more than one width", () => {
    const { geometry } = load("harbour");
    const { kerbs } = planKerbs(geometry);
    expect(new Set(kerbs.map((k) => k.type)).size).toBeGreaterThan(1);
    expect(new Set(kerbs.map((k) => k.widthM.toFixed(2))).size).toBeGreaterThan(1);
    for (const type of new Set(kerbs.map((k) => k.type))) {
      expect(KERB_TYPES).toContain(type);
    }
  });

  test("the plan is the same every time it is built", () => {
    const { geometry } = load("riviera");
    expect(planKerbs(geometry).kerbs).toEqual(planKerbs(geometry).kerbs);
  });

  test("finds the kerb at a point on either side, across the lap's wrap, and none in a gap", () => {
    const { geometry } = load("harbour");
    const plan = planKerbs(geometry);
    for (const kerb of plan.kerbs) {
      const middle = (kerb.fromM + kerb.toM) / 2;
      expect(plan.at(middle % geometry.lengthM, kerb.side)).toEqual(kerb);
      expect(plan.at((middle % geometry.lengthM) + geometry.lengthM, kerb.side)).toEqual(kerb);
    }

    const [first] = plan.kerbs;
    if (!first) {
      throw new Error("a kerb expected");
    }

    expect(plan.at(first.fromM - 1, first.side)).not.toEqual(first);
    expect(plan.at(first.toM + 1, first.side)).not.toEqual(first);
  });
});

describe("a kerb's profile", () => {
  const kerb = (type: Kerb["type"]): Kerb => ({
    side: "left",
    fromM: 100,
    toM: 130,
    type,
    widthM: 1.2,
    heightM: type === "sausage" ? 0.075 : 0.04,
  });

  test("is zero off the kerb and ramps up from each end", () => {
    const k = kerb("flat");
    expect(kerbHeightM(k, 99, 0.5)).toBe(0);
    expect(kerbHeightM(k, 131, 0.5)).toBe(0);
    expect(kerbHeightM(k, 115, -0.1)).toBe(0);
    expect(kerbHeightM(k, 115, 1.3)).toBe(0);
    expect(kerbHeightM(k, 100.2, 0.6)).toBeLessThan(kerbHeightM(k, 101, 0.6));
    expect(kerbHeightM(k, 115, 0.6)).toBeCloseTo(0.04, 6);
  });

  test("a flat kerb slopes gently up from the road; a sausage rises at its outer edge", () => {
    const flat = kerb("flat");
    expect(kerbHeightM(flat, 115, 0.05)).toBeLessThan(kerbHeightM(flat, 115, 0.6));
    const sausage = kerb("sausage");
    expect(kerbHeightM(sausage, 115, 1.0)).toBeGreaterThan(kerbHeightM(sausage, 115, 0.3) + 0.03);
    const stepped = kerb("stepped");
    expect(kerbHeightM(stepped, 115, 1.0)).toBeGreaterThan(kerbHeightM(stepped, 115, 0.3));
  });

  test("never exceeds the kerb's height", () => {
    for (const type of KERB_TYPES) {
      const k = kerb(type);
      for (let along = 99; along <= 131; along += 0.25) {
        for (let across = -0.2; across <= 1.4; across += 0.05) {
          const h = kerbHeightM(k, along, across);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(k.heightM + 1e-9);
        }
      }
    }
  });
});

describe("kerb meshes", () => {
  const { geometry, track } = load("harbour");
  const plan = planKerbs(geometry, track.startDistanceM);
  const meshes = kerbMeshes(geometry, plan.kerbs);

  test("cut every kerb into chunks no longer than 8 m, covering it end to end", () => {
    const covered = new Map<Kerb, number>();
    for (const mesh of meshes) {
      expect(mesh.toM - mesh.fromM).toBeLessThanOrEqual(8 + 1e-9);
      covered.set(mesh.kerb, (covered.get(mesh.kerb) ?? 0) + (mesh.toM - mesh.fromM));
    }

    for (const kerb of plan.kerbs) {
      expect(covered.get(kerb)).toBeCloseTo(kerb.toM - kerb.fromM, 6);
    }
  });

  test("put each vertex on the kerb's profile, on its own side of the road", () => {
    for (const mesh of meshes.slice(0, 40)) {
      const p = mesh.positions;
      for (let v = 0; v < p.length; v += 3) {
        const x = p[v] ?? 0;
        const y = p[v + 1] ?? 0;
        const z = p[v + 2] ?? 0;
        const at = geometry.locate(x, z);
        const across = Math.abs(at.lateralM) - geometry.halfWidthM;
        expect(Math.sign(at.lateralM)).toBe(mesh.kerb.side === "left" ? 1 : -1);
        expect(across).toBeGreaterThan(-0.05);
        expect(across).toBeLessThan(mesh.kerb.widthM + 0.05);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(mesh.kerb.heightM + 1e-6);
      }
    }
  });

  test("face up, and index only their own vertices", () => {
    for (const mesh of meshes.slice(0, 40)) {
      const p = mesh.positions;
      const vertices = p.length / 3;
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a, b, c] = [mesh.indices[t] ?? 0, mesh.indices[t + 1] ?? 0, mesh.indices[t + 2] ?? 0];
        expect(Math.max(a, b, c)).toBeLessThan(vertices);
        const ux = (p[b * 3] ?? 0) - (p[a * 3] ?? 0);
        const uz = (p[b * 3 + 2] ?? 0) - (p[a * 3 + 2] ?? 0);
        const vx = (p[c * 3] ?? 0) - (p[a * 3] ?? 0);
        const vz = (p[c * 3 + 2] ?? 0) - (p[a * 3 + 2] ?? 0);

        // The normal's y is the cross product's y: positive for a face seen from above.
        expect(uz * vx - ux * vz).toBeGreaterThan(0);
      }
    }
  });

  test("know their centre and reach, for streaming near the car", () => {
    for (const mesh of meshes) {
      const p = mesh.positions;
      for (let v = 0; v < p.length; v += 3) {
        expect(Math.hypot((p[v] ?? 0) - mesh.x, (p[v + 2] ?? 0) - mesh.z)).toBeLessThanOrEqual(mesh.radiusM + 1e-6);
      }
    }
  });
});
