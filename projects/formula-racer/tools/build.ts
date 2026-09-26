import { resolve } from "node:path";
import { buildSite } from "./site-build.ts";

const root = resolve(import.meta.dirname, "..");
const files = await buildSite(root, resolve(root, "dist"));
for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
  console.log(`${(file.bytes / 1024).toFixed(1).padStart(10)} KiB  ${file.path}`);
}

console.log("Production build written to dist/.");
