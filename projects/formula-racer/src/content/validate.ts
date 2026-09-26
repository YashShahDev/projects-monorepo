export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class ContentError extends Error {
  override name = "ContentError";
}

export type Json = Record<string, unknown>;

export function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContentError(`${path} must be an object`);
  }

  return value as Json;
}

export function array(value: unknown, path: string, minLength = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minLength) {
    throw new ContentError(`${path} must be an array of at least ${String(minLength)} items`);
  }

  return value;
}

export function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContentError(`${path} must be a non-empty string`);
  }

  return value;
}

export function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContentError(`${path} must be a finite number`);
  }

  return value;
}

export function positive(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number <= 0) {
    throw new ContentError(`${path} must be positive`);
  }

  return number;
}

export function inRange(value: unknown, path: string, min: number, max: number): number {
  const number = finite(value, path);
  if (number < min || number > max) {
    throw new ContentError(`${path} must be between ${String(min)} and ${String(max)}`);
  }

  return number;
}

export function vec3(value: unknown, path: string): Vec3 {
  const v = object(value, path);

  return { x: finite(v.x, `${path}.x`), y: finite(v.y, `${path}.y`), z: finite(v.z, `${path}.z`) };
}

export function extents(value: unknown, path: string): Vec3 {
  const v = object(value, path);

  return {
    x: positive(v.x, `${path}.x`),
    y: positive(v.y, `${path}.y`),
    z: positive(v.z, `${path}.z`),
  };
}

export async function fetchJson(url: URL, fetchImpl: (url: URL) => Promise<Response>): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ContentError(`${url.pathname}: HTTP ${String(response.status)}`);
  }

  try {
    return await response.json();
  } catch {
    throw new ContentError(`${url.pathname}: not valid JSON`);
  }
}
