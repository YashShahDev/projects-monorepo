// Runs the ?bench route on the production build and records a comparable summary.
//
//   bun run tools/bench.ts [--quality medium] [--passes 3] [--seconds 120]
//                          [--warmup 10] [--headed] [--loaded] [--out docs/performance/runs]
//
// --loaded is the heaviest view a player can pick: full racing line, best-lap ghost
// and the far chase camera. The ghost appears once the route completes its first lap.
//
// Headless by default so runs don't open windows on the desktop, with the GPU forced on:
// plain headless Chromium renders in software, whose numbers say nothing about the
// reference laptop (see docs/performance/PROTOCOL.md). Each report names its renderer.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BenchReport } from "../src/app/bench.ts";
import type { FrameSummary } from "../src/app/frame-stats.ts";
import { finite, object, text } from "../src/content/validate.ts";
import { isQualityPreset } from "../src/rendering/quality.ts";
import type { QualityPreset } from "../src/rendering/quality.ts";
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

function parseFrameSummary(value: unknown, path: string): FrameSummary {
  const f = object(value, path);
  const field = (key: keyof FrameSummary) => finite(f[key], `${path}.${key}`);

  return {
    frames: field("frames"),
    medianMs: field("medianMs"),
    p95Ms: field("p95Ms"),
    p99Ms: field("p99Ms"),
    maxMs: field("maxMs"),
    overBudget: field("overBudget"),
    budgetMs: field("budgetMs"),
  };
}

/** Reads back the JSON a `?bench` page printed. */
export function parseBenchReport(value: unknown, path = "report"): BenchReport {
  const r = object(value, path);
  const pausedFrames = finite(r.pausedFrames, `${path}.pausedFrames`);
  if (pausedFrames > 0) {
    throw new Error(
      `${path} was paused for ${String(pausedFrames)} frames (did the window lose focus?); rerun the pass`,
    );
  }

  const buffer = object(r.drawingBuffer, `${path}.drawingBuffer`);
  const gl = object(r.gl, `${path}.gl`);

  return {
    route: text(r.route, `${path}.route`),
    quality: text(r.quality, `${path}.quality`),
    pixelRatio: finite(r.pixelRatio, `${path}.pixelRatio`),
    drawingBuffer: {
      width: finite(buffer.width, `${path}.drawingBuffer.width`),
      height: finite(buffer.height, `${path}.drawingBuffer.height`),
    },
    gl: { vendor: text(gl.vendor, `${path}.gl.vendor`), renderer: text(gl.renderer, `${path}.gl.renderer`) },
    userAgent: text(r.userAgent, `${path}.userAgent`),
    transferBytes: finite(r.transferBytes, `${path}.transferBytes`),
    measuredSeconds: finite(r.measuredSeconds, `${path}.measuredSeconds`),
    frames: parseFrameSummary(r.frames, `${path}.frames`),
    simMs: parseFrameSummary(r.simMs, `${path}.simMs`),
    renderMs: parseFrameSummary(r.renderMs, `${path}.renderMs`),
    drawCalls: finite(r.drawCalls, `${path}.drawCalls`),
    triangles: finite(r.triangles, `${path}.triangles`),
    distanceM: finite(r.distanceM, `${path}.distanceM`),
    pausedFrames,
  };
}

export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/iu.test(renderer);
}

/** Launch flags; ANGLE on GL matches what headed Chromium picks on the reference laptop. */
export function chromiumArgs(headless: boolean): string[] {
  return headless ? ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
}

/** The middle value, or the mean of the two middle values, so no pass is favoured. */
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  const high = sorted[Math.ceil((sorted.length - 1) / 2)] ?? 0;

  return (low + high) / 2;
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

export interface RunOptions {
  quality: QualityPreset;
  passes: number;
  seconds: number;
  warmup: number;
  headed: boolean;
  loaded: boolean;
  out: string;
}

/** Command-line options, checked so a typo fails at once rather than as a NaN timeout. */
export function parseRunOptions(args: string[]): RunOptions {
  const { values } = parseArgs({
    args,
    options: {
      quality: { type: "string", default: "medium" },
      passes: { type: "string", default: "3" },
      seconds: { type: "string", default: "120" },
      warmup: { type: "string", default: "10" },
      headed: { type: "boolean", default: false },
      loaded: { type: "boolean", default: false },
      out: { type: "string", default: "docs/performance/runs" },
    },
  });
  if (!isQualityPreset(values.quality)) {
    throw new Error("--quality must be low, medium or high");
  }

  const passes = Number(values.passes);
  if (!Number.isInteger(passes) || passes <= 0) {
    throw new Error("--passes must be a positive whole number");
  }

  // The same ranges `?bench` accepts, so the runner never builds a page URL it rejects.
  const duration = (name: "seconds" | "warmup", min: number) => {
    const value = Number(values[name]);
    if (!Number.isFinite(value) || value < min || value > 600) {
      throw new Error(`--${name} must be between ${String(min)} and 600`);
    }

    return value;
  };

  return {
    quality: values.quality,
    passes,
    seconds: duration("seconds", 0.1),
    warmup: duration("warmup", 0),
    headed: values.headed,
    loaded: values.loaded,
    out: values.out,
  };
}

async function main() {
  const values = parseRunOptions(process.argv.slice(2));
  const { quality } = values;

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
    ...(process.env.PW_CHROMIUM_PATH !== undefined ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  const reports: BenchReport[] = [];
  const heapBytes: number[] = [];
  try {
    for (let pass = 1; pass <= values.passes; pass += 1) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const extras = values.loaded ? { racingLine: "full", ghost: "best" } : {};
      const prefs = JSON.stringify({ version: 1, quality, ...extras });
      await page.addInitScript({ content: `localStorage.setItem("formula-racer:prefs", ${JSON.stringify(prefs)});` });
      const query = `?bench&warmupSeconds=${String(values.warmup)}&benchSeconds=${String(values.seconds)}`;
      await page.goto(new URL(query, server.url).href);
      if (values.loaded) {
        // Chase, cockpit, T-cam, then far chase.
        await page.locator("#status").waitFor({ state: "hidden", timeout: 60_000 });
        for (let press = 0; press < 3; press += 1) {
          await page.keyboard.press("c");
        }
      }

      const pre = page.locator("#bench-report");
      await pre.waitFor({ timeout: (values.seconds + values.warmup + 60) * 1000 });
      const report = parseBenchReport(JSON.parse((await pre.textContent()) ?? ""));
      reports.push(report);

      // Chromium-only and coarse, but enough to see a leak or a doubled footprint.
      const heap = await page.evaluate(() => {
        const memory: unknown = Reflect.get(performance, "memory");
        const used: unknown = typeof memory === "object" && memory !== null ? Reflect.get(memory, "usedJSHeapSize") : 0;

        return typeof used === "number" ? used : 0;
      });
      heapBytes.push(heap);
      console.log(`pass ${String(pass)}: p95 ${report.frames.p95Ms.toFixed(2)} ms, ${report.gl.renderer}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  const summary = summarizeRuns(reports);
  const outDir = resolve(import.meta.dirname, "..", values.out);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const file = join(outDir, `${stamp}-${quality}${values.loaded ? "-loaded" : ""}.json`);
  writeFileSync(file, `${JSON.stringify({ summary, loaded: values.loaded, heapBytes, passes: reports }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${file}`);
  if (!summary.hardware) {
    console.warn("Software rendering: these numbers validate the route, not GPU performance.");
  }
}

if (import.meta.main) {
  await main();
}
