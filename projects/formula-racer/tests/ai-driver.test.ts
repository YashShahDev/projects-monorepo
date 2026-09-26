import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AI_LEVELS, createAiDriver } from "../src/ai/driver.ts";
import type { AiDriver, AiLevelName } from "../src/ai/driver.ts";
import { createControlEnvironment } from "../src/control/environment.ts";
import type { ControlReply } from "../src/control/environment.ts";
import { lineGripScale, parseLineData } from "../src/content/line-data.ts";
import { parseTrack } from "../src/content/track.ts";
import { estimatedLapTimeS } from "../src/simulation/racing-line.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { fileSessions } from "../tools/control-sources.ts";
import { car } from "./support/vehicle.ts";

const sources = fileSessions();
const trackOf = (id: string) => {
  const asset = (path: string): unknown =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/${path}`), "utf8"));
  const track = parseTrack(asset(`tracks/${id}.json`));
  const geometry = buildTrackGeometry(track);

  // The grip the AI runs saved for the track, as the game loads it.
  const gripScale = lineGripScale(parseLineData(asset(`lines/${id}.json`)), geometry.count);

  return { track, geometry, ...(gripScale ? { gripScale } : {}) };
};

const driverFor = (id: string, level: AiLevelName, seed = 1) => createAiDriver({ car, ...trackOf(id), level, seed });

/** Drives laps through the control API, as outside software would. */
async function race(id: string, driver: AiDriver, laps: number) {
  const environment = createControlEnvironment(sources);
  const times: number[] = [];
  const events: string[] = [];
  let offRoadSteps = 0;
  let reply: ControlReply = await environment.handle({ type: "reset", track: id, maxLaps: laps, maxSeconds: 900 });
  while (reply.type === "observation" && !reply.done) {
    reply = await environment.handle({ type: "step", ...driver.decide(reply.observation), steps: 1 });
    const wheels = reply.type === "observation" ? reply.observation.wheels : [];
    offRoadSteps += wheels.some((w) => w.surface !== "road" && w.surface !== "kerb") ? 1 : 0;
    for (const event of reply.type === "observation" ? reply.events : []) {
      events.push(event.type === "lap" && !event.valid ? "invalid lap" : event.type);
      if (event.type === "lap") {
        times.push(event.timeS);
      }
    }
  }

  environment.close();

  return { times, events, offRoadSteps };
}

const total = (times: number[]) => times.reduce((sum, t) => sum + t, 0);

describe("AI drivers", () => {
  for (const id of ["harbour", "riviera", "ardennes", "royal-park", "corniche", "test-loop"]) {
    // Clean means no tyre ever touches the grass, gravel or run-off, not just the lap
    // rule's all four: a car scraping a wall with one wheel on the road is not clean.
    test(`on ${id}, every level laps cleanly, and a higher level is never slower`, async () => {
      const totals: number[] = [];
      for (const level of AI_LEVELS) {
        const { times, events, offRoadSteps } = await race(id, driverFor(id, level), 3);
        expect(times).toHaveLength(3);
        expect(events).not.toContain("invalid lap");
        expect(offRoadSteps).toBe(0);
        totals.push(total(times));
      }

      for (let k = 1; k < totals.length; k += 1) {
        expect(totals[k] ?? Infinity).toBeLessThanOrEqual(totals[k - 1] ?? 0);
      }
    }, 120_000);
  }

  // The first lap starts from rest; the flying laps are the fair comparison.
  test("Ace laps within 2% of what its line predicts", async () => {
    for (const id of ["harbour", "ardennes"]) {
      const ace = driverFor(id, "ace");
      const { times } = await race(id, ace, 3);
      const best = Math.min(...times.slice(1));
      expect(Math.abs(best / estimatedLapTimeS(ace.line) - 1)).toBeLessThan(0.02);
    }
  }, 120_000);

  test("a seed repeats a driver exactly, and another seed drives differently", async () => {
    const [first, again, other] = [
      await race("test-loop", driverFor("test-loop", "rookie", 5), 2),
      await race("test-loop", driverFor("test-loop", "rookie", 5), 2),
      await race("test-loop", driverFor("test-loop", "rookie", 6), 2),
    ];
    expect(again.times).toEqual(first.times);
    expect(other.times).not.toEqual(first.times);
  }, 60_000);

  // A street circuit's wall, on asphalt. (A gravel trap beaches a stopped car for good,
  // as it does in real racing; the player restarts from the grid.)
  test("stuck nose-first in a wall, it backs out and drives on", async () => {
    const environment = createControlEnvironment(sources);
    let reply: ControlReply = await environment.handle({ type: "reset", track: "riviera", maxSeconds: 200 });

    // Flat out and straight on from the grid ends in the wall at the first bend.
    reply = await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0, steps: 600 });
    reply = await environment.handle({ type: "step", throttle: 1, brake: 0, steer: 0, steps: 360 });
    if (reply.type !== "observation") {
      throw new Error(JSON.stringify(reply));
    }

    const { distanceM: stuckAtM, lengthM } = reply.observation.track;
    expect(Math.abs(reply.observation.speedMps)).toBeLessThan(1);
    const ace = driverFor("riviera", "ace");
    for (let k = 0; k < 60 * 30 && reply.type === "observation" && !reply.done; k += 1) {
      reply = await environment.handle({ type: "step", ...ace.decide(reply.observation), steps: 1 });
    }

    if (reply.type !== "observation") {
      throw new Error(JSON.stringify(reply));
    }

    const { track } = reply.observation;
    expect((track.distanceM - stuckAtM + lengthM) % lengthM).toBeGreaterThan(500);
    expect(Math.abs(track.lateralM)).toBeLessThan(track.halfWidthM);
    expect(reply.observation.speedMps).toBeGreaterThan(15);
    environment.close();
  }, 60_000);
});
