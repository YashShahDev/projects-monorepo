import { expect, test } from "bun:test";
import type { TrackDefinition } from "../src/content/track.ts";
import { tyresWithinLimits } from "../src/app/session.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";

// A straight-ish big ring: at sample 0 the track runs along +z, centre at x = 0.
const ring: TrackDefinition = {
  version: 1,
  id: "ring",
  name: "Ring",
  widthM: 12,
  kerbWidthM: 1.5,
  controlPoints: Array.from({ length: 72 }, (_, i) => ({
    x: 2000 * Math.cos((i * Math.PI) / 36) - 2000,
    z: 2000 * Math.sin((i * Math.PI) / 36),
  })),
  startDistanceM: 0,
  surfaceGrip: { road: 1, kerb: 1, grass: 1, gravel: 1 },
  activeAeroZones: [],
};
const geometry = buildTrackGeometry(ring);
const TYRE_HALF = 0.2;
const limit = 6 + 1.5;

test("a car square to the track is out only once its inner tyres pass the kerb", () => {
  const square = (x: number) => [
    { x: x + 0.8, z: 1.8 },
    { x: x - 0.8, z: 1.8 },
    { x: x + 0.8, z: -1.6 },
    { x: x - 0.8, z: -1.6 },
  ];

  // Positive x is the driver's left here; inner tyres at x − 0.8 edge in at − 0.2.
  expect(tyresWithinLimits(geometry, square(limit + 0.8 + TYRE_HALF - 0.05), TYRE_HALF)).toBe(true);
  expect(tyresWithinLimits(geometry, square(limit + 0.8 + TYRE_HALF + 0.05), TYRE_HALF)).toBe(false);
});

test("a yawed car with one rear tyre still on the kerb stays within limits", () => {
  // Sliding at 40°: the fronts are far out on the grass, a rear tyre still touches the kerb.
  const rearInner = { x: limit + TYRE_HALF - 0.1, z: -1.6 };
  const tyres = [{ x: limit + 3.5, z: 1.5 }, { x: limit + 2.3, z: 2.5 }, { x: limit + 1.2, z: -2.6 }, rearInner];
  expect(tyresWithinLimits(geometry, tyres, TYRE_HALF)).toBe(true);
});

test("a stale hint from the far side of the lap does not misjudge a car on the road", () => {
  // As after a reset: the hints still point half a lap away.
  const far = Math.floor(geometry.count / 2);
  const onRoad = [
    { x: 0.8, z: 1.8 },
    { x: -0.8, z: 1.8 },
    { x: 0.8, z: -1.6 },
    { x: -0.8, z: -1.6 },
  ];
  expect(tyresWithinLimits(geometry, onRoad, TYRE_HALF, [far, far, far, far])).toBe(true);

  const offRoad = onRoad.map((tyre) => ({ ...tyre, x: tyre.x + limit + 5 }));
  expect(tyresWithinLimits(geometry, offRoad, TYRE_HALF, [far, far, far, far])).toBe(false);
});
