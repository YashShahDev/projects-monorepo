import { describe, expect, test } from "bun:test";
import { createCameraRig } from "../src/rendering/camera-rig.ts";
import type { CarPose } from "../src/rendering/camera-rig.ts";

const facing = (headingRad: number, x = 0, z = 0): CarPose => ({
  position: { x, y: 0.5, z },
  rotation: { x: 0, y: Math.sin(headingRad / 2), z: 0, w: Math.cos(headingRad / 2) },
});

function settle(rig: ReturnType<typeof createCameraRig>, pose: CarPose, seconds: number, hz = 60) {
  let view = rig.update(pose, 1 / hz);
  for (let t = 1 / hz; t < seconds - 1e-9; t += 1 / hz) {
    view = rig.update(pose, 1 / hz);
  }

  return view;
}

describe("chase camera", () => {
  test("settles behind and above the car, looking just ahead of it", () => {
    const rig = createCameraRig();
    const view = settle(rig, facing(0), 3);
    expect(view.position.x).toBeCloseTo(0, 3);
    expect(view.position.z).toBeLessThan(-4);
    expect(view.position.y).toBeGreaterThan(1.5);
    expect(view.target.z).toBeGreaterThan(0);
  });

  test("swings round smoothly when the car turns instead of snapping", () => {
    const rig = createCameraRig();
    settle(rig, facing(0), 3);

    // Car now faces +x: "behind" is -x.
    const first = rig.update(facing(Math.PI / 2), 1 / 60);
    expect(first.position.x).toBeGreaterThan(-1);
    const later = settle(rig, facing(Math.PI / 2), 2);
    expect(later.position.x).toBeLessThan(-4);
    expect(Math.abs(later.position.z)).toBeLessThan(0.1);
  });

  test("follows the same path at 30 and 144 frames per second", () => {
    const path = (hz: number) => {
      const rig = createCameraRig();
      settle(rig, facing(0), 1, hz);

      return settle(rig, facing(Math.PI / 2, 10, 20), 0.5, hz);
    };

    const slow = path(30);
    const fast = path(144);
    expect(Math.hypot(slow.position.x - fast.position.x, slow.position.z - fast.position.z)).toBeLessThan(0.1);
  });

  test("reset jumps straight behind the car", () => {
    const rig = createCameraRig();
    settle(rig, facing(0), 3);
    rig.reset();
    const view = rig.update(facing(Math.PI, 0, 100), 1 / 60);
    expect(view.position.z).toBeGreaterThan(104);
  });

  test("C cycles to a rigid cockpit camera and back", () => {
    const rig = createCameraRig();
    settle(rig, facing(0), 3);
    expect(rig.cycle()).toBe("cockpit");
    const view = rig.update(facing(Math.PI / 2, 5, 5), 1 / 60);
    expect(view.position.x).toBeGreaterThan(5);
    expect(view.position.z).toBeCloseTo(5, 3);
    expect(rig.cycle()).toBe("chase");
  });
});

describe("model anchors", () => {
  const anchors = { chase: { x: 0, y: 0.9, z: -1 }, cockpit: { x: 0.1, y: 0.7, z: 0.3 } };

  test("the cockpit camera sits at the cockpit anchor, carried by the car", () => {
    const rig = createCameraRig(anchors);
    rig.cycle();

    // Facing +x, the car's +z axis maps to world +x and its +x axis to world -z.
    const view = rig.update(facing(Math.PI / 2, 5, 5), 1 / 60);
    expect(view.position.x).toBeCloseTo(5.3, 6);
    expect(view.position.y).toBeCloseTo(1.2, 6);
    expect(view.position.z).toBeCloseTo(4.9, 6);
    expect(view.target.x).toBeGreaterThan(20);
    expect(view.target.z).toBeCloseTo(4.9, 6);
  });

  test("the chase camera aims just ahead of the chase anchor", () => {
    const rig = createCameraRig(anchors);
    const view = settle(rig, facing(0), 3);
    expect(view.target.x).toBeCloseTo(0, 6);
    expect(view.target.y).toBeCloseTo(1.4, 6);
    expect(view.target.z).toBeCloseTo(3, 6);
  });
});
