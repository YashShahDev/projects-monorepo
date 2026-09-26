import { describe, expect, test } from "bun:test";
import { checkManagedTool, checkTool, checksPassed } from "../tools/checks.ts";
import type { CommandResult, ToolSpec } from "../tools/checks.ts";

const spec: ToolSpec = {
  name: "Example",
  command: "example",
  args: ["--version"],
  version: "1.2.3",
};
const success: CommandResult = {
  status: 0,
  stdout: "Example v1.2.3\nmore build metadata",
  stderr: "",
};

describe("prerequisite diagnostics", () => {
  test("accepts a pinned version and shows only its first line", () => {
    expect(checkTool(spec, () => success)).toEqual({
      name: "Example",
      ok: true,
      detail: "Example v1.2.3",
    });
  });
  test("supports tools that report their version on stderr", () => {
    expect(checkTool(spec, () => ({ ...success, stdout: "", stderr: "v1.2.3" })).ok).toBe(true);
  });
  test("rejects a different version even when the executable exists", () => {
    expect(checkTool(spec, () => ({ ...success, stdout: "v1.2.30" })).ok).toBe(false);
  });
  test("rejects unrecognized version output", () => {
    expect(checkTool(spec, () => ({ ...success, stdout: "unknown" })).detail).toContain("unrecognized");
  });
  test("reports missing executables and timeouts as failures", () => {
    for (const error of ["ENOENT", "ETIMEDOUT"]) {
      expect(checkTool(spec, () => ({ ...success, status: null, error })).ok).toBe(false);
    }
  });
  test("does not accept a failing command merely because it printed the right version", () => {
    expect(checkTool(spec, () => ({ ...success, status: 1 })).ok).toBe(false);
  });
  test("an unpinned utility still needs successful execution", () => {
    expect(checkTool({ name: "Git", command: "git", args: ["--version"] }, () => success).ok).toBe(true);
  });
  test("any failed prerequisite fails the aggregate report", () => {
    expect(checksPassed([{ name: "one", ok: true, detail: "ok" }])).toBe(true);
    expect(
      checksPassed([
        { name: "one", ok: true, detail: "ok" },
        { name: "two", ok: false, detail: "missing" },
      ]),
    ).toBe(false);
  });
});

test("managed tools use the installed executable instead of a PATH installer wrapper", () => {
  const calls: string[] = [];
  const result = checkManagedTool(spec, (command) => {
    calls.push(command);

    return command === "mise" ? { status: 0, stdout: "/tools with spaces/example\n", stderr: "" } : success;
  });
  expect(result.ok).toBe(true);
  expect(calls).toEqual(["mise", "/tools with spaces/example"]);
});

test("missing managed tools fail without falling back to a PATH wrapper", () => {
  const calls: string[] = [];
  const result = checkManagedTool(spec, (command) => {
    calls.push(command);

    return { status: 1, stdout: "", stderr: "tool not installed" };
  });
  expect(result.ok).toBe(false);
  expect(calls).toEqual(["mise"]);
});
