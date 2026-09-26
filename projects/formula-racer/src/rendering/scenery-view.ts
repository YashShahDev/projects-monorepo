import * as THREE from "three";
import type { TrackGeometry } from "../simulation/track-geometry.ts";
import type { Runoff, Trackside } from "../simulation/trackside.ts";
import type { Footprint, SceneryLayout } from "./scenery-layout.ts";

// Browser tests classify screenshot pixels by colour: nothing here may read as the red
// car (r > 150, g < 80, b < 80) or as sky (b > 170 and b > r + 30).
const RUNOFF_COLOUR: Record<Exclude<Runoff, "grass">, number> = { gravel: 0xd8c49a, asphalt: 0x585c60 };
const BARRIER_RED = 0xd05a4a;
const BARRIER_WHITE = 0xeeeeee;
const BARRIER_STRIPE_M = 4;
const BARRIER_HEIGHT_M = 1.2;
const CONCRETE = 0xa8a8a0;
const SEATS = [0xe0b040, 0xe08a30, 0xcfcfcf, 0x7a5c9a];
const STEPS = 7;
const TREE_GREEN = 0x2f5f2a;
const TREE_BROWN = 0x5a4030;
const CELL_M = 250;
const SPONSORS = [0x1f4fbf, 0xf2f2f2, 0xd81e2c, 0x1b1b1b, 0xf5c400, 0x00a19a];
const TECPRO = [0x2456b0, 0xd23a2a];
const FENCE_GREY = 0x8a9096;
const RUNOFF_STRIPE = 0x2f5fa8;

interface Box {
  centre: [number, number, number];
  size: [number, number, number];
  colour: number;
}

/** One non-indexed geometry from coloured boxes, so a whole structure is one draw call. */
function boxes(parts: Box[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color();
  for (const part of parts) {
    const box = new THREE.BoxGeometry(...part.size).toNonIndexed();
    box.translate(...part.centre);
    positions.push(...box.getAttribute("position").array);
    normals.push(...box.getAttribute("normal").array);
    colour.set(part.colour);
    for (let i = 0; i < box.getAttribute("position").count; i += 1) {
      colours.push(colour.r, colour.g, colour.b);
    }

    box.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));

  return geometry;
}

