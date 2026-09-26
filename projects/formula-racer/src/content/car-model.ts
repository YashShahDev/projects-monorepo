import { array, ContentError, inRange, object, positive, text } from "./validate.ts";

/**
 * The node names a car model must provide so the game can find its moving parts. Each
 * LOD node (body, wheels, flaps) has mesh children `<name>_LOD0` … finest first; wheel
 * and flap nodes are pivots (wheels spin about local x, flaps hinge about local x).
 */
export interface CarModelInterface {
  version: 1;
  lodCount: number;
  wheels: string[];
  flaps: string[];
  body: string;
  anchors: string[];
  collision: string;
  trianglesPerLod: number[];
  collisionMaxTriangles: number;

  /** Body materials a livery recolours: main paint first, then accent. */
  liveryMaterials: string[];

  /** Allowed overall size, height measured from the bottom of the wheels. */
  envelopeM: { length: [number, number]; width: [number, number]; height: [number, number] };
}

const names = (value: unknown, path: string, count?: number) => {
  const list = array(value, path, 1).map((v, i) => text(v, `${path}[${String(i)}]`));
  if (count !== undefined && list.length !== count) {
    throw new ContentError(`${path} must list exactly ${String(count)} names`);
  }

  return list;
};

const range = (value: unknown, path: string): [number, number] => {
  const [min, max] = array(value, path, 2).map((v, i) => positive(v, `${path}[${String(i)}]`));
  if (min === undefined || max === undefined || min > max) {
    throw new ContentError(`${path} must be [min, max]`);
  }

  return [min, max];
};

export function parseCarModelInterface(value: unknown, source = "model"): CarModelInterface {
  const v = object(value, source);
  if (v.version !== 1) {
    throw new ContentError(`${source}.version must be 1`);
  }

  const lodCount = inRange(v.lodCount, `${source}.lodCount`, 1, 5);
  const trianglesPerLod = array(v.trianglesPerLod, `${source}.trianglesPerLod`, lodCount).map((t, i) =>
    positive(t, `${source}.trianglesPerLod[${String(i)}]`),
  );
  if (trianglesPerLod.some((t, i) => i > 0 && t >= (trianglesPerLod[i - 1] ?? 0))) {
    throw new ContentError(`${source}.trianglesPerLod must shrink with each level`);
  }

  const envelope = object(v.envelopeM, `${source}.envelopeM`);
  const spec: CarModelInterface = {
    version: 1,
    lodCount,

    // Physics wheel order: front-left, front-right, rear-left, rear-right.
    wheels: names(v.wheels, `${source}.wheels`, 4),
    flaps: names(v.flaps, `${source}.flaps`, 2),
    body: text(v.body, `${source}.body`),

    // Chase first, then cockpit: the renderer reads them by position.
    anchors: names(v.anchors, `${source}.anchors`, 2),
    collision: text(v.collision, `${source}.collision`),
    trianglesPerLod,
    collisionMaxTriangles: positive(v.collisionMaxTriangles, `${source}.collisionMaxTriangles`),
    liveryMaterials: names(v.liveryMaterials, `${source}.liveryMaterials`, 2),
    envelopeM: {
      length: range(envelope.length, `${source}.envelopeM.length`),
      width: range(envelope.width, `${source}.envelopeM.width`),
      height: range(envelope.height, `${source}.envelopeM.height`),
    },
  };
  const all = requiredNodes(spec);
  const duplicate = all.find((name, i) => all.indexOf(name) !== i);
  if (duplicate) {
    throw new ContentError(`${source} names ${duplicate} twice (duplicate)`);
  }

  return spec;
}

/** Nodes with LOD mesh children, in a stable order. */
export const lodNodes = (spec: CarModelInterface): string[] => [spec.body, ...spec.wheels, ...spec.flaps];

export const requiredNodes = (spec: CarModelInterface): string[] => [
  ...lodNodes(spec),
  ...spec.anchors,
  spec.collision,
];

export const lodName = (node: string, level: number): string => `${node}_LOD${String(level)}`;
