/**
 * Measures headless simulation throughput: simulated seconds per wall-clock second,
 * with the benchmark autopilot driving Harbour Park and the energy system on. Run with
 * `bun run tools/sim-speed.ts [seconds]`; prints the median of three runs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { autopilot } from "../src/app/autopilot.ts";
import { createDrivingSession } from "../src/app/session.ts";
import { parseCar } from "../src/content/car.ts";
import { parseEnergyRules } from "../src/content/energy-rules.ts";
import { parseTrack } from "../src/content/track.ts";

const root = resolve(import.meta.dirname, "..");
const json = (path: string): unknown => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const car = parseCar(json("public/assets/cars/fr26.json"));
const energy = parseEnergyRules(json("public/assets/rules/energy-2026-c18.json"));
const track = parseTrack(json("public/assets/tracks/harbour.json"));

const simulatedS = Number(process.argv[2] ?? 120);
if (!Number.isFinite(simulatedS) || simulatedS <= 0) {
  throw new Error(`seconds must be a positive number, got ${process.argv[2]}`);
}

const FRAME_S = 1 / 60;

async function run(): Promise<number> {
  const session = await createDrivingSession(car, track, { energy });
  const drive = () => autopilot(session);
  const start = performance.now();
  for (let t = 0; t < simulatedS; t += FRAME_S) {
    session.frame(FRAME_S, drive);
  }

  const wallS = (performance.now() - start) / 1000;
  session.dispose();

  return simulatedS / wallS;
}

const rates: number[] = [];
for (let r = 0; r < 3; r += 1) {
  rates.push(await run());
}

rates.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    track: "harbour",
    simulatedS,
    rates: rates.map((x) => Math.round(x)),
    median: Math.round(rates[1] ?? 0),
  }),
);