/** Non-indexed geometries, one colour each, merged into one vertex-coloured geometry. */
function mergeColoured(...parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color();
  for (const [part, hex] of parts) {
    const flat = part.index ? part.toNonIndexed() : part;
    positions.push(...flat.getAttribute("position").array);
    colour.set(hex);
    for (let i = 0; i < flat.getAttribute("position").count; i += 1) {
      colours.push(colour.r, colour.g, colour.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * A grandstand in its own frame: length along z, rising in steps toward +x (away from
 * the track), with a roof over the upper rows.
 */
function grandstand(f: { lengthM: number; depthM: number }): THREE.BufferGeometry {
  const step = f.depthM / STEPS;
  const parts: Box[] = [];
  for (let k = 0; k < STEPS; k += 1) {
    const height = 1 + k * 1.1;
    const x = -f.depthM / 2 + step * (k + 0.5);
    parts.push({ centre: [x, height / 2, 0], size: [step, height, f.lengthM], colour: CONCRETE });

    // The crowd: a thin coloured layer on each step.
    parts.push({
      centre: [x, height + 0.3, 0],
      size: [step * 0.8, 0.6, f.lengthM - 1],
      colour: SEATS[k % SEATS.length] ?? CONCRETE,
    });
  }

  const top = 1 + STEPS * 1.1 + 3;
  parts.push({ centre: [f.depthM / 2 - 0.3, top / 2, 0], size: [0.6, top, f.lengthM], colour: CONCRETE });
  parts.push({ centre: [f.depthM / 6, top, 0], size: [f.depthM * 0.75, 0.4, f.lengthM + 2], colour: 0xe8e8e8 });

  return boxes(parts);
}

/** Pit garages: a long white block with a dark band of garage doors toward the track (−x). */
function building(f: { lengthM: number; depthM: number; heightM: number }, kind: "pits" | "tower") {
  if (kind === "tower") {
    return boxes([
      { centre: [0, f.heightM / 2, 0], size: [f.depthM * 0.6, f.heightM, f.lengthM * 0.6], colour: 0xd9dde1 },
      { centre: [0, f.heightM + 1.5, 0], size: [f.depthM, 3, f.lengthM], colour: 0x3a4148 },
    ]);
  }

  // A row of garage doors, 5 m wide with a metre of wall between them.
  const doors = Math.floor((f.lengthM - 4) / 6);
  const doorParts: Box[] = Array.from({ length: doors }, (_, k) => ({
    centre: [-f.depthM / 2 - 0.05, 2, (k - (doors - 1) / 2) * 6],
    size: [0.1, 4, 5],
    colour: 0x3a4148,
  }));

  return boxes([
    { centre: [0, f.heightM / 2, 0], size: [f.depthM, f.heightM, f.lengthM], colour: 0xd9dde1 },
    ...doorParts,
    { centre: [0, f.heightM + 0.4, 0], size: [f.depthM + 1, 0.8, f.lengthM + 1], colour: 0x9aa3ab },
  ]);
}

/** Heading that turns the structure's +x away from the track on its side. */
const facing = (f: Footprint) => f.headingRad + (f.side === "left" ? 0 : Math.PI);

/**
 * Triangles grouped by ground cell. Lap-long strips drawn as one mesh are never culled,
 * so everything is batched per cell and frustum culling skips what is out of view.
 */
class CellBatches {
  private readonly cells = new Map<string, { positions: number[]; colours: number[] }>();

  constructor(private readonly cellM: number) {}

  /** Adds triangles (world x, y, z triples) in one colour, filed under their first vertex. */
  add(positions: number[], colour: THREE.Color): void {
    const key = `${String(Math.floor((positions[0] ?? 0) / this.cellM))},${String(Math.floor((positions[2] ?? 0) / this.cellM))}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { positions: [], colours: [] };
      this.cells.set(key, cell);
    }

    cell.positions.push(...positions);
    for (let i = 0; i < positions.length / 3; i += 1) {
      cell.colours.push(colour.r, colour.g, colour.b);
    }
  }

  geometries(): THREE.BufferGeometry[] {
    return [...this.cells.values()].map(({ positions, colours }) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();

      return geometry;
    });
  }
}

/** Runoff surfaces beside the kerbs, only where the runoff is gravel or asphalt. */
function runoff(track: TrackGeometry, trackside: Trackside, batches: CellBatches): void {
  const colour = new THREE.Color();
  const edge = track.halfWidthM + track.kerbWidthM;
  const y = 0.004;
  for (const [side, sign] of [
    [trackside.left, 1],
    [trackside.right, -1],
  ] as const) {
    const at = (i: number, offset: number) => [
      (track.x[i] ?? 0) + (track.tz[i] ?? 0) * sign * offset,
      y,
      (track.z[i] ?? 0) - (track.tx[i] ?? 0) * sign * offset,
    ];
    for (let i = 0; i < track.count; i += 1) {
      const j = (i + 1) % track.count;
      const kind = side.runoff[i] ?? "grass";
      if (kind === "grass") {
        continue;
      }

      const [a, b, c, d] = [at(i, edge), at(i, side.runoffM[i] ?? edge), at(j, edge), at(j, side.runoffM[j] ?? edge)];

      // Outer lies left of inner on the left side only, so the right side winds the
      // other way round to face up as well.
      const quad = sign > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c];

      // Painted bands across asphalt run-off, every 10 m.
      const striped = kind === "asphalt" && i % Math.round(10 / track.spacingM) === 0;
      batches.add(quad.flat(), colour.set(striped ? RUNOFF_STRIPE : RUNOFF_COLOUR[kind]));
    }
  }
}

/** Barrier walls along each run, striped red and white. */
function barriers(trackside: Trackside, batches: CellBatches): void {
  const red = new THREE.Color(BARRIER_RED);
  const white = new THREE.Color(BARRIER_WHITE);
  const h = BARRIER_HEIGHT_M;
  for (const run of trackside.barriers) {
    const points = run.closed ? [...run.points, run.points[0] ?? { x: 0, z: 0 }] : run.points;
    let travelled = 0;
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i] ?? { x: 0, z: 0 };
      const b = points[i + 1] ?? a;
      const c = Math.floor(travelled / BARRIER_STRIPE_M) % 2 === 0 ? red : white;
      travelled += Math.hypot(b.x - a.x, b.z - a.z);
      batches.add([a.x, 0, a.z, b.x, 0, b.z, b.x, h, b.z, a.x, 0, a.z, b.x, h, b.z, a.x, h, a.z], c);
    }
  }
}

/**
 * Adds a box standing on `y`: `along` runs with `headingRad` (0 faces +z), `across` to
 * its left. Drawn double-sided, so the winding does not matter.
 */
function worldBox(
  batches: CellBatches,
  at: { x: number; y: number; z: number },
  headingRad: number,
  size: { along: number; across: number; height: number },
  colour: THREE.Color,
): void {
  const [fx, fz] = [Math.sin(headingRad), Math.cos(headingRad)];
  const corner = (a: number, b: number, up: number) => [
    at.x + (fx * a * size.along) / 2 + (fz * b * size.across) / 2,
    at.y + up * size.height,
    at.z + (fz * a * size.along) / 2 - (fx * b * size.across) / 2,
  ];
  const quad = (p: number[][]) => [p[0], p[1], p[2], p[0], p[2], p[3]].flatMap((v) => v ?? []);
  const faces = [
    [corner(-1, -1, 0), corner(1, -1, 0), corner(1, 1, 0), corner(-1, 1, 0)],
    [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)],
    [corner(-1, -1, 0), corner(1, -1, 0), corner(1, -1, 1), corner(-1, -1, 1)],
    [corner(-1, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(-1, 1, 1)],
    [corner(-1, -1, 0), corner(-1, 1, 0), corner(-1, 1, 1), corner(-1, -1, 1)],
    [corner(1, -1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, -1, 1)],
  ];
  batches.add(faces.flatMap(quad), colour);
}

/** Hoardings, tyre walls, fences and the pit wall, each on its barrier segment. */
function dressing(layout: SceneryLayout, batches: CellBatches): void {
  const colour = new THREE.Color();
  const h = BARRIER_HEIGHT_M;
  let travelled = 0;
  layout.attachments.forEach((a, k) => {
    const [dx, dz] = [a.b.x - a.a.x, a.b.z - a.a.z];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) {
      return;
    }

    travelled += length;
    const heading = Math.atan2(dx, dz);
    const mid = { x: (a.a.x + a.b.x) / 2, z: (a.a.z + a.b.z) / 2 };

    // The track lies to the right of travel for a left-side barrier, and to the left
    // for a right-side one. The segment's left is (dz, −dx) / length.
    const toTrack = a.side === "left" ? -1 : 1;
    const inward = (m: number) => ({ x: mid.x + (dz / length) * toTrack * m, z: mid.z - (dx / length) * toTrack * m });
    const along = length + 0.02;
    if (a.kind === "hoarding") {
      const sponsor = SPONSORS[Math.floor(travelled / 8) % SPONSORS.length] ?? 0xffffff;
      worldBox(batches, { ...mid, y: h }, heading, { along, across: 0.12, height: 1 }, colour.set(sponsor));
    } else if (a.kind === "tyres") {
      const block = TECPRO[Math.floor(k / 2) % TECPRO.length] ?? 0x2456b0;
      worldBox(batches, { ...inward(0.5), y: 0 }, heading, { along, across: 0.9, height: 1.05 }, colour.set(block));
    } else if (a.kind === "fence") {
      worldBox(batches, { ...a.a, y: h }, heading, { along: 0.1, across: 0.1, height: 3.4 }, colour.set(FENCE_GREY));
      for (const y of [2.3, 3.4, 4.5]) {
        worldBox(batches, { ...mid, y }, heading, { along, across: 0.04, height: 0.05 }, colour.set(FENCE_GREY));
      }
    } else {
      worldBox(batches, { ...mid, y: h }, heading, { along, across: 0.4, height: 0.3 }, colour.set(0xf2f2f2));

      // Team stands on the pit-lane side of the wall, every 12 m or so.
      if (Math.floor(travelled / 12) !== Math.floor((travelled - length) / 12)) {
        worldBox(
          batches,
          { ...inward(-1.4), y: 0 },
          heading,
          { along: 3, across: 1.6, height: 2.6 },
          colour.set(0x2a2f36),
        );
      }
    }
  });
}

/** The start gantry with its lights, and sponsor bridges. */
function spans(layout: SceneryLayout, batches: CellBatches): void {
  const colour = new THREE.Color();
  layout.spans.forEach((span, k) => {
    const [ax, az] = [Math.cos(span.headingRad), -Math.sin(span.headingRad)];
    const beam = span.kind === "gantry" ? 1.4 : 2.2;
    for (const sign of [-1, 1]) {
      const leg = { x: span.x + (ax * sign * span.widthM) / 2, y: 0, z: span.z + (az * sign * span.widthM) / 2 };
      worldBox(
        batches,
        leg,
        span.headingRad,
        { along: 0.7, across: 0.7, height: span.clearanceM + beam },
        colour.set(0x3a3f45),
      );
    }

    const body = span.kind === "gantry" ? 0x1e2226 : (SPONSORS[(k * 2) % SPONSORS.length] ?? 0x1f4fbf);
    worldBox(
      batches,
      { x: span.x, y: span.clearanceM, z: span.z },
      span.headingRad,
      { along: span.kind === "gantry" ? 1 : 2, across: span.widthM, height: beam },
      colour.set(body),
    );
    if (span.kind === "gantry") {
      // Five red lights facing the grid, which approaches from behind the gantry.
      const [fx, fz] = [Math.sin(span.headingRad), Math.cos(span.headingRad)];
      for (let light = -2; light <= 2; light += 1) {
        const at = {
          x: span.x + ax * light * 1.1 - fx * 0.55,
          y: span.clearanceM + 0.35,
          z: span.z + az * light * 1.1 - fz * 0.55,
        };
        worldBox(batches, at, span.headingRad, { along: 0.2, across: 0.7, height: 0.7 }, colour.set(0xff2a1a));
      }
    }
  });
}

/** Marshal posts: a white hut with an orange roof. */
function marshalPosts(layout: SceneryLayout, batches: CellBatches): void {
  const colour = new THREE.Color();
  for (const f of layout.marshals) {
    const size = { along: f.lengthM, across: f.depthM, height: 2.4 };
    worldBox(batches, { x: f.x, y: 0, z: f.z }, f.headingRad, size, colour.set(0xf2f2f2));
    worldBox(batches, { x: f.x, y: 2.4, z: f.z }, f.headingRad, { ...size, height: 0.35 }, colour.set(0xff7a00));
  }
}

/**
 * Everything around the circuit, in a handful of draw calls: runoff, barriers, stands and
 * buildings as vertex-coloured meshes, and trees as two instanced meshes.
 */
export function createScenery(
  track: TrackGeometry,
  trackside: Trackside,
  layout: SceneryLayout,
  own: <T extends { dispose(): void }>(resource: T) => T,
): THREE.Group {
  const group = new THREE.Group();
  const painted = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  const walls = own(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
  );
  const ground = new CellBatches(CELL_M);
  runoff(track, trackside, ground);
  for (const geometry of ground.geometries()) {
    group.add(new THREE.Mesh(own(geometry), painted));
  }

  const fences = new CellBatches(CELL_M);
  barriers(trackside, fences);
  for (const geometry of fences.geometries()) {
    group.add(Object.assign(new THREE.Mesh(own(geometry), walls), { name: "barrier" }));
  }

  const dressed = new CellBatches(CELL_M);
  dressing(layout, dressed);
  spans(layout, dressed);
  marshalPosts(layout, dressed);
  for (const geometry of dressed.geometries()) {
    group.add(Object.assign(new THREE.Mesh(own(geometry), walls), { name: "dressing" }));
  }

  const [first] = layout.grandstands;
  if (first) {
    const stands = new THREE.InstancedMesh(own(grandstand(first)), painted, layout.grandstands.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    layout.grandstands.forEach((f, i) => {
      rotation.setFromAxisAngle(up, facing(f));
      stands.setMatrixAt(i, matrix.compose(new THREE.Vector3(f.x, 0, f.z), rotation, one));
    });
    group.add(stands);
  }

  for (const b of layout.buildings) {
    const mesh = new THREE.Mesh(own(building(b, b.kind)), painted);
    mesh.position.set(b.x, 0, b.z);
    mesh.rotation.y = facing(b);
    group.add(mesh);
  }

  // Trees are most of the scenery's vertices. Each is one merged crown and trunk, and
  // they are drawn in spatial chunks so frustum culling skips the ones out of view.
  if (layout.trees.length > 0) {
    const crown = new THREE.ConeGeometry(0.35, 0.75, 6, 1, true).translate(0, 0.625, 0);
    const trunk = new THREE.CylinderGeometry(0.04, 0.05, 0.3, 4, 1, true).translate(0, 0.15, 0);
    const tree = own(mergeColoured([crown, TREE_GREEN], [trunk, TREE_BROWN]));
    crown.dispose();
    trunk.dispose();
    const chunks = new Map<string, typeof layout.trees>();
    for (const t of layout.trees) {
      const key = `${String(Math.floor(t.x / CELL_M))},${String(Math.floor(t.z / CELL_M))}`;
      chunks.set(key, [...(chunks.get(key) ?? []), t]);
    }

    const matrix = new THREE.Matrix4();
    for (const trees of chunks.values()) {
      const mesh = new THREE.InstancedMesh(tree, painted, trees.length);
      trees.forEach((t, i) => {
        mesh.setMatrixAt(i, matrix.makeScale(t.heightM, t.heightM, t.heightM).setPosition(t.x, 0, t.z));
      });
      mesh.computeBoundingSphere();
      mesh.name = "trees";
      group.add(mesh);
    }
  }

  return group;
}
