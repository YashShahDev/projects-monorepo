import * as RAPIER from "@dimforge/rapier3d-compat";

export interface BarrierRun {
  points: { x: number; z: number }[];
  closed: boolean;

  /** The side of travel along the points that faces away from the track. */
  outside: "left" | "right";
}

export interface BarrierField {
  /** Makes solid every barrier segment near this ground position. */
  follow(x: number, z: number): void;

  /** Colliders the field holds, enabled or parked. */
  readonly colliders: number;
}

const HALF_HEIGHT_M = 0.6;
const HALF_THICKNESS_M = 0.3;

// Every segment within REACH_M of the car when it was last placed is solid, and the car
// is re-placed after moving REFRESH_M, so anything within 16 m of it always is: far more
// than the car covers in a step (1.5 m at 320 km/h) or its body reaches.
const REACH_M = 20;
const REFRESH_M = 4;
const CELL_M = 16;

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  centre: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  halfLength: number;
}

/**
 * The track's barriers as box colliders, one per segment, but only near the car.
 *
 * Rapier's JavaScript `World.step` visits every collider in the world each step to keep
 * its handle map current, so a lap's thousands of barrier segments cost more than the
 * car's own physics. Here a small pool of boxes is moved onto the segments around the
 * car instead; a segment's box is exactly the one it would have had in the full world.
 */
export function createBarrierField(world: RAPIER.World, runs: readonly BarrierRun[]): BarrierField {
  const segments: Segment[] = [];
  for (const run of runs) {
    const { points } = run;
    const count = run.closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i += 1) {
      const a = points[i] ?? { x: 0, z: 0 };
      const b = points[(i + 1) % points.length] ?? a;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-3) {
        continue;
      }

      // Left of travel along (dx, dz) is (dz, −dx); the centre sits half a thickness out.
      const out = (HALF_THICKNESS_M * (run.outside === "left" ? 1 : -1)) / length;
      const heading = Math.atan2(b.x - a.x, b.z - a.z);
      segments.push({
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        centre: {
          x: (a.x + b.x) / 2 + (b.z - a.z) * out,
          y: HALF_HEIGHT_M,
          z: (a.z + b.z) / 2 - (b.x - a.x) * out,
        },
        rotation: { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) },
        halfLength: length / 2,
      });
    }
  }

  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / CELL_M);
  segments.forEach((s, index) => {
    for (let cx = cell(Math.min(s.ax, s.bx)); cx <= cell(Math.max(s.ax, s.bx)); cx += 1) {
      for (let cz = cell(Math.min(s.az, s.bz)); cz <= cell(Math.max(s.az, s.bz)); cz += 1) {
        const key = `${cx},${cz}`;
        const list = grid.get(key) ?? [];
        list.push(index);
        grid.set(key, list);
      }
    }
  });

  const distance = (s: Segment, x: number, z: number) => {
    const [dx, dz] = [s.bx - s.ax, s.bz - s.az];
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));

    return Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
  };

  const pool: RAPIER.Collider[] = [];
  const holder: number[] = [];
  const slotOf = new Int32Array(segments.length).fill(-1);
  const seen = new Uint32Array(segments.length);
  let stamp = 0;
  let placedAt: { x: number; z: number } | undefined;

  const place = (slot: number, index: number) => {
    const s = segments[index];
    const collider = pool[slot];
    if (!s || !collider) {
      return;
    }

    collider.setHalfExtents({ x: HALF_THICKNESS_M, y: HALF_HEIGHT_M, z: s.halfLength });
    collider.setTranslation(s.centre);
    collider.setRotation(s.rotation);
    collider.setEnabled(true);
    holder[slot] = index;
    slotOf[index] = slot;
  };

  return {
    get colliders() {
      return pool.length;
    },
    follow(x, z) {
      if (placedAt && Math.hypot(x - placedAt.x, z - placedAt.z) < REFRESH_M) {
        return;
      }

      placedAt = { x, z };
      stamp += 1;
      const wanted: number[] = [];
      for (let cx = cell(x - REACH_M); cx <= cell(x + REACH_M); cx += 1) {
        for (let cz = cell(z - REACH_M); cz <= cell(z + REACH_M); cz += 1) {
          for (const index of grid.get(`${cx},${cz}`) ?? []) {
            const s = segments[index];
            if (seen[index] !== stamp && s && distance(s, x, z) <= REACH_M) {
              seen[index] = stamp;
              wanted.push(index);
            }
          }
        }
      }

      // Boxes already on a wanted segment stay put; the rest are freed for reuse.
      const free: number[] = [];
      holder.forEach((index, slot) => {
        if (index >= 0 && seen[index] !== stamp) {
          slotOf[index] = -1;
          holder[slot] = -1;
        }

        if (holder[slot] === -1) {
          free.push(slot);
        }
      });

      for (const index of wanted) {
        if (slotOf[index] !== -1) {
          continue;
        }

        let slot = free.pop();
        if (slot === undefined) {
          slot = pool.length;
          pool.push(
            world.createCollider(
              RAPIER.ColliderDesc.cuboid(HALF_THICKNESS_M, HALF_HEIGHT_M, 1).setFriction(0.3).setRestitution(0.1),
            ),
          );
          holder.push(-1);
        }

        place(slot, index);
      }

      for (const slot of free) {
        if (holder[slot] === -1) {
          pool[slot]?.setEnabled(false);
        }
      }
    },
  };
}
