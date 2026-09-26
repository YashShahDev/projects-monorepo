// Runs the ?bench route on the production build and records a comparable summary.
//
//   bun run tools/bench.ts [--quality medium] [--passes 3] [--seconds 120]
//                          [--warmup 10] [--headed] [--out docs/performance/runs]
//
// Headless by default so runs don't open windows on the desktop, with the GPU forced on:
// plain headless Chromium renders in software, whose numbers say nothing about the
// reference laptop (see docs/performance/PROTOCOL.md). Each report names its renderer.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BenchReport } from "../src/app/bench.ts";
import { isQualityPreset } from "../src/rendering/quality.ts";
import { serveStaticFile } from "./static-files.ts";

const TARGET_P95_MS = 16.7;

// Chromium coarsens rAF timestamps to 0.1 ms, so a frame locked to the 16.67 ms refresh
// records as 16.6–16.8 ms; the target allows that rounding and nothing more.
const TIMESTAMP_ROUNDING_MS = 0.15;

export interface RunSummary {
  route: string;
  quality: string;
  passes: number;

  /** Median across passes of each pass's figure. */
  p95Ms: number;
  medianMs: number;
  simP95Ms: number;
  renderP95Ms: number;
  worstP95Ms: number;
  overBudget: number;
  drawCalls: number;
  triangles: number;
  drawingBuffer: { width: number; height: number };
  gl: { vendor: string; renderer: string };
  userAgent: string;
  transferBytes: number;

  /** False when any pass rendered in software; such runs cannot meet the target. */
  hardware: boolean;
  meetsTarget: boolean;
}

export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
}

/** Launch flags; ANGLE on GL matches what headed Chromium picks on the reference laptop. */
export function chromiumArgs(headless: boolean): string[] {
  return headless ? ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};

export function summarizeRuns(reports: readonly BenchReport[]): RunSummary {
  const [first] = reports;
  if (!first) {
    throw new Error("no passes to summarize");
  }

  for (const key of ["route", "quality"] as const) {
    if (reports.some((r) => r[key] !== first[key])) {
      throw new Error(`passes differ in ${key}`);
    }
  }

  const hardware = reports.every((r) => !isSoftwareRenderer(r.gl.renderer));
  const p95Ms = median(reports.map((r) => r.frames.p95Ms));

  return {
    route: first.route,
    quality: first.quality,
    passes: reports.length,
    p95Ms,
    medianMs: median(reports.map((r) => r.frames.medianMs)),
    simP95Ms: median(reports.map((r) => r.simMs.p95Ms)),
    renderP95Ms: median(reports.map((r) => r.renderMs.p95Ms)),
    worstP95Ms: Math.max(...reports.map((r) => r.frames.p95Ms)),
    overBudget: median(reports.map((r) => r.frames.overBudget)),
    drawCalls: median(reports.map((r) => r.drawCalls)),
    triangles: median(reports.map((r) => r.triangles)),
    drawingBuffer: first.drawingBuffer,
    gl: first.gl,
    userAgent: first.userAgent,
    transferBytes: first.transferBytes,
    hardware,
    meetsTarget: hardware && p95Ms <= TARGET_P95_MS + TIMESTAMP_ROUNDING_MS,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      quality: { type: "string", default: "medium" },
      passes: { type: "string", default: "3" },
      seconds: { type: "string", default: "120" },
      warmup: { type: "string", default: "10" },
      headed: { type: "boolean", default: false },
      out: { type: "string", default: "docs/performance/runs" },
    },
  });
  const quality = values.quality ?? "medium";
  if (!isQualityPreset(quality)) {
    throw new Error("--quality must be low, medium or high");
  }

  const root = resolve(import.meta.dirname, "../dist");
  if (!existsSync(join(root, "index.html"))) {
    throw new Error("dist/index.html is missing; run make build first");
  }

  // Imported here so the summary functions can be unit-tested without a browser.
  const { chromium } = await import("@playwright/test");
  const server = Bun.serve({ port: 0, fetch: (request) => serveStaticFile(root, "/", new URL(request.url).pathname) });
  const browser = await chromium.launch({
    headless: !values.headed,
    args: chromiumArgs(!values.headed),
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  const reports: BenchReport[] = [];
  try {
    for (let pass = 1; pass <= Number(values.passes); pass += 1) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const prefs = JSON.stringify({ version: 1, quality });
      await page.addInitScript({ content: `localStorage.setItem("formula-racer:prefs", ${JSON.stringify(prefs)});` });
      const query = `?bench&warmupSeconds=${String(values.warmup)}&benchSeconds=${String(values.seconds)}`;
      await page.goto(new URL(query, server.url).href);
      const pre = page.locator("#bench-report");
      await pre.waitFor({ timeout: (Number(values.seconds) + Number(values.warmup) + 60) * 1000 });
      const report = JSON.parse((await pre.textContent()) ?? "") as BenchReport;
      reports.push(report);
      console.log(`pass ${String(pass)}: p95 ${report.frames.p95Ms.toFixed(2)} ms, ${report.gl.renderer}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  const summary = summarizeRuns(reports);
  const outDir = resolve(import.meta.dirname, "..", values.out ?? "docs/performance/runs");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(outDir, `${stamp}-${quality}.json`);
  writeFileSync(file, `${JSON.stringify({ summary, passes: reports }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${file}`);
  if (!summary.hardware) {
    console.warn("Software rendering: these numbers validate the route, not GPU performance.");
  }
}

if (import.meta.main) {
  await main();
}
