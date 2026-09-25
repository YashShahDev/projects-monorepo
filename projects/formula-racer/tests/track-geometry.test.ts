import { describe, expect, test } from "bun:test";
import type { TrackDefinition } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";

const RADIUS = 100;

// Thirty-six points on a circle, travelling clockwise seen from above (+y): the first leg
// heads along +z with the centre on the driver's right.
function circle(): TrackDefinition {
  const controlPoints = Array.from({ length: 36 }, (_, i) => ({
    x: RADIUS * Math.cos((i * Math.PI) / 18),
    z: RADIUS * Math.sin((i * Math.PI) / 18),
  }));
  return {
    version: 1,
    id: "ring",
    name: "Ring",
    widthM: 12,
    kerbWidthM: 1.5,
    controlPoints,
    startDistanceM: 0,
    surfaceGrip: { road: 1, kerb: 1, grass: 1 },
  };
}

describe("track geometry", () => {
  test("a circular centreline has the circle's length and constant right-hand curvature", () => {
    const geometry = buildTrackGeometry(circle());
    expect(geometry.lengthM).toBeCloseTo(2 * Math.PI * RADIUS, -1);
    for (const k of geometry.curvature) expect(Math.abs(k * RADIUS + 1)).toBeLessThan(0.03);
  });
});

describe("locating a position on the track", () => {
  const geometry = buildTrackGeometry(circle());

  test("reports the driver's left as positive and classifies road, kerb and grass", () => {
    // At (100, 0) the car faces +z, so +x (outside the ring) is its left.
    expect(geometry.locate(RADIUS + 3, 0)).toMatchObject({ surface: "road" });
    expect(geometry.locate(RADIUS + 3, 0).lateralM).toBeCloseTo(3, 1);
    expect(geometry.locate(RADIUS + 7, 0).surface).toBe("kerb");
    const inside = geometry.locate(RADIUS - 10, 0);
    expect(inside.surface).toBe("grass");
    expect(inside.lateralM).toBeCloseTo(-10, 1);
  });

  test("measures lap distance from the first control point in the driving direction", () => {
    expect(geometry.locate(0, RADIUS).distanceM / geometry.lengthM).toBeCloseTo(0.25, 2);
    expect(geometry.locate(RADIUS, -1).distanceM / geometry.lengthM).toBeGreaterThan(0.99);
  });

  test("a stale hint still finds the nearest point", () => {
    const far = geometry.locate(-RADIUS, 0, 0);
    expect(far.distanceM / geometry.lengthM).toBeCloseTo(0.5, 2);
  });
});
