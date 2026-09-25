import { accessSync, constants } from "node:fs";
import { chromium, firefox } from "@playwright/test";
import versions from "../toolchain.json";
import { checkManagedTool, checkTool, checksPassed } from "./checks.ts";
import type { CheckResult, ToolSpec } from "./checks.ts";

const specs: ToolSpec[] = [
  { name: "Bun", command: "bun", args: ["--version"], version: versions.bun },
  { name: "Node", command: "node", args: ["--version"], version: versions.node },
  { name: "Git", command: "git", args: ["--version"] },
  { name: "GitHub CLI", command: "gh", args: ["--version"], version: versions.gh },
  { name: "Blender", command: "blender", args: ["--version"], version: versions.blender },
  { name: "KTX encoder", command: "toktx", args: ["--version"], version: versions.toktx },
  { name: "Git LFS", command: "git-lfs", args: ["version"], version: versions["git-lfs"] },
];
const results: CheckResult[] = specs.map((spec) =>
  ["bun", "node", "gh"].includes(spec.command) ? checkManagedTool(spec) : checkTool(spec),
);
for (const browser of [chromium, firefox]) {
  const path = browser.executablePath();
  try {
    accessSync(path, constants.X_OK);
    results.push({ name: `Playwright ${browser.name()}`, ok: true, detail: path });
  } catch {
    results.push({
      name: `Playwright ${browser.name()}`,
      ok: false,
      detail: "missing executable; run make browsers-install",
    });
  }
}
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
}
console.log(
  "Doctor checks versions and presence only. Run make verify-prerequisites for browser launch and Blender/KTX checks.",
);
process.exitCode = checksPassed(results) ? 0 : 1;
