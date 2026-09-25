---
id: P5
title: P5 — Performance and release verification
type: phase
status: planned
date: 2026-09-26
updated: 2026-09-26
summary: Measure the first release and close regressions on real hardware.
---

# P5 — Performance and release verification

Prerequisite: P4 done. Use PERF-001.

- P5-C1: implement benchmark route and reporting; capture three warmed two-minute
  production runs on the reference laptop and identify CPU/GPU/asset bottlenecks.
- P5-C2: optimize evidenced bottlenecks (LOD, texture/material cost, scenery instancing,
  shadows, bounded adaptive resolution) with before/after numbers and regression checks.
- P5-C3: full test/build/lint/browser/asset checks, setup reproduction, final screenshots,
  known limitations and PR description aligned with the delivered game.

Gate: report 1280×720/60 FPS target result honestly, including p95 timing and backend.
A missed target is an unresolved acceptance item, not permission to hide reduced quality.
Do not run hardware FPS assertions as unstable shared CI tests.

Decided (user, 2026-09-26): the agent may launch headed Chromium benchmark runs on the
live session (window may take focus); no window-manager commands. Before starting:
confirm any required quality reduction if measurements make a material
visual tradeoff necessary. Keep the PR draft until checks and review are complete;
merging still requires the user's instruction.
