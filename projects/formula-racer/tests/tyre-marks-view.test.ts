import { expect, test } from "bun:test";
import * as THREE from "three";
import { createTyreMarksView, MARK_FADE_S } from "../src/rendering/tyre-marks-view.ts";
import { MAX_LAP_MARKS, MAX_MARKS } from "../src/simulation/tyre-marks.ts";

const mark = (x: number, timeS: number) => ({ ax: x, az: 0, bx: x + 1, bz: 0, timeS });

const isMesh = (object: THREE.Object3D): object is THREE.Mesh => object instanceof THREE.Mesh;

function geometryOf(object: THREE.Object3D): THREE.BufferGeometry {
  if (!isMesh(object)) {
    throw new Error("expected a mesh");
  }

  return object.geometry;
}

/** Alpha of the drawn strip that starts at x = `ax`. */
function alphaAt(object: THREE.Object3D, ax: number): number | undefined {
  const geometry = geometryOf(object);
  const position = geometry.getAttribute("position");
  const colour = geometry.getAttribute("color");
  const index = geometry.getIndex();
  const { start, count } = geometry.drawRange;
  for (let at = start; at < start + count; at += 6) {
    const v = index?.getX(at) ?? 0;
    if (position.getX(v) === ax) {
      return colour.getW(v);
    }
  }

  return undefined;
}

test("draws new marks as dark strips on the road, fading out over about a lap", () => {
  const view = createTyreMarksView();
  view.add([mark(10, 10), mark(11, 20)]);
  expect(view.update(20, undefined)).toEqual({ live: 2, ghost: 0 });
  expect(view.object.visible).toBe(true);
  const first = alphaAt(view.object, 10) ?? 1;
  const second = alphaAt(view.object, 11) ?? 0;
  expect(second).toBeGreaterThan(first);
  expect(first).toBeGreaterThan(0);

  // Half faded, then gone.
  view.update(10 + MARK_FADE_S / 2, undefined);
  expect(alphaAt(view.object, 10)).toBeCloseTo(second / 2, 2);
  expect(view.update(20 + MARK_FADE_S, undefined)).toEqual({ live: 0, ghost: 0 });
  expect(view.object.visible).toBe(false);

  // The first strip lies across its mark (x 10 to 11), just above the road.
  const geometry = geometryOf(view.object);
  const position = geometry.getAttribute("position");
  const first4 = geometry.getIndex()?.getX(geometry.drawRange.start) ?? 0;
  const corners = [0, 1, 2, 3].map((v) => [
    position.getX(first4 + v),
    position.getY(first4 + v),
    position.getZ(first4 + v),
  ]);
  for (const [x, y, z] of corners) {
    expect(x === 10 || x === 11).toBe(true);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(0.05);
    expect(Math.abs(z ?? 1)).toBeCloseTo(0.16, 5);
  }

  view.dispose();
});

test("reuses the oldest slots once the ring is full", () => {
  const view = createTyreMarksView();
  view.add(Array.from({ length: MAX_MARKS + 10 }, (_, k) => mark(k, 100)));
  expect(view.update(100, undefined).live).toBe(MAX_MARKS);
  view.dispose();
});

test("a ghost lays its lap's marks as it reaches them", () => {
  const view = createTyreMarksView();
  const ghostMarks = [mark(0, 5), mark(1, 12), mark(2, 30)];
  expect(view.update(0, { marks: ghostMarks, lapTimeS: 13 })).toEqual({ live: 0, ghost: 2 });
  expect(view.update(0, { marks: ghostMarks, lapTimeS: 31 })).toEqual({ live: 0, ghost: 3 });
  expect(view.update(0, undefined)).toEqual({ live: 0, ghost: 0 });
  expect(
    view.update(0, { marks: Array.from({ length: MAX_LAP_MARKS + 5 }, () => mark(0, 0)), lapTimeS: 1 }).ghost,
  ).toBe(MAX_LAP_MARKS);
  view.dispose();
});
