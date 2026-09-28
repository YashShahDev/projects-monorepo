import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDocLinks } from "../tools/doc-links.ts";

const directories: string[] = [];
function fixture(text: string): string {
  const root = mkdtempSync(join(tmpdir(), "formula-racer-doc-test-"));
  directories.push(root);
  writeFileSync(join(root, "README.md"), text);

  return root;
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

test("finds a broken handoff link", () => {
  expect(checkDocLinks(fixture("[Next](missing.md)"))).toEqual(["README.md: missing missing.md"]);
});
test("resolves nested links and encoded paths relative to the source document", () => {
  const root = fixture("[Phase](docs/phase.md#gate)");
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/phase.md"), "[Back](../README.md) [Note](a%20note.md)");
  writeFileSync(join(root, "docs/a note.md"), "# Note");
  expect(checkDocLinks(root)).toEqual([]);
});
test("does not make external network requests or validate fragment-only links", () => {
  expect(
    checkDocLinks(fixture("[Web](https://example.invalid) [Mail](mailto:x@example.invalid) [Here](#here)")),
  ).toEqual([]);
});
test("ignores examples in fenced code and dependency documentation", () => {
  const root = fixture("```md\n[Example](missing.md)\n```");
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules/README.md"), "[Dependency](missing.md)");
  expect(checkDocLinks(root)).toEqual([]);
});
test("reports malformed encoding without crashing the whole scan", () => {
  expect(checkDocLinks(fixture("[Bad](broken%.md)"))).toEqual(["README.md: malformed link broken%.md"]);
});
