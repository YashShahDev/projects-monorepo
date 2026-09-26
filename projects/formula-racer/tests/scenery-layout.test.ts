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
      for (const f of [...scenery.grandstands, ...scenery.buildings]) {
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
      for (const f of [...scenery.grandstands, ...scenery.buildings]) {
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

  test("never places more than four corner stands, even when the main stand does not fit", () => {
    // Harbour's turn 1 apex has no room for the main stand and pits.
    const apex = findCorners(harbour.geometry)[0]?.apexM ?? 0;
    const crowded = layoutScenery(harbour.geometry, harbour.trackside, apex);
    expect(crowded.buildings).toEqual([]);
    expect(crowded.grandstands.length).toBeLessThanOrEqual(4);
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
});
