import type { TrackGeometry } from "./track-geometry.ts";

export const KERB_TYPES = ["flat", "stepped", "sausage"] as const;
export type KerbType = (typeof KERB_TYPES)[number];
export type Side = "left" | "right";

/** One kerb along one edge of the road, from the road's edge outwards. */
export interface Kerb {
  side: Side;

  /** Lap distance where it starts, in [0, lap); `toM` may run past the lap's end. */
  fromM: number;
  toM: number;
  type: KerbType;
  widthM: number;
  heightM: number;
}

export interface KerbPlan {
  readonly kerbs: readonly Kerb[];

  /** The kerb on `side` at lap distance `distanceM`, if there is one. */
  at(distanceM: number, side: Side): Kerb | undefined;
}

// Real kerbs: 25–50 mm for flat and stepped kerbs, up to 75 mm for a sausage.
const HEIGHT_M: Record<KerbType, number> = { flat: 0.03, stepped: 0.05, sausage: 0.075 };

// A corner, as the trackside and the map count them: tighter than this, and turning at
// least MIN_TURN_RAD.
const CORNER_RADIUS_M = 300;
const MIN_TURN_RAD = (15 * Math.PI) / 180;

// Corners this tight also get a kerb on the outside where the car turns in.
const ENTRY_KERB_RADIUS_M = 120;

// Kerbs closer than this on one side join into one; the rest keep their gaps.
const MIN_GAP_M = 2;

// The start line and the grid stay clear of kerbs by this much.
const START_CLEAR_M = 10;

