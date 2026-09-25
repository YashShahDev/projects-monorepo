---
id: P4
title: P4 — Blender content and presentation
type: phase
status: planned
date: 2026-09-26
updated: 2026-09-26
summary: Add the detailed original car and circuit through a reproducible asset pipeline.
---

# P4 — Blender content and presentation

Prerequisite: P3 done; verify LFS endpoint with a small source asset upload/download
before large binaries. Read architecture and RES-001. Asset and UI tasks can use
independent worktrees when parallel work is authorized.

- P4-C1: Blender car source, reproducible Python export, named wheel/wing/camera
  anchors, collision geometry and LODs; baked normal/AO textures and asset validation.
- P4-C2: three fictional equal-performance liveries and one original circuit with
  slow/fast corners, straight, kerbs/runoff; a second small map fixture tests loading.
- P4-C3: chase/cockpit cameras, animated wings/wheels, basic engine/tire/kerb audio,
  menu/HUD polish and low/medium/high graphics settings.

Gate: repeatable exports, correct scale/pivots/materials, required-node checks,
missing-texture failures, fixed-camera screenshots and browser loading tests pass.
No copyrighted team branding is required. Track transfer/triangle/material budgets
and tune against actual rendering measurements.

Before starting: present the visual direction, circuit layout and car proportions;
ask for unresolved aesthetic choices before detailed modeling. Agree interface node
names before splitting Blender and UI/rendering work.
