export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

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

export class ContentError extends Error {
  override name = "ContentError";
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContentError(`${path} must be an object`);
  }
  return value as Json;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContentError(`${path} must be a finite number`);
  }
  return value;
}

function vec3(value: unknown, path: string): Vec3 {
  const v = object(value, path);
  return { x: finite(v.x, `${path}.x`), y: finite(v.y, `${path}.y`), z: finite(v.z, `${path}.z`) };
}

function extents(value: unknown, path: string): Vec3 {
  const v = vec3(value, path);
  for (const axis of ["x", "y", "z"] as const) {
    if (v[axis] <= 0) throw new ContentError(`${path}.${axis} must be positive`);
  }
  return v;
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
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ContentError(`${url.pathname}: HTTP ${String(response.status)}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ContentError(`${url.pathname}: not valid JSON`);
  }
  return parseProbeScene(json, url.pathname);
}
