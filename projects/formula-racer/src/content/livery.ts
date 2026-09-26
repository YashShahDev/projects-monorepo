import { array, ContentError, fetchJson, inRange, object, text } from "./validate.ts";

/** A paint scheme. Liveries carry no performance data, so every choice drives the same. */
export interface Livery {
  id: string;
  name: string;
  number: number;

  /** Main body colour, `#rrggbb`; drawn on the model's `paint` material. */
  paint: string;

  /** Detail colour, `#rrggbb`; drawn on the model's `accent` material. */
  accent: string;
}

const KEYS = new Set(["id", "name", "number", "paint", "accent"]);

const colour = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new ContentError(`${path} must be a #rrggbb colour`);
  }

  return value.toLowerCase();
};

export function parseLiveries(value: unknown, source = "liveries"): Livery[] {
  const root = object(value, source);
  if (root.version !== 1) {
    throw new ContentError(`${source}.version must be 1`);
  }

  const seen = new Set<string>();

  return array(root.liveries, `${source}.liveries`, 1).map((entry, i) => {
    const path = `${source}.liveries[${String(i)}]`;
    const v = object(entry, path);
    for (const key of Object.keys(v)) {
      if (!KEYS.has(key)) {
        throw new ContentError(`${path}.${key} is not a livery property (liveries are visual only)`);
      }
    }

    const id = text(v.id, `${path}.id`);
    if (seen.has(id)) {
      throw new ContentError(`${path}.id ${id} is used twice`);
    }

    seen.add(id);

    return {
      id,
      name: text(v.name, `${path}.name`),
      number: inRange(v.number, `${path}.number`, 0, 99),
      paint: colour(v.paint, `${path}.paint`),
      accent: colour(v.accent, `${path}.accent`),
    };
  });
}

export async function fetchLiveries(url: URL, fetchImpl: (url: URL) => Promise<Response> = fetch): Promise<Livery[]> {
  return parseLiveries(await fetchJson(url, fetchImpl), url.pathname);
}
