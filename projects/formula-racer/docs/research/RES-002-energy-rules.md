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

## Selected revision (P3, retrieved 2026-09-26)

- [Section C: Technical, Issue 18, 7 May 2026](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_18_-_2026-05-07.pdf):
  C5.2.7 ERS-K ≤ 350 kW; C5.2.8(i) without Overtake, deployment ≤ 1800 − 5·v kW below
  340 km/h and 6900 − 20·v kW from 340 to 345 km/h, zero from 345 km/h; C5.2.8(ii)
  Overtake ≤ 7100 − 20·v kW below 355 km/h; C5.2.9 state-of-charge window ≤ 4 MJ;
  C5.2.10 Recharge ≤ 8.5 MJ per lap (7 MJ at designated circuits, 5 MJ minimum in some
  qualifying sessions, +0.5 MJ with Overtake); C5.2.12 no MGU-K drive from a standing
  start until 50 km/h; C3.10.10 and C3.11.6 Corner and Straight Mode wing positions,
  transition ≤ 400 ms, Straight Mode only fully inside an Activation Zone.
- [Section B: Sporting, Issue 07, 25 June 2026](https://api.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_07_-_2026-06-25.pdf):
  B7.1 Driver Adjustable Bodywork (full and partial activation, circuit-defined
  Activation Zones); B7.2 per-circuit deployment and Recharge limits, and Overtake
  via a Detection Gap, Detection Line and Activation Line relative to another car.

These figures are encoded in `public/assets/rules/energy-2026-c18.json`, which names
its source; the game reads them from there, not from engine code.
