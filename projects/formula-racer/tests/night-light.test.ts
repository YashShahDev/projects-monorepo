import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTrack } from "../src/content/track.ts";
import { floodlitLevel, NIGHT_AMBIENT } from "../src/rendering/night-light.ts";
import { layoutScenery } from "../src/rendering/scenery-layout.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { buildTrackside } from "../src/simulation/trackside.ts";

const tower = { x: 0, z: 0, heightM: 16, aim: { x: 10, z: 0 } };

test("the ground is brightest under a tower's lamps and falls to the night's ambient", () => {
  const under = floodlitLevel(6, 0, [tower]);
  expect(under).toBeGreaterThan(floodlitLevel(20, 0, [tower]));
  expect(floodlitLevel(20, 0, [tower])).toBeGreaterThan(floodlitLevel(40, 0, [tower]));
  expect(floodlitLevel(500, 0, [tower])).toBe(NIGHT_AMBIENT);
  expect(floodlitLevel(0, 0, [])).toBe(NIGHT_AMBIENT);
});

test("light from neighbouring towers adds up, but never past full brightness", () => {
  const row = Array.from({ length: 20 }, (_, k) => ({ ...tower, x: k * 3, aim: { x: k * 3, z: 5 } }));
  expect(floodlitLevel(30, 5, [tower, { ...tower, x: 1 }])).toBeGreaterThan(floodlitLevel(30, 5, [tower]));
  expect(floodlitLevel(30, 5, row)).toBeLessThanOrEqual(1);
});

test("the whole of a night circuit's road is evenly lit", () => {
  const track = parseTrack(
    JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/corniche.json"), "utf8")),
  );
  const geometry = buildTrackGeometry(track);
  const trackside = buildTrackside(geometry, track.setting);
  const { floodlights } = layoutScenery(geometry, trackside, track.startDistanceM, { lighting: "night" });
  const levels: number[] = [];
  for (let i = 0; i < geometry.count; i += 1) {
    for (const lateral of [-geometry.halfWidthM, 0, geometry.halfWidthM]) {
      const x = (geometry.x[i] ?? 0) + (geometry.tz[i] ?? 0) * lateral;
      const z = (geometry.z[i] ?? 0) - (geometry.tx[i] ?? 0) * lateral;
      levels.push(floodlitLevel(x, z, floodlights));
    }
  }

  expect(Math.min(...levels)).toBeGreaterThan(0.6);
  expect(Math.max(...levels)).toBeLessThanOrEqual(1);
});
