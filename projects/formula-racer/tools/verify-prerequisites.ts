import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, firefox } from "@playwright/test";

const output = await mkdtemp(join(tmpdir(), "formula-racer-prerequisites-"));
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch({ headless: true, timeout: 30_000 });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><title>Prerequisite check</title><p>Browser ready</p>");
      if ((await page.title()) !== "Prerequisite check") {
        throw new Error(`${engine.name()}: page execution failed`);
      }

      console.log(`PASS ${engine.name()} ${browser.version()}: headless launch and DOM execution`);
    } finally {
      await browser.close();
    }
  }

  execFileSync(
    "blender",
    [
      "--background",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      resolve(import.meta.dirname, "check-blender.py"),
      "--",
      output,
    ],
    { timeout: 60_000, stdio: "pipe" },
  );
  const glb = await readFile(join(output, "fixture.glb"));
  if (
    glb.toString("ascii", 0, 4) !== "glTF" ||
    glb.readUInt32LE(4) !== 2 ||
    glb.readUInt32LE(8) !== glb.length
  ) {
    throw new Error("Blender did not produce a valid GLB 2 header");
  }

  console.log(
    `PASS Blender background Python: GLB export (${String(glb.length)} bytes) and PNG fixture`,
  );
  execFileSync(
    "toktx",
    ["--t2", "--encode", "uastc", join(output, "fixture.ktx2"), join(output, "fixture.png")],
    { timeout: 30_000, stdio: "pipe" },
  );
  const ktx = await readFile(join(output, "fixture.ktx2"));
  const identifier = new Uint8Array([
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (!ktx.subarray(0, 12).equals(identifier)) {
    throw new Error("KTX encoder did not produce KTX2");
  }

  console.log(`PASS KTX UASTC encoding (${String(ktx.length)} bytes)`);
  execFileSync(
    "node",
    [
      resolve(import.meta.dirname, "../node_modules/@gltf-transform/cli/bin/cli.js"),
      "inspect",
      join(output, "fixture.glb"),
    ],
    { timeout: 30_000, stdio: "pipe" },
  );
  console.log("PASS glTF Transform: inspected Blender GLB");
  console.log("Prerequisites verified. This is not a game, renderer or GPU performance test.");
} finally {
  await rm(output, { recursive: true, force: true });
}
