import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportCar } from "./export-car.ts";

/** Rebuilds the car from source and fails unless it matches the committed GLB byte for byte. */
const committed = "public/assets/cars/fr26.glb";
const dir = await mkdtemp(join(tmpdir(), "fr26-export-"));
try {
  const out = join(dir, "fr26.glb");
  const problems = await exportCar(out);
  if (problems.length > 0) {
    throw new Error(`rebuilt model is invalid:\n${problems.join("\n")}`);
  }

  const hash = async (path: string) =>
    new Bun.CryptoHasher("sha256").update(new Uint8Array(await readFile(path))).digest("hex");
  const [expected, actual] = await Promise.all([hash(committed), hash(out)]);
  if (expected !== actual) {
    console.error(`${committed} is stale or not reproducible: committed ${expected}, rebuilt ${actual}`);
    process.exit(1);
  }

  console.log(`${committed}: rebuilt from source, identical (${actual.slice(0, 12)})`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
