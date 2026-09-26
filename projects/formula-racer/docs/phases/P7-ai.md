---
id: P7
title: P7 — Racing line, AI drivers and external control
type: phase
status: planned
date: 2026-09-27
updated: 2026-09-27
summary: Energy modes, a correct and dynamic 3D racing line, a headless control API for external software, and AI drivers at several levels.
---

# P7 — Racing line, AI drivers and external control

Requested by the user on 2026-09-27, after P6-C10:

1. More energy modes than Balanced and Harvest.
2. The racing line hugs the middle of the road. A real one uses the width, so find
   the maths and physics behind it and build that.
3. The line should be 3D, like the F1 games' line that shows how much to brake or
   accelerate. It should be dynamic, following current speed, the road ahead and the
   grip available. Start making the physics more real, and faster.
4. AI drivers at several levels, taking the best line, braking and pacing right. The
   AI should run the track to improve the line. The game should be tunable and
   controllable by external software, so machine-learning drivers can be trained on
   it later.

It lands in PR #7 like P6, after P6-C11 and the P6 phase review. Each checkpoint is
built test-first, then `make lint` and `make test` (Chromium only) run, and the
result is committed and pushed.

## What was found

- **The line is nearly the centreline.** On Harbour the median offset from the
  centre is 0.07 m, and 90% of the lap is within 0.85 m, though the car may use
  ±4.7 m. The projected Gauss–Seidel solve of summed squared curvature stops long
  before it converges: each sweep moves an offset only by its neighbours' average,
  so a corner's width-long move needs thousands of sweeps per level. That is a bug in
  P6-C6, not a modelling choice.
- **What a racing line is.** Three standard formulations, from simplest:
  - _Minimum curvature._ Choose lateral offsets `α` within the track bounds to
    minimise the summed squared curvature of the path. Linearising curvature in `α`
    turns it into a quadratic programme with box bounds, solved by iterating the
    linearisation (Braghin et al., 2008; Heilmeier et al., 2020, _Vehicle System
    Dynamics_ 58(10)). The result is outside–apex–outside through corners. It is not
    minimum time: it ignores that exits matter more than entries on power.
  - _Quasi-steady-state lap simulation_ on a g-g-v envelope. A speed profile along a
    fixed path is limited by lateral grip, `v² κ ≤ a_lat(v)`, and by combined grip on
    the friction ellipse, `(a_x/a_x,max)² + (a_y/a_y,max)² ≤ 1`. It is integrated
    forwards on power and backwards on brakes (Brayshaw and Harrison, 2005). The game
    already does a simpler version of this.
  - _Minimum time._ Kapania, Subosits and Gerdes (2016, _J. Dyn. Sys. Meas. Control_
    138(9)) alternate the two: compute the speed profile, then update the path to cut
    curvature where the car is grip-limited, weighted by time lost. This converges to
    near-optimal-control lap times at a fraction of the cost, and gives the late apex
    on corners before straights. It is also a natural way for AI runs to improve the
    line: each lap's measured grip use and time loss drive the next path update.
- **Dynamic line.** The F1 games colour the line by the car's own state: the target
  speed ahead against the current speed, recomputed each frame. Here that means a
  short-horizon speed profile from the car's current speed and position, using the
  grip actually available (surface and tyre slip), plus a rejoin path from the car's
  lateral offset back onto the line.

## Checkpoints, in build order

- **P7-C1 Energy modes.** Four driver-selectable modes, cycled with `E` and chosen in
  the menu:
  - Harvest: maximum recharge, no automatic deployment;
  - Balanced: as now;
  - Attack: deploys more of the permitted power, and harvests only under braking;
  - Qualifying: deploys all permitted power without request until the battery's lap
    allowance is spent.

  Each mode is a row of data in `energy-rules` (deploy share, harvest power, when each
  applies), not a branch in the code.
  - Seams: the energy model (per-mode charge over a scripted lap: Harvest ends a lap
    with the most charge and Qualifying with the least, and none breaks the per-lap
    limits); key cycling order; menu and preference; HUD label.

- **P7-C2 A minimum-curvature line that converges.** Replace the sweep solver with the
  linearised QP. The tridiagonal-plus-corners system for a closed loop is solved
  directly per iteration, with bounds enforced by an active set. Then re-derive the
  speed profile on the friction ellipse with downforce (g-g-v), rather than lateral
  grip alone.
  - Seams: on a 90° corner of a wide test track, the line is at the outside edge
    before and after the corner and at the inside edge at the apex; its summed
    squared curvature is within 1% of a brute-force reference on a small track; no
    point leaves the bounds; the estimated lap time beats the centreline's on every
    shipped track; the build stays under 200 ms on Ardennes (7 km).
