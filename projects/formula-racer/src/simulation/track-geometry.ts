import type { TrackDefinition } from "../content/track.ts";

export type Surface = "road" | "kerb" | "grass";

export interface TrackLocation {
  /** Nearest centreline sample. Pass back as the next query's hint. */
  index: number;

  /** Distance along the lap from the sampled start of the loop, metres. */
  distanceM: number;

  /** Signed offset from the centreline; positive is the driver's left. */
  lateralM: number;
  surface: Surface;
}

export interface TrackGeometry {
  readonly lengthM: number;
  readonly spacingM: number;
  readonly count: number;
  readonly x: Float64Array;
  readonly z: Float64Array;

  /** Unit tangent in the driving direction. */
  readonly tx: Float64Array;
  readonly tz: Float64Array;

  /** Signed curvature, 1/m; positive turns left. */
  readonly curvature: Float64Array;
  readonly halfWidthM: number;
  readonly kerbWidthM: number;
  pointAt(distanceM: number): { x: number; z: number; tx: number; tz: number };
  locate(x: number, z: number, hint?: number): TrackLocation;
}

// Centripetal Catmull-Rom avoids the cusps and self-loops the uniform variant makes
// around unevenly spaced control points.
function catmullRom(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number },
  t: number,
): { x: number; z: number } {
  const knot = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.max(Math.hypot(b.x - a.x, b.z - a.z) ** 0.5, 1e-6);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (
    a: { x: number; z: number },
    b: { x: number; z: number },
    ta: number,
    tb: number,
  ) => {
    const w = (u - ta) / (tb - ta);

    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
  };

  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);

  return lerp(b1, b2, t1, t2);
}

const SEARCH_WINDOW = 40;

export function buildTrackGeometry(track: TrackDefinition, spacingM = 2): TrackGeometry {
  const control = track.controlPoints;
  const n = control.length;
  const at = (i: number) => control[((i % n) + n) % n] ?? { x: 0, z: 0 };

  // Densely sample the spline, then resample at uniform arc length.
  const dense: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let s = 0; s < 64; s += 1) {
      dense.push(catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), s / 64));
    }
  }

  const cumulative = [0];
  for (let i = 1; i <= dense.length; i += 1) {
    const a = dense[i - 1] ?? { x: 0, z: 0 };
    const b = dense[i % dense.length] ?? { x: 0, z: 0 };
    cumulative.push((cumulative[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
  }

  const lengthM = cumulative[dense.length] ?? 0;
  const count = Math.max(8, Math.round(lengthM / spacingM));
  const step = lengthM / count;
  const x = new Float64Array(count);
  const z = new Float64Array(count);
  let segment = 0;
  for (let i = 0; i < count; i += 1) {
    const target = i * step;
    while ((cumulative[segment + 1] ?? lengthM) < target) {
      segment += 1;
    }

    const a = dense[segment] ?? { x: 0, z: 0 };
    const b = dense[(segment + 1) % dense.length] ?? { x: 0, z: 0 };
    const span = (cumulative[segment + 1] ?? lengthM) - (cumulative[segment] ?? 0);
    const w = span > 0 ? (target - (cumulative[segment] ?? 0)) / span : 0;
    x[i] = a.x + (b.x - a.x) * w;
    z[i] = a.z + (b.z - a.z) * w;
  }

  const tx = new Float64Array(count);
  const tz = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const prev = (i - 1 + count) % count;
    const dx = (x[next] ?? 0) - (x[prev] ?? 0);
    const dz = (z[next] ?? 0) - (z[prev] ?? 0);
    const length = Math.hypot(dx, dz) || 1;
    tx[i] = dx / length;
    tz[i] = dz / length;
  }

  const curvature = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const prev = (i - 1 + count) % count;

    // Heading change per metre. With +z forward and +x left, a left turn rotates the
    // tangent from +z toward +x, which is a positive cross product here.
    const cross = (tz[prev] ?? 0) * (tx[next] ?? 0) - (tx[prev] ?? 0) * (tz[next] ?? 0);
    const dot = (tx[prev] ?? 0) * (tx[next] ?? 0) + (tz[prev] ?? 0) * (tz[next] ?? 0);
    curvature[i] = Math.atan2(cross, dot) / (2 * step);
  }

  const halfWidthM = track.widthM / 2;
  const kerbWidthM = track.kerbWidthM;

  const nearestInRange = (px: number, pz: number, from: number, to: number) => {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let k = from; k <= to; k += 1) {
      const i = ((k % count) + count) % count;
      const d = ((x[i] ?? 0) - px) ** 2 + ((z[i] ?? 0) - pz) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }

    return { best, bestDistance };
  };

  return {
    lengthM,
    spacingM: step,
    count,
    x,
    z,
    tx,
    tz,
    curvature,
    halfWidthM,
    kerbWidthM,
    pointAt(distanceM) {
      const d = ((distanceM % lengthM) + lengthM) % lengthM;
      const i = Math.floor(d / step) % count;
      const j = (i + 1) % count;
      const w = d / step - Math.floor(d / step);

      return {
        x: (x[i] ?? 0) + ((x[j] ?? 0) - (x[i] ?? 0)) * w,
        z: (z[i] ?? 0) + ((z[j] ?? 0) - (z[i] ?? 0)) * w,
        tx: tx[i] ?? 0,
        tz: tz[i] ?? 1,
      };
    },
    locate(px, pz, hint) {
      let { best, bestDistance } =
        hint === undefined
          ? nearestInRange(px, pz, 0, count - 1)
          : nearestInRange(px, pz, hint - SEARCH_WINDOW, hint + SEARCH_WINDOW);

      // A hint can be stale after a reset or a long jump; fall back to a full scan.
      if (hint !== undefined && bestDistance > (halfWidthM * 4) ** 2) {
        ({ best, bestDistance } = nearestInRange(px, pz, 0, count - 1));
      }

      const i = best;
      const dx = px - (x[i] ?? 0);
      const dz = pz - (z[i] ?? 0);
      const along = dx * (tx[i] ?? 0) + dz * (tz[i] ?? 0);

      // Left of travel is +x when facing +z: rotate the tangent by +90° about +y.
      const lateralM = dx * (tz[i] ?? 0) - dz * (tx[i] ?? 0);
      const offset = Math.abs(lateralM);
      const surface: Surface =
        offset <= halfWidthM ? "road" : offset <= halfWidthM + kerbWidthM ? "kerb" : "grass";
      const distanceM = (((i * step + along) % lengthM) + lengthM) % lengthM;

      return { index: i, distanceM, lateralM, surface };
    },
  };
}
