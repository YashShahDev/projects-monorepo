import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isBetter, measureLine, tuneLine } from "../src/ai/line-tuning.ts";
import type { LineMeasure } from "../src/ai/line-tuning.ts";
import { lineGripScale, parseLineData } from "../src/content/line-data.ts";
import { parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { fileSessions } from "../tools/control-sources.ts";
import { car } from "./support/vehicle.ts";

const trackOf = (id: string) => {
  const track = parseTrack(
    JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")),
  );

  return { car, trackId: id, track, geometry: buildTrackGeometry(track), sources: fileSessions(), seed: 1 };
};

const measure = (clean: boolean, lapS: number, offRoadSteps = clean ? 0 : 10): LineMeasure => ({
  clean,
  lapS,
  offRoadSteps,
});

describe("line tuning from AI laps", () => {
  test("a clean line beats a faster one that left the road; then the faster wins", () => {
    expect(isBetter(measure(true, 80), measure(false, 77))).toBe(true);
    expect(isBetter(measure(false, 77), measure(true, 80))).toBe(false);
    expect(isBetter(measure(true, 77), measure(true, 78))).toBe(true);
    expect(isBetter(measure(true, 78), measure(true, 78))).toBe(false);
    expect(isBetter(measure(false, 90, 5), measure(false, 80, 50))).toBe(true);
  });

  // At Riviera's hairpin the plain line asks for more braking while turning than the
  // car has, and Ace runs wide onto the run-off and into the wall.
  const riviera = trackOf("riviera");

  test("where Ace leaves the road, it lowers the grip on the way in until Ace stays on", async () => {
    const tuned = await tuneLine({ ...riviera, rounds: 4 });
    expect(tuned.baseline.clean).toBe(false);
    expect(tuned.measure.clean).toBe(true);
    expect(tuned.rounds.length).toBeGreaterThan(0);

    // Each kept round beat the best before it.
    let best = tuned.baseline;
    for (const round of tuned.rounds.filter((r) => r.kept)) {
      expect(isBetter(round, best)).toBe(true);
      best = round;
    }

    expect(tuned.measure).toEqual({ clean: best.clean, offRoadSteps: best.offRoadSteps, lapS: best.lapS });

    // Only the approach to the trouble was touched, and only downward.
    const lowered = Array.from(tuned.gripScale).filter((s) => s < 1);
    expect(lowered.length).toBeGreaterThan(0);
    expect(lowered.length).toBeLessThan(tuned.gripScale.length * 0.2);
    expect(Math.max(...tuned.gripScale)).toBe(1);

    // Measuring the result again gives the same laps.
    expect(await measureLine(riviera, tuned.gripScale)).toEqual(tuned.measure);
  }, 120_000);

  test("is the same for the same seed", async () => {
    const [a, b] = [await tuneLine({ ...riviera, rounds: 2 }), await tuneLine({ ...riviera, rounds: 2 })];
    expect(Array.from(b.gripScale)).toEqual(Array.from(a.gripScale));
    expect(b.rounds).toEqual(a.rounds);
  }, 120_000);

  test("leaves a line Ace already drives cleanly as it is", async () => {
    const tuned = await tuneLine({ ...trackOf("test-loop"), rounds: 4 });
    expect(tuned.baseline.clean).toBe(true);
    expect(tuned.rounds).toEqual([]);
    expect(Array.from(new Set(tuned.gripScale))).toEqual([1]);
  }, 60_000);
});

// The lines `make tune-lines` saved. Measuring each again catches a track, car or
// driver change that has made one stale: rerun the tool when this fails.
describe("saved racing lines", () => {
  for (const id of fileSessions().trackIds) {
    test(`${id}: is current, clean, and no slower than the plain line`, async () => {
      const options = trackOf(id);
      const path = resolve(import.meta.dirname, `../public/assets/lines/${id}.json`);
      const data = parseLineData(JSON.parse(readFileSync(path, "utf8")), path);
      expect(data.track).toBe(id);
      const scale = lineGripScale(data, options.geometry.count);
      if (!scale) {
        throw new Error(
          `${path} was tuned on ${String(data.samples)} samples; the track now has ${String(options.geometry.count)}`,
        );
      }

      const saved = await measureLine(options, scale);
      expect(saved).toEqual({ clean: true, offRoadSteps: 0, lapS: data.lapS });
      const plain = await measureLine(options, new Float64Array(options.geometry.count).fill(1));
      expect(plain.lapS).toBe(data.baselineLapS);
      expect(isBetter(plain, saved)).toBe(false);
    }, 60_000);
  }
});
