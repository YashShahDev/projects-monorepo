import { getBounds, NodeIO, Primitive } from "@gltf-transform/core";
import type { Document, Material, Node, Texture } from "@gltf-transform/core";
import { parseCar } from "../src/content/car.ts";
import type { CarDefinition } from "../src/content/car.ts";
import {
  lodName,
  lodNodes,
  parseCarModelInterface,
  requiredNodes,
} from "../src/content/car-model.ts";
import type { CarModelInterface } from "../src/content/car-model.ts";

const POSITION_TOLERANCE_M = 0.01;
const COLLISION_TOLERANCE_M = 0.03;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/ktx2"]);

type Box = { min: number[]; max: number[] };

const f3 = (v: number[]) => `(${v.map((n) => n.toFixed(3)).join(", ")})`;
const at = (v: number[], i: number) => v[i] ?? 0;
const size = (b: Box, i: number) => at(b.max, i) - at(b.min, i);
const centre = (b: Box, i: number) => (at(b.max, i) + at(b.min, i)) / 2;

function triangles(node: Node): number {
  let total = 0;
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    if (primitive.getMode() !== Primitive.Mode.TRIANGLES) continue;
    const count =
      primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount();
    total += Math.floor((count ?? 0) / 3);
  }
  return total;
}

function union(boxes: Box[]): Box {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(at(min, i), at(b.min, i));
      max[i] = Math.max(at(max, i), at(b.max, i));
    }
  return { min, max };
}

const TEXTURE_SLOTS: [string, (m: Material) => Texture | null][] = [
  ["baseColor", (m) => m.getBaseColorTexture()],
  ["metallicRoughness", (m) => m.getMetallicRoughnessTexture()],
  ["normal", (m) => m.getNormalTexture()],
  ["occlusion", (m) => m.getOcclusionTexture()],
  ["emissive", (m) => m.getEmissiveTexture()],
];

/**
 * Checks a car model against the node interface and the physics definition it will be
 * drawn over. Returns every problem found, so one export run reports them all.
 */
