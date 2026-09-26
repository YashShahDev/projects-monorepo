import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { findCorners, mapProjection, nextCorner, previewPath } from "../src/app/track-map.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";

const harbour = buildTrackGeometry(
  parseTrack(JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"))),
);

describe("corners", () => {
  const corners = findCorners(harbour);

  test("numbers the harbour's corners in lap order, with their direction", () => {
    // Harbour's layout (content/tracks/harbour.layout.json) has 12 arcs; the S-bends
    // and chicane arcs are separate turns, and the 250 m-radius sweeper counts too.
    expect(corners.length).toBeGreaterThanOrEqual(10);
    expect(corners.map((c) => c.number)).toEqual(corners.map((_, i) => i + 1));
    for (let i = 1; i < corners.length; i += 1) {
      expect(corners[i]?.apexM ?? 0).toBeGreaterThan(corners[i - 1]?.apexM ?? 0);
    }

    // The hairpin, radius 18 m, is a right-hander and the tightest turn.
    const hairpin = corners.reduce((a, b) => (b.radiusM < a.radiusM ? b : a));
    expect(hairpin.direction).toBe("right");
    expect(hairpin.radiusM).toBeGreaterThan(14);
    expect(hairpin.radiusM).toBeLessThan(24);
  });

  test("a straight gives no corners", () => {
    expect(findCorners({ ...harbour, curvature: new Float64Array(harbour.count) })).toEqual([]);
  });

  test("the next corner wraps round past the last one to turn 1", () => {
    const last = corners.at(-1);
    const first = corners[0];
    if (!last || !first) {
      throw new Error("no corners");
    }

    const after = nextCorner(corners, harbour.lengthM, last.endM + 1);
    expect(after?.corner.number).toBe(1);

    // The last corner can run past the lap line, so distances wrap.
    const lap = harbour.lengthM;
    expect(after?.inM).toBeCloseTo((((first.startM - (last.endM + 1)) % lap) + lap) % lap, 6);
    expect(nextCorner(corners, harbour.lengthM, first.startM - 50)).toEqual({ corner: first, inM: 50 });
  });

  test("inside a corner, that corner stays next until its apex is passed", () => {
    const second = corners[1];
    if (!second) {
      throw new Error("no corners");
    }

    const between = (second.startM + second.apexM) / 2;
    expect(nextCorner(corners, harbour.lengthM, between)).toEqual({ corner: second, inM: 0 });
    expect(nextCorner(corners, harbour.lengthM, second.apexM + 1)?.corner.number).toBe(3);
  });
});

describe("map projection", () => {
  test("fits the circuit in the box with padding, keeping its proportions", () => {
    const map = mapProjection(harbour, 200, 120, 8);
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < harbour.count; i += 1) {
      const [u, v] = map.toMap(harbour.x[i] ?? 0, harbour.z[i] ?? 0);
      [minU, maxU, minV, maxV] = [Math.min(minU, u), Math.max(maxU, u), Math.min(minV, v), Math.max(maxV, v)];
    }

    expect(minU).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(maxU).toBeLessThanOrEqual(192 + 1e-9);
    expect(minV).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(maxV).toBeLessThanOrEqual(112 + 1e-9);

    // The limiting axis fills its span exactly.
    expect(Math.max(maxU - minU - 184, maxV - minV - 104)).toBeCloseTo(0, 6);
    expect(map.path.startsWith("M")).toBe(true);
    expect(map.path.endsWith("Z")).toBe(true);
  });

  test("seen from above, a car heading +z moves up the map and its left is map left", () => {
    const map = mapProjection(harbour, 200, 200, 0);
    const [u0, v0] = map.toMap(0, 0);
    const [, v1] = map.toMap(0, 10);
    const [u2] = map.toMap(10, 0);
    expect(v1).toBeLessThan(v0);
    expect(u2).toBeLessThan(u0);
  });
});

describe("corner preview", () => {
  test("draws the road ahead heading-up: forward is up, a right-hander bends right", () => {
    const corners = findCorners(harbour);
    const hairpin = corners.reduce((a, b) => (b.radiusM < a.radiusM ? b : a));
    const preview = previewPath(harbour, hairpin.startM - 40, 100, 50);
    const points = preview.points;
    const [first, last] = [points[0], points.at(-1)];
    if (!first || !last) {
      throw new Error("empty preview");
    }

    // Starts at the car, at the bottom centre of a 100×100 box.
    expect(first.u).toBeCloseTo(50, 0);
    expect(first.v).toBeCloseTo(90, 0);

    // It goes up first, then turns right (toward larger u).
    expect(points[5]?.v ?? 0).toBeLessThan(first.v);
    expect(Math.max(...points.map((p) => p.u))).toBeGreaterThan(first.u + 10);
    expect(preview.path.startsWith("M")).toBe(true);
  });
});
