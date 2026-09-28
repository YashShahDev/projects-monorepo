import * as RAPIER from "@dimforge/rapier3d-compat";
import type { KerbMesh } from "./kerbs.ts";

export interface KerbField {
  /** Makes solid every kerb chunk near this ground position, and drops the rest. */
  follow(x: number, z: number): void;

  /** Chunks solid right now. They go with the world when it is freed. */
  readonly colliders: number;
}

// Rapier's collision groups: the upper 16 bits say which groups a collider is in, the
// lower which it touches. Kerbs are for the wheels' rays only; the chassis passes over
// them, as a real floor clears a 75 mm sausage.
const KERB_GROUP = 0x0002;
export const KERB_GROUPS = (KERB_GROUP << 16) | 0xffff;
export const CHASSIS_GROUPS = (0x0001 << 16) | (0xffff & ~KERB_GROUP);

// As with the barriers: every chunk within REACH_M of where the car was last placed is
// solid, and the car is re-placed after moving REFRESH_M, far less than the reach.
const REACH_M = 20;
const REFRESH_M = 4;
const CELL_M = 16;

/**
 * The kerbs as trimesh colliders, made only near the car. A trimesh cannot change shape,
 * so chunks are created on arrival and removed on leaving instead of being moved.
 */
export function createKerbField(world: RAPIER.World, meshes: readonly KerbMesh[]): KerbField {
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / CELL_M);
  meshes.forEach((mesh, index) => {
    for (let cx = cell(mesh.x - mesh.radiusM); cx <= cell(mesh.x + mesh.radiusM); cx += 1) {
      for (let cz = cell(mesh.z - mesh.radiusM); cz <= cell(mesh.z + mesh.radiusM); cz += 1) {
        const key = `${String(cx)},${String(cz)}`;
        const list = grid.get(key) ?? [];
        list.push(index);
        grid.set(key, list);
      }
    }
  });

  const solid = new Map<number, RAPIER.Collider>();
  let placedAt: { x: number; z: number } | undefined;

  return {
    get colliders() {
      return solid.size;
    },
    follow(x, z) {
      if (placedAt && Math.hypot(x - placedAt.x, z - placedAt.z) < REFRESH_M) {
        return;
      }

      placedAt = { x, z };
      const wanted = new Set<number>();
      for (let cx = cell(x - REACH_M); cx <= cell(x + REACH_M); cx += 1) {
        for (let cz = cell(z - REACH_M); cz <= cell(z + REACH_M); cz += 1) {
          for (const index of grid.get(`${String(cx)},${String(cz)}`) ?? []) {
            const mesh = meshes[index];
            if (mesh && Math.hypot(mesh.x - x, mesh.z - z) <= REACH_M + mesh.radiusM) {
              wanted.add(index);
            }
          }
        }
      }

      for (const [index, collider] of solid) {
        if (!wanted.has(index)) {
          world.removeCollider(collider, false);
          solid.delete(index);
        }
      }

      for (const index of wanted) {
        const mesh = meshes[index];
        if (mesh && !solid.has(index)) {
          const desc = RAPIER.ColliderDesc.trimesh(mesh.positions, mesh.indices).setCollisionGroups(KERB_GROUPS);
          solid.set(index, world.createCollider(desc.setFriction(1)));
        }
      }
    },
  };
}
