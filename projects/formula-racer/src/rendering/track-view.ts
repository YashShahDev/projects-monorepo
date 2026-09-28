import * as THREE from "three";
import type { Livery } from "../content/livery.ts";
import type { TrackLighting } from "../content/track.ts";
import { kerbMeshes } from "../simulation/kerbs.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";
import type { Trackside } from "../simulation/trackside.ts";
import { kerbGeometry, kerbShadowGeometry } from "./kerb-view.ts";
import { edgeLineGeometry, gridBoxGeometry } from "./markings.ts";
import { floodlitLevel } from "./night-light.ts";
import { layoutScenery } from "./scenery-layout.ts";
import { createScenery } from "./scenery-view.ts";
import type { VehicleSnapshot } from "../simulation/vehicle.ts";
import type { CameraView } from "./camera-rig.ts";
import type { BoundCarModel } from "./car-model-view.ts";
import type { QualitySettings } from "./quality.ts";

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  width: number;
  height: number;
  glVendor: string;
  glRenderer: string;
}

export interface TrackView {
  /** Counts from the last rendered frame, plus the drawing buffer and GPU identity. */
  stats(): RenderStats;
  render(car: VehicleSnapshot, view: CameraView): void;
  setLivery(livery: Livery): void;
  setQuality(settings: QualitySettings): void;

  /** Adds an object to the scene; the view disposes of it with itself. */
  add(part: { readonly object: THREE.Object3D; dispose(): void }): void;
  dispose(): void;
}

// Greybox palette. Browser tests classify screenshot pixels by these, so the kerb red
// keeps its green channel high enough not to read as the car.
const SKY = 0x87b7e0;
const NIGHT_SKY = 0x070b18;
const GRASS = 0x4f8a3a;
const ROAD = 0x6b6f73;
const VERGE = 0x7c8084;
const KERB_WHITE = 0xeeeeee;

/**
 * A flat strip between two lateral offsets from the centreline (positive is left), with
 * a vertex colour per sample.
 */
