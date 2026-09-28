---
id: ADR-004
title: Keep the friction-circle tyre on Rapier's vehicle controller for P7
type: decision
status: accepted
date: 2026-09-27
updated: 2026-09-27
summary: A slip-based tyre model is not built in P7; it needs its own vehicle and its own phase.
---

# Keep the friction-circle tyre on Rapier's vehicle controller for P7

## Context

The car rides on Rapier's raycast vehicle controller. Its lateral tyre force comes from
Rapier's side-friction solve, capped by a friction slip per wheel. On top of that, the
car enforces a true friction circle per tyre: it caps each wheel's lengthways force by
the grip the cornering force leaves (`tyreBudgetN`), and shrinks Rapier's circle to
match (`frictionSlipFor`). A tyre asked for too much locks or spins and carries 75% of
its grip while sliding. The P6-C5 audit tuned this model to measured targets: 1.84 g
steady cornering at 100 km/h, 3.24 g at 200, and braking and traction figures
(`tools/characterize.ts`).

P7 asked for a decision on a slip-based model (a Pacejka or brush tyre, where force
follows slip angle and slip ratio) before AI training starts on the simulation.

## What a slip-based model would change

- Force would rise with slip up to a peak and fall past it, instead of Rapier's
  constraint-like grip up to a cap. Understeer and oversteer would come from the
  tyres' slip curves and load transfer, not from assists and caps. Combined slip would
  be a property of the model rather than something enforced outside it.
- Wheel spin would be a state (angular speed per wheel) that the model integrates.
  Locking and wheelspin would then emerge rather than being switched on at a threshold.
- The driving feel, every tuned envelope, and so every stored best lap and ghost would
  change (a new physics version).

## What it would cost

- Rapier's controller computes the lateral impulse itself and cannot take an external
  tyre law. A slip model means writing our own vehicle: suspension raycasts
  (`castRay`), the wheel-spin integration, and forces applied at contact points.
  That is a rewrite of `vehicle.ts`'s core, not a swap.
- Tyre forces are stiff at low speed. At our 60 Hz step, a slip model needs sub-steps
  (typically 4–8 per step) or a low-speed blend to stay stable. That costs headless
  throughput, which C5 just raised from 75× to about 560× real time on Harbour. A
  4× sub-step on the tyre part would give much of that back.
- P6-C5's property tests and the circuits' autopilot laps would all need retuning.

## Decision

Do not build it in P7. The AI levels, the external control API and the line learning in
P7 need a fast, deterministic and stable car more than a sim-grade one. The current
model gives the behaviours they depend on: grip that grows with downforce, a friction
circle, locking and wheelspin, and surface grip.

If sim-grade handling becomes a goal, it gets its own phase:

- start from `tools/characterize.ts` as the acceptance harness, with the current
  figures as the baseline;
- build our own raycast vehicle behind the existing `VehicleSimulation` interface, so
  the session, the AI and the renderer do not change;
- measure headless throughput before and after with `make sim-speed`.

It needs the user's agreement first.

## Consequences

The P7 AI learns on the current model. Lap times and lines it finds are specific to it,
and would need re-learning after a tyre-model change. That costs only compute, since
the line and levels are rebuilt from the car's limits.
