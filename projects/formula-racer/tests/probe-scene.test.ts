import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ContentError, fetchProbeScene, parseProbeScene } from "../src/content/probe-scene.ts";

const shipped: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../public/assets/probe/scene.json"), "utf8"),
);
const valid = () => structuredClone(shipped) as Record<string, Record<string, unknown>>;

describe("probe scene content", () => {
  test("the shipped scene is valid", () => {
    expect(parseProbeScene(shipped).box.dropHeight).toBe(4);
  });
  test("names the failing field", () => {
    const scene = valid();
    scene.gravity = { x: 0, y: "down", z: 0 };
    expect(() => parseProbeScene(scene)).toThrow("probe scene.gravity.y must be a finite number");
  });
  test("rejects non-objects, arrays, NaN-like and unsupported versions", () => {
    expect(() => parseProbeScene(null)).toThrow(ContentError);
    expect(() => parseProbeScene([])).toThrow("must be an object");
    expect(() => parseProbeScene({ ...valid(), version: 2 })).toThrow("version must be 1");
    const scene = valid();
    scene.box = { ...scene.box, dropHeight: Number.POSITIVE_INFINITY };
    expect(() => parseProbeScene(scene)).toThrow("dropHeight must be a finite number");
  });
  test("rejects zero or negative sizes", () => {
    const scene = valid();
    scene.ground = { halfExtents: { x: 20, y: 0, z: 20 } };
    expect(() => parseProbeScene(scene)).toThrow("ground.halfExtents.y must be positive");
  });
  test("rejects a box that starts inside the ground", () => {
    const scene = valid();
    scene.box = { ...scene.box, dropHeight: 0.5 };
    expect(() => parseProbeScene(scene)).toThrow("must start the box above the ground");
  });
});

describe("probe scene loading", () => {
  const url = new URL("http://localhost/game/assets/probe/scene.json");
  test("reports the missing asset path and HTTP status", async () => {
    const fetch404 = () => Promise.resolve(new Response("", { status: 404 }));
    await expect(fetchProbeScene(url, fetch404)).rejects.toThrow(
      "/game/assets/probe/scene.json: HTTP 404",
    );
  });
  test("reports malformed JSON as a content error", async () => {
    const fetchBad = () => Promise.resolve(new Response("{"));
    await expect(fetchProbeScene(url, fetchBad)).rejects.toThrow("not valid JSON");
  });
  test("validates with the asset path as the error source", async () => {
    const fetchWrong = () => Promise.resolve(Response.json({ version: 1 }));
    await expect(fetchProbeScene(url, fetchWrong)).rejects.toThrow(
      "/game/assets/probe/scene.json.ground must be an object",
    );
  });
});
