---
id: ROADMAP
title: Delivery roadmap
type: plan
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Six resumable phases leading to the first playable time trial.
---

# Delivery roadmap

## Product contract

Original 2026-style open-wheel chassis, three fictional liveries with equal initial
performance, one original daylight circuit. Accessible keyboard handling with
meaningful braking, grip, aero and battery management. Chase camera first, cockpit
view later in P4. HUD shows speed, gear, lap time, charge, power flow and wing state.
Controls: WASD/arrows, Shift deployment, E energy mode, C camera, R reset, Escape pause.
Save local settings and best laps by track and physics version.

Desktop Chromium first, Firefox smoke coverage. Target 60 FPS at 1280×720 on the
reference laptop; that is a goal, not an existing result. AI, multiplayer, mobile,
weather, damage and full regulatory fidelity are later work.

## Phases

| Phase                         | Checkpoints                                            | Gate                                                       |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| [P0](phases/P0-foundation.md) | C1 docs; C2 toolchain; C3 verification                 | Reproducible setup, shared checkpoint system, one draft PR |
| [P1](phases/P1-technical.md)  | C1 browser bundle; C2 rendering/WASM; C3 browser tests | Static build runs and loads assets correctly               |
| [P2](phases/P2-driving.md)    | C1 simulation; C2 controls/camera; C3 tuning           | Drivable greybox with reproducible scenarios               |
| [P3](phases/P3-time-trial.md) | C1 laps; C2 energy; C3 HUD/persistence                 | Complete time trial and bounded energy accounting          |
| [P4](phases/P4-content.md)    | C1 car pipeline; C2 circuit/liveries; C3 presentation  | Detailed original assets, audio and quality presets        |
| [P5](phases/P5-release.md)    | C1 baseline; C2 optimization; C3 regression            | Measured hardware performance and reviewed first release   |

Each phase begins with a brief and material clarifications. Each checkpoint has a
commit, acceptance evidence and a resume action. All phases remain in one draft PR
as explicitly requested. Checkpoint commits remain useful even if final merge is squashed.
