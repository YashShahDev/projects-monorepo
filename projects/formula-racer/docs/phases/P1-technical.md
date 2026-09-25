---
id: P1
title: P1 — Browser technical foundation
type: phase
status: done
date: 2026-09-26
updated: 2026-09-26
summary: Prove Bun rendering and WASM delivery before gameplay.
---

# P1 — Browser technical foundation

Prerequisite: P0 done. Read ADR-001/002 and RES-001.

- P1-C1: HTML entrypoint, Bun dev server, browser-target production build, local static
  asset delivery; verify direct and subpath hosting. Exclude development hooks.
- P1-C2: minimal WebGL2 scene and asynchronously initialized Rapier world using the
  pinned compat package. Dispose resources and surface WebGL/WASM/asset failures.
- P1-C3: Playwright tests against dev and production, Chromium plus Firefox smoke;
  no console/runtime errors, visible scene and observable physics advancement.

Gate: clean frozen install, build, lint, unit/integration/browser tests pass. Report
bundle/WASM sizes and startup time without claiming a comparative speed improvement.
Add test-only stepping/inspection controls guarded out of production.

Before starting: brief the planned scene and known Bun/asset constraints. Ask only
if a proved incompatibility requires changing the approved toolchain or hosting scope.
