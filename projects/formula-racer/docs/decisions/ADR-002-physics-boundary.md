---
id: ADR-002
title: Keep the physics world in WASM behind a TypeScript adapter
type: decision
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Use Rapier without whole-world serialization or worker messaging per tick.
---

# Keep the physics world in WASM behind a TypeScript adapter

## Decision

Rapier owns persistent world memory in WASM. TypeScript computes controls and initial
vehicle/aero/energy behavior, sends forces and reads only required body/wheel poses.
Initialize once, release resources on teardown, and avoid taking world snapshots in
the hot path. This is not JSON serialization of a world every frame.

Bindings still cost time: calls cross the JS/WASM boundary and may marshal values or
allocate returned objects. Cache reads within a tick and reuse JS-side scratch storage
where APIs allow. Profile the whole step, not just the internal solver.

Run 60 Hz physics on the main thread initially. WASM is not automatically a worker or
parallel execution. A worker introduces message copies/transfer ownership and timing
complexity; shared memory adds deployment constraints. Add either only with measured
benefit. No custom Rust compiler is required to use the published package.

## Alternatives and consequences

A custom TypeScript-only solver is plausible for a small car count, but increases
collision/constraint implementation work. Rapier gives a maintained starting point;
we make no unmeasured speed claim. GPU-heavy rendering can remain the FPS bottleneck
regardless of solver language. The adapter allows future tire and suspension changes.

Evidence: [RES-001](../research/RES-001-toolchain.md). Validation:
[performance protocol](../performance/PROTOCOL.md), [P2](../phases/P2-driving.md).
