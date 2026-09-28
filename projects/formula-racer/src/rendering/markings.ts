import * as THREE from "three";
import { GRID_SLOTS, gridSlot } from "../simulation/grid.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";

/** Width of the white line painted inside each edge of the road. */
export const EDGE_LINE_M = 0.15;

// A grid box is a bar across the car just ahead of its nose, with short arms back
// along its sides, as painted on real grids.
const BOX_HALF_WIDTH_M = 1.2;
const BOX_FRONT_M = 2.8;
const BOX_ARM_M = 1.2;
const PAINT_M = 0.2;

const WHITE = new THREE.Color(0xeeeeee);

interface Painter {
  quad(corners: readonly { x: number; z: number }[]): void;
  geometry(): THREE.BufferGeometry;
}

// Flat white quads on the ground, each wound to face up, lit by `lightAt` at night.
function painter(lightAt: (x: number, z: number) => number): Painter {
  const positions: number[] = [];
  const colours: number[] = [];

  return {
    quad(corners) {
      const [a, b, c, d] = corners;
      if (!a || !b || !c || !d) {
        return;
      }

      // The y of (b − a) × (c − a), negated: a→b→c faces up when this is negative.
      const facesUp = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) < 0;
      const order = facesUp ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
      for (const v of order) {
        const light = lightAt(v.x, v.z);
        positions.push(v.x, 0, v.z);
        colours.push(WHITE.r * light, WHITE.g * light, WHITE.b * light);
      }
    },
    geometry() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
      geometry.computeVertexNormals();

      return geometry;
    },
  };
}

/** The white lines along both edges of the road, just inside it. */
export function edgeLineGeometry(
  track: TrackGeometry,
  lightAt: (x: number, z: number) => number = () => 1,
): THREE.BufferGeometry {
  const paint = painter(lightAt);
  const at = (i: number, lateral: number) => {
    const k = i % track.count;
    const x = track.x[k] ?? 0;
    const z = track.z[k] ?? 0;

    // Left of travel is (tz, −tx).
    return { x: x + lateral * (track.tz[k] ?? 0), z: z - lateral * (track.tx[k] ?? 0) };
  };

  for (const sign of [1, -1]) {
    const outer = sign * track.halfWidthM;
    const inner = sign * (track.halfWidthM - EDGE_LINE_M);
    for (let i = 0; i < track.count; i += 1) {
      paint.quad([at(i, inner), at(i, outer), at(i + 1, outer), at(i + 1, inner)]);
    }
  }

  return paint.geometry();
}

/** A painted box just ahead of every grid slot. */
export function gridBoxGeometry(
  track: TrackGeometry,
  startDistanceM: number,
  lightAt: (x: number, z: number) => number = () => 1,
): THREE.BufferGeometry {
  const paint = painter(lightAt);
  for (let slot = 0; slot < GRID_SLOTS; slot += 1) {
    const s = gridSlot(track, startDistanceM, slot);
    const fx = Math.sin(s.headingRad);
    const fz = Math.cos(s.headingRad);

    // A point `ahead` forwards and `left` to the left of the slot's car.
    const at = (ahead: number, left: number) => ({ x: s.x + ahead * fx + left * fz, z: s.z + ahead * fz - left * fx });
    const rect = (ahead0: number, ahead1: number, left0: number, left1: number) => {
      paint.quad([at(ahead0, left0), at(ahead0, left1), at(ahead1, left1), at(ahead1, left0)]);
    };

    rect(BOX_FRONT_M - PAINT_M, BOX_FRONT_M, -BOX_HALF_WIDTH_M, BOX_HALF_WIDTH_M);
    rect(BOX_FRONT_M - BOX_ARM_M, BOX_FRONT_M - PAINT_M, BOX_HALF_WIDTH_M - PAINT_M, BOX_HALF_WIDTH_M);
    rect(BOX_FRONT_M - BOX_ARM_M, BOX_FRONT_M - PAINT_M, -BOX_HALF_WIDTH_M, -BOX_HALF_WIDTH_M + PAINT_M);
  }

  return paint.geometry();
}
