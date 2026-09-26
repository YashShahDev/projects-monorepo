import { fetchTrack } from "./track.ts";
import type { TrackDefinition } from "./track.ts";
import { array, ContentError, fetchJson, object, text } from "./validate.ts";

/** A track the game can load; its content lives in `assets/tracks/<id>.json`. */
export interface TrackEntry {
  id: string;
  name: string;
}

export function parseTrackCatalog(value: unknown, source = "tracks"): TrackEntry[] {
  const root = object(value, source);
  if (root.version !== 1) {
    throw new ContentError(`${source}.version must be 1`);
  }

  const seen = new Set<string>();

  return array(root.tracks, `${source}.tracks`, 1).map((entry, i) => {
    const path = `${source}.tracks[${String(i)}]`;
    const v = object(entry, path);
    const id = text(v.id, `${path}.id`);

    // The id becomes part of a URL path, so it must not be able to reach another file.
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new ContentError(`${path}.id must use only a-z, 0-9 and -`);
    }

    if (seen.has(id)) {
      throw new ContentError(`${path}.id ${id} is used twice`);
    }

    seen.add(id);

    return { id, name: text(v.name, `${path}.name`) };
  });
}

/** The requested track, or the catalog's first when none is requested. */
export function chooseTrack(catalog: readonly TrackEntry[], requested: string | null): TrackEntry {
  const entry = requested === null ? catalog[0] : catalog.find((t) => t.id === requested);
  if (!entry) {
    const available = catalog.map((t) => t.id).join(", ");

    throw new ContentError(`unknown track "${String(requested)}"; available: ${available}`);
  }

  return entry;
}

export async function loadCatalogTrack(
  asset: (path: string) => URL,
  requested: string | null,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<TrackDefinition> {
  const catalogUrl = asset("assets/tracks/tracks.json");
  const catalog = parseTrackCatalog(await fetchJson(catalogUrl, fetchImpl), catalogUrl.pathname);
  const entry = chooseTrack(catalog, requested);
  const url = asset(`assets/tracks/${entry.id}.json`);
  const track = await fetchTrack(url, fetchImpl);
  if (track.id !== entry.id) {
    throw new ContentError(`${url.pathname}.id is ${track.id}, but the catalog lists ${entry.id}`);
  }

  return track;
}
