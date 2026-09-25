---
id: SETUP
title: Local setup and verification
type: guide
status: active
date: 2026-09-26
updated: 2026-09-26
summary: Pinned tools, install steps and checks for the Linux reference machine.
---

# Local setup and verification

Toolchain installation is in progress during P0. This guide will be completed with
verified versions and exact reproduction commands at P0-C2/P0-C3.

Bun and Node are installed through mise without replacing global defaults. Blender,
KTX and Git LFS use checksum-verified user-local archives where possible. Playwright
browser revisions come from the pinned package. No Go or Rust toolchain is needed.

Distinguish executable presence, successful verification and application integration:
P0 verifies prerequisites; P1 verifies Bun/Three.js/Rapier together in the browser.
