import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { autopilot } from "../src/app/autopilot.ts";
import { createDrivingSession } from "../src/app/session.ts";
import type { DrivingSession } from "../src/app/session.ts";
import { parseTrack } from "../src/content/track.ts";
import { car } from "./support/vehicle.ts";

let session: DrivingSession | undefined;
afterEach(() => session?.dispose());

// The real-layout circuits must be drivable end to end, hairpins included.
test.each(["riviera", "ardennes", "royal-park"])(
  "the autopilot completes a lap of %s",
  async (id) => {
    const track = parseTrack(
      JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")),
    );
    session = await createDrivingSession(car, track);
    const s = session;
    for (let t = 0; t < 400 && s.state().laps.length === 0; t += 1 / 60) {
      s.frame(1 / 60, autopilot(s));
    }

    const [lap] = s.state().laps;
    expect(lap).toBeDefined();
    expect(lap?.timeS).toBeGreaterThan(40);
  },
  60_000,
);
