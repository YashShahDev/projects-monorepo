// Generates a track's centreline control points from straights and constant-radius
// arcs, so a layout can be edited as corners rather than as hundreds of coordinates.
// Two straights are marked `solve`; their lengths are solved so the loop closes.
//
//   bun run tools/generate-track.ts <layout.json> <out.json> [preview.svg]
import { readFileSync, writeFileSync } from "node:fs";
import { ContentError, array, finite, object, positive, text } from "../src/content/validate.ts";

export type Segment = { straight: number; solve?: boolean } | { arc: number; radius: number }; // degrees, positive turns left

export interface Layout {
  id: string;
  name: string;
  widthM: number;
  kerbWidthM: number;
  startDistanceM: number;
  surfaceGrip: { road: number; kerb: number; grass: number; gravel: number };
  activeAeroZones: { startM: number; endM: number }[];
  segments: Segment[];
}

function parseSegment(value: unknown, path: string): Segment {
  const s = object(value, path);
  if ("straight" in s) {
    if (s.solve !== undefined && typeof s.solve !== "boolean") {
      throw new ContentError(`${path}.solve must be a boolean`);
    }

    const straight = finite(s.straight, `${path}.straight`);

    return s.solve === undefined ? { straight } : { straight, solve: s.solve };
  }

  if ("arc" in s) {
    return { arc: finite(s.arc, `${path}.arc`), radius: positive(s.radius, `${path}.radius`) };
  }

  throw new ContentError(`${path} must be a straight or an arc`);
}

/** Checks a layout file's shape; whether it closes into a loop is `generateTrack`'s job. */
export function parseLayout(value: unknown, path = "layout"): Layout {
  const l = object(value, path);
  const grip = object(l.surfaceGrip, `${path}.surfaceGrip`);

  return {
    id: text(l.id, `${path}.id`),
    name: text(l.name, `${path}.name`),
    widthM: positive(l.widthM, `${path}.widthM`),
    kerbWidthM: positive(l.kerbWidthM, `${path}.kerbWidthM`),
    startDistanceM: finite(l.startDistanceM, `${path}.startDistanceM`),
    surfaceGrip: {
      road: positive(grip.road, `${path}.surfaceGrip.road`),
      kerb: positive(grip.kerb, `${path}.surfaceGrip.kerb`),
      grass: positive(grip.grass, `${path}.surfaceGrip.grass`),
      gravel: positive(grip.gravel, `${path}.surfaceGrip.gravel`),
    },
    activeAeroZones: array(l.activeAeroZones, `${path}.activeAeroZones`).map((zone, i) => {
      const z = object(zone, `${path}.activeAeroZones[${String(i)}]`);

      return {
        startM: finite(z.startM, `${path}.activeAeroZones[${String(i)}].startM`),
        endM: finite(z.endM, `${path}.activeAeroZones[${String(i)}].endM`),
      };
    }),
    segments: array(l.segments, `${path}.segments`, 1).map((segment, i) =>
      parseSegment(segment, `${path}.segments[${String(i)}]`),
    ),
  };
}

export interface GeneratedTrack {
  /** Track content in the shipped JSON shape. */
  track: Record<string, unknown>;

  /** The solved straight lengths, in layout order. */
  solvedM: [number, number];
  points: { x: number; z: number }[];
}

// Heading 0 faces +z; a left turn (toward +x) increases it.
function trace(layout: Layout, lengths: number[]) {
  const points: { x: number; z: number }[] = [];
  let x = 0;
  let z = 0;
  let heading = 0;
  let solved = 0;
  for (const segment of layout.segments) {
    if ("straight" in segment) {
      const length = segment.solve === true ? (lengths[solved++] ?? 0) : segment.straight;
      const pieces = Math.max(1, Math.ceil(Math.abs(length) / 60));
      for (let i = 0; i < pieces; i += 1) {
        points.push({ x, z });
        x += (Math.sin(heading) * length) / pieces;
        z += (Math.cos(heading) * length) / pieces;
      }
    } else {
      const turn = (segment.arc * Math.PI) / 180;
      const length = Math.abs(turn) * segment.radius;
      const pieces = Math.max(2, Math.ceil(length / 12));
      for (let i = 0; i < pieces; i += 1) {
        points.push({ x, z });

        // Advance along the chord of each small sub-arc.
        const dTurn = turn / pieces;
        const chord = 2 * segment.radius * Math.sin(Math.abs(dTurn) / 2);
        x += Math.sin(heading + dTurn / 2) * chord;
        z += Math.cos(heading + dTurn / 2) * chord;
        heading += dTurn;
      }
    }
  }

  return { points, end: { x, z }, heading };
}