- **P7-C3 Minimum-time refinement.** Kapania's two-step iteration on top of C2.
  - Seams: the estimated lap time never rises between iterations, and falls on every
    shipped track; corners before long straights apex later than on the
    minimum-curvature line.
- **P7-C4 A 3D, dynamic racing line.** A raised ribbon with chevrons, coloured by the
  pedal each point needs _from the car's current state_: green gradient for throttle,
  yellow for lift or coast, red gradient for brake. Intensity shows how hard. Each
  frame:
  - a short forward profile from the current speed over the next 300 m;
  - the grip available now, lowered on grass, gravel or while a tyre slides;
  - a rejoin curve from the car's lateral offset to the line within 60–120 m, longer
    at speed.

  It stays within the frame budget on the loaded bench.
  - Seams: `guidance(state, line)` is pure. Its tests: faster than target shows brake
    earlier and harder; on grass it shows brake sooner; off the line it bends back to
    it; the colour ramps with the needed pedal. Browser: the ribbon has height and
    chevrons. Bench: loaded High before and after.

- **P7-C5 Faster, headless simulation.** The session already runs without a browser.
  This checkpoint measures and raises headless throughput for AI training. Profile
  first (`bun --cpu-prof`), then fix what the profile shows. Known candidates:
  - `snapshot()` is recomputed many times per step;
  - the mark recorder reads Rapier per wheel.
  - Record simulated seconds per wall-clock second on Harbour, before and after.
  - Physics fidelity (a slip-based tyre model in place of Rapier's friction) gets a
    written decision record here: what it would change, what it costs, and whether
    to do it. It is not built in P7 unless the record says so and the user agrees.
- **P7-C6 External control API.** A stable, documented interface so outside software
  (scripts, reinforcement-learning trainers) can drive the car:
  - **Headless:** `tools/sim-server.ts`, JSON lines over stdin/stdout, in the shape
    of a Gym environment:
    - `reset {track, seed, assists, gearbox}` returns an observation;
    - `step {throttle, brake, steer, shift?, steps}` returns an observation, events
      (sector, lap, off-track, reset) and `done`;
    - `close`.
  - **In the browser:** the same messages through `window.formulaRacer.control`,
    enabled by `?control`.
  - **Observation:** pose; velocity; yaw rate; gear and rpm; per-wheel slip and
    surface; track-relative distance, lateral offset and heading error; curvature and
    width for the next N samples; lap and sector times; energy.
  - Versioned (`controlVersion`) and deterministic for a given seed and action
    sequence.
  - Seams: same actions give the same observations twice; a scripted client completes
    a lap through the server; malformed messages get an error reply rather than a
    crash; the docs' example client runs in the tests.
- **P7-C7 AI drivers with levels.** A driver built on the same control API as outside
  software. It follows the line with a lookahead steering controller (pure pursuit or
  Stanley) and tracks the speed profile with feed-forward plus feedback pedals.
  Levels are named parameter sets:
  - grip use;
  - braking-point and apex error (seeded noise);
  - reaction delay;
  - line-tracking gain;
  - throttle smoothness.

  Levels are, for example, Rookie, Club, Pro and Ace.
  - Seams: on every shipped track, each level completes clean laps, and a higher level
    is never slower than a lower one over 3 laps (fixed seeds); Ace within an agreed
    margin of the line's estimated lap time; the player can hand the car to the AI and
    take it back.

- **P7-C8 AI runs improve the line.** A tool that drives laps with the Ace driver,
  measures where it used less or more grip than planned, and feeds that into C3's
  path and speed updates. It writes the improved line per track as data, which the
  game loads.
  - Seams: each saved line's measured lap time is no slower than the one it replaced;
    the tool is deterministic for a seed.
- **P7-C9 AI opponents.** AI cars on track at chosen levels. Each runs its own vehicle
  simulation; they do not collide with the player or each other in P7 (collisions
  need a shared physics world, a larger change). They are drawn like the ghost but
  opaque, with a race start from a grid and positions shown.
  - Seams: grid order and start; positions from progress; the frame budget holds with
    three opponents on the loaded bench.

## Open questions for the user

- Whether AI opponents should collide in a later phase.
- Whether to build the slip-based tyre model after C5's decision record.
