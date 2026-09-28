import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDrivingSession } from "../src/app/session.ts";
import type { SessionSource } from "../src/control/environment.ts";
import { parseCar } from "../src/content/car.ts";
import { parseEnergyRules } from "../src/content/energy-rules.ts";
import { parseTrack } from "../src/content/track.ts";
import { ContentError } from "../src/content/validate.ts";
import { parseTrackCatalog } from "../src/content/track-catalog.ts";

/**
 * Fresh sessions of the shipped car, energy rules and tracks, read from `public/assets`.
 * A new session per episode makes each one depend only on its reset and its steps.
 */
export function fileSessions(root = resolve(import.meta.dirname, "..")): SessionSource {
  const json = (path: string): unknown => JSON.parse(readFileSync(resolve(root, "public/assets", path), "utf8"));
  const car = parseCar(json("cars/fr26.json"));
  const energy = parseEnergyRules(json("rules/energy-2026-c18.json"));

  return {
    trackIds: parseTrackCatalog(json("tracks/tracks.json")).map((entry) => entry.id),
    async open(id) {
      const path = `tracks/${id}.json`;
      const track = parseTrack(json(path), path);

      // As the browser's catalog loader does: a file copied under another name is refused.
      if (track.id !== id) {
        throw new ContentError(`${path}.id is ${track.id}, but the catalog lists ${id}`);
      }

      const session = await createDrivingSession(car, track, { energy });

      return {
        session,
        release: () => {
          session.dispose();
        },
      };
    },
  };
}
