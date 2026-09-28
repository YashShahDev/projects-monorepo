---
id: P8
title: P8 — A 3D track, richer surroundings and a detailed car
type: phase
status: planned
date: 2026-09-28
updated: 2026-09-28
summary: Raised kerbs and a road with real edges, textured surfaces, shadows and a sky, fuller trackside, and a detailed car with a driver in a helmet, within the measured frame budget.
---

# P8 — A 3D track, richer surroundings and a detailed car

Requested by the user on 2026-09-28, after P7:

> Today we have the kerbs and track as 2D flat. Let's make this 3D. Given we have more
> compute room, we can start adding and improving the surrounding graphics, and the car
> graphic as well: more detailed, more things. The driver is seen, and the helmet and
> all.

It lands in PR #7 like P6 and P7. Each checkpoint is built test-first. Then
`make lint` and `make test` (Chromium only) run, and the result is committed and
pushed.

## What was found

- **Everything on the ground is a flat ribbon.** `track-view.ts` draws the road and
  both kerbs as three vertex-coloured strips 0–5 mm apart, ordered with polygon offset
  because they z-fought in headless SwiftShader. The start line is a plane. There are
  no road edges, no painted lines other than the start, and no grid boxes, though the
  race now uses grid slots.
- **The world is untextured.** Every surface is a flat vertex colour: road, grass,
  runoff, stands and buildings. There are no shadows at all, and the sky is a clear
  colour.
- **The trackside is boxes.** `scenery-view.ts` merges boxes into batches per 250 m
  cell: barriers, TecPro, fences, marshal posts, stands, pits and a control tower,
  floodlights, and cone-and-trunk trees.
- **The car has a helmet but no driver.** `assets/blender/fr26_car.py` (572 lines)
  builds the FR26 in Blender 4.5: body, wheels, flaps and LODs. It already has a small
  helmet, a halo, mirrors and wishbones, all joined into the body mesh, so none of
  them moves. There are no shoulders, arms, gloves or steering wheel.
  `make assets-verify` checks that the committed GLB rebuilds the same. The opponents
  are a single flat colour.
- **There is CPU headroom; GPU headroom is unknown.** The P5 bench on High holds a
  locked 60 Hz, with 46 draw calls, 39.3k triangles, and a render CPU p95 of 1.1 ms.
  The loaded bench with three Ace opponents keeps a frame p95 of 16.7 ms and 0 frames
  over budget (P7-C9). A locked 60 Hz shows only that the GPU keeps up, not how much
  it has spare. So C0 measures GPU time before anything is added, and the budget is
  PERF-001 (60 Hz, p95 ≤ 16.7 ms, 0 missed) on every preset.
- **Wheels don't read a height.** Rapier's raycast vehicle finds contacts against
  colliders, and the ground is one flat cuboid. Kerbs you can feel need kerb
  colliders.

## Decisions

- **Kerbs you can feel are proven before they are drawn.** Raising the kerbs only in
  the picture would bury a wheel 4–8 cm into a kerb it drives over. So C1 prototypes
  kerb colliders, built from one profile function and streamed near each car like
  the barriers, and C2 draws that same profile. C1 changes lap times, so it bumps the
  physics version (best laps are kept per version) and re-tunes the saved lines, as P7
  did for the energy caps.
- **Procedural, not downloaded.** Textures (asphalt grain, grass, gravel, painted
  lines, sponsor boards) are generated from a seed, like the rest of the content.
  There are no third-party asset licences and nothing unreviewable in the repository.
  They are generated at runtime only if the cold start stays within 50 ms more than
  today; otherwise a build tool writes them, and a check proves they rebuild the same.
  Car detail stays in `fr26_car.py`, so `assets-verify` still proves a byte-identical
  rebuild.
- **Budgets come before modelling.** C0 sets caps for the whole visible scene per
  preset, not per car: triangles, shadow-pass triangles, draw calls and texture
  memory. Four cars, with shadows, multiply every per-car figure. LOD switches by
  distance, with hysteresis, and cars share geometry and textures.
- **Pixel tests compare with and without.** A feature's test captures the same
  frame with it on and off, from a fixed camera and over a masked region. Colour
  classifiers alone can pass for unrelated reasons once surfaces have texture.
  SwiftShader checks correctness; the hardware bench checks speed.
- **Every addition has a preset.** Low stays close to today: no shadows, fewer
  props. Medium and High add shadows, textures and props. The car's finest LOD is
  shown only near the camera.
- **One GLB for every car.** Opponents use the full car model with their own liveries
  and helmets, not flat colours, at the LOD their distance calls for.

## Checkpoints, in build order

- **C0 — Baseline and budgets.** Run the loaded bench on every preset now, adding GPU
  time where `EXT_disjoint_timer_query_webgl2` is available, and include a high-DPI
  buffer and Corniche at night (the worst case). Record the caps above.