const round = (v: number) => Math.round(v * 10) / 10;

export function generateTrack(layout: Layout): GeneratedTrack {
  const solvable = layout.segments.filter((s) => "straight" in s && s.solve === true);
  if (solvable.length !== 2) {
    throw new Error("mark exactly two straights with solve: true");
  }

  const turns = trace(layout, [0, 0]).heading / (2 * Math.PI);
  if (Math.abs(Math.abs(turns) - 1) > 1e-9) {
    throw new Error(`heading sums to ${String(turns)} turns, not one`);
  }

  // The end position is affine in the two solved lengths, so two probes give the system.
  const origin = trace(layout, [0, 0]).end;
  const a = trace(layout, [1, 0]).end;
  const b = trace(layout, [0, 1]).end;
  const ax = a.x - origin.x;
  const az = a.z - origin.z;
  const bx = b.x - origin.x;
  const bz = b.z - origin.z;
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-9) {
    throw new Error("solved straights are parallel; no closing lengths");
  }

  const l1 = (-origin.x * bz + origin.z * bx) / det;
  const l2 = (-ax * origin.z + az * origin.x) / det;
  if (!(l1 > 0 && l2 > 0)) {
    throw new Error(`no closing lengths: ${l1.toFixed(1)}, ${l2.toFixed(1)}`);
  }

  const { points } = trace(layout, [l1, l2]);

  return {
    track: {
      version: 1,
      id: layout.id,
      name: layout.name,
      widthM: layout.widthM,
      kerbWidthM: layout.kerbWidthM,
      controlPoints: points.map((p) => [round(p.x), round(p.z)]),
      startDistanceM: layout.startDistanceM,
      surfaceGrip: layout.surfaceGrip,
      activeAeroZones: layout.activeAeroZones,
    },
    solvedM: [l1, l2],
    points,
  };
}

export function previewSvg(layout: Layout, points: { x: number; z: number }[]): string {
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const pad = 60;
  const minX = Math.min(...xs) - pad;
  const minZ = Math.min(...zs) - pad;
  const w = Math.max(...xs) + pad - minX;
  const h = Math.max(...zs) + pad - minZ;

  // Mirror x so the map reads as seen from above with +z up the page.
  const px = (x: number) => round(minX + w - (x - minX));
  const pz = (z: number) => round(minZ + h - (z - minZ));
  const path = points.map((p, i) => `${i ? "L" : "M"}${String(px(p.x))},${String(pz(p.z))}`).join(" ");
  const box = `${String(minX)} ${String(minZ)} ${String(w)} ${String(h)}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="900">` +
    `<rect x="${String(minX)}" y="${String(minZ)}" width="${String(w)}" height="${String(h)}" fill="#1b2b1b"/>` +
    `<path d="${path} Z" fill="none" stroke="#888" stroke-width="${String(layout.widthM)}" stroke-linejoin="round"/>` +
    `<circle cx="${String(px(0))}" cy="${String(pz(0))}" r="15" fill="#e33"/></svg>\n`
  );
}

if (import.meta.main) {
  const [layoutPath, outPath, svgPath] = process.argv.slice(2);
  if (layoutPath === undefined || outPath === undefined) {
    throw new Error("usage: generate-track <layout.json> <out.json> [preview.svg]");
  }

  const layout = parseLayout(JSON.parse(readFileSync(layoutPath, "utf8")), layoutPath);
  const result = generateTrack(layout);
  writeFileSync(outPath, `${JSON.stringify(result.track)}\n`);
  const [l1, l2] = result.solvedM;
  console.log(`solved straights ${l1.toFixed(1)} m and ${l2.toFixed(1)} m; ${String(result.points.length)} points`);
  if (svgPath !== undefined) {
    writeFileSync(svgPath, previewSvg(layout, result.points));
  }
}
