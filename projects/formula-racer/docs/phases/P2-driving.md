---
id: P2
title: P2 — Driving prototype
type: phase
status: planned
date: 2026-09-26
updated: 2026-09-26
summary: Build accessible vehicle motion with replaceable physics modules.
---

# P2 — Driving prototype

Prerequisite: P1 done. Read architecture and ADR-002.

- P2-C1: 60 Hz stepper with bounded catch-up, interpolation snapshots, rigid chassis,
  four raycast wheels, suspension and reset; seeded simulation harness.
- P2-C2: normalized keyboard inputs, assisted steering/braking, automatic gears,
  chase camera, pause/focus-loss behavior on a greybox track.
- P2-C3: surface grip, speed-squared aero and powertrain modules; development tuning
  panel, structural changes on reset and recorded physics version.

Gate: acceleration/braking/turning/contact/reset tests, comparable behavior across
render rates, bounded catch-up and no stuck input after focus loss. Demonstrate
stable straight-line driving and corners; record tuning values and known limits.

Before starting: ask about any handling preference beyond the approved accessible-sim
default. Do not block routine implementation on unspecified full-simulator parameters.
Later tire slip/temperature/wear models remain replaceable follow-ups.
