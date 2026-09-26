import { Document } from "@gltf-transform/core";
import type { Material, Node } from "@gltf-transform/core";
import type { CarDefinition } from "../../src/content/car.ts";
import type { CarModelInterface } from "../../src/content/car-model.ts";

/** A 1×1 PNG, enough for a texture slot to count as present. */
export const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

/**
 * An axis-aligned box made of `triangles` triangles (at least 12): the extras are
 * degenerate so counts can be set per LOD without real geometry.
 */
function box(
  doc: Document,
  material: Material | null,
  centre: number[],
  half: number[],
  triangles = 12,
) {
  const [cx = 0, cy = 0, cz = 0] = centre;
  const [hx = 0, hy = 0, hz = 0] = half;
  const corners: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(cx + sx * hx, cy + sy * hy, cz + sz * hz);
      }
    }
  }

  const faces = [
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5,
    7, 1, 7, 3,
  ];
  const index = [...faces];
  while (index.length < triangles * 3) {
    index.push(0, 0, 0);
  }

  const primitive = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(new Float32Array(corners)),
    )
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(index)));
  if (material) {
    primitive.setMaterial(material);
  }

  return doc.createMesh().addPrimitive(primitive);
}

/** A minimal model that satisfies the interface for `car`, for tests to break one way at a time. */
export function validModel(car: CarDefinition, spec: CarModelInterface) {
  const doc = new Document();
  const texture = (name: string) => doc.createTexture(name).setImage(PNG).setMimeType("image/png");
  const paint = doc
    .createMaterial("paint")
    .setNormalTexture(texture("normal"))
    .setOcclusionTexture(texture("ao"));
  const accent = doc
    .createMaterial("accent")
    .setNormalTexture(paint.getNormalTexture())
    .setOcclusionTexture(paint.getOcclusionTexture());
  const scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  const lods = (parent: Node, name: string, centre: number[], half: number[]) => {
    for (let i = 0; i < spec.lodCount; i += 1) {
      const triangles = [2000, 500, 100][i] ?? 12;
      parent.addChild(
        doc.createNode(`${name}_LOD${String(i)}`).setMesh(box(doc, paint, centre, half, triangles)),
      );
    }

    return parent;
  };

  const w = car.wheels;
  const groundY = w.connectionY - w.suspensionRestLength - w.radius;

  // Body: 5.1 m long, 1.6 m wide, top at 0.95 m above the ground.
  scene.addChild(
    lods(doc.createNode(spec.body), spec.body, [0, groundY + 0.5, 0.2], [0.8, 0.45, 2.55]),
  );

  // An accent trim piece on the body's finest LOD, for the livery material check.
  const trim = box(doc, accent, [0, groundY + 0.5, 0], [0.1, 0.1, 0.1]).listPrimitives()[0];
  if (trim) {
    findNode(doc, `${spec.body}_LOD0`).getMesh()?.addPrimitive(trim);
  }

  const centres = [
    [w.halfTrack, w.frontAxleZ],
    [-w.halfTrack, w.frontAxleZ],
    [w.halfTrack, w.rearAxleZ],
    [-w.halfTrack, w.rearAxleZ],
  ];
  spec.wheels.forEach((name, i) => {
    const [x = 0, z = 0] = centres[i] ?? [];
    const pivot = doc
      .createNode(name)
      .setTranslation([x, w.connectionY - w.suspensionRestLength, z]);
    scene.addChild(lods(pivot, name, [0, 0, 0], [0.14, w.radius, w.radius]));
  });
  spec.flaps.forEach((name, i) => {
    const z = i === 0 ? 2.6 : -2.2;
    scene.addChild(
      lods(doc.createNode(name).setTranslation([0, 0, z]), name, [0, 0, 0], [0.7, 0.02, 0.1]),
    );
  });
  for (const name of spec.anchors) {
    scene.addChild(doc.createNode(name).setTranslation([0, 0.5, -1]));
  }

  const h = car.chassisHalfExtents;
  scene.addChild(
    doc.createNode(spec.collision).setMesh(box(doc, null, [0, 0, 0], [h.x, h.y, h.z])),
  );

  return doc;
}

export const findNode = (doc: Document, name: string): Node => {
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
  if (!node) {
    throw new Error(`fixture has no node ${name}`);
  }

  return node;
};
