import { defineConfig, devices } from "@playwright/test";

const dev = "http://localhost:4310/";
const root = "http://localhost:4311/";
const subpath = "http://localhost:4312/games/formula-racer/";

// Tags: @smoke runs everywhere, @dev needs development hooks, @prod checks production-only
// guarantees. Untagged tests run on the Chromium production servers.
// Headless software GL renders a 1280×720 frame in ~31 ms and 640×360 in ~15 ms (one
// worker); clock-driven tests render every frame, so the smaller view halves their time.
const viewport = { width: 640, height: 360 };

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: [
    { command: "bun run tools/dev.ts", env: { PORT: "4310" }, url: dev },
    { command: "bun run tools/serve-dist.ts --port 4311", url: root },
    {
      command: "bun run tools/serve-dist.ts --port 4312 --base /games/formula-racer/",
      url: subpath,
    },
  ],
  projects: [
    {
      name: "chromium-dev",
      grep: /@smoke|@dev/u,
      use: { ...devices["Desktop Chrome"], viewport, baseURL: dev },
    },
    {
      name: "chromium-prod",
      grepInvert: /@dev/u,
      use: { ...devices["Desktop Chrome"], viewport, baseURL: root },
    },
    {
      name: "chromium-prod-subpath",
      grepInvert: /@dev/u,
      use: { ...devices["Desktop Chrome"], viewport, baseURL: subpath },
    },
    {
      name: "firefox-dev",
      grep: /@smoke/u,
      use: { ...devices["Desktop Firefox"], viewport, baseURL: dev },
    },
    {
      name: "firefox-prod-subpath",
      grep: /@smoke/u,
      use: { ...devices["Desktop Firefox"], viewport, baseURL: subpath },
    },
  ],
});
