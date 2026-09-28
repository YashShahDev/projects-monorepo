import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { object } from "../../src/content/validate.ts";
import type { Json } from "../../src/content/validate.ts";

/** Reads a JSON object from a path relative to the project root. */
export const readJsonObject = (path: string): Json =>
  object(JSON.parse(readFileSync(resolve(import.meta.dirname, "../..", path), "utf8")), path);
