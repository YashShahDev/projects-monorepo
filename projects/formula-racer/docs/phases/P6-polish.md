---
id: P6
title: P6 — Driving aids, views and presentation
type: phase
status: in_progress
date: 2026-09-26
updated: 2026-09-26
summary: Menus, help, bigger preview, manual gears and reverse, physics checks, more cameras, F1-style scenery, racing line and ghost.
---

# P6 — Driving aids, views and presentation

Requested by the user on 2026-09-26, after playing P5. The work lands in PR #7 (user:
"make changes in same PR"). Each checkpoint is built test-first (red → green), then
`make lint` and `make test` (Chromium only) run, and the result is committed and pushed.

## Checkpoints, in build order

Each checkpoint lists the **seams** its tests use. Tests go through these public
surfaces and nothing else. A Codex (`gpt-6-astra`) plan review shaped this version;
the findings are recorded at the end.

- **P6-C1 Manual gears and reverse (a drivetrain change, bumps `PHYSICS_VERSION`).**
  - Keys: `X` shifts up and `Z` shifts down. They are edge-triggered requests,
    applied on the next fixed step and ignored while paused or during the countdown.
    A reset returns the car to 1st.
  - Automatic (the default): the box shifts itself. `Z` at a standstill (below
    1 km/h) selects R, and `X` in R, or throttle from R when stopped, returns to 1.
  - Hybrid (user, 2026-09-26): the driver can shift at any time, and the automatic
    takes over only at the edges. It upshifts at the limiter, and it downshifts when
    engine speed falls below the downshift point, so the car never bogs down or sits
    on the limiter.
  - Manual: only the keys shift. A downshift is refused if it
    would put the engine over the redline. Each shift is followed by a
    `shiftTimeS` cooldown with drive cut. At the redline the limiter cuts drive, with
    hysteresis. Engine speed comes from road speed and there is no clutch, so there is
    no stall state.
  - The model is signed: drive force has the sign of the selected direction, and R
    has its own ratio with a speed cap of about 30 km/h. Brakes always oppose motion
    and never accelerate the car through zero. Traction control limits the magnitude
    of the force, so negative force (engine braking, reverse) is limited too. In
    reverse ERS neither deploys nor harvests. Rapier's brake-as-impulse units stay,
    and so does the rule that braking cuts drive.
  - A Pause-menu choice selects Automatic, Hybrid or Manual. The HUD shows `R`, and
    `A`, `H` or `M` next to the gear.
  - Gearing from F1 data (user asked for better numbers). Automatic upshifts where the
    next gear gives more wheel force at the same road speed, taken from the power
    curve, instead of at a fixed rpm. Downshifts happen where the lower gear would
    still land below that point. The car's gearing is retuned to published 2026
    figures: 8 speeds, 8th at about 360 km/h at 13,000 rpm (reported 2026 McLaren
    gearing); a 15,000 rpm regulation limit; racing upshifts around 12,000–12,500
    rpm, just past the power peak. Best laps are stored per gearbox mode,
    like assists.
  - Seams: `createGearbox` and `createPowertrain` (shift requests, refusals, cut and
    limiter, R only when stopped); `createVehicleSimulation` (throttle in R moves the
    car backwards and is capped; brakes stop but never reverse it; traction control
    limits negative force); `createKeyboard` actions; `DrivingSession` (shifts
    ignored while paused or counting down, and cleared by a reset).
- **P6-C2 Pause menu redesign and keyboard help.**
  - The menu gets a styled panel with sections (Driving, Assists, Aids, View, Audio),
    switch toggles, segmented choices and keycap hints.
  - A **Controls** overlay opens with `H`, or with `?` (judged by `event.key`, so
    layouts that need Shift work). It can also be opened from the menu. The overlay
    owns input while open: it pauses the session, `Esc` or `H` closes it, and focus
    goes back to where it was. Help actions never reach `session.action`, so they
    can't fall through to the camera. Its content is generated from the key-binding
    table in `keyboard.ts`.
  - Seams: browser tests on the rendered result (H opens the overlay; every bound key
    is listed; Esc closes it and focus returns; the menu controls are labelled and
    still apply); a `createKeyboard` unit test (help keys give a `help` action).