// Each end of a kerb ramps down to the road over this length.
const END_RAMP_M = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A fixed pseudo-random fraction per corner, so kerbs vary but never change between loads. */
const vary = (corner: number, salt: number) => {
  let h = Math.imul(corner + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;

  return (h >>> 0) / 2 ** 32;
};

interface Corner {
  startM: number;
  apexM: number;
  endM: number;
  direction: Side;
  radiusM: number;
}

/** Runs of samples turning the same way, as distances that may run past the lap's end. */
function corners(track: TrackGeometry): Corner[] {
  const n = track.count;
  const k = (i: number) => track.curvature[((i % n) + n) % n] ?? 0;
  const turning = (i: number) => Math.abs(k(i)) > 1 / CORNER_RADIUS_M;
  const offset = Array.from({ length: n }, (_, i) => i).find((i) => !turning(i));
  if (offset === undefined) {
    return [];
  }

  const found: Corner[] = [];
  let i = offset;
  while (i < offset + n) {
    if (!turning(i)) {
      i += 1;
      continue;
    }

    const sign = Math.sign(k(i));
    let end = i;
    let turn = 0;
    let apex = i;
    while (end < offset + n && turning(end) && Math.sign(k(end)) === sign) {
      turn += Math.abs(k(end)) * track.spacingM;
      if (Math.abs(k(end)) > Math.abs(k(apex))) {
        apex = end;
      }

      end += 1;
    }

    if (turn >= MIN_TURN_RAD) {
      found.push({
        startM: i * track.spacingM,
        apexM: apex * track.spacingM,
        endM: end * track.spacingM,
        direction: sign > 0 ? "left" : "right",
        radiusM: 1 / Math.abs(k(apex)),
      });
    }

    i = end;
  }

  return found;
}

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/**
 * Where the kerbs go: on the inside at each corner's apex, on the outside where cars run
 * wide at the exit, and at the entry of tight corners. Straights have none. The type,
 * width and length vary from corner to corner, but a track always gets the same plan.
 */
export function planKerbs(track: TrackGeometry, startDistanceM = 0): KerbPlan {
  const lap = track.lengthM;
  const wrap = (d: number) => ((d % lap) + lap) % lap;
  const band = track.kerbWidthM;
  const raw: Omit<Kerb, "heightM">[] = [];
  corners(track).forEach((c, index) => {
    const length = c.endM - c.startM;
    const width = (salt: number) => band * (0.6 + 0.4 * vary(index, salt));

    const apexHalf = clamp(0.3 * length, 8, 35);
    raw.push({
      side: c.direction,
      fromM: c.apexM - apexHalf,
      toM: c.apexM + apexHalf,
      type: vary(index, 1) < 0.3 ? "stepped" : "flat",
      widthM: width(2),
    });

    // Tight exits, where cars are tempted to run wide, may get a sausage.
    let exitType: KerbType = vary(index, 4) < 0.6 ? "stepped" : "flat";
    if (c.radiusM < 80 && vary(index, 3) < 0.5) {
      exitType = "sausage";
    }

    raw.push({
      side: other(c.direction),
      fromM: c.endM - clamp(0.2 * length, 5, 20),
      toM: c.endM + clamp(0.4 * length + 20, 20, 70),
      type: exitType,
      widthM: width(5),
    });

    if (c.radiusM < ENTRY_KERB_RADIUS_M) {
      raw.push({ side: other(c.direction), fromM: c.startM - 25, toM: c.startM + 5, type: "flat", widthM: width(6) });
    }
  });

  const kerbs: Kerb[] = [];
  for (const side of ["left", "right"] as const) {
    const own = raw
      .filter((k) => k.side === side)
      .map((k) => ({ ...k, toM: wrap(k.fromM) + (k.toM - k.fromM), fromM: wrap(k.fromM) }))
      .sort((a, b) => a.fromM - b.fromM);

    // Join kerbs that overlap or nearly touch, including across the lap's end.
    const joined: Omit<Kerb, "heightM">[] = [];
    for (const kerb of own) {
      const last = joined.at(-1);
      if (last && kerb.fromM - last.toM < MIN_GAP_M) {
        const longer = kerb.toM - kerb.fromM > last.toM - last.fromM ? kerb : last;
        joined[joined.length - 1] = {
          ...last,
          toM: Math.max(last.toM, kerb.toM),
          type: longer.type,
          widthM: Math.max(last.widthM, kerb.widthM),
        };
      } else {
        joined.push(kerb);
      }
    }

    const first = joined[0];
    const last = joined.at(-1);
    if (first && last && last !== first && first.fromM + lap - last.toM < MIN_GAP_M) {
      joined[joined.length - 1] = { ...last, toM: Math.max(last.toM, first.toM + lap) };
      joined.shift();
    }

    for (const kerb of joined) {
      const startAhead = wrap(startDistanceM - kerb.fromM);
      const clearOfStart = startAhead > kerb.toM - kerb.fromM + START_CLEAR_M && lap - startAhead > START_CLEAR_M;

      // A kerb that joined round the whole lap would leave no gap; none of the circuits
      // has one, and it would be no kerb plan at all.
      if (clearOfStart && kerb.toM - kerb.fromM < lap / 2) {
        kerbs.push({ ...kerb, heightM: HEIGHT_M[kerb.type] });
      }
    }
  }

  kerbs.sort((a, b) => a.fromM - b.fromM || a.side.localeCompare(b.side));

  // Each sample remembers the kerb over it on each side, so a lookup is constant time.
  const index = { left: new Int32Array(track.count).fill(-1), right: new Int32Array(track.count).fill(-1) };
  kerbs.forEach((kerb, k) => {
    for (let d = kerb.fromM; d <= kerb.toM; d += track.spacingM / 2) {
      index[kerb.side][Math.floor(wrap(d) / track.spacingM) % track.count] = k;
    }
  });

  const covers = (kerb: Kerb | undefined, d: number) =>
    kerb !== undefined && wrap(d - kerb.fromM) <= kerb.toM - kerb.fromM;

  return {
    kerbs,
    at(distanceM, side) {
      const d = wrap(distanceM);
      const i = Math.floor(d / track.spacingM) % track.count;
      for (const j of [i, (i + 1) % track.count, (i + track.count - 1) % track.count]) {
        const kerb = kerbs[index[side][j] ?? -1];
        if (covers(kerb, d)) {
          return kerb;
        }
      }

      return undefined;
    },
  };
}

/**
 * The kerb's surface height above the road at `alongM` (in the kerb's own distances,
 * from `fromM` to `toM`) and `acrossM` outwards from the road's edge. A flat kerb slopes
 * up from the road, a stepped one rises again on its outer half, and a sausage is a
 * rounded hump at the outer edge. Both ends ramp down to the road.
 */
export function kerbHeightM(kerb: Kerb, alongM: number, acrossM: number): number {
  if (alongM < kerb.fromM || alongM > kerb.toM || acrossM < 0 || acrossM > kerb.widthM) {
    return 0;
  }

  const u = acrossM / kerb.widthM;
  const rise = Math.min(1, 0.4 + (0.6 * u) / 0.3);
  let share: number;
  switch (kerb.type) {
    case "flat":
      share = rise;
      break;
    case "stepped":
      share = u > 0.6 ? 1 : 0.5 * rise;
      break;
    case "sausage":
      share = Math.max(0.3 * rise, u > 0.6 ? Math.sin((Math.PI * (u - 0.6)) / 0.4) : 0);
      break;
  }

  const ends = Math.min(1, (alongM - kerb.fromM) / END_RAMP_M, (kerb.toM - alongM) / END_RAMP_M);

  return kerb.heightM * share * ends;
}
