---
id: STATUS
title: Current delivery status
type: status
status: active
date: 2026-09-26
updated: 2026-09-26
summary: P1 is complete; resume at the P2 driving-prototype brief.
---

# Current delivery status

- Branch: `feat/formula-racer`, main checkout (user preference).
- Base: `origin/main`, `ef7ad88` at creation.
- Completed phases: P0 — documentation and prerequisites; P1 — browser technical
  foundation ([record](checkpoints/P1.md)).
- Next checkpoint: P2-C1, planned; no P2 implementation has started.
- Draft PR: [#7](https://github.com/YashShahDev/projects-monorepo/pull/7).
- Session boundary: P1 complete; stop before P2.

## Next action

Read [P2](phases/P2-driving.md), [ARCHITECTURE](ARCHITECTURE.md) and
[ADR-002](decisions/ADR-002-physics-boundary.md). Check branch/status, give a short
phase brief and ask about any handling preference beyond the accessible-sim default.
P2-C1 starts with the 60 Hz fixed-rate stepper that replaces the P1 probe's
one-physics-step-per-frame loop in `src/app/probe-app.ts`.

## Checkpoints

| ID    | State   | Evidence                                               |
| ----- | ------- | ------------------------------------------------------ |
| P0-C1 | done    | `35d4059`; [P0 record](checkpoints/P0.md)              |
| P0-C2 | done    | `1df7e26`; [tooling evidence](checkpoints/P0.md)       |
| P0-C3 | done    | `d8f8b38`; [verification](checkpoints/P0.md)           |
| P1-C1 | done    | `2c619ed`; [P1 record](checkpoints/P1.md)              |
| P1-C2 | done    | `c4768e0`; [P1 record](checkpoints/P1.md)              |
| P1-C3 | done    | This checkpoint commit; [P1 record](checkpoints/P1.md) |
| P2–P5 | planned | [Roadmap](ROADMAP.md)                                  |

Find checkpoint commits with `git log --oneline --grep='P1-C'`.

## Verified

P1: Bun dev server and production build; static delivery at the root and under a URL
subpath; Three.js WebGL2 probe scene with a Rapier WASM world; recoverable startup
errors; 44 Bun unit tests and 24 Playwright tests (Chromium dev/prod/subpath, Firefox
smoke) through `make test`. Headless software GL only.

P0: pinned Bun/Node/GitHub CLI and native asset tools; frozen dependency install;
strict TypeScript, Oxlint, Oxfmt and local documentation links; doctor; Blender
GLB/PNG export; KTX UASTC encoding; glTF inspection. Git LFS is configured and its
authenticated GitHub endpoint responds.

## Known limits

No gameplay, hardware graphics benchmark or regulation-accurate model exists yet.
Physics currently steps once per displayed frame (P2-C1 fixes this). The production
script is 4.88 MB raw / 1.79 MB gzip, mostly Rapier's base64-inlined WASM; separate
WASM delivery awaits a hardware startup measurement. Static hosts must redirect a bare
subpath to its trailing-slash form. Blender interactive GUI was not exercised. Full LFS
object upload/download is gated before the first large assets in P4. Arch uses
Playwright's fallback builds; rerun prerequisite verification after browser updates.

The unrelated untracked `projects/text_tools.py` is preserved and must not be staged.
Repository docs remain the shared source of truth; the private knowledge base mirrors
durable findings only.
