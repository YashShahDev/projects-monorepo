---
id: P0
title: P0 — Documentation and prerequisites
type: phase
status: planned
date: 2026-09-26
updated: 2026-09-26
summary: Create a resumable project and verify the toolchain without implementing gameplay.
---

# P0 — Documentation and prerequisites

**Session boundary:** finish this phase, then hand off before P1.

- P0-C1: scaffold through the root Makefile; write agent protocol, architecture,
  research, ADRs, roadmap and checkpoint records; open one draft PR after commit.
- P0-C2: pin Bun/Node/dependencies, commit lockfile, implement diagnostic/setup checks
  with tests, add strict TypeScript and lint configuration.
- P0-C3: verify tools and browser executables, background Blender export prerequisites,
  native texture encoder and Git LFS; record precise results and next action.

Gate: required Make targets work; lint and setup-tool tests pass; build honestly states
there is no browser entrypoint. Installed, verified and deferred capabilities are
separate. No Three.js scene or browser game smoke test until P1.

Clarifications: user chose main checkout, one draft PR and questions only for material
unresolved decisions. Use portable user-local tools where possible. No remaining
product decision blocks P0.
