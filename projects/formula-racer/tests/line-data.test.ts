import { describe, expect, test } from "bun:test";
import { fetchLineData, lineDataFrom, lineGripScale, parseLineData } from "../src/content/line-data.ts";

const scale = Float64Array.from([1, 1, 0.925, 0.925, 0.925, 1, 1, 0.85, 1, 1]);
const data = lineDataFrom("riviera", scale, { lapS: 77.2, baselineLapS: 78.02 });

describe("saved racing line data", () => {
  test("keeps only the stretches whose grip was changed, and round-trips through JSON", () => {
    expect(data.lowered).toEqual([
      { from: 2, to: 4, scale: 0.925 },
      { from: 7, to: 7, scale: 0.85 },
    ]);
    const saved = JSON.stringify(data);
    const parsed = parseLineData(JSON.parse(saved));
    expect(parsed).toEqual(data);
    expect(Array.from(lineGripScale(parsed, 10) ?? [])).toEqual(Array.from(scale));
  });

  test("an untouched line saves no stretches and gives back all ones", () => {
    const plain = lineDataFrom("harbour", new Float64Array(4).fill(1), { lapS: 66.4, baselineLapS: 66.4 });
    expect(plain.lowered).toEqual([]);
    expect(Array.from(lineGripScale(plain, 4) ?? [])).toEqual([1, 1, 1, 1]);
  });

  test("is ignored when the track has a different number of samples, as after an edit", () => {
    expect(lineGripScale(data, 11)).toBeUndefined();
  });

  test("rejects malformed data with the path to the problem", () => {
    const bad = (patch: object) => () => parseLineData({ ...structuredClone(data), ...patch }, "riviera");
    expect(bad({ version: 2 })).toThrow("riviera.version must be 1");
    expect(bad({ lowered: [{ from: 5, to: 3, scale: 0.9 }] })).toThrow("riviera.lowered[0]");
    expect(bad({ lowered: [{ from: 0, to: 10, scale: 0.9 }] })).toThrow("riviera.lowered[0]");
    expect(bad({ lowered: [{ from: 0, to: 1, scale: 0 }] })).toThrow("riviera.lowered[0].scale");
    expect(bad({ track: "../x" })).toThrow("riviera.track");
  });

  test("a track with no saved line loads none; any other failure is an error", async () => {
    const reply =
      (status: number, body = "{}") =>
      () =>
        Promise.resolve(new Response(body, { status }));
    const url = new URL("https://example.test/assets/lines/harbour.json");
    expect(await fetchLineData(url, reply(404))).toBeUndefined();
    expect(await fetchLineData(url, reply(200, JSON.stringify(data)))).toEqual(data);
    const failure = await fetchLineData(url, reply(500)).catch((error: unknown) => error);
    expect(String(failure)).toContain("HTTP 500");
  });
});
