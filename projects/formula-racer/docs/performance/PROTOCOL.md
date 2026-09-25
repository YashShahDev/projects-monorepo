---
id: PERF-001
title: Performance measurement protocol
type: protocol
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Repeatable evidence on the reference laptop without unmeasured speed claims.
---

# Performance measurement protocol

## Reference and goal

Inspected machine: Intel Core Ultra 7 268V, Intel Arc 130V/140V integrated graphics,
about 30 GiB RAM, Linux/Omarchy. Target: 60 FPS at 1280×720 with one car on the initial
circuit. No game benchmark exists in P0.

## Procedure to implement in P5

Use the production build, a versioned two-minute route and fixed input seed. Warm
assets/shaders first; run three measured passes with the same browser, quality preset,
pixel ratio and camera. Record AC/battery state and power profile by reading them;
do not change system settings or dispatch window-manager commands.

Report median/p95 frame time, missed frame budget, physics-step time, JS/WASM read
cost, draw calls, visible triangles and transfer sizes. Record browser version,
WebGL vendor/renderer, actual render resolution and backend. Hardware rendering must
be confirmed. Target p95 frame time at or below 16.7 ms; report failure honestly and
identify the limiting stage. FPS and p95 alone do not prove input responsiveness.

Keep route/seed and small JSON/Markdown summaries in Git. Exclude recordings and large
trace artifacts. Compare before/after on the same machine and workload. Introduce
workers, resolution changes or custom WASM only against evidence. Software-headless
results validate behavior, not target GPU performance.
