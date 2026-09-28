import { describe, expect, test } from "bun:test";
import { parseCarModelInterface } from "../src/content/car-model.ts";
import { validateCarModel } from "../tools/validate-car-model.ts";
import spec from "../content/cars/model-interface.json";
import { findNode, validModel } from "./support/car-model.ts";
import { car } from "./support/vehicle.ts";

const contract = parseCarModelInterface(spec);
const problems = (doc = validModel(car, contract)) => validateCarModel(doc, car, contract);

describe("car model interface", () => {
  test("names every node the game looks up", () => {
    expect(contract.wheels).toEqual(["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]);
    expect(contract.flaps).toEqual(["wing_front_flap", "wing_rear_flap"]);
    expect(contract.anchors).toEqual(["camera_chase", "camera_cockpit"]);
  });
  test("rejects duplicate names and budgets that do not shrink", () => {
    expect(() => parseCarModelInterface({ ...spec, anchors: ["body", "camera_cockpit"] })).toThrow("duplicate");
    expect(() => parseCarModelInterface({ ...spec, trianglesPerLod: [100, 200, 50] })).toThrow("trianglesPerLod");
  });
  test("needs exactly the chase and cockpit anchors, in that order", () => {
    expect(() => parseCarModelInterface({ ...spec, anchors: ["camera_chase"] })).toThrow(
      "model.anchors must list exactly 2 names",
    );
  });
});

describe("car model validation", () => {
  test("accepts a model that meets the interface", () => {
    expect(problems()).toEqual([]);
  });

  test("reports each missing or duplicated required node", () => {
    const doc = validModel(car, contract);
    findNode(doc, "camera_cockpit").dispose();
    findNode(doc, "wheel_RR").setName("wheel_RL");
    expect(problems(doc)).toContainValues([
      "missing node camera_cockpit",
      "missing node wheel_RR",
      "node wheel_RL appears 2 times",
    ]);
  });

  test("rejects meshes outside the interface, which would draw at every LOD", () => {
    const doc = validModel(car, contract);
    const stray = doc.createNode("airbox").setMesh(findNode(doc, "body_LOD0").getMesh());
    doc.getRoot().getDefaultScene()?.addChild(stray);
    expect(problems(doc)).toContain("mesh node airbox is not part of the model interface");
  });

  test("requires every LOD level under each LOD node", () => {
    const doc = validModel(car, contract);
    findNode(doc, "wing_rear_flap_LOD2").dispose();
    expect(problems(doc)).toContain("wing_rear_flap has no mesh wing_rear_flap_LOD2");
  });

  test("requires each LOD to have fewer triangles than the one before", () => {
    const doc = validModel(car, contract);
    const lod0 = findNode(doc, "body_LOD0").getMesh();
    if (lod0) {
      findNode(doc, "body_LOD1").setMesh(lod0);
    }

    expect(problems(doc)).toContain("body_LOD1 has 2012 triangles, not fewer than body_LOD0");
  });

  test("keeps each LOD level within its triangle budget", () => {
    const tight = { ...contract, trianglesPerLod: [5000, 1000, 400] };
    expect(validateCarModel(validModel(car, contract), car, tight)).toContain("LOD0 has 14012 triangles, budget 5000");
  });

  test("puts wheel pivots at the physics hub positions", () => {
    const doc = validModel(car, contract);
    findNode(doc, "wheel_FR").setTranslation([-0.8, -0.16, 1.7]);
    expect(problems(doc)).toContain("wheel_FR pivot is at (-0.800, -0.160, 1.700), expected (-0.800, -0.160, 1.800)");
  });

  test("requires wheel meshes centred on the pivot with the physics radius", () => {
    const doc = validModel(car, contract);
    findNode(doc, "wheel_RL_LOD0").setTranslation([0, 0.05, 0]);
    findNode(doc, "wheel_FL_LOD0").setScale([1, 1.1, 1.1]);
    expect(problems(doc)).toContainValues([
      "wheel_RL_LOD0 is not centred on its pivot",
      "wheel_FL_LOD0 has radius 0.396 m, physics uses 0.360 m",
    ]);
  });

  test("checks overall size against the 2026 envelope, so a wrong scale fails", () => {
    const doc = validModel(car, contract);
    for (const node of doc.getRoot().getDefaultScene()?.listChildren() ?? []) {
      node.setScale([100, 100, 100]);
    }

    const found = problems(doc);
    expect(found).toContain("node body has scale (100, 100, 100); named nodes must be unscaled");
    const envelope = validateCarModel(validModel(car, contract), car, {
      ...contract,
      envelopeM: { ...contract.envelopeM, width: [1.8, 1.85] },
    });
    expect(envelope).toContain("width is 1.880 m, expected 1.800–1.850 m");
  });

  test("requires the collision hull to match the physics chassis box", () => {
    const doc = validModel(car, contract);
    findNode(doc, "collision").setScale([1, 1, 1.2]);
    expect(problems(doc)).toContain(
      "collision bounds (0.850, 0.220, 3.000) differ from chassisHalfExtents (0.850, 0.220, 2.500)",
    );
  });

  test("requires a material on every visible primitive", () => {
    const doc = validModel(car, contract);
    for (const p of findNode(doc, "body_LOD1").getMesh()?.listPrimitives() ?? []) {
      p.setMaterial(null);
    }

    expect(problems(doc)).toContain("body_LOD1 has a primitive without a material");
  });

  test("fails on a texture slot whose image is missing or not PNG, JPEG or KTX2", () => {
    const doc = validModel(car, contract);
    const paint = doc.getRoot().listMaterials()[0];
    paint?.getNormalTexture()?.setImage(null);
    paint?.getOcclusionTexture()?.setMimeType("image/gif");
    expect(problems(doc)).toContainValues([
      "material paint normal texture has no image",
      "material paint occlusion texture has unsupported type image/gif",
    ]);
  });

  test("requires the materials liveries repaint on the body", () => {
    expect(contract.liveryMaterials).toEqual(["paint", "accent"]);
    const doc = validModel(car, contract);
    doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === "accent")
      ?.setName("trim");
    expect(problems(doc)).toContain("body_LOD0 has no material accent for liveries");
  });

  test("requires baked normal and ambient occlusion maps on the body", () => {
    const doc = validModel(car, contract);
    doc.getRoot().listMaterials()[0]?.setOcclusionTexture(null);
    expect(problems(doc)).toContain("body_LOD0 material paint has no occlusion texture");
  });
});