export function validateCarModel(
  doc: Document,
  car: CarDefinition,
  spec: CarModelInterface,
): string[] {
  const problems: string[] = [];
  const nodes = doc.getRoot().listNodes();
  const byName = new Map<string, Node[]>();
  for (const node of nodes)
    byName.set(node.getName(), [...(byName.get(node.getName()) ?? []), node]);

  const named = new Map<string, Node>();
  for (const name of requiredNodes(spec)) {
    const found = byName.get(name) ?? [];
    if (found.length === 0) problems.push(`missing node ${name}`);
    else if (found.length > 1) problems.push(`node ${name} appears ${String(found.length)} times`);
    else if (found[0]) named.set(name, found[0]);
  }
  for (const [name, node] of named) {
    const scale = node.getScale();
    if (scale.some((s) => Math.abs(s - 1) > 1e-6)) {
      problems.push(`node ${name} has scale (${scale.join(", ")}); named nodes must be unscaled`);
    }
  }

  const allowedMeshes = new Set([
    spec.collision,
    ...lodNodes(spec).flatMap((name) =>
      Array.from({ length: spec.lodCount }, (_, level) => lodName(name, level)),
    ),
  ]);
  for (const node of nodes) {
    if (node.getMesh() && !allowedMeshes.has(node.getName())) {
      problems.push(`mesh node ${node.getName()} is not part of the model interface`);
    }
  }

  // LOD meshes, their triangle counts and materials.
  const lod0: Node[] = [];
  const perLevel = Array.from({ length: spec.lodCount }, () => 0);
  const materials = new Set<Material>();
  for (const name of lodNodes(spec)) {
    const parent = named.get(name);
    if (!parent) continue;
    let previous: number | undefined;
    for (let level = 0; level < spec.lodCount; level += 1) {
      const child = parent.listChildren().find((c) => c.getName() === lodName(name, level));
      if (!child?.getMesh()) {
        problems.push(`${name} has no mesh ${lodName(name, level)}`);
        continue;
      }
      if (level === 0) lod0.push(child);
      const count = triangles(child);
      perLevel[level] = at(perLevel, level) + count;
      if (previous !== undefined && count >= previous) {
        problems.push(
          `${lodName(name, level)} has ${String(count)} triangles, not fewer than ${lodName(name, level - 1)}`,
        );
      }
      previous = count;
      for (const primitive of child.getMesh()?.listPrimitives() ?? []) {
        const material = primitive.getMaterial();
        if (material) materials.add(material);
        else problems.push(`${lodName(name, level)} has a primitive without a material`);
      }
    }
  }
  perLevel.forEach((count, level) => {
    const budget = spec.trianglesPerLod[level] ?? 0;
    if (count > budget) {
      problems.push(`LOD${String(level)} has ${String(count)} triangles, budget ${String(budget)}`);
    }
  });

  for (const material of materials) {
    for (const [slot, get] of TEXTURE_SLOTS) {
      const texture = get(material);
      if (!texture) continue;
      const label = `material ${material.getName()} ${slot} texture`;
      if (!texture.getImage()?.byteLength) problems.push(`${label} has no image`);
      else if (!IMAGE_TYPES.has(texture.getMimeType())) {
        problems.push(`${label} has unsupported type ${texture.getMimeType()}`);
      }
    }
  }
  const bodyLod0 = lod0.find((n) => n.getName() === lodName(spec.body, 0));
  for (const primitive of bodyLod0?.getMesh()?.listPrimitives() ?? []) {
    const material = primitive.getMaterial();
    if (!material) continue;
    for (const [slot, texture] of [
      ["normal", material.getNormalTexture()],
      ["occlusion", material.getOcclusionTexture()],
    ] as const) {
      if (!texture) {
        problems.push(
          `${bodyLod0?.getName() ?? ""} material ${material.getName()} has no ${slot} texture`,
        );
      }
    }
  }

  // Wheel pivots sit where physics puts the hubs at rest.
  const w = car.wheels;
  const hubs = [
    [w.halfTrack, w.frontAxleZ],
    [-w.halfTrack, w.frontAxleZ],
    [w.halfTrack, w.rearAxleZ],
    [-w.halfTrack, w.rearAxleZ],
  ];
  spec.wheels.forEach((name, i) => {
    const pivot = named.get(name);
    if (!pivot) return;
    const expected = [
      at(hubs[i] ?? [], 0),
      w.connectionY - w.suspensionRestLength,
      at(hubs[i] ?? [], 1),
    ];
    const actual = pivot.getWorldTranslation();
    if (expected.some((e, k) => Math.abs(e - at(actual, k)) > POSITION_TOLERANCE_M)) {
      problems.push(`${name} pivot is at ${f3(actual)}, expected ${f3(expected)}`);
    }
    const mesh = pivot.listChildren().find((c) => c.getName() === lodName(name, 0));
    if (!mesh) return;
    const bounds = getBounds(mesh);
    if ([0, 1, 2].some((k) => Math.abs(centre(bounds, k) - at(actual, k)) > POSITION_TOLERANCE_M)) {
      problems.push(`${lodName(name, 0)} is not centred on its pivot`);
    }
    const radius = Math.max(size(bounds, 1), size(bounds, 2)) / 2;
    if (Math.abs(radius - w.radius) > POSITION_TOLERANCE_M) {
      problems.push(
        `${lodName(name, 0)} has radius ${radius.toFixed(3)} m, physics uses ${w.radius.toFixed(3)} m`,
      );
    }
  });

  // Overall size catches unit and scale mistakes as well as proportions.
  if (lod0.length > 0) {
    const all = union(lod0.map((n) => getBounds(n)));
    const e = spec.envelopeM;
    for (const [label, axis, [min, max]] of [
      ["length", 2, e.length],
      ["width", 0, e.width],
      ["height", 1, e.height],
    ] as const) {
      const measured = size(all, axis);
      if (measured < min - 1e-6 || measured > max + 1e-6) {
        problems.push(
          `${label} is ${measured.toFixed(3)} m, expected ${min.toFixed(3)}–${max.toFixed(3)} m`,
        );
      }
    }
  }

  const collision = named.get(spec.collision);
  if (collision) {
    if (!collision.getMesh()) problems.push(`${spec.collision} has no mesh`);
    else {
      const b = getBounds(collision);
      const half = [0, 1, 2].map((k) => size(b, k) / 2);
      const h = car.chassisHalfExtents;
      const expected = [h.x, h.y, h.z];
      const off =
        expected.some((e, k) => Math.abs(e - at(half, k)) > COLLISION_TOLERANCE_M) ||
        [0, 1, 2].some((k) => Math.abs(centre(b, k)) > COLLISION_TOLERANCE_M);
      if (off) {
        problems.push(
          `${spec.collision} bounds ${f3(half)} differ from chassisHalfExtents ${f3(expected)}`,
        );
      }
      const count = triangles(collision);
      if (count > spec.collisionMaxTriangles) {
        problems.push(
          `${spec.collision} has ${String(count)} triangles, limit ${String(spec.collisionMaxTriangles)}`,
        );
      }
    }
  }
  return problems;
}

/** Reads and validates a model file; unreadable files (such as a missing texture) are problems too. */
export async function validateCarModelFile(
  path: string,
  car: CarDefinition,
  spec: CarModelInterface,
): Promise<string[]> {
  let doc: Document;
  try {
    doc = await new NodeIO().read(path);
  } catch (error) {
    return [`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`];
  }
  return validateCarModel(doc, car, spec);
}

if (import.meta.main) {
  const [model = "public/assets/cars/fr26.glb", carPath = "public/assets/cars/fr26.json"] =
    process.argv.slice(2);
  const car = parseCar(await Bun.file(carPath).json(), carPath);
  const spec = parseCarModelInterface(await Bun.file("content/cars/model-interface.json").json());
  const problems = await validateCarModelFile(model, car, spec);
  for (const problem of problems) console.error(`${model}: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`${model}: valid`);
}
