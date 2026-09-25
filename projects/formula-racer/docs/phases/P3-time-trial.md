---
id: P3
title: P3 — Time trial and energy
type: phase
status: planned
date: 2026-09-26
updated: 2026-09-26
summary: Complete lap rules and configurable 2026-inspired energy management.
---

# P3 — Time trial and energy

Prerequisite: P2 done. Read RES-002; refresh official rules before numeric tuning.

- P3-C1: ordered checkpoints, lap validity/countdown/timing, reverse crossing and
  shortcut prevention; reset invalidates the current lap.
- P3-C2: versioned energy rules, deployment, regeneration efficiency and brake
  blending; active-wing zones and braking override; expose charge/power telemetry.
- P3-C3: HUD, session menu and persistence keyed by track/physics version; recover
  gracefully from unavailable/corrupt storage.

Gate: valid/invalid laps, full/empty battery, per-lap limits, energy conservation,
brake blending and local-save compatibility have behavior tests and browser coverage.

Decided (user, 2026-09-26): hold Shift to request deployment above the baseline; E
cycles Balanced → Harvest → Balanced; HUD shows mode and charge. Before starting:
show selected regulatory revision and document gameplay deviations. Do not silently
implement opponent-dependent overtake rules in solo time trial.
