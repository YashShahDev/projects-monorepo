import { defineConfig } from "@playwright/test";
import fullConfig from "./playwright.config.ts";

export default defineConfig({
  ...fullConfig,

  // Local checks need only the dev server; dist/ may not exist yet.
  webServer: {
    command: "bun run tools/dev.ts",
    env: { PORT: "4310" },
    url: "http://localhost:4310/",
  },
  projects: fullConfig.projects?.filter((project) => project.name === "chromium-dev"),
});
