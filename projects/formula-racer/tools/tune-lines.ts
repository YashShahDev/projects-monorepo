/**
 * Tunes each track's racing line from the Ace driver's laps (`tuneLine`) and saves it to
 * `public/assets/lines/<track>.json`, which the game loads. A saved line is replaced
 * only by one that measures better, so no save is ever slower than the one before.
 * Run with `bun run tools/tune-lines.ts [track ...]`; all tracks when none are given.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isBetter, measureLine, tuneLine } from "../src/ai/line-tuning.ts";
import type { LineMeasure } from "../src/ai/line-tuning.ts";
import { parseCar } from "../src/content/car.ts";
import { lineDataFrom, lineGripScale, parseLineData } from "../src/content/line-data.ts";
import { parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { fileSessions } from "./control-sources.ts";

const ROUNDS = 10;
const SEED = 1;

const root = resolve(import.meta.dirname, "..");
const json = (path: string): unknown => JSON.parse(readFileSync(resolve(root, "public/assets", path), "utf8"));
const car = parseCar(json("cars/fr26.json"));
const sources = fileSessions(root);
const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : sources.trackIds;
const describe = (m: LineMeasure) =>
  m.clean ? `${m.lapS.toFixed(3)} s` : `${m.lapS.toFixed(3)} s, ${String(m.offRoadSteps)} steps off the road`;

mkdirSync(resolve(root, "public/assets/lines"), { recursive: true });
for (const id of ids) {
  if (!sources.trackIds.includes(id)) {
    throw new Error(`unknown track ${JSON.stringify(id)}; available: ${sources.trackIds.join(", ")}`);
  }

  const track = parseTrack(json(`tracks/${id}.json`));
  const options = { car, trackId: id, track, geometry: buildTrackGeometry(track), sources, seed: SEED };
  const tuned = await tuneLine({ ...options, rounds: ROUNDS });

  // What is saved is rounded, so it is measured again as the game will build it.
  const data = lineDataFrom(id, tuned.gripScale, { lapS: 0, baselineLapS: tuned.baseline.lapS });
  const scale = lineGripScale(data, options.geometry.count) ?? tuned.gripScale;
  const measure = await measureLine(options, scale);
  const path = resolve(root, `public/assets/lines/${id}.json`);
  const savedScale = existsSync(path)
    ? lineGripScale(parseLineData(json(`lines/${id}.json`), path), options.geometry.count)
    : undefined;
  const saved = savedScale ? await measureLine(options, savedScale) : undefined;
  console.log(`${id}: plain line ${describe(tuned.baseline)}; tuned ${describe(measure)}`);
  if (!measure.clean) {
    console.log(`  not saved: Ace still leaves the road`);
  } else if (saved && savedScale && !isBetter(measure, saved)) {
    // Kept, but measured again: a physics or driver change moves its laps.
    const current = parseLineData(json(`lines/${id}.json`), path);
    if (saved.clean && (current.lapS !== saved.lapS || current.baselineLapS !== tuned.baseline.lapS)) {
      const refreshed = lineDataFrom(id, savedScale, { lapS: saved.lapS, baselineLapS: tuned.baseline.lapS });
      writeFileSync(path, `${JSON.stringify(refreshed, null, 2)}\n`);
      console.log(`  kept the saved line, which measures ${describe(saved)}; its laps are updated`);
    } else {
      console.log(`  not saved: the saved line measures ${describe(saved)}`);
    }
  } else {
    writeFileSync(path, `${JSON.stringify({ ...data, lapS: measure.lapS }, null, 2)}\n`);
    console.log(`  saved, ${String(data.lowered.length)} stretches lowered`);
  }
}
