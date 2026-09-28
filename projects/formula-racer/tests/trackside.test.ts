import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import type { TrackDefinition } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import type { TrackGeometry } from "../src/simulation/track-geometry.ts";
import { buildTrackside, gripSurface, GROUND_SURFACES, isOnTrack } from "../src/simulation/trackside.ts";

const definition = (id: string) =>
  parseTrack(JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")));
const shipped = (id: string) => buildTrackGeometry(definition(id));
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
    setting: "circuit",
    lighting: "day",
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
  for (const id of ["harbour", "riviera", "ardennes", "royal-park", "corniche", "test-loop"]) {
    test(`on ${id}, no barrier comes within the kerb plus 2 m of any part of the track`, () => {
      const track = shipped(id);
      const side = buildTrackside(track, definition(id).setting);
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

  test("a street circuit has its walls 2 m past the kerbs, with pavement between", () => {
    const side = buildTrackside(ring(), "street");
    const edge = 6 + 1.5;
    for (const e of [side.left, side.right]) {
      for (const m of e.barrierM) {
        expect(m).toBeCloseTo(edge + 2, 1);
      }

      expect(new Set(e.runoff)).toEqual(new Set(["asphalt"]));
    }
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

    // An endless corner has no straight to place kerbs from, so its band is all verge.
    expect(at(-7)).toBe("verge");
    expect(at(15)).toBe("gravel");
    expect(at(40)).toBe("grass");
    expect(at(-12)).toBe("grass");
  });

  // What a wheel feels matches the planned kerbs: kerb only on a kerb, the verge elsewhere.
  test.each(["harbour", "riviera"])("%s: the band beside the road is kerb only where a kerb is planned", (id) => {
    const def = definition(id);
    const track = buildTrackGeometry(def);
    const side = buildTrackside(track, def.setting, def.startDistanceM);
    const half = track.halfWidthM;
    const at = (distanceM: number, lateralM: number) => {
      const i = Math.round(distanceM / track.spacingM) % track.count;
      const band = Math.abs(lateralM) <= half + track.kerbWidthM ? "kerb" : "grass";
      const surface = Math.abs(lateralM) <= half ? "road" : band;

      return side.surfaceAt({ index: i, distanceM, lateralM, surface });
    };

    const kerbs = side.kerbs.kerbs;
    expect(kerbs.length).toBeGreaterThan(0);
    for (const kerb of kerbs) {
      const middle = ((kerb.fromM + kerb.toM) / 2) % track.lengthM;
      const sign = kerb.side === "left" ? 1 : -1;
      expect(at(middle, sign * (half + 0.2))).toBe("kerb");
      if (kerb.widthM < track.kerbWidthM - 0.1) {
        expect(at(middle, sign * (half + kerb.widthM + 0.05))).toBe("verge");
      }
    }

    // Somewhere on each side there is a gap, and a wheel in it is on the verge.
    for (const s of ["left", "right"] as const) {
      const gap = Array.from({ length: track.count }, (_, i) => i * track.spacingM).find(
        (d) => !side.kerbs.at(d, s) && !side.kerbs.at(d + 3, s) && !side.kerbs.at(d - 3, s),
      );
      if (gap === undefined) {
        throw new Error(`a gap expected on the ${s}`);
      }

      expect(at(gap, (s === "left" ? 1 : -1) * (half + 0.2))).toBe("verge");
    }
  });
});

describe("what a surface means", () => {
  test("the verge and asphalt runoff grip like the road; the rest grip as themselves", () => {
    expect(GROUND_SURFACES.map(gripSurface)).toEqual(["road", "kerb", "grass", "gravel", "road", "road"]);
  });

  // Track limits end at the kerb band, so the verge within it is still on track.
  test("road, kerb and verge are on track; grass, gravel and asphalt runoff are not", () => {
    expect(GROUND_SURFACES.filter(isOnTrack)).toEqual(["road", "kerb", "verge"]);
  });
});
