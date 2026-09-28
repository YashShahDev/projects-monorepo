import * as THREE from "three";
import type { KerbMesh, KerbType } from "../simulation/kerbs.ts";

/** Length of each red or white block along a kerb. */
export const KERB_STRIPE_M = 1;

// The track's kerb palette: browser tests tell kerb red from the car's by its green channel.
const RED = new THREE.Color(0xd05a4a);
const WHITE = new THREE.Color(0xeeeeee);
const GREEN = new THREE.Color(0x2f9e55);
const YELLOW = new THREE.Color(0xf2c21b);

// Where a stepped kerb's upper tier and a sausage's hump begin, as shares of the width.
const TIER_FROM = 0.62;
const HUMP_FROM = 0.6;

// Walls lower than this are the ramped ends, flat on the ground: not worth a face.
const MIN_WALL_M = 1e-4;

// Triangles under half this area are too thin to see, like where a wall meets a ramped end.
const MIN_AREA_M2 = 1e-6;

const UP = new THREE.Vector3(0, 1, 0);

// The contact shadow along a kerb's outer edge: how far it reaches and how dark it starts.
const SHADOW_M = 0.3;
const SHADOW_ALPHA = 0.35;

// The collider samples every profile finely across and every 0.5 m along, which drew
// 100k triangles on Harbour. The eye needs only the shares where each profile bends,
// and a row per stripe block.
const DRAWN_ACROSS: Record<KerbType, readonly number[]> = {
  flat: [0, 0.3, 1],
  stepped: [0, 0.3, 0.5, 0.62, 0.75, 1],
  sausage: [0, 0.3, 0.62, 0.68, 0.8, 0.95, 1],
};
const DRAWN_ROW_M = 1;

/**
 * The kerbs as one lit, flat-shaded surface on the profile the wheels ride on, painted in
 * blocks, with walls down to the ground along both edges so each kerb stands up from the
 * verge. `lightAt` scales the colours, for the floodlit night.
 */
