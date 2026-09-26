import { spawnSync } from "node:child_process";

export interface ToolSpec {
  name: string;
  command: string;
  args: string[];
  version?: string;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export type Runner = (command: string, args: string[]) => CommandResult;

export const runCommand: Runner = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, MISE_AUTO_INSTALL: "0" },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error.message } : {}),
  };
};

export function checkTool(spec: ToolSpec, run: Runner = runCommand): CheckResult {
  const result = run(spec.command, spec.args);
  if (result.error || result.status !== 0) {
    return {
      name: spec.name,
      ok: false,
      detail: result.error ?? (result.stderr.trim() || `exit ${String(result.status)}`),
    };
  }

  const output = `${result.stdout}
${result.stderr}`.trim();
  const actual = /\d+\.\d+\.\d+(?:-[\w.-]+)?/u.exec(output)?.[0];
  if (spec.version && actual !== spec.version) {
    return {
      name: spec.name,
      ok: false,
      detail: `expected ${spec.version}; got ${actual ?? "unrecognized version"}`,
    };
  }

  return { name: spec.name, ok: true, detail: output.split("\n")[0] || "available" };
}

export function checksPassed(results: readonly CheckResult[]): boolean {
  return results.every((result) => result.ok);
}

export function checkManagedTool(spec: ToolSpec, run: Runner = runCommand): CheckResult {
  // User PATH wrappers may install or upgrade tools even for --version.
  const resolved = run("mise", ["which", spec.command]);
  if (resolved.error || resolved.status !== 0 || !resolved.stdout.trim()) {
    return {
      name: spec.name,
      ok: false,
      detail: resolved.error ?? (resolved.stderr.trim() || "mise could not resolve the installed tool"),
    };
  }

  return checkTool({ ...spec, command: resolved.stdout.trim() }, run);
}