- **P6-C3 Bigger corner preview.** Enlarge the box (about 2.5× the area) and extend
  the look-ahead to about 600 m. It shows the next two corners with their numbers,
  directions and distances. The speed hint comes in C6, from the speed profile,
  because a radius alone cannot supply a speed.
  - Seams: `nextCorners(corners, length, distance, count)` and `previewPath` unit
    tests; a browser test on the rendered size and the two labels.
- **P6-C4 Two more cameras.** `C` cycles Chase → Cockpit → T-cam → Far chase.
  - T-cam sits above the airbox, derived from the cockpit anchor (raised and moved
    back).
  - Far chase is higher and further back than the chase anchor.
  - `CameraView` gains `fovDeg`, and each mode sets its own field of view.
  - Seams: `createCameraRig` (cycle order; each eye's position in the chassis frame;
    it looks along the heading; FOV per mode).
- **P6-C5 Physics and assists: characterize first, then fix.**
  - First, measure a baseline on grip 1.0 and on 0.5, from stated speeds and after a
    settling period:
    - 0–100 and 0–200 km/h;
    - 100–0 and 200–0 km/h;
    - top speed;
    - steady-state lateral g at 100 and 200 km/h;
    - left against right turns;
    - rear sideslip under throttle with and without traction control.
  - Then set numerical targets from public F1 figures, with tolerances. A test fails
    only when a target is missed. Planned bounded experiments:
    - mirror symmetry within 2%;
    - straight-line braking keeps heading within 1°;
    - ABS on low grip stops no more than 10% longer than the best locked-wheel stop
      and keeps the car steerable;
    - traction control keeps rear sideslip under a bound on low grip;
    - on a fixed path, steering assist keeps the car within the track edges at a
      speed where it would otherwise go wide;
    - cornering stays inside the grip envelope, including downforce and the adapter's
      doubled longitudinal budget.
  - Every physics fix bumps `PHYSICS_VERSION`.
  - Seams: `createVehicleSimulation` and `DrivingSession` only.
- **P6-C6 Racing line and braking guide.** Calibrated against C5's measured envelope.
  - `buildRacingLine(geometry, limits)` returns a closed, periodic lateral offset.
    Its objective is to minimise integrated **squared** curvature, with clearance of
    half the car's width plus a margin inside the kerbs. Iterations are bounded.
  - `limits` holds grip per surface, mass, the downforce and drag curves, power and
    braking force. It is taken from the car and the C5 measurements.
  - The speed profile runs forward and backward passes along the line's own arc
    length. It uses a coupled lateral/longitudinal friction ellipse with speed-based
    downforce and drag, iterated across the lap seam until stable.
  - `guideColour(state)` uses the car's speed against the profile at the car, plus
    the braking distance needed to reach the next profile minimum:
    - red means brake now;
    - yellow means lift, inside the lift window;
    - green means the profile allows acceleration.

    The ribbon is drawn a few centimetres above the road, and its vertex colours are
    updated for the stretch ahead only. The corner preview gains its speed hint here.

  - Setting: Racing line Off / Braking zones only / Full.
  - Seams:
    - the line stays inside the clearance everywhere;
    - its integrated squared curvature is below the centreline's;
    - it is continuous across the seam;
    - the profile's minimum is at the hairpin, and it falls before every corner;
    - every profile corner speed is at most the cornering speed C5 measured;
    - `guideColour` cases;
    - a browser test that the ribbon hides when the setting is Off.
