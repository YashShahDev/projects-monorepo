---
id: STATUS
title: Current delivery status
type: status
status: active
date: 2026-09-26
updated: 2026-09-26
summary: P0–P5 complete; the game is playable and the PR is ready for review.
---

# Current delivery status

- Branch: `feat/formula-racer`, main checkout (user preference).
- Base: `origin/main`, `ef7ad88` at creation.
- Completed phases: P0 — documentation and prerequisites; P1 — browser technical
  foundation ([record](checkpoints/P1.md)); P2 — driving prototype
  ([record](checkpoints/P2.md)); P3 — time trial and energy ([record](checkpoints/P3.md)); P4 — content and presentation ([record](checkpoints/P4.md)).
- Active phase: P5 — performance and release verification ([phase](phases/P5-release.md)).
- Next checkpoint: none; P0–P5 complete.
- Draft PR: [#7](https://github.com/YashShahDev/projects-monorepo/pull/7).
- Session boundary: P2–P5 authorized; Codex review (`gpt-6-astra`) after each phase.

## Next action

P4 is done: implemented, reviewed (9 findings fixed, 2 rejected) and verified against
the real `fr26.glb` with chase and cockpit screenshots ([record](checkpoints/P4.md)).
The P5-C1 benchmark route and `make bench` runner are built ([record](checkpoints/P5.md)).

P4-C4 (trackside, map, telemetry, braking harvest) is done and Codex-reviewed (2/2
fixed). The PR #7 Codex comments (6) and an independent review (6) are fixed in
`beee51e` and `a01a783` ([P5](checkpoints/P5.md)). Benchmarks wait until the user says the laptop is idle (user, 2026-09-26); the
earlier Low runs predate the scenery and must be repeated.

P5-C1 is closed. On the reference laptop, every preset holds a locked 60 Hz: p95 16.7 ms,
0 missed refreshes, and CPU work around 2 ms. The limiting stage is the frame clock
([P5](checkpoints/P5.md)). The strict-types branch is merged (`13f3669`).

Next:

P5 is complete. The phase review found 5 defects, all fixed ([P5](checkpoints/P5.md#phase-review)).
The PR is ready for the user's review; don't merge. The open items listed in that
review are optional follow-ups.

Cloud sessions: set `PW_CHROMIUM_PATH` (see [SETUP](SETUP.md)). LFS works through the
root `.lfsconfig`, provided `YashShahDev/projects-monorepo` is in the session's
repository sources.

## Checkpoints

| ID        | State  | Evidence                                                                      |
| --------- | ------ | ----------------------------------------------------------------------------- |
| P0-C1     | done   | `35d4059`; [P0 record](checkpoints/P0.md)                                     |
| P0-C2     | done   | `1df7e26`; [tooling evidence](checkpoints/P0.md)                              |
| P0-C3     | done   | `d8f8b38`; [verification](checkpoints/P0.md)                                  |
| P1-C1     | done   | `2c619ed`; [P1 record](checkpoints/P1.md)                                     |
| P1-C2     | done   | `c4768e0`; [P1 record](checkpoints/P1.md)                                     |
| P1-C3     | done   | `08f3cbd`, `ae25a13`, `6683d2f`; [P1 record](checkpoints/P1.md)               |
| P2-C1     | done   | `aab4afa`; [P2 record](checkpoints/P2.md)                                     |
| P2-C2     | done   | `f9cb3b1`… (`--grep=P2-C2`); [P2 record](checkpoints/P2.md)                   |
| P2-C3     | done   | `ec511a5`… (`--grep=P2-C3`); [P2 record](checkpoints/P2.md)                   |
| P2 review | done   | Codex `gpt-6-astra`, 4/4 fixed; [P2 record](checkpoints/P2.md#phase-review)   |
| P3-C1–C3  | done   | `09c6ec9`… (`--grep=P3-C`); [P3 record](checkpoints/P3.md)                    |
| P3 review | done   | Codex `gpt-6-astra`, 3/3 fixed; [P3 record](checkpoints/P3.md)                |
| P4-C1     | done   | `--grep=P4-C1`; [P4 record](checkpoints/P4.md)                                |
| P4-C2     | done   | `--grep=P4-C2`; [P4 record](checkpoints/P4.md)                                |
| P4-C3     | active | `--grep=P4-C3`; needs the real-model check; [P4](checkpoints/P4.md)           |
| P4 review | done   | Fresh review agent, 9 fixed, 2 rejected; [P4](checkpoints/P4.md#phase-review) |
| P4-C4     | done   | `--grep=P4-C4`; Codex reviewed, 2/2 fixed; [P4](checkpoints/P4.md)            |
| P5-C1     | done   | `--grep=P5-C1`; all presets locked 60 Hz; [P5](checkpoints/P5.md)             |
| P5-C2     | done   | No bottleneck to optimize; [P5](checkpoints/P5.md)                            |
| P5-C3     | done   | Lint, Chromium tests, screenshots, limitations; [P5](checkpoints/P5.md)       |
| P5 review | done   | Independent agent, 5 fixed; [P5](checkpoints/P5.md#phase-review)              |

Find checkpoint commits with `git log --oneline --grep='P[0-9]-C'`.

## Verified

P4 on the real model: LFS object fetched (oid matches); 293/293 unit tests; Chromium
browser 29/29 twice; chase (two liveries) and cockpit screenshots recorded.

P4 review and P5-C1 tooling: 9 review fixes with tests; bench route, frame/run summaries
and `make bench` verified headless (software GL, not a performance result); unit tests
pass except the shipped-GLB check; Chromium browser 29/29 against a local stand-in model.

P4-C3: favicon; graphics presets (pixel ratio, draw distance, car LOD; saved); sound
model and Web Audio playback with a saved toggle; anchored chase/cockpit cameras; car
GLB binding, loading and rendering; battery meter. Unit tests pass except the shipped-GLB
checks, which need the real LFS object; Chromium browser 27/27 against a local stand-in
model.

P4-C2: liveries (paint/accent only, saved choice); track catalog with safe ids and a
catalog/file id check; Test Loop second map loaded by `?track=`; 245 unit tests pass
(the 2 GLB tests need LFS objects); Chromium browser 22/22.

P4-C1: LFS push and fresh-clone fetch of a probe object; car GLB (LOD0 18,596
triangles, 5.22 × 1.89 × 0.95 m, baked 1024² normal/AO) validated against the node
interface and physics car; three exports byte-identical; 226 unit tests; `make test`
17/17 browser.

P3-C3: pause menu with assist toggles (restart on change), best laps per track/physics/
assists in versioned local storage with recovery from blocked, corrupt or full storage;
203 unit tests; `make test-full` 73/73.

P3-C2: Section C Iss 18 energy rules (sourced file), ICE + ERS deployment with MGU-K
torque limit, regeneration blended with friction braking, Balanced/Harvest and Shift
deploy, active-aero zones with braking override; physics `p3.1`; 193 unit tests;
`make test-full` 43/43.

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
