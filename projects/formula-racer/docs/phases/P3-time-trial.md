---
id: P3
title: P3 — Time trial and energy
type: phase
status: in_progress
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

## Selected regulation and gameplay deviations

Selected: Section C Issue 18 (7 May 2026) and Section B Issue 07 (25 June 2026); details
and article numbers in [RES-002](../research/RES-002-energy-rules.md). Deviations,
labelled in-game where visible:

1. No Overtake. It depends on a Detection Gap to another car (B7.2), so solo time trial
   uses the C5.2.8(i) curve only.
2. Modes are gameplay: Balanced deploys a fixed share of the permitted power
   automatically; holding Shift requests the full permitted power; Harvest deploys
   nothing and harvests on lift-off. Real deployment is team and ECU strategy.
3. Energy is accounted at the energy store with fixed efficiencies (deploy and regen) in
   the rules file; the regulation measures at the DC bus and ICE fuel flow.
4. The ICE is a power curve, not a fuel-flow model (C5.2.3–C5.2.5 not modelled).
5. Braking returns the wings to Corner Mode, and they re-open only on throttle inside a
   track-defined zone. Real activation is driver command within ECU-enabled zones.
6. One Recharge limit (8.5 MJ) for every lap; the circuit reductions, Low Grip curves
   and race-only 250 kW sectors need per-event FIA data and are not modelled.
7. Each session starts at full charge (the top of the 4 MJ window).
