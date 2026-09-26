import * as THREE from "three";
import type { CarDefinition } from "../content/car.ts";
import type { CarModelInterface } from "../content/car-model.ts";
import type { Livery } from "../content/livery.ts";
import type { VehicleSnapshot } from "../simulation/vehicle.ts";
import type { CameraAnchors } from "./camera-rig.ts";

/** How far a flap rotates about its hinge when fully open in Straight Mode. */
export const FLAP_OPEN_RAD = 0.35;

export interface BoundCarModel {
  readonly root: THREE.Object3D;
  readonly anchors: CameraAnchors;

  /** Shows level `level` of every LOD part (0 is the finest). */
  setLod(level: number): void;
  setLivery(livery: Livery): void;
  pose(car: VehicleSnapshot): void;
}

/**
 * Finds the interface's nodes in a loaded model (its root in the chassis frame) so the
 * renderer can move them. Every missing node is reported, not just the first.
 */
export function bindCarModel(root: THREE.Object3D, spec: CarModelInterface, car: CarDefinition): BoundCarModel {
  const [chaseName = "", cockpitName = ""] = spec.anchors;
  const wanted = [spec.body, ...spec.wheels, ...spec.flaps, chaseName, cockpitName, spec.collision];
  const missing = wanted.filter((name) => !root.getObjectByName(name));
  if (missing.length > 0) {
    throw new Error(`car model is missing ${missing.join(", ")}`);
  }

  const node = (name: string) => root.getObjectByName(name) as THREE.Object3D;
  const wheels = spec.wheels.map(node);
  const flaps = spec.flaps.map(node);
  const flapRest = flaps.map((flap) => flap.rotation.x);
  const lodParts = [spec.body, ...spec.wheels, ...spec.flaps].map(node);
  node(spec.collision).visible = false;

  root.updateMatrixWorld(true);
  const toChassis = root.matrixWorld.clone().invert();
  const anchorAt = (name: string) => {
    const p = new THREE.Vector3().setFromMatrixPosition(node(name).matrixWorld).applyMatrix4(toChassis);

    return { x: p.x, y: p.y, z: p.z };
  };

  const materials = new Map<string, THREE.MeshStandardMaterial[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const list: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (material instanceof THREE.MeshStandardMaterial && spec.liveryMaterials.includes(material.name)) {
        const named = materials.get(material.name) ?? [];
        if (!named.includes(material)) {
          named.push(material);
        }

        materials.set(material.name, named);
      }
    }
  });
  const [paintName = "", accentName = ""] = spec.liveryMaterials;

  return {
    root,
    anchors: { chase: anchorAt(chaseName), cockpit: anchorAt(cockpitName) },
    setLod(level) {
      for (const part of lodParts) {
        for (const child of part.children) {
          child.visible = child.name === `${part.name}_LOD${String(level)}`;
        }
      }
    },
    setLivery(livery) {
      for (const material of materials.get(paintName) ?? []) {
        material.color.set(livery.paint);
      }

      for (const material of materials.get(accentName) ?? []) {
        material.color.set(livery.accent);
      }
    },
    pose(snapshot) {
      const { position: p, rotation: r } = snapshot;
      root.position.set(p.x, p.y, p.z);
      root.quaternion.set(r.x, r.y, r.z, r.w);
      snapshot.wheels.forEach((state, i) => {
        const wheel = wheels[i];
        if (wheel) {
          wheel.position.y = car.wheels.connectionY - state.suspensionLength;
          wheel.rotation.set(state.spinRad, state.steerRad, 0, "YXZ");
        }
      });

      // Opening lays the flap flatter: its trailing edge drops toward the chord line, a
      // negative turn about x.
      flaps.forEach((flap, i) => {
        flap.rotation.x = (flapRest[i] ?? 0) - snapshot.wing.opening * FLAP_OPEN_RAD;
      });
    },
  };
}
