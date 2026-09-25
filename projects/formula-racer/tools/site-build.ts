import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
  return listFiles(outdir).map((path) => ({
    path: relative(outdir, path),
    bytes: statSync(path).size,
  }));
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
