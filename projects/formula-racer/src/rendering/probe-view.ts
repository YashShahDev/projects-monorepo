import * as THREE from "three";
import type { ProbeScene } from "../content/probe-scene.ts";
import type { Pose } from "../simulation/probe-world.ts";

export interface ProbeView {
  render(box: Pose): void;
  dispose(): void;
}

export function createProbeView(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
  probe: ProbeScene,
): ProbeView {
  const renderer = new THREE.WebGLRenderer({ canvas, context });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x9fc3dc);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x404040, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  const g = probe.ground.halfExtents;
  const groundGeometry = new THREE.BoxGeometry(g.x * 2, g.y * 2, g.z * 2);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5560 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.y = -g.y;
  scene.add(ground);

  const b = probe.box.halfExtents;
  const boxGeometry = new THREE.BoxGeometry(b.x * 2, b.y * 2, b.z * 2);
  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xd9352b });
  const box = new THREE.Mesh(boxGeometry, boxMaterial);
  scene.add(box);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(6, 4, 8);
  camera.lookAt(0, 1, 0);

  const size = new THREE.Vector2();
  return {
    render(pose) {
      const { clientWidth: width, clientHeight: height } = canvas;
      if (renderer.getSize(size).x !== width || size.y !== height) {
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      }
      box.position.set(pose.position.x, pose.position.y, pose.position.z);
      box.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
      renderer.render(scene, camera);
    },
    dispose() {
      for (const resource of [groundGeometry, groundMaterial, boxGeometry, boxMaterial]) {
        resource.dispose();
      }
      renderer.dispose();
    },
  };
}