- **P6-C7 Ghost and live delta.**
  - Timing contract: the session exposes lap-start and lap-finish events, with the
    lap timer's interpolated crossing times. Recording happens in the fixed step:
    `lapTimeS`, x, z, heading and progress, at 10 Hz, plus exact samples at the lap
    boundaries. Playback interpolates at the same presentation time the car is drawn
    at.
  - Progress is start-relative and unwrapped, with a first-passage rule: only a new
    maximum counts. Reversing and nearby sections of track therefore can't jump it.
  - The delta is the current lap time minus the ghost's time at the same progress.
    It is unavailable before the first ghost exists and after a reset until a new lap
    starts.
  - Storage: Float32 x/z/heading/progress plus Uint16 centiseconds. That is 18 B
    per sample, about 21.6 KB raw or 29 KB of base64 for a 120 s lap, capped at
    150 s and 1,500 samples.
    - One ghost is kept per best-lap key: track, assists, gearbox mode and physics
      version. Tuned laps are excluded, as they are from best laps.
    - Past 12 ghosts, the oldest is evicted.
    - A ghost is saved only with its best time, so the two stay consistent. The save
      happens after the frame (`setTimeout`), falling back to memory when storage
      fails.
  - "Last lap" uses the last completed lap, marked invalid when it was.
  - Setting: Ghost Off / Best / Last.
  - Seams:
    - a recorder and player (interpolation; the delta's sign; the first-passage rule
      under reversing; invalid and tuned laps never become Best; decode bound; wrong
      version ignored; identical at 30 and 60 Hz);
    - a browser test: the ghost appears on the next lap once enabled, using the test
      hook.
- **P6-C8 F1-style scenery.** Pits and a corner stand already exist. Add:
  - a garage row and a pit wall along the start straight;
  - a start gantry with lights, and overhead sponsor bridges, both kept at least
    5.5 m above the road;
  - advertising hoardings and TecPro or tyre-wall facings attached to the barriers
    (visual only; the colliders stay the barrier's);
  - debris fencing above the barriers beside the grandstands;
  - marshal posts behind the barriers;
  - more corner grandstands;
  - striped asphalt run-off.

  Each class has its own placement rule: overhead spans the road, attachments follow
  the barrier line, and free-standing items use the existing footprint check.
  Everything is batched per 250 m cell.
  - Seams:
    - `layoutScenery` (free-standing items clear the track and barriers; spans cross
      the road with clearance; attachments follow their barrier);
    - the rendered triangle count and draw calls (`createScenery`);
    - `make bench` on High with the ghost, the ribbon and far chase all enabled:
      frame and CPU percentiles, triangles, draw calls and JS heap, before and after.

- **P6-C9 Tyre marks (user, 2026-09-26).** When a tyre locks, spins or slides past a
  slip threshold, it leaves a dark mark on the surface it is on. Marks fade over a
  lap and are kept in a bounded ring buffer (about 4,000 segments), drawn as one
  batched mesh. Each lap's marks are recorded with its ghost, so replaying a saved
  lap (ghost on) shows where it slid.
  - Seams: the vehicle snapshot's per-wheel slip (locked under hard braking with ABS
    off; spinning under full throttle on low grip with traction control off; none when
    cruising); a mark recorder (threshold, segment joining, ring bound, round-trip
    with the ghost); a browser test (marks appear after a lock-up).
- **P6-C10 Three real-layout circuits (user, 2026-09-26).** They use centrelines from
  `bacinger/f1-circuits` (MIT, GeoJSON), so the layouts match the real ones:
  - a street circuit from Monaco (`mc-1929`);
  - a fast, flowing circuit from Spa-Francorchamps (`be-1925`);
  - a power circuit from Monza (`it-1922`).

  The in-game names are our own, and the dataset is credited in the docs.
  `tools/import-circuit.ts` converts latitude and longitude to metres (local
  equirectangular), resamples and smooths to the game's spacing, orients the lap in
  race direction, and places the start line. Each track gets its own width (Monaco
  narrower), active-aero zones on its main straights, and scenery suited to it:
  Monaco gets barriers close to the track with little run-off.
  - Limitation: the game's tracks are flat, so Spa's elevation (Eau Rouge) is not
    reproduced. Adding height is a larger physics and rendering change, left out of
    P6.
  - Seams: the importer (closed loop; lap length within 2% of the published length:
    Monaco 3.337 km, Spa 7.004 km, Monza 5.793 km; no self-intersection; curvature
    within what the car can turn); catalog and `?track=` load for each; the
    autopilot completes a lap of each in the session.