function ribbon(
  track: TrackGeometry,
  inner: number,
  outer: number,
  y: number,
  colourAt: (i: number) => THREE.Color,
  lightAt: (x: number, z: number) => number = () => 1,
): THREE.BufferGeometry {
  const n = track.count;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const colours = new Float32Array((n + 1) * 2 * 3);
  for (let k = 0; k <= n; k += 1) {
    const i = k % n;
    const x = track.x[i] ?? 0;
    const z = track.z[i] ?? 0;

    // Left of travel when facing the tangent (tx, tz).
    const lx = track.tz[i] ?? 0;
    const lz = -(track.tx[i] ?? 0);
    positions.set([x + lx * inner, y, z + lz * inner, x + lx * outer, y, z + lz * outer], k * 6);
    const c = colourAt(i);
    const a = lightAt(x + lx * inner, z + lz * inner);
    const b = lightAt(x + lx * outer, z + lz * outer);
    colours.set([c.r * a, c.g * a, c.b * a, c.r * b, c.g * b, c.b * b], k * 6);
  }

  const index: number[] = [];
  for (let k = 0; k < n; k += 1) {
    const a = k * 2;

    // Outer lies to the left of inner, so this winding faces up (+y).
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  return geometry;
}

export function createTrackView(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
  track: TrackGeometry,
  startDistanceM: number,
  car: BoundCarModel,
  trackside: Trackside,
  lighting: TrackLighting = "day",
): TrackView {
  const night = lighting === "night";
  const renderer = new THREE.WebGLRenderer({ canvas, context });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(night ? NIGHT_SKY : SKY);
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    disposables.push(resource);

    return resource;
  };

  const layout = layoutScenery(track, trackside, startDistanceM, { lighting });
  const scene = new THREE.Scene();

  // At night the towers light everything from overhead: the road's light is baked into
  // its colours, and one warm light from above stands in for them on cars and scenery.
  scene.add(
    night ? new THREE.HemisphereLight(0x8090b8, 0x101018, 0.45) : new THREE.HemisphereLight(0xdfefff, 0x506040, 1.6),
  );
  const sun = night ? new THREE.DirectionalLight(0xfff0d8, 0.75) : new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(night ? 40 : 300, 600, night ? 30 : 200);
  scene.add(sun);

  const flat = (colour: number) => own(new THREE.MeshStandardMaterial({ color: colour, roughness: 1, metalness: 0 }));
  const painted = own(
    night
      ? new THREE.MeshBasicMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  );

  // Road, kerbs and grass are nearly coplanar. A 2 cm gap alone z-fought at 640×360 in
  // headless SwiftShader (no road visible), so polygon offset orders the layers instead.
  const grassMaterial = flat(GRASS);
  grassMaterial.polygonOffset = true;
  grassMaterial.polygonOffsetFactor = 4;
  grassMaterial.polygonOffsetUnits = 4;

  // In 300 m tiles: as two 6 km triangles, the ones clipped at the camera's near plane got
  // a depth slope that pulled them in front of the road around the car (ANGLE on GL,
  // Intel).
  const grass = new THREE.Mesh(own(new THREE.PlaneGeometry(6000, 6000, 20, 20)), grassMaterial);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  scene.add(grass);

  const road = new THREE.Color(ROAD);
  const half = track.halfWidthM;
  const band = half + track.kerbWidthM;
  const lit = night ? (x: number, z: number) => floodlitLevel(x, z, layout.floodlights) : undefined;
  scene.add(new THREE.Mesh(own(ribbon(track, -half, half, 0, () => road, lit)), painted));

  // The kerb band is the asphalt verge, a shade lighter than the road so its edge reads,
  // with the kerbs standing on it. It lies at the road's level, pushed back in depth so
  // a kerb's ramped ends still draw over it.
  const vergeMaterial = own(painted.clone());
  vergeMaterial.polygonOffset = true;
  vergeMaterial.polygonOffsetFactor = 2;
  vergeMaterial.polygonOffsetUnits = 2;
  const verge = new THREE.Color(VERGE);
  scene.add(new THREE.Mesh(own(ribbon(track, half, band, 0, () => verge, lit)), vergeMaterial));

  // A strip faces up when its outer edge lies to the left of its inner one.
  scene.add(new THREE.Mesh(own(ribbon(track, -band, -half, 0, () => verge, lit)), vergeMaterial));

  // Lit even at night, unlike the road, so the kerbs' walls shade apart from their tops.
  const kerbMaterial = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
  const meshes = kerbMeshes(track, trackside.kerbs.kerbs);
  scene.add(new THREE.Mesh(own(kerbGeometry(meshes, lit)), kerbMaterial));
  const shadowMaterial = own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  scene.add(new THREE.Mesh(own(kerbShadowGeometry(meshes)), shadowMaterial));

  // Painted on the road, drawn over it by polygon offset like the start line.
  const markings = own(painted.clone());
  markings.polygonOffset = true;
  markings.polygonOffsetFactor = -4;
  markings.polygonOffsetUnits = -4;
  scene.add(new THREE.Mesh(own(edgeLineGeometry(track, lit)), markings));
  scene.add(new THREE.Mesh(own(gridBoxGeometry(track, startDistanceM, lit)), markings));

  const start = track.pointAt(startDistanceM);
  const lineMaterial = flat(KERB_WHITE);
  lineMaterial.polygonOffset = true;
  lineMaterial.polygonOffsetFactor = -4;
  lineMaterial.polygonOffsetUnits = -4;
  const line = new THREE.Mesh(own(new THREE.PlaneGeometry(half * 2, 0.8)), lineMaterial);
  line.rotation.set(-Math.PI / 2, 0, Math.atan2(start.tx, start.tz));
  line.position.set(start.x, 0.01, start.z);
  scene.add(line);

  const scenery = createScenery(track, trackside, layout, own);
  scene.add(scenery);
  scene.add(car.root);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
  const size = new THREE.Vector2();

  // The unmasked names identify the real GPU, which a benchmark report needs.
  const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
  const glVendor = String(context.getParameter(debugInfo ? debugInfo.UNMASKED_VENDOR_WEBGL : context.VENDOR));
  const glRenderer = String(context.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : context.RENDERER));

  return {
    stats: () => ({
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      width: context.drawingBufferWidth,
      height: context.drawingBufferHeight,
      glVendor,
      glRenderer,
    }),
    render(snapshot, view) {
      const { clientWidth: width, clientHeight: height } = canvas;
      if (renderer.getSize(size).x !== width || size.y !== height) {
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      }

      if (camera.fov !== view.fovDeg) {
        camera.fov = view.fovDeg;
        camera.updateProjectionMatrix();
      }

      car.pose(snapshot);
      camera.position.set(view.position.x, view.position.y, view.position.z);
      camera.lookAt(view.target.x, view.target.y, view.target.z);
      renderer.render(scene, camera);
    },
    setLivery(livery) {
      car.setLivery(livery);
    },
    setQuality(settings) {
      // Changing the ratio resizes the drawing buffer; render() keeps the CSS size.
      renderer.setPixelRatio(settings.pixelRatio);
      camera.far = settings.drawDistanceM;
      car.setLod(settings.carLod);
      for (const child of scenery.children) {
        if (child.name === "trees") {
          child.visible = settings.trees;
        }
      }

      camera.updateProjectionMatrix();
    },
    add(part) {
      scene.add(part.object);
      disposables.push(part);
    },
    dispose() {
      for (const resource of disposables) {
        resource.dispose();
      }

      car.dispose();
      renderer.dispose();
    },
  };
}
