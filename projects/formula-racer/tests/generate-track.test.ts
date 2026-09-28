import { describe, expect, test } from "bun:test";
import { parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { generateTrack, parseLayout } from "../tools/generate-track.ts";
import type { Layout } from "../tools/generate-track.ts";
import { readJsonObject } from "./support/json.ts";

const base = {
  id: "square",
  name: "Square",
  widthM: 12,
  kerbWidthM: 1.5,
  startDistanceM: 10,
  surfaceGrip: { road: 1, kerb: 0.85, grass: 0.45, gravel: 0.5 },
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

  test.each(["harbour", "test-loop"])("regenerates the shipped %s track exactly", (id) => {
    const layout = parseLayout(readJsonObject(`content/tracks/${id}.layout.json`));
    expect(generateTrack(layout).track).toEqual(readJsonObject(`public/assets/tracks/${id}.json`));
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

  test("reads a layout file and names the first field that is wrong", () => {
    const roundTrip: unknown = structuredClone(square);
    expect(parseLayout(roundTrip)).toEqual(square);
    expect(() => parseLayout({ ...square, widthM: "12" })).toThrow("layout.widthM must be a finite number");
    expect(() => parseLayout({ ...square, segments: [{ straight: 10 }, { turn: 90 }] })).toThrow(
      "layout.segments[1] must be a straight or an arc",
    );
    expect(() => parseLayout({ ...square, segments: [{ straight: 10, solve: "yes" }] })).toThrow(
      "layout.segments[0].solve must be a boolean",
    );
  });
});
