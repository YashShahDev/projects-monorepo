import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBasePath, resolveStaticPath, serveStaticFile } from "../tools/static-files.ts";

const root = mkdtempSync(join(tmpdir(), "formula-racer-static-test-"));
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "index.html"), "<!doctype html>");
writeFileSync(join(root, "assets/scene.json"), "{}");
writeFileSync(join(root, "assets/a note.json"), "{}");
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("base paths", () => {
  test("normalize to leading and trailing slashes", () => {
    expect(normalizeBasePath("/")).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(normalizeBasePath("game")).toBe("/game/");
    expect(normalizeBasePath("/games/formula-racer/")).toBe("/games/formula-racer/");
  });
  test("reject traversal and empty segments", () => {
    for (const bad of ["/../x", "/a/./b", "/a//b"]) {
      expect(() => normalizeBasePath(bad)).toThrow();
    }
  });
});

describe("static file resolution", () => {
  test("serves the index for the base itself and nested directories", () => {
    expect(resolveStaticPath(root, "/game/", "/game/")).toBe(join(root, "index.html"));
    expect(resolveStaticPath(root, "/", "/assets/")).toBe(join(root, "assets/index.html"));
  });
  test("decodes encoded names", () => {
    expect(resolveStaticPath(root, "/", "/assets/a%20note.json")).toBe(join(root, "assets/a note.json"));
  });
  test("ignores requests outside the deployment base", () => {
    expect(resolveStaticPath(root, "/game/", "/assets/scene.json")).toBeNull();
  });
  test("refuses to escape the root, including encoded traversal", () => {
    for (const path of ["/../secret", "/%2e%2e/secret", "/assets/%2E%2E/%2E%2E/secret"]) {
      expect(resolveStaticPath(root, "/", path)).toBeNull();
    }
  });
  test("rejects malformed encoding and NUL bytes", () => {
    expect(resolveStaticPath(root, "/", "/bad%.json")).toBeNull();
    expect(resolveStaticPath(root, "/", "/index.html%00.json")).toBeNull();
  });
});

describe("static responses", () => {
  test("redirects a bare subpath so relative bundle URLs resolve", async () => {
    const response = await serveStaticFile(root, "/game/", "/game");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/game/");
  });
  test("serves files with a content type under a subpath", async () => {
    const response = await serveStaticFile(root, "/game/", "/game/assets/scene.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
  test("returns 404 for missing files and paths outside the base", async () => {
    expect((await serveStaticFile(root, "/", "/assets/missing.json")).status).toBe(404);
    expect((await serveStaticFile(root, "/game/", "/index.html")).status).toBe(404);
  });
});