- **P6-C11 Night racing and a Jeddah-style street circuit (user, 2026-09-26).**
  - A track can declare `"lighting": "night"`. The scene then uses a dark sky and dim
    ambient light, and floodlight towers along the track light the road. The lights are
    baked into the road's vertex colours plus a few real lights near the car, so the
    frame cost stays bounded. The HUD is unchanged.
  - A fourth imported layout from Jeddah (`sa-2021`, 6.174 km) is a night track. It is
    fast and walled, with little run-off.
  - Seams: parsing the lighting field (day by default, unknown values rejected); the
    importer's length check for Jeddah; a browser test that the night track renders
    dark sky pixels and a lit road; `make bench` on the night track.

## Risks and decisions

- Keys: `X`, `Z` and `H`/`?` are free. `E` stays as energy mode.
- A speed profile that is optimistic makes the colours mislead, so C6 is calibrated
  on C5's measured envelope, not on the autopilot, which follows the centreline
  conservatively at 1 g.
- Scenery, ghost transparency and the ribbon all cost frame time, so they are
  measured together.
- Browser tests stay Chromium-only; the full matrix is never run (user, 2026-09-26).

## Plan review (Codex `gpt-6-astra`, 2026-09-26)

All 8 findings were folded in above:

1. C1 is a signed drivetrain change.
2. Manual shifting now has an explicit model.
3. C5 runs bounded experiments after measuring a baseline.
4. The racing line minimises squared curvature and uses the full vehicle limits.
5. The ghost has a timing and progress contract.
6. The storage arithmetic is corrected; the original said 20 KB when it was about
   48 KB.
7. The help overlay has explicit ownership, and cameras gain FOV.
8. Scenery placement classes are separated, and benchmarks cover the aids together.

## Addendum review (Codex `gpt-6-astra`, 2026-09-26)

These refine C1, C9 and C10:

- **Shift logic.** Automatic upshifts at the crossover where the next gear's power, at
  its ratio-adjusted rpm and with the force caps applied, beats the current gear's.
  When there is no crossover it falls back to the redline. Downshifts keep hysteresis
  and a cooldown. In Hybrid the driver's request takes priority, and the automatic
  never reverses a driver shift straight away; bog-prone upshifts are refused. The
  gearing is set to a 13,000 rpm redline with 8th at about 360 km/h, the reported 2026
  figure. That is not the 15,000 rpm regulation limit, which would put 8th at about
  415 km/h.
- **Tyre-mark slip model.** Rapier's `frictionSlip` is a parameter, not measured
  slip, so marks use explicit proxies:
  - lateral velocity at the contact patch;
  - the requested longitudinal force against the grip available (lock-up and
    wheelspin).

  There are guards for contact, load and low speed, plus hysteresis. Marks are sampled
  by distance, not per step, with a byte budget per ghost and preallocated GPU
  buffers. Tests cover cornering, an airborne wheel and reverse.

- **Circuit import.**
  - GeoJSON is `[longitude, latitude]`: convert to radians and project about the
    centroid with cos(latitude), with the axis handedness stated.
  - Drop the duplicate closing point, verify the direction, and pin the dataset
    revision.
  - Anchor the start/finish line geographically, then recompute distances and aero
    zones after resampling.
  - Avoid double smoothing on top of the runtime Catmull-Rom spline. Test positional
    deviation from the source as well as length.
  - Imported tracks write `public/assets/tracks/<id>.json` directly, alongside the
    arc-based generator.
  - Clearance tests run on the final runtime geometry: roads, kerbs and barriers of
    adjacent sections must not overlap, and progress must stay continuous with no
    shortcut.
  - Monaco needs explicit trackside settings (walls close to the road).
  - Measure the hairpin against the car's kinematic minimum radius (about 8.5 m,
    from a 3.4 m wheelbase and 0.38 rad of lock) before any smoothing. Raise the
    steering lock if needed rather than erasing the hairpin.
- **Licensing.** The dataset's copyright and MIT notice ship beside the derived track
  files. Names and branding make no official or F1 claims.
