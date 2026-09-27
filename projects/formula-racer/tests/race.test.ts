import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDrivingSession, GRID_GAP_M } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { createRace, raceOrder } from "../src/app/race.ts";
import type { Race } from "../src/app/race.ts";
import { parseTrack } from "../src/content/track.ts";
import { buildRacingLine, lineLimits } from "../src/simulation/racing-line.ts";
import { car } from "./support/vehicle.ts";

const track = parseTrack(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8")),
);
const idle = { throttle: false, brake: false, left: false, right: false, deploy: false };

const sessions: DrivingSession[] = [];
const races: Race[] = [];
afterEach(() => {
  sessions.splice(0).forEach((s) => {
    s.dispose();
  });
  races.splice(0).forEach((r) => {
    r.dispose();
  });
});

const open = async (slot?: number) => {
  const s = await createDrivingSession(car, track, slot === undefined ? {} : { gridSlot: slot });
  sessions.push(s);

  return s;
};

describe("the grid", () => {
  test("slot 0 is the time-trial start; later slots stand further back, alternating sides", async () => {
    const [pole, second, third] = await Promise.all([open(), open(1), open(2)]);
    const where = (s: DrivingSession) => {
      const { x, z } = s.snapshot().position;

      return s.geometry.locate(x, z);
    };

    const back = (s: DrivingSession) => {
      const lengthM = s.geometry.lengthM;

      return ((track.startDistanceM - where(s).distanceM + 1.5 * lengthM) % lengthM) - lengthM / 2;
    };

    expect(back(pole)).toBeCloseTo(0, 0);
    expect(where(pole).lateralM).toBeCloseTo(0, 0);
    expect(back(second)).toBeCloseTo(GRID_GAP_M, 0);
    expect(back(third)).toBeCloseTo(2 * GRID_GAP_M, 0);
    expect(Math.abs(where(second).lateralM)).toBeGreaterThan(1.5);
    expect(Math.sign(where(second).lateralM)).toBe(-Math.sign(where(third).lateralM));
  });

  test("a car behind the line starts its first lap short of zero, so laps still end on the line", async () => {
    const s = await open(2);
    for (let t = 0; t < 3.05; t += 1 / 60) {
      s.frame(1 / 60, idle);
    }

    expect(s.state().lap?.progressM).toBeCloseTo(-2 * GRID_GAP_M, 0);
  });
});

describe("a race", () => {
  const start = async (count: number) => {
    const player = await open();
    const line = buildRacingLine(player.geometry, lineLimits(car));
    const race = await createRace(player, { car, track, level: "ace", count, line });
    races.push(race);

    return { player, race };
  };

  const run = (race: Race, seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      race.frame(1 / 60, idle);
    }
  };

  test("opponents line up behind the player and wait for the lights", async () => {
    const { player, race } = await start(3);
    expect(race.opponents).toHaveLength(3);
    expect(race.standings()).toEqual({ position: 1, cars: 4 });
    run(race, 2.9);
    for (const opponent of race.opponents) {
      expect(opponent.snapshot().simSeconds).toBeCloseTo(player.snapshot().simSeconds, 9);
      expect(Math.abs(opponent.snapshot().speedMps)).toBeLessThan(0.5);
    }
  });

  test("after the lights they drive off in step with the player, who falls behind standing still", async () => {
    const { player, race } = await start(2);
    run(race, 8);
    for (const opponent of race.opponents) {
      expect(opponent.snapshot().simSeconds).toBeCloseTo(player.snapshot().simSeconds, 9);
      expect(opponent.state().lap?.progressM).toBeGreaterThan(50);
    }

    expect(race.standings()).toEqual({ position: 3, cars: 3 });
  }, 30_000);

  test("a player restart puts every opponent back on its grid slot", async () => {
    const { player, race } = await start(2);
    run(race, 6);
    player.action("reset");
    race.frame(1 / 60, idle);
    for (const opponent of race.opponents) {
      expect(opponent.state().countdownS).toBeCloseTo(player.state().countdownS, 9);
      expect(Math.abs(opponent.snapshot().speedMps)).toBeLessThan(0.5);
    }

    expect(race.standings()).toEqual({ position: 1, cars: 3 });
  }, 30_000);

  test("the drawn opponents sit at the same point between steps as the player", async () => {
    const { race } = await start(1);
    run(race, 5);
    const frame = race.frame(1 / 144, idle);
    const [drawn] = frame.opponents;
    const [opponent] = race.opponents;
    if (!drawn || !opponent) {
      throw new Error("no opponent");
    }

    const latest = opponent.snapshot().position;
    const gapM = Math.hypot(drawn.position.x - latest.x, drawn.position.z - latest.z);
    expect(gapM).toBeGreaterThan(0);
    expect(gapM).toBeLessThan(opponent.snapshot().speedMps * opponent.stepSeconds);
  }, 30_000);
});

describe("race order", () => {
  test("more laps first, then further round the lap; ties keep grid order", () => {
    expect(
      raceOrder([
        { laps: 0, progressM: 500 },
        { laps: 1, progressM: 10 },
        { laps: 0, progressM: 600 },
      ]),
    ).toEqual([1, 2, 0]);
    expect(
      raceOrder([
        { laps: 0, progressM: -8 },
        { laps: 0, progressM: -8 },
      ]),
    ).toEqual([0, 1]);
    expect(raceOrder([])).toEqual([]);
  });
});
