---
id: DOC-INDEX
title: Documentation index
type: index
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Entry point for plans, decisions, research and handoffs.
---

# Documentation index

Read [STATUS](STATUS.md) first when resuming.

- [Roadmap](ROADMAP.md): scope, phases and checkpoint IDs.
- [Workflow](WORKFLOW.md): state transitions, commits and multi-agent handoffs.
- [Setup](SETUP.md): tools, installation and verification.
- [Architecture](ARCHITECTURE.md): interfaces, data flow and folder responsibilities.
- [Phase 0](phases/P0-foundation.md), [Phase 1](phases/P1-technical.md),
  [Phase 2](phases/P2-driving.md), [Phase 3](phases/P3-time-trial.md),
  [Phase 4](phases/P4-content.md), [Phase 5](phases/P5-release.md).
- [P0 checkpoint record](checkpoints/P0.md).
- [Checkpoint template](checkpoints/TEMPLATE.md).
- [ADR-001 Bun browser toolchain](decisions/ADR-001-bun-toolchain.md).
- [ADR-002 WASM and simulation boundary](decisions/ADR-002-physics-boundary.md).
- [ADR-003 Repository knowledge and checkpoint protocol](decisions/ADR-003-checkpoints.md).
- [RES-001 Toolchain sources](research/RES-001-toolchain.md).
- [RES-002 2026 energy rules](research/RES-002-energy-rules.md).
- [Performance protocol](performance/PROTOCOL.md).

Use relative Markdown links, stable IDs and YAML frontmatter (id, title, type,
status, date, updated, summary). Link decisions to evidence and dependent phases.
Add new records here. Supersede decisions with a new linked record rather than
rewriting history. Research records can be corrected in place with an updated date.
