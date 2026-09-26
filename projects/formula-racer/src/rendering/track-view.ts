import * as THREE from "three";
import type { Livery } from "../content/livery.ts";
import type { TrackGeometry } from "../simulation/track-geometry.ts";
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
  dispose(): void;
}

// Greybox palette. Browser tests classify screenshot pixels by these, so the kerb red
// keeps its green channel high enough not to read as the car.
const SKY = 0x87b7e0;
const GRASS = 0x4f8a3a;
const ROAD = 0x6b6f73;
const KERB_RED = 0xd05a4a;
const KERB_WHITE = 0xeeeeee;
const KERB_STRIPE_M = 5;

/**
 * A flat strip between two lateral offsets from the centreline (positive is left), with
 * a vertex colour per sample so kerbs can alternate.
 */
function ribbon(
  track: TrackGeometry,
  inner: number,
  outer: number,
  y: number,
  colourAt: (i: number) => THREE.Color,
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
    colours.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
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
): TrackView {
  const renderer = new THREE.WebGLRenderer({ canvas, context });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(SKY);
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    disposables.push(resource);

    return resource;
  };

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x506040, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(300, 600, 200);
  scene.add(sun);

  const flat = (colour: number) => own(new THREE.MeshStandardMaterial({ color: colour, roughness: 1, metalness: 0 }));
  const painted = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));

  // Road, kerbs and grass are nearly coplanar. A 2 cm gap alone z-fought at 640×360 in
  // headless SwiftShader (no road visible), so polygon offset orders the layers instead.
  const grassMaterial = flat(GRASS);
  grassMaterial.polygonOffset = true;
  grassMaterial.polygonOffsetFactor = 4;
  grassMaterial.polygonOffsetUnits = 4;
  const grass = new THREE.Mesh(own(new THREE.PlaneGeometry(6000, 6000)), grassMaterial);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  scene.add(grass);

  const road = new THREE.Color(ROAD);
  const red = new THREE.Color(KERB_RED);
  const white = new THREE.Color(KERB_WHITE);
  const stripe = (i: number) => (Math.floor((i * track.spacingM) / KERB_STRIPE_M) % 2 === 0 ? red : white);
  const half = track.halfWidthM;
  const kerb = half + track.kerbWidthM;
  scene.add(new THREE.Mesh(own(ribbon(track, -half, half, 0, () => road)), painted));
  scene.add(new THREE.Mesh(own(ribbon(track, half, kerb, 0.005, stripe)), painted));
  scene.add(new THREE.Mesh(own(ribbon(track, -kerb, -half, 0.005, stripe)), painted));

  const start = track.pointAt(startDistanceM);
  const lineMaterial = flat(KERB_WHITE);
  lineMaterial.polygonOffset = true;
  lineMaterial.polygonOffsetFactor = -4;
  lineMaterial.polygonOffsetUnits = -4;
  const line = new THREE.Mesh(own(new THREE.PlaneGeometry(half * 2, 0.8)), lineMaterial);
  line.rotation.set(-Math.PI / 2, 0, Math.atan2(start.tx, start.tz));
  line.position.set(start.x, 0.01, start.z);
  scene.add(line);

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
      camera.updateProjectionMatrix();
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
