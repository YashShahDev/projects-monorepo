import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chooseTrack, loadCatalogTrack, parseTrackCatalog } from "../src/content/track-catalog.ts";
import { parseTrack } from "../src/content/track.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import shipped from "../public/assets/tracks/tracks.json";

const catalog = parseTrackCatalog(shipped);
const readTrack = (id: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../public/assets/tracks/${id}.json`), "utf8")) as Record<
    string,
    unknown
  >;

/** Serves JSON bodies by URL path and records what was asked for. */
function fakeFetch(files: Record<string, unknown>) {
  const requested: string[] = [];
  const fetchImpl = (url: URL) => {
    requested.push(url.pathname);
    const body = files[url.pathname];

    return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(JSON.stringify(body)));
  };

  return { fetchImpl, requested };
}

const asset = (path: string) => new URL(path, "http://localhost/game/");

describe("track catalog", () => {
  test("ships the circuit first and a small test map", () => {
    expect(catalog.map((t) => t.id)).toEqual(["harbour", "test-loop"]);
    expect(catalog[0]?.name).toBe("Harbour Park");
  });

  test("every entry has a matching track file", () => {
    for (const entry of catalog) {
      const track = parseTrack(readTrack(entry.id), entry.id);
      expect(track.id).toBe(entry.id);
      expect(track.name).toBe(entry.name);
    }
  });

  test("rejects ids that are not safe file names, duplicates and an empty list", () => {
    const tracks = (list: unknown[]) => ({ version: 1, tracks: list });
    expect(() => parseTrackCatalog(tracks([{ id: "../car", name: "X" }]))).toThrow(
      "tracks.tracks[0].id must use only a-z, 0-9 and -",
    );
    expect(() =>
      parseTrackCatalog(
        tracks([
          { id: "a", name: "A" },
          { id: "a", name: "B" },
        ]),
      ),
    ).toThrow("tracks.tracks[1].id a is used twice");
    expect(() => parseTrackCatalog(tracks([]))).toThrow("tracks.tracks");
    expect(() => parseTrackCatalog({ version: 2, tracks: [] })).toThrow("tracks.version must be 1");
  });

  test("chooses the first track by default and a requested one by id", () => {
    expect(chooseTrack(catalog, null).id).toBe("harbour");
    expect(chooseTrack(catalog, "test-loop").id).toBe("test-loop");
    expect(chooseTrack(catalog, "").id).toBe("harbour");
  });

  test("names the available tracks when the requested one is unknown", () => {
    expect(() => chooseTrack(catalog, "monza")).toThrow('unknown track "monza"; available: harbour, test-loop');
  });
});

describe("loading a catalog track", () => {
  test("fetches the catalog, then the chosen track under the same base path", async () => {
    const { fetchImpl, requested } = fakeFetch({
      "/game/assets/tracks/tracks.json": shipped,
      "/game/assets/tracks/test-loop.json": readTrack("test-loop"),
    });
    const track = await loadCatalogTrack(asset, "test-loop", fetchImpl);
    expect(track.id).toBe("test-loop");
    expect(requested).toEqual(["/game/assets/tracks/tracks.json", "/game/assets/tracks/test-loop.json"]);
  });

  test("rejects a track file whose id disagrees with the catalog", async () => {
    const { fetchImpl } = fakeFetch({
      "/game/assets/tracks/tracks.json": shipped,
      "/game/assets/tracks/test-loop.json": readTrack("harbour"),
    });
    await expect(loadCatalogTrack(asset, "test-loop", fetchImpl)).rejects.toThrow(
      "/game/assets/tracks/test-loop.json.id is harbour, but the catalog lists test-loop",
    );
  });

  test("reports a missing track file by path", async () => {
    const { fetchImpl } = fakeFetch({ "/game/assets/tracks/tracks.json": shipped });
    await expect(loadCatalogTrack(asset, null, fetchImpl)).rejects.toThrow(
      "/game/assets/tracks/harbour.json: HTTP 404",
    );
  });
});

describe("the test loop", () => {
  const track = parseTrack(readTrack("test-loop"));
  const geometry = buildTrackGeometry(track);

  test("is a short map that loads quickly", () => {
    expect(geometry.lengthM).toBeGreaterThan(800);
    expect(geometry.lengthM).toBeLessThan(1500);
    expect(track.controlPoints.length).toBeLessThan(150);
  });

  test("starts on the road", () => {
    const start = geometry.pointAt(track.startDistanceM);
    expect(geometry.locate(start.x, start.z).surface).toBe("road");
  });

  test("never passes within run-off distance of another part of itself", () => {
    const clearance = geometry.halfWidthM * 2 + geometry.kerbWidthM * 2 + 10;
    const skip = Math.ceil(150 / geometry.spacingM);
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < geometry.count; i += 1) {
      for (let j = i + skip; j < geometry.count; j += 1) {
        if (geometry.count - (j - i) < skip) {
          continue;
        }

        const d = Math.hypot((geometry.x[i] ?? 0) - (geometry.x[j] ?? 0), (geometry.z[i] ?? 0) - (geometry.z[j] ?? 0));
        closest = Math.min(closest, d);
      }
    }

    expect(closest).toBeGreaterThan(clearance);
  });
});
