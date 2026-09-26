---
id: STATUS
title: Current delivery status
type: status
status: active
date: 2026-09-26
updated: 2026-09-26
summary: P2 done and reviewed; P3 time trial and energy in progress.
---

# Current delivery status

- Branch: `feat/formula-racer`, main checkout (user preference).
- Base: `origin/main`, `ef7ad88` at creation.
- Completed phases: P0 — documentation and prerequisites; P1 — browser technical
  foundation ([record](checkpoints/P1.md)); P2 — driving prototype
  ([record](checkpoints/P2.md)).
- Active phase: P3 — time trial and energy ([record](checkpoints/P3.md)).
- Next checkpoint: P3-C2 energy rules, deployment and active aero.
- Draft PR: [#7](https://github.com/YashShahDev/projects-monorepo/pull/7).
- Session boundary: P2–P5 authorized; Codex review (`gpt-6-astra`) after each phase.

## Next action

P3-C1 is done. Next, P3-C2: first read RES-002, show the selected regulatory revision
and document the gameplay deviations; then test-first: versioned energy rules, Shift
deployment above baseline, E cycling Balanced → Harvest, regeneration efficiency and
brake blending, active-wing zones with braking override, and charge/power telemetry.

## Checkpoints

| ID        | State   | Evidence                                                                    |
| --------- | ------- | --------------------------------------------------------------------------- |
| P0-C1     | done    | `35d4059`; [P0 record](checkpoints/P0.md)                                   |
| P0-C2     | done    | `1df7e26`; [tooling evidence](checkpoints/P0.md)                            |
| P0-C3     | done    | `d8f8b38`; [verification](checkpoints/P0.md)                                |
| P1-C1     | done    | `2c619ed`; [P1 record](checkpoints/P1.md)                                   |
| P1-C2     | done    | `c4768e0`; [P1 record](checkpoints/P1.md)                                   |
| P1-C3     | done    | `08f3cbd`, `ae25a13`, `6683d2f`; [P1 record](checkpoints/P1.md)             |
| P2-C1     | done    | `aab4afa`; [P2 record](checkpoints/P2.md)                                   |
| P2-C2     | done    | `f9cb3b1`… (`--grep=P2-C2`); [P2 record](checkpoints/P2.md)                 |
| P2-C3     | done    | `ec511a5`… (`--grep=P2-C3`); [P2 record](checkpoints/P2.md)                 |
| P2 review | done    | Codex `gpt-6-astra`, 4/4 fixed; [P2 record](checkpoints/P2.md#phase-review) |
| P3-C1     | next    | [P3](phases/P3-time-trial.md)                                               |
| P3-C2–C3  | planned | [P3](phases/P3-time-trial.md)                                               |
| P4–P5     | planned | [Roadmap](ROADMAP.md)                                                       |

Find checkpoint commits with `git log --oneline --grep='P[0-9]-C'`.

## Verified

P3-C1: ordered sectors, lap timing interpolated within a step, reverse-crossing and
shortcut rules, four-wheels track limits, 3 s countdown, reset abandons the lap, laps
tagged with physics/assists/tuning; 154 unit tests; `make test-full` 38/38.

P2-C3: drag and downforce (top speed ≈ 340 km/h), per-wheel surface grip, rpm power
curve with shift cut, dev tuning panel applied on reset; physics `p2.4`; 130 unit tests;
`make test-full` 33/33.

P2-C2: drivable greybox Harbour Park in the browser: keyboard (released on blur and
hidden tab), speed-sensitive steering smoothing, steering/ABS/traction assists, automatic
gearbox, chase and nose cameras, pause on Escape and focus loss, R reset, speed/gear
readout. 107 unit tests; `make test-full` 31/31 (Chromium dev/prod/subpath, Firefox).

P2-C1: fixed 60 Hz stepper with bounded catch-up; Rapier raycast-wheel vehicle behind
`VehicleSimulation`; 67 unit tests including bit-identical state at 30/60/144 Hz.

P1: Bun dev server and production build; static delivery at the root and under a URL
subpath; recoverable startup errors; Playwright suite. `make test` runs unit tests plus
Chromium dev checks; `make test-full` runs the complete browser matrix (Chromium
dev/prod/subpath, Firefox smoke). Headless software GL only. CI wiring is deferred.

P0: pinned Bun/Node/GitHub CLI and native asset tools; frozen dependency install;
strict TypeScript, Oxlint, Oxfmt and local documentation links; doctor; Blender
GLB/PNG export; KTX UASTC encoding; glTF inspection. Git LFS is configured and its
authenticated GitHub endpoint responds.

## Known limits

No rolling resistance; Rapier's 2× longitudinal grip budget allows ≈3 g braking; grass
still out-grips the brakes above ~250 km/h. Kerb stripes are interpolated vertex colours
(greybox). The production script is 4.88 MB raw / 1.79 MB
gzip, mostly Rapier's base64-inlined WASM. Static hosts must redirect a bare subpath
to its trailing-slash form. No hardware graphics benchmark or regulation-accurate
model. Full LFS object transfer is gated before the first large assets in P4. Arch
uses Playwright's fallback builds.

The unrelated untracked `projects/text_tools.py` is preserved and must not be staged.
Repository docs remain the shared source of truth.
