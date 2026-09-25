import { ContentError, extents, fetchJson, finite, object, vec3 } from "./validate.ts";
import type { Vec3 } from "./validate.ts";

export { ContentError };
export type { Vec3 };

/** Technical probe content for P1: a box dropped onto flat ground. SI units throughout. */
export interface ProbeScene {
  version: 1;
  /** m/s² */
  gravity: Vec3;
  /** Metres. The ground's top surface sits at y = 0. */
  ground: { halfExtents: Vec3 };
  /** Metres. `dropHeight` is the box centre's starting height above the ground. */
  box: { halfExtents: Vec3; dropHeight: number };
}

export function parseProbeScene(value: unknown, source = "probe scene"): ProbeScene {
  const root = object(value, source);
  if (root.version !== 1) throw new ContentError(`${source}.version must be 1`);
  const ground = object(root.ground, `${source}.ground`);
  const box = object(root.box, `${source}.box`);
  const scene: ProbeScene = {
    version: 1,
    gravity: vec3(root.gravity, `${source}.gravity`),
    ground: { halfExtents: extents(ground.halfExtents, `${source}.ground.halfExtents`) },
    box: {
      halfExtents: extents(box.halfExtents, `${source}.box.halfExtents`),
      dropHeight: finite(box.dropHeight, `${source}.box.dropHeight`),
    },
  };
  if (scene.box.dropHeight <= scene.box.halfExtents.y) {
    throw new ContentError(`${source}.box.dropHeight must start the box above the ground`);
  }
  return scene;
}

export async function fetchProbeScene(
  url: URL,
  fetchImpl: (url: URL) => Promise<Response> = fetch,
): Promise<ProbeScene> {
  return parseProbeScene(await fetchJson(url, fetchImpl), url.pathname);
}
