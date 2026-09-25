---
id: RES-002
title: 2026-inspired energy and active aero
type: research
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Preserve regulatory sources and distinguish gameplay approximation from current compliance.
---

# 2026-inspired energy and active aero

Retrieved 2026-09-26. These sources establish design direction, not a frozen complete
rulebook for implementation.

- [FIA initial 2026 announcement](https://www.fia.com/news/new-era-competition-fia-showcases-future-focused-formula-1-regulations-2026-and-beyond).
- [FIA regulation refinements](https://api.fia.com/news/refinements-2026-fia-formula-1-regulations-agreed-all-stakeholders).
- [FIA regulations index](https://www.fia.com/regulations/formula-1-regulations).

The later refinements change energy-management parameters from early announcements.
Before P3, retrieve the latest applicable technical regulation issue and record its
date/sections. Do not confuse stored usable energy, per-lap recharge allowance,
instantaneous power or opponent-dependent deployment rules. Avoid baking old headline
numbers directly into physics. Any circuit-specific override needs an explicit source.

## Approved gameplay scope

Versioned configurable rules, visible charge and power flow, baseline deployment,
driver deployment request and balanced/harvest modes. Account energy in joules and
power in watts, with efficiency losses. Blend regenerative and friction braking
against one requested braking force. Handle full/empty battery and lap transitions.

Active wings use track-defined straight zones and return to cornering state under
braking. This is a documented gameplay approximation. No opponent-dependent overtake
eligibility in solo time trial. Label rule deviations in [P3](../phases/P3-time-trial.md).

Open at P3: confirm preferred deployment button semantics and selected regulation
revision with the user after research. Default request is held Shift deployment.
