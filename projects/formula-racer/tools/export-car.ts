import { spawnSync } from "node:child_process";
import { parseCar } from "../src/content/car.ts";
import { parseCarModelInterface } from "../src/content/car-model.ts";
import { validateCarModelFile } from "./validate-car-model.ts";

/** Builds the car GLB in Blender (background, factory settings) and validates the result. */
export async function exportCar(
  out: string,
  options: { textureSize?: number; samples?: number } = {},
) {
  const carPath = "public/assets/cars/fr26.json";
  const interfacePath = "content/cars/model-interface.json";
  const result = spawnSync(
    "blender",
    [
      "--background",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      "assets/blender/fr26_car.py",
      "--",
      "--car",
      carPath,
      "--interface",
      interfacePath,
      "--out",
      out,
      "--texture-size",
      String(options.textureSize ?? 1024),
      "--samples",
      String(options.samples ?? 64),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `Blender export failed (${String(result.status)}):\n${result.stderr}${result.stdout.slice(-4000)}`,
    );
  }

  const car = parseCar(await Bun.file(carPath).json(), carPath);
  const spec = parseCarModelInterface(await Bun.file(interfacePath).json(), interfacePath);

  return validateCarModelFile(out, car, spec);
}

if (import.meta.main) {
  const out = process.argv[2] ?? "public/assets/cars/fr26.glb";
  const started = performance.now();
  const problems = await exportCar(out);
  for (const problem of problems) {
    console.error(`${out}: ${problem}`);
  }

  if (problems.length > 0) {
    process.exit(1);
  }

  console.log(
    `${out}: exported and valid in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}
