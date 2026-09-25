---
id: ADR-001
title: Use Bun for the browser toolchain
type: decision
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Bun owns package management, bundling and unit tests; TypeScript and Playwright remain explicit.
---

# Use Bun for the browser toolchain

## Decision

Use pinned Bun with a committed lockfile. `Bun.build` takes an HTML browser entrypoint,
minifies and splits production assets. A TypeScript dev server uses Bun HTML support.
`tsc --noEmit` checks types independently. Bun tests exercise non-DOM logic; Playwright
uses Node LTS for supported CLI execution. Keep tool and browser TypeScript environments
separate when browser code arrives. Hosting is static.

## Alternatives and consequences

Vite is mature but adds a second bundling layer the user asked to avoid; revisit only
if the P1 integration probe establishes a concrete Bun limitation. React is unnecessary
for the initial UI and must not own per-frame state. Go/HTMX suits later server pages,
not the simulation/render loop. No runtime server is needed initially.

Bun's bundler does not type-check. WASM/GLB/decoder URL handling and subpath deployment
must pass P1 tests before declaring the browser pipeline ready. Start with Rapier's
compatibility package to reduce bundler-specific WASM loading setup, then measure
its embedded WASM transfer/startup cost before choosing separate WASM delivery.

Evidence: [RES-001](../research/RES-001-toolchain.md). Applies to [P1](../phases/P1-technical.md).
