import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { generateTrack } from "../tools/generate-track.ts";
import type { Layout } from "../tools/generate-track.ts";

const base = {
  id: "square",
  name: "Square",
  widthM: 12,
  kerbWidthM: 1.5,
  startDistanceM: 10,
  surfaceGrip: { road: 1, kerb: 0.85, grass: 0.45 },
  activeAeroZones: [],
};
// A rounded square: two adjacent (perpendicular) solved sides close it against the two
// fixed ones; parallel solved sides could not fix both axes.
const square: Layout = {
  ...base,
  segments: [
    { straight: 0, solve: true },
    { arc: -90, radius: 50 },
    { straight: 0, solve: true },
    { arc: -90, radius: 50 },
    { straight: 200 },
    { arc: -90, radius: 50 },
    { straight: 200 },
    { arc: -90, radius: 50 },
  ],
};

describe("track generator", () => {
  test("solves the marked straights so the loop closes", () => {
    const { track, solvedM } = generateTrack(square);
    // Opposite sides of a square match: both solved straights equal the fixed 200 m.
    expect(solvedM[0]).toBeCloseTo(200, 6);
    expect(solvedM[1]).toBeCloseTo(200, 6);
    const geometry = buildTrackGeometry(parseTrack(track));
    // 4 × 200 m of straights plus a 50 m circle: 800 + 2π·50 = 1114.2 m.
    expect(geometry.lengthM).toBeCloseTo(1114.2, -1);
  });

  test("regenerates the shipped Harbour Park exactly", () => {
    const layout = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../content/tracks/harbour.layout.json"), "utf8"),
    ) as Layout;
    const shipped = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(generateTrack(layout).track).toEqual(shipped);
  });

  test("rejects a layout that does not turn exactly once", () => {
    const segments = square.segments.map((s) => ("arc" in s ? { ...s, arc: -80 } : s));
    expect(() => generateTrack({ ...square, segments })).toThrow("turns");
  });

  test("rejects a layout that cannot close with positive straights", () => {
    const segments = square.segments.map((s, i) => (i === 4 ? { straight: -500 } : s));
    expect(() => generateTrack({ ...square, segments })).toThrow("no closing lengths");
  });

  test("needs exactly two solved straights", () => {
    const segments = square.segments.map((s) => ("solve" in s ? { straight: 200 } : s));
    expect(() => generateTrack({ ...square, segments })).toThrow("exactly two");
  });
});
