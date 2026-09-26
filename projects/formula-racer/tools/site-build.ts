import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { TEST_HOOK_GLOBAL } from "../src/app/test-hook-name.ts";

export interface BuiltFile {
  path: string;
  bytes: number;
}

/** Bundles the browser entrypoint for production and copies runtime assets beside it. */
export async function buildSite(projectRoot: string, outdir: string): Promise<BuiltFile[]> {
  rmSync(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(projectRoot, "src/index.html")],
    outdir,
    target: "browser",
    minify: true,

    // Bun leaves NODE_ENV unresolved unless told, which would keep development-only code.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Bun.build failed");
  }

  const publicRoot = join(projectRoot, "public");
  const collisions = listFiles(publicRoot)
    .map((path) => relative(publicRoot, path))
    .filter((path) => existsSync(join(outdir, path)));
  if (collisions.length) {
    throw new Error(`public/ would overwrite bundle outputs: ${collisions.join(", ")}`);
  }

  cpSync(publicRoot, outdir, { recursive: true });
  assertNoLfsPointers(
    listFiles(outdir).map((path): [string, Uint8Array] => [relative(outdir, path), new Uint8Array(readFileSync(path))]),
  );
  const scripts = listFiles(outdir).filter((path) => path.endsWith(".js"));
  assertNoTestHooks(scripts.map((path) => [relative(outdir, path), readFileSync(path, "utf8")]));

  return listFiles(outdir).map((path) => ({
    path: relative(outdir, path),
    bytes: statSync(path).size,
  }));
}

const LFS_POINTER = new TextEncoder().encode("version https://git-lfs.github.com/spec/");

/**
 * A clone without Git LFS (or with smudging skipped) has small text pointers in place of
 * binary assets; packaging one would ship a game that cannot load its car.
 */
export function assertNoLfsPointers(files: [path: string, bytes: Uint8Array][]): void {
  const pointers = files.filter(([, bytes]) => LFS_POINTER.every((byte, i) => bytes[i] === byte));
  if (pointers.length) {
    throw new Error(
      `${pointers.map(([path]) => path).join(", ")} is a Git LFS pointer, not the asset; run git lfs pull`,
    );
  }
}

export function assertNoTestHooks(scripts: [path: string, source: string][]): void {
  const leaks = scripts.filter(([, source]) => source.includes(TEST_HOOK_GLOBAL));
  if (leaks.length) {
    throw new Error(`test hooks leaked into production: ${leaks.map(([path]) => path).join(", ")}`);
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
