import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSite } from "../tools/site-build.ts";

const outdir = mkdtempSync(join(tmpdir(), "formula-racer-build-test-"));
afterAll(() => rmSync(outdir, { recursive: true, force: true }));
const files = await buildSite(resolve(import.meta.dirname, ".."), outdir);
const html = readFileSync(join(outdir, "index.html"), "utf8");

test("the production page references its bundle with subpath-safe relative URLs", () => {
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map((match) => match[1] ?? "");
  expect(urls.length).toBeGreaterThanOrEqual(2);
  for (const url of urls) expect(url).toStartWith("./");
  for (const url of urls) expect(files.map((file) => file.path)).toContain(url.slice(2));
});

test("runtime assets are copied beside the bundle", () => {
  expect(files.map((file) => file.path)).toContain("assets/probe/scene.json");
});
