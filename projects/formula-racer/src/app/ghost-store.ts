import { isRecord } from "../content/validate.ts";
import { decodeGhost, encodeGhost } from "../simulation/ghost.ts";
import type { Ghost } from "../simulation/ghost.ts";
import type { StorageLike } from "./lap-store.ts";

export interface GhostStore {
  /** The ghost saved for `key`, if it is of the lap `bestLapS` long when that is given. */
  get(key: string, bestLapS?: number): Ghost | undefined;

  /** Keeps the ghost for this visit even when storage refuses it. */
  save(key: string, ghost: Ghost): void;
}

const STORAGE_KEY = "formula-racer:ghosts";
const SCHEMA = 1;

// The ghost's header keeps its lap time exactly; this only allows for rounding.
const SAME_LAP_S = 0.001;

// About 29 KB each as base64, so a dozen stay well inside a browser's storage quota.
const LIMIT = 12;

/** One ghost per best-lap key, the oldest saved dropped first. */
export function createGhostStore(storage: StorageLike | undefined): GhostStore {
  // Oldest first; encoded text is kept so saving never re-encodes the others.
  const saved = new Map<string, string>();
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
    if (isRecord(parsed) && parsed.version === SCHEMA && Array.isArray(parsed.order) && isRecord(parsed.ghosts)) {
      for (const key of parsed.order) {
        const text: unknown = typeof key === "string" ? parsed.ghosts[key] : undefined;
        if (typeof key === "string" && typeof text === "string") {
          saved.set(key, text);
        }
      }
    }
  } catch {
    // Unreadable or blocked: start with no ghosts.
  }

  return {
    get(key, bestLapS) {
      const text = saved.get(key);
      const ghost = text === undefined ? undefined : decodeGhost(text);
      if (ghost && bestLapS !== undefined && Math.abs(ghost.lapTimeS - bestLapS) > SAME_LAP_S) {
        return undefined;
      }

      return ghost;
    },
    save(key, ghost) {
      saved.delete(key);
      saved.set(key, encodeGhost(ghost));
      for (const oldest of saved.keys()) {
        if (saved.size <= LIMIT) {
          break;
        }

        saved.delete(oldest);
      }

      const write = (ghosts: Map<string, string>) => {
        storage?.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: SCHEMA, order: [...ghosts.keys()], ghosts: Object.fromEntries(ghosts) }),
        );
      };

      try {
        write(saved);
      } catch {
        // Quota or a revoked permission: the ghost still races this visit. The stored one
        // for this key belongs to an older best, so it must not come back after a reload.
        const others = new Map(saved);
        others.delete(key);
        try {
          write(others);
        } catch {
          // Storage is refusing all writes (revoked, say); nothing more can be done here.
        }
      }
    },
  };
}
