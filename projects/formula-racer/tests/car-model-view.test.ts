import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { parseCar } from "../src/content/car.ts";
import { parseCarModelInterface } from "../src/content/car-model.ts";
import { FLAP_OPEN_RAD, bindCarModel } from "../src/rendering/car-model-view.ts";
import type { VehicleSnapshot } from "../src/simulation/vehicle.ts";

const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, path), "utf8")) as unknown;
const car = parseCar(read("../public/assets/cars/fr26.json"));
const isMesh = (object: THREE.Object3D): object is THREE.Mesh => object instanceof THREE.Mesh;
const spec = parseCarModelInterface(read("../content/cars/model-interface.json"));

/** The node tree a loader produces for a model that follows the interface. */
function modelTree(skip: string[] = []) {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ name: "paint" });
  const accent = new THREE.MeshStandardMaterial({ name: "accent" });
  const add = (name: string, position: [number, number, number] = [0, 0, 0], lods = true) => {
    if (skip.includes(name)) {
      return;
    }

    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(...position);
    if (lods) {
      for (let i = 0; i < spec.lodCount; i += 1) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), i === 0 && name === spec.body ? [paint, accent] : paint);
        mesh.name = `${name}_LOD${String(i)}`;
        node.add(mesh);
      }
    }

    root.add(node);
  };

  add(spec.body);
  spec.wheels.forEach((name, i) => {
    add(name, [i % 2 === 0 ? 0.8 : -0.8, 0.3, i < 2 ? 1.8 : -1.8]);
  });
  spec.flaps.forEach((name, i) => {
    add(name, [0, 0.4, i === 0 ? 2.6 : -2.2]);
  });
  add("camera_chase", [0, 1, -1], false);
  add("camera_cockpit", [0, 0.8, 0.4], false);
  add(spec.collision, [0, 0, 0], false);

  return { root, paint, accent };
}

const snapshot = (patch: Partial<VehicleSnapshot> = {}): VehicleSnapshot => ({
  physicsVersion: "test",
  simSeconds: 0,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  speedMps: 0,
  wheels: [0, 1, 2, 3].map(() => ({ suspensionLength: 0.1, steerRad: 0, spinRad: 0, inContact: true })),
  applied: { throttle: 0, brake: 0, steer: 0 },
  gear: 1,
  rpm: 4000,
  assists: { steering: true, abs: true, traction: true },
  energy: undefined,
  wing: { mode: "corner", opening: 0 },
  ...patch,
});

describe("binding a car model", () => {
  test("names every missing interface node at once", () => {
    const { root } = modelTree(["wheel_RR", "camera_cockpit"]);
    expect(() => bindCarModel(root, spec, car)).toThrow("car model is missing wheel_RR, camera_cockpit");
  });

  test("reads the camera anchors in the chassis frame", () => {
    const bound = bindCarModel(modelTree().root, spec, car);
    expect(bound.anchors.chase).toEqual({ x: 0, y: 1, z: -1 });
    expect(bound.anchors.cockpit.y).toBeCloseTo(0.8, 6);
    expect(bound.anchors.cockpit.z).toBeCloseTo(0.4, 6);
  });

  test("hides the collision box and shows exactly one LOD per part", () => {
    const { root } = modelTree();
    const bound = bindCarModel(root, spec, car);
    expect(root.getObjectByName(spec.collision)?.visible).toBe(false);
    bound.setLod(2);
    for (const name of [spec.body, ...spec.wheels, ...spec.flaps]) {
      const shown = root
        .getObjectByName(name)
        ?.children.filter((child) => child.visible)
        .map((child) => child.name);
      expect(shown).toEqual([`${name}_LOD2`]);
    }
  });

  test("paints the livery on the paint and accent materials", () => {
    const { root, paint, accent } = modelTree();
    const bound = bindCarModel(root, spec, car);
    bound.setLivery({ id: "t", name: "T", number: 12, paint: "#127a8a", accent: "#f2c230" });
    expect(`#${paint.color.getHexString()}`).toBe("#127a8a");
    expect(`#${accent.color.getHexString()}`).toBe("#f2c230");
  });
});

