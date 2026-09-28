---
id: RES-001
title: Toolchain and WASM research
type: research
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: Primary references for Bun, Rapier, Blender, browser testing and asset tools.
---

# Toolchain and WASM research

Retrieved 2026-09-26. Version pins live in setup/configuration; these pages may change.

| Source                                                                                                                           | Relevant finding                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Bun HTML bundling](https://bun.sh/docs/bundler/html-static)                                                                     | HTML can be the bundler entrypoint; scripts/styles are processed together.                   |
| [Bun build API](https://bun.sh/docs/bundler)                                                                                     | Browser targeting, splitting and production output are supported.                            |
| [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) / [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)                  | User-selected lint/format tools; type checking remains explicit.                             |
| [Bun installation](https://bun.sh/docs/installation)                                                                             | Pin versions rather than silently upgrading the toolchain.                                   |
| [Rapier getting started](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)                                      | Official JS packages expose the WASM engine; compat packaging simplifies initialization.     |
| [Raycast vehicle API](https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html)                               | Initial suspension, steering, braking and traction controls exist.                           |
| [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)                                                      | Initial graphics backend is WebGL2.                                                          |
| [Blender glTF export](https://docs.blender.org/manual/en/4.5/addons/import_export/scene_gltf2.html)                              | Author supported materials and bake procedural surface details for export.                   |
| [Blender LTS downloads](https://download.blender.org/release/Blender4.5/)                                                        | Official archives and SHA256 files allow pinned portable installation.                       |
| [Playwright browsers](https://playwright.dev/docs/browsers)                                                                      | Browser builds must match the Playwright package.                                            |
| [Playwright requirements](https://playwright.dev/docs/intro)                                                                     | Arch is outside listed supported Linux distributions; verify native libraries empirically.   |
| [Chromium headless GPU](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md) | Headless GPU selection differs; functional success is not a hardware benchmark.              |
| [glTF Transform CLI](https://gltf-transform.dev/cli)                                                                             | Asset optimization and texture processing tools.                                             |
| [KTX releases](https://github.com/KhronosGroup/KTX-Software/releases)                                                            | Native texture encoder distribution.                                                         |
| [Git LFS](https://git-lfs.com/)                                                                                                  | Large sources use pointers and separate storage; verify server transfer before content work. |

## Interpretation and unresolved measurements

WASM boundary overhead depends on calls/data; do not promise an FPS gain. A retained
world avoids application-level whole-world serialization. P1 proves Bun/WASM/browser
compatibility; P2/P5 measure real workloads. No benchmark was performed during research.

Linked decisions: [ADR-001](../decisions/ADR-001-bun-toolchain.md),
[ADR-002](../decisions/ADR-002-physics-boundary.md).
