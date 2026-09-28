import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { parseTrack } from "../src/content/track.ts";
import { EDGE_LINE_M, edgeLineGeometry, gridBoxGeometry } from "../src/rendering/markings.ts";
import { GRID_GAP_M, GRID_SLOTS, gridSlot } from "../src/simulation/grid.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { readJsonObject } from "./support/json.ts";

const def = parseTrack(readJsonObject("public/assets/tracks/harbour.json"));
const track = buildTrackGeometry(def);

// Distance from a to b along the lap, between -lap/2 and lap/2.
const along = (a: number, b: number) =>
  ((((b - a) % track.lengthM) + 1.5 * track.lengthM) % track.lengthM) - track.lengthM / 2;

const vertices = (geometry: THREE.BufferGeometry) => {
  const p = geometry.getAttribute("position");

  return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
};

const facesUp = (geometry: THREE.BufferGeometry) => {
  const v = vertices(geometry);
  for (let i = 0; i < v.length; i += 3) {
    const [a, b, d] = [v[i], v[i + 1], v[i + 2]];
    if (!a || !b || !d) {
      return false;
    }

    if (new THREE.Vector3().subVectors(d, b).cross(new THREE.Vector3().subVectors(a, b)).y <= 0) {
      return false;
    }
  }

  return v.length > 0;
};

describe("the grid", () => {
  test("has its first slot on the line and the centreline, and the rest a gap apart, alternating sides", () => {
    const first = gridSlot(track, def.startDistanceM, 0);
    const at = track.locate(first.x, first.z);
    expect(along(def.startDistanceM, at.distanceM)).toBeCloseTo(0, 1);
    expect(at.lateralM).toBeCloseTo(0, 1);

    const sides = [1, 2, 3].map((slot) => {
      const s = gridSlot(track, def.startDistanceM, slot);
      const l = track.locate(s.x, s.z);
      expect(along(def.startDistanceM, l.distanceM)).toBeCloseTo(slot * GRID_GAP_M, 0);
      expect(Math.abs(l.lateralM)).toBeCloseTo(track.halfWidthM / 2, 1);

      return Math.sign(l.lateralM);
    });
    expect(sides[0]).toBe(-(sides[1] ?? 0));
    expect(sides[1]).toBe(-(sides[2] ?? 0));
  });
});

describe("road markings", () => {
  test("edge lines run inside both edges of the road, flat and facing up", () => {
    const geometry = edgeLineGeometry(track);
    expect(facesUp(geometry)).toBe(true);
    let left = 0;
    let right = 0;
    for (const v of vertices(geometry)) {
      const lateral = track.locate(v.x, v.z).lateralM;
      expect(v.y).toBe(0);
      expect(Math.abs(lateral)).toBeGreaterThan(track.halfWidthM - EDGE_LINE_M - 0.01);
      expect(Math.abs(lateral)).toBeLessThan(track.halfWidthM + 0.01);
      left += lateral > 0 ? 1 : 0;
      right += lateral < 0 ? 1 : 0;
    }

    expect(left).toBe(right);
  });

  test("a box is painted just ahead of every grid slot, across its car, and nowhere else", () => {
    const geometry = gridBoxGeometry(track, def.startDistanceM);
    expect(facesUp(geometry)).toBe(true);
    const slots = Array.from({ length: GRID_SLOTS }, (_, k) => {
      const s = gridSlot(track, def.startDistanceM, k);

      return track.locate(s.x, s.z);
    });
    const used = new Set<number>();
    for (const v of vertices(geometry)) {
      const at = track.locate(v.x, v.z);
      const slot = slots.findIndex(
        (s) =>
          along(s.distanceM, at.distanceM) > 0 &&
          along(s.distanceM, at.distanceM) < 4 &&
          Math.abs(at.lateralM - s.lateralM) < 1.5,
      );
      expect(slot).toBeGreaterThanOrEqual(0);
      used.add(slot);
    }

    expect(used.size).toBe(GRID_SLOTS);
  });
});
