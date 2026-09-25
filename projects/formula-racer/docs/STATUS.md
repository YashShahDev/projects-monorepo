---
id: STATUS
title: Current delivery status
type: status
status: active
date: 2026-09-26
updated: 2026-09-26
summary: P2 in progress; P2-C1 vehicle simulation done, next P2-C2 controls and camera.
---

# Current delivery status

- Branch: `feat/formula-racer`, main checkout (user preference).
- Base: `origin/main`, `ef7ad88` at creation.
- Completed phases: P0 — documentation and prerequisites; P1 — browser technical
  foundation ([record](checkpoints/P1.md)).
- Active phase: P2 — driving prototype ([record](checkpoints/P2.md)).
- Next checkpoint: P2-C2 controls, assists, gears, chase camera, greybox track.
- Draft PR: [#7](https://github.com/YashShahDev/projects-monorepo/pull/7).
- Session boundary: P2–P5 authorized; Codex review (`gpt-6-astra`) after each phase.

## Next action

P2-C2 is in progress. Done: track content, geometry and the 3.93 km Harbour Park
layout; keyboard adapter; steering, ABS and traction assists (all on by default,
toggled with `setAssists`); keyboard steering smoothing; automatic gearbox; camera rig.
Next, test-first at the seams in the [P2 record](checkpoints/P2.md): the game session
(pause on focus loss/Escape, R reset, C camera) and a greybox track and car view with a
speed/gear readout, replacing the P1 probe app, then browser tests. Then P2-C3 and the
phase review (see AGENTS.md).

## Checkpoints

| ID    | State       | Evidence                                                        |
| ----- | ----------- | --------------------------------------------------------------- |
| P0-C1 | done        | `35d4059`; [P0 record](checkpoints/P0.md)                       |
| P0-C2 | done        | `1df7e26`; [tooling evidence](checkpoints/P0.md)                |
| P0-C3 | done        | `d8f8b38`; [verification](checkpoints/P0.md)                    |
| P1-C1 | done        | `2c619ed`; [P1 record](checkpoints/P1.md)                       |
| P1-C2 | done        | `c4768e0`; [P1 record](checkpoints/P1.md)                       |
| P1-C3 | done        | `08f3cbd`, `ae25a13`, `6683d2f`; [P1 record](checkpoints/P1.md) |
| P2-C1 | done        | `aab4afa`; [P2 record](checkpoints/P2.md)                       |
| P2-C2 | in_progress | [P2](phases/P2-driving.md)                                      |
| P2-C3 | planned     | [P2](phases/P2-driving.md)                                      |
| P3–P5 | planned     | [Roadmap](ROADMAP.md)                                           |

Find checkpoint commits with `git log --oneline --grep='P[0-9]-C'`.

## Verified

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

No gameplay UI yet; the browser still runs the P1 probe scene until P2-C2. No drag, so
top speed is unbounded until P2-C3. The production script is 4.88 MB raw / 1.79 MB
gzip, mostly Rapier's base64-inlined WASM. Static hosts must redirect a bare subpath
to its trailing-slash form. No hardware graphics benchmark or regulation-accurate
model. Full LFS object transfer is gated before the first large assets in P4. Arch
uses Playwright's fallback builds.

The unrelated untracked `projects/text_tools.py` is preserved and must not be staged.
Repository docs remain the shared source of truth.
