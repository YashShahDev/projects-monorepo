import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProbeScene } from "../src/content/probe-scene.ts";
import type { ProbeScene } from "../src/content/probe-scene.ts";
import { createProbeWorld } from "../src/simulation/probe-world.ts";

const scene = parseProbeScene(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../public/assets/probe/scene.json"), "utf8"),
  ),
);

async function heightsAfter(stepCounts: number[], input: ProbeScene = scene): Promise<number[]> {
  const world = await createProbeWorld(input);
  try {
    return stepCounts.map((count) => {
      while (world.steps < count) world.step();
      return world.boxPose().position.y;
    });
  } finally {
    world.dispose();
  }
}

describe("probe physics world", () => {
  test("starts the box at the scene's drop height", async () => {
    expect(await heightsAfter([0])).toEqual([scene.box.dropHeight]);
  });

  test("the box falls under gravity at roughly g·t²/2 before contact", async () => {
    const world = await createProbeWorld(scene);
    const steps = 30;
    for (let i = 0; i < steps; i += 1) world.step();
    const t = steps * world.timestep;
    const expected = scene.box.dropHeight + 0.5 * scene.gravity.y * t * t;
    // Semi-implicit Euler integration differs from the closed form by a few centimetres.
    expect(world.boxPose().position.y).toBeCloseTo(expected, 1);
    world.dispose();
  });

  test("the box comes to rest on top of the ground", async () => {
    const [settled] = await heightsAfter([300]);
    expect(settled).toBeCloseTo(scene.box.halfExtents.y, 2);
  });

  test("identical scenes produce identical trajectories", async () => {
    const counts = [1, 10, 45, 120];
    expect(await heightsAfter(counts)).toEqual(await heightsAfter(counts));
  });

  test("scene gravity is applied rather than a built-in default", async () => {
    const moon = { ...scene, gravity: { x: 0, y: -1.62, z: 0 } };
    const [earth, lunar] = [(await heightsAfter([20]))[0], (await heightsAfter([20], moon))[0]];
    expect(lunar).toBeGreaterThan(earth ?? Number.NaN);
  });

  test("using a disposed world fails clearly and dispose is idempotent", async () => {
    const world = await createProbeWorld(scene);
    world.dispose();
    world.dispose();
    expect(() => world.step()).toThrow("probe world used after dispose()");
    expect(() => world.boxPose()).toThrow("probe world used after dispose()");
  });

  test("worlds are independent", async () => {
    const [a, b] = [await createProbeWorld(scene), await createProbeWorld(scene)];
    for (let i = 0; i < 20; i += 1) a.step();
    expect(b.boxPose().position.y).toBe(scene.box.dropHeight);
    a.dispose();
    b.dispose();
  });
});
