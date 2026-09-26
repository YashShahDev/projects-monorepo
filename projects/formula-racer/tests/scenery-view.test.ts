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

test("dresses the circuit: hoardings on the walls, spans over the road and marshal posts", () => {
  const group = createScenery(geometry, trackside, layout, (r) => r);
  const dressing = group.children.filter((c): c is THREE.Mesh => c.name === "dressing");
  expect(dressing.length).toBeGreaterThan(4);

  // Every dressing part is a box of 36 vertices; collect each one's centre and height.
  const boxes: { x: number; z: number; bottom: number; top: number }[] = [];
  let vertices = 0;
  for (const mesh of dressing) {
    const position = mesh.geometry.getAttribute("position");
    vertices += position.count;
    expect(position.count % 36).toBe(0);
    for (let at = 0; at < position.count; at += 36) {
      const ys = Array.from({ length: 36 }, (_, i) => position.getY(at + i));
      const mean = (get: (i: number) => number) =>
        Array.from({ length: 36 }, (_, i) => get(at + i)).reduce((a, b) => a + b) / 36;
      boxes.push({
        x: mean((i) => position.getX(i)),
        z: mean((i) => position.getZ(i)),
        bottom: Math.min(...ys),
        top: Math.max(...ys),
      });
    }
  }

  const at = (x: number, z: number) => boxes.filter((b) => Math.hypot(b.x - x, b.z - z) < 0.05);

  // A hoarding sits on the barrier top over the middle of its segment, a metre tall.
  const hoarding = layout.attachments.find((a) => a.kind === "hoarding");
  expect(hoarding).toBeDefined();
  if (hoarding !== undefined) {
    const board = at((hoarding.a.x + hoarding.b.x) / 2, (hoarding.a.z + hoarding.b.z) / 2);
    expect(board).toHaveLength(1);
    expect(board[0]?.bottom).toBeCloseTo(1.2, 5);
    expect(board[0]?.top).toBeCloseTo(2.2, 5);
  }

  // Each span's beam hangs over the road with its underside at the clearance height.
  expect(layout.spans.length).toBeGreaterThan(0);
  for (const span of layout.spans) {
    const beam = at(span.x, span.z);
    expect(beam).toHaveLength(1);
    expect(beam[0]?.bottom).toBeCloseTo(span.clearanceM, 5);
  }

  // A hut with a roof on top.
  expect(layout.marshals.length).toBeGreaterThan(0);
  for (const post of layout.marshals) {
    const tops = at(post.x, post.z)
      .map((b) => b.top)
      .sort((a, b) => a - b);
    expect(tops).toHaveLength(2);
    expect(tops[0]).toBeCloseTo(2.4, 5);
    expect(tops[1]).toBeCloseTo(2.75, 5);
  }

  // Twelve triangles a box keeps the whole dressing well under the frame budget.
  expect(vertices / 3).toBeLessThan(120_000);
});
