import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { findCorners } from "../src/app/track-map.ts";
import { layoutScenery } from "../src/rendering/scenery-layout.ts";
import type { Footprint } from "../src/rendering/scenery-layout.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { buildTrackside } from "../src/simulation/trackside.ts";

const load = (id: string) => {
  const track = parseTrack(
    JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")),
  );
  const geometry = buildTrackGeometry(track);
  const trackside = buildTrackside(geometry);

  return { track, geometry, trackside, scenery: layoutScenery(geometry, trackside, track.startDistanceM) };
};

const harbour = load("harbour");

/** The four ground corners of a footprint. */
function corners(f: Footprint) {
  const fx = Math.sin(f.headingRad);
  const fz = Math.cos(f.headingRad);

  return [-1, 1].flatMap((a) =>
    [-1, 1].map((b) => ({
      x: f.x + fx * a * (f.lengthM / 2) + fz * b * (f.depthM / 2),
      z: f.z + fz * a * (f.lengthM / 2) - fx * b * (f.depthM / 2),
    })),
  );
}

describe("scenery layout", () => {
  for (const id of ["harbour", "test-loop"]) {
    test(`on ${id}, no stand or building comes within its barrier's reach of the track`, () => {
      const { geometry, trackside, scenery } = id === "harbour" ? harbour : load(id);
      const clear = geometry.halfWidthM + geometry.kerbWidthM + 4;
      for (const f of [...scenery.grandstands, ...scenery.buildings, ...scenery.marshals]) {
        for (const p of [f, ...corners(f)]) {
          expect(trackside.distanceToTrack(p.x, p.z, 80)).toBeGreaterThan(clear);
        }
      }

      expect(scenery.grandstands.length).toBeGreaterThan(0);
    });
  }

  for (const id of ["harbour", "test-loop"]) {
    test(`on ${id}, no barrier runs through a stand or building`, () => {
      const { trackside, scenery } = id === "harbour" ? harbour : load(id);
      for (const f of [...scenery.grandstands, ...scenery.buildings, ...scenery.marshals]) {
        const fx = Math.sin(f.headingRad);
        const fz = Math.cos(f.headingRad);
        for (const run of trackside.barriers) {
          for (const p of run.points) {
            const dx = p.x - f.x;
            const dz = p.z - f.z;
            const along = dx * fx + dz * fz;
            const across = dx * fz - dz * fx;
            const inside = Math.abs(along) <= f.lengthM / 2 && Math.abs(across) <= f.depthM / 2;
            expect(inside).toBe(false);
          }
        }
      }
    });
  }

  test("never places more than seven corner stands, even when the main stand does not fit", () => {
    // Harbour's turn 1 apex has no room for the main stand and pits.
    const apex = findCorners(harbour.geometry)[0]?.apexM ?? 0;
    const crowded = layoutScenery(harbour.geometry, harbour.trackside, apex);
    expect(crowded.buildings).toEqual([]);
    expect(crowded.grandstands.length).toBeLessThanOrEqual(7);
  });

  test("a grandstand and the pit building face each other across the start straight", () => {
    const start = harbour.geometry.pointAt(harbour.track.startDistanceM);
    const near = (f: Footprint) => Math.hypot(f.x - start.x, f.z - start.z) < 60;
    const stand = harbour.scenery.grandstands.find(near);
    const pits = harbour.scenery.buildings.find((b) => b.kind === "pits");
    expect(stand).toBeDefined();
    expect(pits && near(pits)).toBe(true);
    expect(stand?.side).not.toBe(pits?.side);
  });

  test("trees keep off the track and out of the stands, and the layout is repeatable", () => {
    const { geometry, trackside, scenery } = harbour;
    expect(scenery.trees.length).toBeGreaterThan(400);
    const clear = geometry.halfWidthM + geometry.kerbWidthM + 22;
    for (const tree of scenery.trees) {
      expect(trackside.distanceToTrack(tree.x, tree.z, 60)).toBeGreaterThan(clear);
      for (const f of [...scenery.grandstands, ...scenery.buildings]) {
        expect(Math.hypot(tree.x - f.x, tree.z - f.z)).toBeGreaterThan(f.lengthM / 2);
      }
    }

    expect(layoutScenery(geometry, trackside, harbour.track.startDistanceM)).toEqual(scenery);
  });

  test("overhead spans cross the whole road at least 5.5 m up, with their legs off it", () => {
    const { geometry, trackside, scenery } = harbour;
    const edge = geometry.halfWidthM + geometry.kerbWidthM;
    const start = geometry.pointAt(harbour.track.startDistanceM);
    expect(
      scenery.spans.filter((s) => s.kind === "gantry" && Math.hypot(s.x - start.x, s.z - start.z) < 5),
    ).toHaveLength(1);
    expect(scenery.spans.some((s) => s.kind === "bridge")).toBe(true);
    for (const span of scenery.spans) {
      expect(span.clearanceM).toBeGreaterThanOrEqual(5.5);
      expect(Math.abs(geometry.locate(span.x, span.z).lateralM)).toBeLessThan(1);
      expect(span.widthM).toBeGreaterThan(2 * edge);

      // Legs stand at each end, across the track from each other.
      const [ax, az] = [Math.cos(span.headingRad), -Math.sin(span.headingRad)];
      for (const sign of [-1, 1]) {
        const leg = { x: span.x + (ax * sign * span.widthM) / 2, z: span.z + (az * sign * span.widthM) / 2 };
        expect(trackside.distanceToTrack(leg.x, leg.z, 80)).toBeGreaterThan(edge + 0.5);
      }
    }
  });

  test("barrier dressing follows its barrier: tyre walls at run-off, fences by the stands", () => {
    const { geometry, trackside, scenery } = harbour;

    // The centreline sample a barrier point was laid out from.
    const sampleOf = (p: { x: number; z: number }) => {
      for (const run of trackside.barriers) {
        const k = run.points.findIndex((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-9);
        if (k >= 0) {
          return (run.first + k) % geometry.count;
        }
      }

      return undefined;
    };

    const onBarrier = (p: { x: number; z: number }) => sampleOf(p) !== undefined;
    const kinds = new Set(scenery.attachments.map((a) => a.kind));
    expect([...kinds].sort()).toEqual(["fence", "hoarding", "pitwall", "tyres"]);
    for (const a of scenery.attachments) {
      expect(onBarrier(a.a) && onBarrier(a.b)).toBe(true);
      const mid = { x: (a.a.x + a.b.x) / 2, z: (a.a.z + a.b.z) / 2 };
      if (a.kind === "tyres") {
        const i = sampleOf(a.a) ?? -1;
        expect((a.side === "left" ? trackside.left : trackside.right).runoff[i]).not.toBe("grass");
      }

      if (a.kind === "fence") {
        const nearest = Math.min(...scenery.grandstands.map((f) => Math.hypot(f.x - mid.x, f.z - mid.z)));
        expect(nearest).toBeLessThan(80);
      }
    }
  });

  test("marshal posts stand behind the barriers around the lap", () => {
    expect(harbour.scenery.marshals.length).toBeGreaterThanOrEqual(6);
  });
});
