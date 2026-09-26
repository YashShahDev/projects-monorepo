---
id: ARCHITECTURE
title: Architecture and content boundaries
type: design
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Browser rendering, simulation, content and tooling responsibilities.
---

# Architecture and content boundaries

## Runtime

Input adapters produce normalized controls. A fixed 60 Hz accumulator advances the
simulation, limiting catch-up after stalls. The renderer interpolates completed
snapshots. Pause on focus loss and clear pressed keys. Game session state owns lap
validity, checkpoints and persistence; the HUD samples telemetry independently.

Bun is build/development tooling; the browser executes bundled JavaScript, not Bun.
Three.js WebGL2 is the initial renderer. HTML/CSS/TypeScript provides menus and HUD.
No React, HTMX or backend is needed for this release. Go can support later online
services without entering the rendering loop.

## Interfaces to introduce in P1/P2

- `VehicleSimulation`: step controls at a fixed dt, reset and read snapshots.
  Rapier body handles stay internal; consumers see transforms and telemetry.
- `CarDefinition`, `TeamDefinition`, `TrackDefinition`, `EnergyRules`: typed,
  validated content loaded at boundaries. SI units; dated physics/rules versions.
- Separate grip/suspension, aero, powertrain/energy and assist calculations so
  higher-fidelity models can replace initial behavior without rewriting the HUD.

Start with Rapier raycast wheels and a rigid chassis. Add speed-squared drag and
downforce, configurable aero balance, automatic gears and assisted steering/braking.
Physics changes need repeatable input scenarios and meaningful behavior tests.
See [ADR-002](decisions/ADR-002-physics-boundary.md).

## Intended folders

`src/app`: boot and lifecycle; `game`: laps/session; `simulation`: physics, aero,
powertrain; `rendering`: scene/cameras/lighting/quality; `input`: controls;
`ui`: menus/HUD/errors; `content`: definitions/validation/loading; `telemetry`:
recordings/timings/dev tools. Add folders only when they contain implementation.

`content/` holds definitions. `assets/` holds Blender and source textures.
`public/assets/` holds optimized GLB/textures/decoders. `tools/` contains project
TypeScript and Blender Python utilities. `tests/` grows unit, integration, browser
and scenario suites. No imports cross project boundaries.

## Asset and distribution pipeline

Blender source → named nodes, baked PBR textures and low-detail meshes → glTF
optimization/KTX compression → runtime assets → Bun static distribution.
Use meters and document axis conversion. Wheels, wings and cameras need stable
anchors. Collision geometry is separate from visible detail. Asset validation
checks nodes, bounds, texture references and budgets. Load only selected content.

Production uses browser-target bundles and local assets. Test deployment below a
URL subpath in P1. Exclude test hooks and tooling from production. Handle WebGL2
absence, WASM failures and missing content with clear recoverable UI.
