import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { normalizeBasePath, serveStaticFile } from "./static-files.ts";

const { values } = parseArgs({
  options: { base: { type: "string", default: "/" }, port: { type: "string", default: "4173" } },
});
const root = resolve(import.meta.dirname, "../dist");
if (!existsSync(join(root, "index.html"))) {
  console.error("dist/index.html is missing; run make build first.");
  process.exit(1);
}
const base = normalizeBasePath(values.base ?? "/");
const server = Bun.serve({
  port: Number(values.port ?? "4173"),
  fetch: (request) => serveStaticFile(root, base, new URL(request.url).pathname),
});
console.log(`Serving dist/ at ${new URL(base, server.url).href}`);
