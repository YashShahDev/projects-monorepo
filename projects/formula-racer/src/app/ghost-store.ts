import { isRecord } from "../content/validate.ts";
import { decodeGhost, encodeGhost } from "../simulation/ghost.ts";
import type { Ghost } from "../simulation/ghost.ts";
import type { StorageLike } from "./lap-store.ts";

export interface GhostStore {
  get(key: string): Ghost | undefined;

  /** Keeps the ghost for this visit even when storage refuses it. */
  save(key: string, ghost: Ghost): void;
}

const STORAGE_KEY = "formula-racer:ghosts";
const SCHEMA = 1;

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
    get(key) {
      const text = saved.get(key);

      return text === undefined ? undefined : decodeGhost(text);
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

      try {
        storage?.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: SCHEMA, order: [...saved.keys()], ghosts: Object.fromEntries(saved) }),
        );
      } catch {
        // Quota or a revoked permission: the ghost still races this visit.
      }
    },
  };
}