- **C1 — Kerbs you feel.** Kerbs stop being one strip around the whole lap. A kerb
  plan places separate kerbs where the corners call for them: on the inside at the
  apex, and on the outside at entry and exit. Straights get none, and there are gaps
  between kerbs. Kerbs vary around the lap in type (a flat ramp; a raised, stepped
  kerb; a sausage on some exits), length and width. The plan comes from the track's
  corners, with optional overrides in the track data. Where there is no kerb, the
  strip is grass or painted asphalt runoff, so grip and sound follow the real layout.
  Kerb colliders come from one profile function per type, streamed near every car:
  the player, opponents and headless runs.
  - Tests: the kerb plan (kerbs only in corner zones, gaps between them, more than one
    type per track, deterministic, no kerb across the start line). A wheel on a kerb
    rests at the kerb's height. Crossings at 50, 150 and
    250 km/h and at 5°, 20° and 45°, under braking and in reverse, stay stable, with
    no launch and no chassis contact. A landing on a kerb recontacts cleanly, and a
    reset clears the colliders. The sim-speed and loaded-bench simulation p95 are
    recorded. The lines are re-tuned last.
- **C2 — A 3D road and kerbs.** The road becomes a slab with a visible edge
  (5–10 cm), and there are white edge lines. Each kerb from C1 is drawn as a solid
  with its profile, with red and white blocks, a lit top and side faces, and ends that
  ramp down. The gaps between kerbs show. There is a grass verge, painted grid boxes
  at the race's slots, and a raised start line. The mesh uses the collider's
  profile. Painted markings stay flush with polygon offset,
  because the separate layers z-fought in SwiftShader even 2 cm apart. The slab,
  grass and runoff heights are defined together.
  - Tests: profile geometry (heights, normals up, no seam at the lap wrap, meets the
    road without a gap), and track data validation. A paired capture shows the kerb's
    side face from the chase camera, and the Test Loop still draws a road (the
    SwiftShader regression).
- **C3 — Surfaces.** Textured materials, generated once at startup and mipmapped:
  - asphalt with grain and a darker rubbered racing line, taken from the saved line;
  - mown grass stripes, gravel and runoff paint;
  - kerb paint with wear.

  Low keeps vertex colours.
  - Tests: textures are deterministic from a seed; a pixel test of the road's
    variance against flat colour; the bench on each preset.

- **C4 — Light and sky.** One bounded shadow light first: a sun shadow whose frustum
  follows the car, prototyped and measured before more. Then Medium (cars only) and
  High (cars and nearby trackside), with a blob shadow on Low. Night floodlights
  are meshes, and the night road is unlit `MeshBasicMaterial`, so night gets its own
  decision after the day is measured. A sky dome with a gradient and clouds.
  An environment map, so paint and visor reflect the sky. Night keeps its
  floodlights, with shadows on High.
  - Tests: a paired capture (shadows on and off) darkens the masked road under the
    car on Medium and High only; the bench on each preset.
- **C5 — The trackside.** Proper 3D props, instanced:
  - a start gantry whose lights follow the countdown;
  - tyre walls, and catch fencing with posts and mesh;
  - marshal posts with flags, and billboards with generated sponsor art;
  - crowds in the stands as instanced impostors;
  - better trees (two or three species, instanced);
  - pit garages with open doors.

  Each has a preset gate and stays within cells.
  - Tests: the gantry lights match `countdownS`; layout unit tests (clearances, no
    prop on the road); draw calls and triangles per preset recorded.

- **C6 — The car, detailed.** First, check in the cockpit and chase cameras why the
  existing helmet barely shows. Then, in `fr26_car.py`:
  - a driver: shoulders, arms, gloves, HANS, and a bigger helmet with a visor, in
    livery colours;
  - separate nodes, with their own pivots, for parts that move: the helmet (it leans
    with lateral g) and a steering wheel (it turns with steer);
  - the halo fairing, push rods, bargeboard and endplate detail, rims with spokes, and
    tyre sidewall markings.

  Each part is at three LODs, within the C0 caps. The model interface and
  `validate-car-model.ts` gain the new nodes. The build keeps its seed, CPU and tool
  version pinned, and `assets-verify` still proves a byte-identical rebuild.
  - Tests: interface nodes exist; the head's lean and the wheel's turn follow the
    snapshot; the triangle count per LOD is within budget; a cockpit-camera screenshot
    shows the steering wheel and gloves.

- **C7 — Opponents in full.** Opponents use the real model with their own liveries
  and helmets, with LOD by distance. The flat-colour copy remains the ghost only.
  - Tests: each opponent has a distinct livery; LOD switches with distance; the loaded
    bench with three opponents on High.
- **C8 — Performance and phase review.** Run the bench on every preset (loaded and
  unloaded), record the numbers, and fix what misses the budget. Codex reviews the
  phase (or Antigravity if Codex is out), and every finding gets a test.

## Plan review

Codex (`codex exec`, the user's default model) reviewed this plan on 2026-09-28. Its
findings are taken in above:

- Kerb physics needs colliders, and needs testing at many speeds and angles.
- Layers must stay polygon-offset.
- GPU headroom must be measured, not inferred.
- Shadows and night need bounding.
- Pixel tests must be paired.
- Texture generation needs a startup budget.
- The car already had a helmet, halo, mirrors and wishbones.
- Budgets must be for the whole scene.

## User decisions

- **Kerbs** (2026-09-28): realistic heights, not overdone, but clearly 3D, with light
  and shadow. Separate kerbs with gaps between them, varying around the track. The
  plan uses 25–50 mm for flat and stepped kerbs and up to 75 mm for sausages, with
  side faces lit and shadowed (C2, C4).

## Open questions for the user

- **Rubbered line:** C3 darkens the road along the saved racing line. With the
  racing line guide off, that still hints at the line. Keep it, or make it follow the
  guide setting?
