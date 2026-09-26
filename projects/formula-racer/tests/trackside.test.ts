import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import type { TrackDefinition } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import type { TrackGeometry } from "../src/simulation/track-geometry.ts";
import { buildTrackside } from "../src/simulation/trackside.ts";

const shipped = (id: string) =>
  buildTrackGeometry(
    parseTrack(JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8"))),
  );
const harbour = shipped("harbour");
const harbourSide = buildTrackside(harbour);

// A clockwise ring: one endless right-hander, so its outside is the driver's left.
function ring(): TrackGeometry {
  const track: TrackDefinition = {
    version: 1,
    id: "ring",
    name: "Ring",
    widthM: 12,
    kerbWidthM: 1.5,
    controlPoints: Array.from({ length: 36 }, (_, i) => ({
      x: 100 * Math.cos((i * Math.PI) / 18),
      z: 100 * Math.sin((i * Math.PI) / 18),
    })),
    startDistanceM: 0,
    surfaceGrip: { road: 1, kerb: 1, grass: 1, gravel: 0.5 },
    activeAeroZones: [],
  };

  return buildTrackGeometry(track);
}

/** Index of the tightest sample, and its signed curvature. */
function tightest(track: TrackGeometry) {
  let best = 0;
  track.curvature.forEach((k, i) => {
    if (Math.abs(k) > Math.abs(track.curvature[best] ?? 0)) {
      best = i;
    }
  });

  return best;
}

describe("trackside runoff", () => {
  test("gravel lines the outside of a corner and grass the inside", () => {
    const side = buildTrackside(ring());
    expect(new Set(side.left.runoff)).toEqual(new Set(["gravel"]));
    expect(new Set(side.right.runoff)).toEqual(new Set(["grass"]));
  });

  test("a hairpin gets asphalt runoff on its outside", () => {
    const apex = tightest(harbour);

    // Harbour's hairpin is a right-hander, so its outside is the left.
    expect(harbour.curvature[apex] ?? 0).toBeLessThan(-1 / 30);
    expect(harbourSide.left.runoff[apex]).toBe("asphalt");
  });

  test("the start straight keeps grass on both sides", () => {
    const start = harbour.locate(harbour.pointAt(150).x, harbour.pointAt(150).z).index;
    expect(harbourSide.left.runoff[start]).toBe("grass");
    expect(harbourSide.right.runoff[start]).toBe("grass");
  });
});

describe("trackside barriers", () => {
  for (const [id, track] of [
    ["harbour", harbour],
    ["test-loop", shipped("test-loop")],
  ] as const) {
    test(`on ${id}, no barrier comes within the kerb plus 2 m of any part of the track`, () => {
      const side = buildTrackside(track);
      const clearance = track.halfWidthM + track.kerbWidthM + 2;
      let closest = Number.POSITIVE_INFINITY;
      for (const run of side.barriers) {
        for (const p of run.points) {
          for (let i = 0; i < track.count; i += 1) {
            closest = Math.min(closest, Math.hypot((track.x[i] ?? 0) - p.x, (track.z[i] ?? 0) - p.z));
          }
        }
      }

      expect(closest).toBeGreaterThan(clearance - 0.05);
      expect(side.barriers.length).toBeGreaterThan(0);
    });
  }

  test("barriers stand beyond the runoff: 20 m of gravel, 10 m of grass", () => {
    const side = buildTrackside(ring());
    const edge = 6 + 1.5;
    for (const m of side.left.barrierM) {
      expect(m).toBeCloseTo(edge + 20, 1);
    }

    for (const m of side.right.barrierM) {
      expect(m).toBeCloseTo(edge + 10, 1);
    }

    expect(side.barriers.map((b) => b.closed)).toEqual([true, true]);
  });

  test("painted runoff never runs past the barrier", () => {
    for (const edge of [harbourSide.left, harbourSide.right]) {
      edge.runoffM.forEach((m, i) => {
        const barrier = edge.barrierM[i] ?? Number.NaN;
        if (!Number.isNaN(barrier)) {
          expect(m).toBeLessThanOrEqual(barrier + 1e-9);
        }
      });
    }
  });

  test("the inside of the hairpin leaves a gap rather than folding the barrier back on itself", () => {
    const apex = tightest(harbour);
    expect(harbourSide.right.barrierM[apex]).toBeNaN();
    expect(harbourSide.barriers.filter((b) => b.side === "right").every((b) => !b.closed)).toBe(true);
  });
});

describe("ground surface", () => {
  test("classifies road, kerb, runoff and the grass beyond it", () => {
    const track = ring();
    const side = buildTrackside(track);
    const at = (lateralM: number) =>
      side.surfaceAt({ ...track.locate(track.x[0] ?? 0, track.z[0] ?? 0), lateralM, surface: surfaceOf(lateralM) });
    const surfaceOf = (lateralM: number) => {
      if (Math.abs(lateralM) <= 6) {
        return "road";
      }

      return Math.abs(lateralM) <= 7.5 ? "kerb" : "grass";
    };

    expect(at(3)).toBe("road");
    expect(at(-7)).toBe("kerb");
    expect(at(15)).toBe("gravel");
    expect(at(40)).toBe("grass");
    expect(at(-12)).toBe("grass");
  });
});
