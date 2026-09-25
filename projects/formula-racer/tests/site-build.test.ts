import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TEST_HOOK_GLOBAL } from "../src/app/test-hook-name.ts";
import { assertNoTestHooks, buildSite } from "../tools/site-build.ts";

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
  expect(files.map((file) => file.path)).toContain("assets/tracks/harbour.json");
});

test("the production bundle excludes development test hooks", () => {
  const scripts = files.filter((file) => file.path.endsWith(".js"));
  expect(scripts.length).toBeGreaterThan(0);
  for (const file of scripts) {
    expect(readFileSync(join(outdir, file.path), "utf8")).not.toContain(TEST_HOOK_GLOBAL);
  }
});

test("the leak guard names the offending script", () => {
  expect(() =>
    assertNoTestHooks([
      ["ok.js", "x"],
      ["bad.js", `w.${TEST_HOOK_GLOBAL}=1`],
    ]),
  ).toThrow("test hooks leaked into production: bad.js");
});