export function kerbGeometry(
  meshes: readonly KerbMesh[],
  lightAt: (x: number, z: number) => number = () => 1,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color();

  for (const mesh of meshes) {
    const { kerb, columns } = mesh;
    const p = mesh.positions;
    const meshRows = p.length / 3 / columns - 1;
    const vertex = (r: number, c: number) => {
      const i = (r * columns + c) * 3;

      return new THREE.Vector3(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0);
    };

    const shareOf = (c: number) => {
      const a = vertex(0, 0);
      const b = vertex(0, c);

      return Math.hypot(b.x - a.x, b.z - a.z) / kerb.widthM;
    };

    const shares = Array.from({ length: columns }, (_, c) => shareOf(c));
    const cols = DRAWN_ACROSS[kerb.type].map((want) =>
      shares.reduce((best, share, c) => (Math.abs(share - want) < Math.abs((shares[best] ?? 0) - want) ? c : best), 0),
    );
    const step = Math.max(1, Math.round((DRAWN_ROW_M * meshRows) / (mesh.toM - mesh.fromM)));
    const rows: number[] = [];
    for (let r = 0; r < meshRows; r += step) {
      rows.push(r);
    }

    rows.push(meshRows);
    const along = (r: number) => mesh.fromM + ((mesh.toM - mesh.fromM) * r) / meshRows;

    const paint = (alongM: number, u: number, x: number, z: number) => {
      const block = Math.floor((alongM - kerb.fromM) / KERB_STRIPE_M);
      if (kerb.type === "stepped" && u >= TIER_FROM) {
        colour.copy(GREEN);
      } else if (kerb.type === "sausage" && u >= HUMP_FROM) {
        colour.copy(YELLOW);
      } else {
        colour.copy(block % 2 === 0 ? RED : WHITE);
      }

      colour.multiplyScalar(lightAt(x, z));
    };

    // Adds a triangle wound so that it faces `towards`.
    const triangle = (
      corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
      towards: THREE.Vector3,
      alongM: number,
      u: number,
    ) => {
      const [a, b, c] = corners;
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (normal.lengthSq() < MIN_AREA_M2 ** 2) {
        return;
      }

      const ordered = normal.dot(towards) < 0 ? [a, c, b] : [a, b, c];
      const cx = (a.x + b.x + c.x) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      paint(alongM, u, cx, cz);
      for (const v of ordered) {
        positions.push(v.x, v.y, v.z);
        colours.push(colour.r, colour.g, colour.b);
      }
    };

    for (let k = 0; k + 1 < rows.length; k += 1) {
      const [r0, r1] = [rows[k] ?? 0, rows[k + 1] ?? 0];
      const alongM = (along(r0) + along(r1)) / 2;
      for (let j = 0; j + 1 < cols.length; j += 1) {
        const [c0, c1] = [cols[j] ?? 0, cols[j + 1] ?? 0];
        const u = ((shares[c0] ?? 0) + (shares[c1] ?? 0)) / 2;
        const [a, b, d, e] = [vertex(r0, c0), vertex(r0, c1), vertex(r1, c0), vertex(r1, c1)];
        triangle([a, d, b], UP, alongM, u);
        triangle([b, d, e], UP, alongM, u);
      }

      // Walls along the inner and outer edges, facing away from the kerb's middle.
      const outwards = new THREE.Vector3().subVectors(vertex(r0, columns - 1), vertex(r0, 0)).setY(0);
      for (const [c, facing] of [
        [0, outwards.clone().negate()],
        [columns - 1, outwards],
      ] as const) {
        const top0 = vertex(r0, c);
        const top1 = vertex(r1, c);
        if (Math.max(top0.y, top1.y) < MIN_WALL_M) {
          continue;
        }

        const ground0 = top0.clone().setY(0);
        const ground1 = top1.clone().setY(0);
        const u = c === 0 ? 0 : 1;
        triangle([top0, ground0, top1], facing, alongM, u);
        triangle([top1, ground0, ground1], facing, alongM, u);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * A soft shadow on the ground along each kerb's outer edge, black fading to clear, for a
 * transparent vertex-coloured material. It is what makes a 30 mm kerb read as standing
 * up when seen from the road, which cannot see its outer wall.
 */
export function kerbShadowGeometry(meshes: readonly KerbMesh[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  for (const { positions: p, columns, kerb, fromM, toM } of meshes) {
    const rows = p.length / 3 / columns;
    const step = Math.max(1, Math.round((DRAWN_ROW_M * (rows - 1)) / (toM - fromM)));
    const edge = (r: number) => {
      const i = (r * columns + columns - 1) * 3;
      const j = r * columns * 3;
      const x = p[i] ?? 0;
      const z = p[i + 2] ?? 0;
      const across = Math.hypot(x - (p[j] ?? 0), z - (p[j + 2] ?? 0));
      const ox = (x - (p[j] ?? 0)) / across;
      const oz = (z - (p[j + 2] ?? 0)) / across;

      // As deep as the edge is tall, so the ramped ends cast none.
      const alpha = (SHADOW_ALPHA * (p[i + 1] ?? 0)) / kerb.heightM;

      return { x, z, fx: x + ox * SHADOW_M, fz: z + oz * SHADOW_M, alpha };
    };

    for (let r = 0; r + 1 < rows; r += step) {
      const a = edge(r);
      const b = edge(Math.min(r + step, rows - 1));
      const quad = [
        [a.x, a.z, a.alpha],
        [a.fx, a.fz, 0],
        [b.x, b.z, b.alpha],
        [b.x, b.z, b.alpha],
        [a.fx, a.fz, 0],
        [b.fx, b.fz, 0],
      ] as const;

      // Wound to face up whichever side of the road the kerb is on.
      const ux = a.fx - a.x;
      const uz = a.fz - a.z;
      const up = ux * (b.z - a.z) - uz * (b.x - a.x) < 0;
      for (const k of up ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4]) {
        const [x, z, alpha] = quad[k] ?? [0, 0, 0];
        positions.push(x, 0, z);
        colours.push(0, 0, 0, alpha);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 4));

  return geometry;
}
