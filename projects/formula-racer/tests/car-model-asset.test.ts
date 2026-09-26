import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { parseCarModelInterface } from "../src/content/car-model.ts";
import { validateCarModelFile } from "../tools/validate-car-model.ts";
import spec from "../content/cars/model-interface.json";
import { validModel } from "./support/car-model.ts";
import { car } from "./support/vehicle.ts";

const contract = parseCarModelInterface(spec);
const MODEL = "public/assets/cars/fr26.glb";

describe("shipped car model", () => {
  test("is the LFS object, not a pointer file", async () => {
    const head = (await readFile(MODEL)).subarray(0, 4).toString("latin1");

    // A checkout without `git lfs pull` holds a text pointer instead of the GLB.
    expect(head).toBe("glTF");
  });

  test("meets the model interface for the physics car", async () => {
    expect(await validateCarModelFile(MODEL, car, contract)).toEqual([]);
  });
});

describe("model files", () => {
  test("a texture file missing next to a .gltf is a validation failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "car-model-"));
    try {
      const doc = validModel(car, contract);
      const buffer = doc.createBuffer();
      for (const accessor of doc.getRoot().listAccessors()) {
        accessor.setBuffer(buffer);
      }

      doc
        .getRoot()
        .listTextures()
        .forEach((t, i) => t.setURI(`texture-${String(i)}.png`));
      const path = join(dir, "car.gltf");
      await new NodeIO().write(path, doc);
      await rm(join(dir, "texture-0.png"));
      const problems = await validateCarModelFile(path, car, contract);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toStartWith(`cannot read ${path}:`);
      expect(problems[0]).toContain("texture-0.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
