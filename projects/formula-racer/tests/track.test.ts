import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchTrack, parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import type { TrackGeometry } from "../src/simulation/track-geometry.ts";

const raw = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8"),
) as Record<string, unknown>;
const geometry = buildTrackGeometry(parseTrack(raw));
const DEG = Math.PI / 180;

/** Heading change over each window of `lengthM` metres, keyed by start sample. */
function turnOver(g: TrackGeometry, lengthM: number): number[] {
  const n = Math.round(lengthM / g.spacingM);
  return Array.from({ length: g.count }, (_, i) => {
    let sum = 0;
    for (let k = 0; k < n; k += 1) sum += (g.curvature[(i + k) % g.count] ?? 0) * g.spacingM;
    return sum;
  });
}

describe("the shipped circuit", () => {
  test("is a balanced lap of about 4 km", () => {
    expect(geometry.lengthM).toBeGreaterThan(3800);
    expect(geometry.lengthM).toBeLessThan(4300);
  });

  test("has a straight of at least 1 km for active aero", () => {
    let best = 0;
    let run = 0;
    // Two laps so a straight crossing the loop's seam is counted whole.
    for (let i = 0; i < geometry.count * 2; i += 1) {
      run = Math.abs(geometry.curvature[i % geometry.count] ?? 0) < 1 / 1000 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    expect(best * geometry.spacingM).toBeGreaterThan(1000);
  });

  test("has a hairpin", () => {
    expect(Math.max(...turnOver(geometry, 100).map(Math.abs))).toBeGreaterThan(160 * DEG);
  });

  test("has a fast sweeper", () => {
    // A fast sweeper is one continuous corner of at least 60° that never tightens below
    // a 150 m radius. Scan two laps so a corner crossing the loop's seam counts whole.
    let sweep = 0;
    let sweeper = false;
    for (let i = 0; i < geometry.count * 2; i += 1) {
      const k = geometry.curvature[i % geometry.count] ?? 0;
      const fast = Math.abs(k) > 1 / 1000 && Math.abs(k) <= 1 / 150;
      sweep = fast && k * sweep >= 0 ? sweep + k * geometry.spacingM : 0;
      sweeper ||= Math.abs(sweep) >= 60 * DEG;
    }
    expect(sweeper).toBe(true);
  });

  test("has a chicane", () => {
    const flick = turnOver(geometry, 40);
    const chicane = flick.some((turn, i) => {
      const next = flick[(i + Math.round(50 / geometry.spacingM)) % geometry.count] ?? 0;
      return Math.abs(turn) > 20 * DEG && Math.abs(next) > 20 * DEG && turn * next < 0;
    });
    expect(chicane).toBe(true);
  });

  test("never passes within run-off distance of another part of itself", () => {
    const clearance = geometry.halfWidthM * 2 + geometry.kerbWidthM * 2 + 10;
    const skip = Math.ceil(150 / geometry.spacingM);
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < geometry.count; i += 1) {
      for (let j = i + 1; j < geometry.count; j += 1) {
        if (Math.min(j - i, geometry.count - (j - i)) < skip) continue;
        const d = Math.hypot(
          (geometry.x[i] ?? 0) - (geometry.x[j] ?? 0),
          (geometry.z[i] ?? 0) - (geometry.z[j] ?? 0),
        );
        closest = Math.min(closest, d);
      }
    }
    expect(closest).toBeGreaterThan(clearance);
  });

  test("starts on the road", () => {
    const start = geometry.pointAt(parseTrack(raw).startDistanceM);
    expect(geometry.locate(start.x, start.z).surface).toBe("road");
  });
});

describe("track content", () => {
  test("names the failing field", () => {
    expect(() => parseTrack({ ...raw, widthM: 3 })).toThrow(
      "track.widthM must be between 6 and 30",
    );
    expect(() => parseTrack({ ...raw, version: 2 })).toThrow("track.version must be 1");
    expect(() =>
      parseTrack({
        ...raw,
        controlPoints: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      }),
    ).toThrow("track.controlPoints");
    expect(() =>
      parseTrack({
        ...raw,
        controlPoints: [
          [0, 0],
          ["a", 1],
          [2, 2],
          [3, 3],
        ],
      }),
    ).toThrow("track.controlPoints[1][0]");
  });

  test("rejects consecutive duplicate points, including across the loop's seam", () => {
    const loop = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0.2, 0.3],
    ];
    expect(() => parseTrack({ ...raw, controlPoints: loop })).toThrow(
      "track.controlPoints[3] duplicates its neighbour",
    );
  });

  test("loads over fetch and reports the URL path on failure", async () => {
    const ok = async () => new Response(JSON.stringify(raw));
    expect((await fetchTrack(new URL("http://x/assets/tracks/harbour.json"), ok)).id).toBe(
      "harbour",
    );
    const bad = async () => new Response(JSON.stringify({ ...raw, name: "" }));
    await expect(fetchTrack(new URL("http://x/t.json"), bad)).rejects.toThrow("/t.json.name");
  });
});
