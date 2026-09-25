// Generates a track's centreline control points from straights and constant-radius
// arcs, so a layout can be edited as corners rather than as hundreds of coordinates.
// Two straights are marked `solve`; their lengths are solved so the loop closes.
//
//   bun run tools/generate-track.ts <layout.json> <out.json> [preview.svg]
import { readFileSync, writeFileSync } from "node:fs";

type Segment = { straight: number; solve?: boolean } | { arc: number; radius: number }; // degrees, positive turns left

interface Layout {
  id: string;
  name: string;
  widthM: number;
  kerbWidthM: number;
  startDistanceM: number;
  surfaceGrip: { road: number; kerb: number; grass: number };
  segments: Segment[];
}

const [layoutPath, outPath, svgPath] = process.argv.slice(2);
if (!layoutPath || !outPath)
  throw new Error("usage: generate-track <layout.json> <out.json> [preview.svg]");
const layout = JSON.parse(readFileSync(layoutPath, "utf8")) as Layout;

// Heading 0 faces +z; a left turn (toward +x) increases it.
function trace(lengths: number[]) {
  const points: { x: number; z: number }[] = [];
  let x = 0;
  let z = 0;
  let heading = 0;
  let solved = 0;
  for (const segment of layout.segments) {
    if ("straight" in segment) {
      const length = segment.solve ? (lengths[solved++] ?? 0) : segment.straight;
      const pieces = Math.max(1, Math.ceil(length / 60));
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

const solvable = layout.segments.filter((s) => "straight" in s && s.solve);
if (solvable.length !== 2) throw new Error("mark exactly two straights with solve: true");
// The end position is affine in the two solved lengths, so two probes give the system.
const origin = trace([0, 0]).end;
const a = trace([1, 0]).end;
const b = trace([0, 1]).end;
const ax = a.x - origin.x;
const az = a.z - origin.z;
const bx = b.x - origin.x;
const bz = b.z - origin.z;
const det = ax * bz - az * bx;
const l1 = (-origin.x * bz + origin.z * bx) / det;
const l2 = (-ax * origin.z + az * origin.x) / det;
if (!(l1 > 0 && l2 > 0)) throw new Error(`no closing lengths: ${l1.toFixed(1)}, ${l2.toFixed(1)}`);
const result = trace([l1, l2]);
const turns = result.heading / (2 * Math.PI);
if (Math.abs(Math.abs(turns) - 1) > 1e-9) throw new Error(`heading sums to ${String(turns)} turns`);

const round = (v: number) => Math.round(v * 10) / 10;
const track = {
  version: 1,
  id: layout.id,
  name: layout.name,
  widthM: layout.widthM,
  kerbWidthM: layout.kerbWidthM,
  controlPoints: result.points.map((p) => [round(p.x), round(p.z)]),
  startDistanceM: layout.startDistanceM,
  surfaceGrip: layout.surfaceGrip,
};
writeFileSync(outPath, `${JSON.stringify(track)}\n`);
console.log(
  `solved straights ${l1.toFixed(1)} m and ${l2.toFixed(1)} m; ${String(result.points.length)} points`,
);

if (svgPath) {
  const xs = result.points.map((p) => p.x);
  const zs = result.points.map((p) => p.z);
  const pad = 60;
  const minX = Math.min(...xs) - pad;
  const minZ = Math.min(...zs) - pad;
  const w = Math.max(...xs) + pad - minX;
  const h = Math.max(...zs) + pad - minZ;
  // Mirror x so the map reads as seen from above with +z up the page.
  const path = result.points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${String(round(minX + w - (p.x - minX)))},${String(round(minZ + h - (p.z - minZ)))}`,
    )
    .join(" ");
  writeFileSync(
    svgPath,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${String(minX)} ${String(minZ)} ${String(w)} ${String(h)}" width="900"><rect x="${String(minX)}" y="${String(minZ)}" width="${String(w)}" height="${String(h)}" fill="#1b2b1b"/><path d="${path} Z" fill="none" stroke="#888" stroke-width="${String(layout.widthM)}" stroke-linejoin="round"/><circle cx="${String(minX + w - (0 - minX))}" cy="${String(minZ + h - (0 - minZ))}" r="15" fill="#e33"/></svg>\n`,
  );
}
