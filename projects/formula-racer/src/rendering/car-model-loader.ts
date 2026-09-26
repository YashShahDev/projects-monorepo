import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CarDefinition } from "../content/car.ts";
import type { CarModelInterface } from "../content/car-model.ts";
import { bindCarModel } from "./car-model-view.ts";
import type { BoundCarModel } from "./car-model-view.ts";

const GLB_MAGIC = "glTF";
const LFS_POINTER = "version https://git-lfs";

/** Fails with the likely fix when a checkout serves an LFS pointer instead of the model. */
export function assertGlb(buffer: ArrayBuffer, source: string): void {
  const head = new TextDecoder().decode(buffer.slice(0, LFS_POINTER.length));
  if (head.startsWith(LFS_POINTER)) {
    throw new Error(`${source} is a Git LFS pointer, not the model; run git lfs pull`);
  }

  if (!head.startsWith(GLB_MAGIC)) {
    throw new Error(`${source} is not a binary glTF (.glb) file`);
  }
}

export async function loadCarModel(
  url: URL,
  spec: CarModelInterface,
  car: CarDefinition,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<BoundCarModel> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${url.pathname}: HTTP ${String(response.status)}`);
  }

  const buffer = await response.arrayBuffer();
  assertGlb(buffer, url.pathname);
  const gltf = await new GLTFLoader().parseAsync(buffer, new URL(".", url).href);

  return bindCarModel(gltf.scene, spec, car);
}
