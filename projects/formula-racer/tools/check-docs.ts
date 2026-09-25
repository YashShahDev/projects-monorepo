import { resolve } from "node:path";
import { checkDocLinks } from "./doc-links.ts";

const problems = checkDocLinks(resolve(import.meta.dirname, ".."));
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else {
  console.log("Documentation file links resolve (external URLs and anchors are not checked).");
}
