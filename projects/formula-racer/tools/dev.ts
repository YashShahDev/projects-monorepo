import { resolve } from "node:path";
import index from "../src/index.html";
import { serveStaticFile } from "./static-files.ts";

const publicRoot = resolve(import.meta.dirname, "../public");
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: true,
  routes: { "/": index },
  fetch: (request) => serveStaticFile(publicRoot, "/", new URL(request.url).pathname),
});
console.log(`Formula Racer dev server: ${server.url.href}`);