describe("posing a car model", () => {
  test("moves the root with the chassis", () => {
    const { root } = modelTree();
    const bound = bindCarModel(root, spec, car);
    bound.pose(snapshot({ position: { x: 3, y: 0.5, z: -2 }, rotation: { x: 0, y: 1, z: 0, w: 0 } }));
    expect(root.position.toArray()).toEqual([3, 0.5, -2]);
    expect(root.quaternion.toArray()).toEqual([0, 1, 0, 0]);
  });

  test("drops wheels with the suspension and spins and steers them", () => {
    const { root } = modelTree();
    const bound = bindCarModel(root, spec, car);
    const wheels = [0, 1, 2, 3].map((i) => ({
      suspensionLength: 0.1 + i * 0.01,
      steerRad: i < 2 ? 0.2 : 0,
      spinRad: 1.5,
      inContact: true,
    }));
    bound.pose(snapshot({ wheels }));
    const rl = root.getObjectByName("wheel_RL");
    const fl = root.getObjectByName("wheel_FL");
    expect(rl?.position.y).toBeCloseTo(car.wheels.connectionY - 0.12, 6);
    expect(fl?.rotation.x).toBeCloseTo(1.5, 6);
    expect(fl?.rotation.y).toBeCloseTo(0.2, 6);
    expect(rl?.rotation.y).toBeCloseTo(0, 6);
  });

  test("opens the flaps with the active-aero state and closes them again", () => {
    const { root } = modelTree();
    const bound = bindCarModel(root, spec, car);
    const flap = root.getObjectByName("wing_rear_flap");
    bound.pose(snapshot({ wing: { mode: "straight", opening: 1 } }));
    expect(flap?.rotation.x).toBeCloseTo(-FLAP_OPEN_RAD, 6);
    bound.pose(snapshot({ wing: { mode: "straight", opening: 0.5 } }));
    expect(flap?.rotation.x).toBeCloseTo(-FLAP_OPEN_RAD / 2, 6);
    bound.pose(snapshot());
    expect(flap?.rotation.x).toBeCloseTo(0, 6);
  });

  test("opens both flaps from their modelled rest angle", () => {
    const { root } = modelTree();
    const front = root.getObjectByName("wing_front_flap");
    const rear = root.getObjectByName("wing_rear_flap");
    front?.rotation.set(0.1, 0, 0);
    rear?.rotation.set(0.2, 0, 0);
    const bound = bindCarModel(root, spec, car);
    bound.pose(snapshot({ wing: { mode: "straight", opening: 1 } }));
    expect(front?.rotation.x).toBeCloseTo(0.1 - FLAP_OPEN_RAD, 6);
    expect(rear?.rotation.x).toBeCloseTo(0.2 - FLAP_OPEN_RAD, 6);
  });
});

test("dispose frees every geometry, material and texture the model owns", () => {
  const { root, paint } = modelTree();
  const bitmap = {
    closed: false,
    close() {
      this.closed = true;
    },
  };
  const texture = new THREE.Texture();
  texture.source.data = bitmap;
  paint.normalMap = texture;
  const disposed = new Set<unknown>();
  const watch = (resource: THREE.EventDispatcher<{ dispose: object }>) => {
    resource.addEventListener("dispose", () => disposed.add(resource));
  };

  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (isMesh(object)) {
      geometries.add(object.geometry);
    }
  });
  for (const resource of [...geometries, paint, texture]) {
    watch(resource);
  }

  bindCarModel(root, spec, car).dispose();
  expect([...geometries, paint, texture].every((resource) => disposed.has(resource))).toBe(true);
  expect(bitmap.closed).toBe(true);
});
