import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { parseTrack } from "../src/content/track.ts";
import { KERB_STRIPE_M, kerbGeometry, kerbShadowGeometry } from "../src/rendering/kerb-view.ts";
import { kerbMeshes, planKerbs } from "../src/simulation/kerbs.ts";
import type { Kerb, KerbMesh } from "../src/simulation/kerbs.ts";
import { buildTrackGeometry } from "../src/simulation/track-geometry.ts";
import { readJsonObject } from "./support/json.ts";

const def = parseTrack(readJsonObject("public/assets/tracks/harbour.json"));
const track = buildTrackGeometry(def);
const plan = planKerbs(track, def.startDistanceM);

// Without a side, the first kerb of the type on either: Harbour's only sausage is on the right.
const one = (type: Kerb["type"], side?: Kerb["side"]): KerbMesh[] => {
  const kerb = plan.kerbs.find((k) => k.type === type && (side ?? k.side) === k.side);
  if (!kerb) {
    throw new Error(`a ${type} kerb expected`);
  }

  return kerbMeshes(track, [kerb]);
};

interface Face {
  centre: THREE.Vector3;
  normal: THREE.Vector3;
  colour: THREE.Color;
}

const faces = (geometry: THREE.BufferGeometry): Face[] => {
  const p = geometry.getAttribute("position");
  const c = geometry.getAttribute("color");
  const out: Face[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, d] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k));
    if (!a || !b || !d) {
      continue;
    }

    const normal = new THREE.Vector3().subVectors(d, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    out.push({
      centre: new THREE.Vector3().add(a).add(b).add(d).divideScalar(3),
      normal,
      colour: new THREE.Color().fromBufferAttribute(c, i),
    });
  }

  return out;
};

// How far a point lies outwards from the road's edge on the kerb's side.
const outwards = (point: THREE.Vector3, side: Kerb["side"]) => {
  const at = track.locate(point.x, point.z);

  return (side === "left" ? at.lateralM : -at.lateralM) - track.halfWidthM;
};

describe("a kerb drawn in 3D", () => {
  for (const side of ["left", "right"] as const) {
    test(`on the ${side}, its top faces up and its sides face out of it, down to the ground`, () => {
      const meshes = one("flat", side);
      const all = faces(kerbGeometry(meshes));
      const tops = all.filter((f) => f.normal.y > 0.5);
      const walls = all.filter((f) => Math.abs(f.normal.y) < 0.2);
      expect(tops.length).toBeGreaterThan(0);
      expect(walls.length).toBeGreaterThan(0);
      expect(all.every((f) => f.normal.y > -0.2)).toBe(true);

      const widthM = meshes[0]?.kerb.widthM ?? 0;
      const lowest = Math.min(
        ...Array.from(kerbGeometry(meshes).getAttribute("position").array).filter((_, i) => i % 3 === 1),
      );
      expect(lowest).toBeCloseTo(0, 6);
      for (const wall of walls) {
        const across = outwards(wall.centre, side);
        const step = wall.normal.clone().multiplyScalar(0.05).add(wall.centre);
        const outer = across > widthM / 2;

        // An outer wall faces away from the road, the inner lip towards it.
        expect(outwards(step, side) > across).toBe(outer);
      }
    });
  }

  test("is painted in red and white blocks of one stripe length each", () => {
    const meshes = one("flat", "left");
    const tops = faces(kerbGeometry(meshes)).filter((f) => f.normal.y > 0.5);
    const colours = new Set(tops.map((f) => f.colour.getHexString()));
    expect(colours.size).toBe(2);

    const kerb = meshes[0]?.kerb;
    if (!kerb) {
      throw new Error("a kerb expected");
    }

    // Faces a stripe apart differ; faces within one stripe match.
    const block = (f: Face) =>
      Math.floor((track.locate(f.centre.x, f.centre.z).distanceM - kerb.fromM) / KERB_STRIPE_M);
    const byBlock = new Map<number, Set<string>>();
    for (const face of tops) {
      const set = byBlock.get(block(face)) ?? new Set<string>();
      set.add(face.colour.getHexString());
      byBlock.set(block(face), set);
    }

    const blocks = [...byBlock.keys()].sort((a, b) => a - b);
    for (const b of blocks) {
      expect(byBlock.get(b)?.size).toBe(1);
      const next = byBlock.get(b + 1);
      if (next) {
        expect([...next][0]).not.toBe([...(byBlock.get(b) ?? [])][0]);
      }
    }
  });

  test("gives each type its own look: a green upper tier when stepped, a yellow hump on a sausage", () => {
    const colours = (type: Kerb["type"]) =>
      new Set(
        faces(kerbGeometry(one(type)))
          .filter((f) => f.normal.y > 0.5)
          .map((f) => f.colour.getHexString()),
      );
    const flat = colours("flat");
    const stepped = colours("stepped");
    const sausage = colours("sausage");
    expect([...stepped].some((c) => !flat.has(c))).toBe(true);
    expect([...sausage].some((c) => !flat.has(c) && !stepped.has(c))).toBe(true);
  });

  test("dims its colours where the night's light is low", () => {
    const meshes = one("flat", "left");
    const lit = faces(kerbGeometry(meshes));
    const dim = faces(kerbGeometry(meshes, () => 0.5));
    expect(dim[0]?.colour.r).toBeCloseTo((lit[0]?.colour.r ?? 0) * 0.5, 5);
  });

  test("casts a soft shadow on the ground beside its outer edge, fading out away from it", () => {
    for (const side of ["left", "right"] as const) {
      const meshes = one("flat", side);
      const widthM = meshes[0]?.kerb.widthM ?? 0;
      const geometry = kerbShadowGeometry(meshes);
      const p = geometry.getAttribute("position");
      const c = geometry.getAttribute("color");
      expect(c.itemSize).toBe(4);
      expect(p.count).toBeGreaterThan(0);
      const against: number[] = [];
      for (let i = 0; i < p.count; i += 1) {
        const point = new THREE.Vector3().fromBufferAttribute(p, i);
        const beyond = outwards(point, side) - widthM;
        expect(point.y).toBeCloseTo(0, 6);
        expect(beyond).toBeGreaterThan(-0.01);
        expect(beyond).toBeLessThan(0.5);
        expect(c.getX(i) + c.getY(i) + c.getZ(i)).toBe(0);
        if (beyond < 0.05) {
          against.push(c.getW(i));
        } else {
          expect(c.getW(i)).toBe(0);
        }
      }

      // Darkest against the kerb, except where its ends ramp down to the ground.
      against.sort((a, b) => a - b);
      expect(against[Math.floor(against.length / 2)]).toBeGreaterThan(0.2);
      expect(against[0]).toBe(0);
    }
  });

  test("draws every kerb on a track in few triangles: under 12 per metre of kerb", () => {
    const geometry = kerbGeometry(kerbMeshes(track, plan.kerbs));
    const metres = plan.kerbs.reduce((sum, k) => sum + k.toM - k.fromM, 0);
    expect(geometry.getAttribute("position").count / 3 / metres).toBeLessThan(12);
  });
});
