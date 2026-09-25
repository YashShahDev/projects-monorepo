import { resolve, sep } from "node:path";

/** Normalizes a deployment prefix such as `game` or `/game` to `/game/`. */
export function normalizeBasePath(input: string): string {
  const trimmed = input.trim().replace(/^\/+|\/+$/gu, "");
  if (trimmed === "") return "/";
  if (trimmed.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`invalid base path: ${input}`);
  }
  return `/${trimmed}/`;
}

/**
 * Maps a request path under `base` to a file inside `root`, or null when the
 * request is outside the base or would escape the root directory.
 */
export function resolveStaticPath(root: string, base: string, pathname: string): string | null {
  if (!pathname.startsWith(base)) return null;
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(base.length));
  } catch {
    return null;
  }
  if (relativePath.includes("\0")) return null;
  if (relativePath === "" || relativePath.endsWith("/")) relativePath += "index.html";
  const absoluteRoot = resolve(root);
  const path = resolve(absoluteRoot, relativePath);
  return path.startsWith(absoluteRoot + sep) ? path : null;
}

export async function serveStaticFile(
  root: string,
  base: string,
  pathname: string,
): Promise<Response> {
  // Relative bundle URLs only resolve correctly once the subpath has its trailing slash.
  if (base !== "/" && pathname === base.slice(0, -1)) {
    return new Response(null, { status: 308, headers: { Location: base } });
  }
  const path = resolveStaticPath(root, base, pathname);
  const file = path ? Bun.file(path) : null;
  if (!file || !(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file);
}
