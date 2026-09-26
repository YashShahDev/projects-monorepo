import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { parseTrack } from "../src/content/track.ts";
import { layoutScenery } from "../src/rendering/scenery-layout.ts";
import { createScenery } from "../src/rendering/scenery-view.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { buildTrackside } from "../src/simulation/trackside.ts";

const track = parseTrack(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../public/assets/tracks/harbour.json"), "utf8")),
);
const geometry = buildTrackGeometry(track);
const trackside = buildTrackside(geometry);
const layout = layoutScenery(geometry, trackside, track.startDistanceM);

test("draws the whole layout in a handful of draw calls, and owns what it creates", () => {
  const owned: { dispose(): void }[] = [];
  const group = createScenery(geometry, trackside, layout, (r) => {
    owned.push(r);

    return r;
  });
  const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  const instanced = meshes.filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh);
  const trees = instanced.slice(1);
  expect(meshes.length - instanced.length).toBeLessThan(150);
  expect(instanced[0]?.count).toBe(layout.grandstands.length);
  expect(trees.reduce((sum, m) => sum + m.count, 0)).toBe(layout.trees.length);

  // Trees come in a few culled chunks, not one draw per tree.
  expect(trees.length).toBeGreaterThan(4);
  expect(trees.length).toBeLessThan(60);
  for (const mesh of meshes) {
    expect(owned).toContain(mesh.geometry);
    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
  }
});

test("barrier walls stand on the barrier lines, 1.2 m tall", () => {
  const group = createScenery(geometry, trackside, layout, (r) => r);
  const walls = group.children.filter((c): c is THREE.Mesh => c.name === "barrier");
  let vertices = 0;
  for (const wall of walls) {
    wall.geometry.computeBoundingBox();
    expect(wall.geometry.boundingBox?.min.y).toBe(0);
    expect(wall.geometry.boundingBox?.max.y).toBeCloseTo(1.2, 6);
    vertices += wall.geometry.getAttribute("position").count;
  }

  const segments = trackside.barriers.reduce((sum, b) => sum + b.points.length - (b.closed ? 0 : 1), 0);
  expect(vertices).toBe(segments * 6);

  // Batched by ground cell, so walls out of view are culled.
  expect(walls.length).toBeGreaterThan(4);
});

test("tree meshes are named so a quality preset can hide them", () => {
  const group = createScenery(geometry, trackside, layout, (r) => r);
  const trees = group.children.filter((c) => c.name === "trees");
  expect(trees.length).toBeGreaterThan(4);
  expect(trees.every((t) => t instanceof THREE.InstancedMesh)).toBe(true);
});
