---
id: CONTROL
title: External control API
type: design
status: accepted
date: 2026-09-27
updated: 2026-09-27
summary: Drive the car from outside software, headless over stdin/stdout or in the page with ?control.
---

# External control API

Outside software (scripts, reinforcement-learning trainers) drives the car with three
messages in the shape of a Gym environment: `reset`, `step` and `close`. The same
messages work in two places:

- **Headless:** `bun run tools/sim-server.ts` reads one JSON message per line on stdin
  and writes one reply per line on stdout, in order. It runs at several hundred times
  real time (`make sim-speed`).
- **In the browser:** open the game with `?control` (for example
  `/?track=harbour&control`). The page then offers
  `await window.formulaRacer.control.send(message)`, which returns the same replies.
  While outside software has the car, the keyboard does not drive it. After `close`,
  the keyboard drives again. The page can only drive the track it loaded.

Every reply carries `controlVersion` (now 1). It changes whenever a message,
observation or event changes shape or meaning.

A minimal client that drives a lap is [examples/control-client.ts](../examples/control-client.ts).
The tests run it on every `make test`.

## Messages

`reset` starts an episode, and every field is optional:

```json
{
  "type": "reset",
  "track": "harbour",
  "seed": 1,
  "assists": { "abs": false },
  "gearbox": "automatic",
  "energyMode": "balanced",
  "maxLaps": 1,
  "maxSeconds": 600
}
```

- `track` is a catalog id: `harbour`, `riviera`, `ardennes`, `royal-park`,
  `corniche` or `test-loop`. The default is the first, `harbour`.
- `assists` turns off any of `steering`, `abs` and `traction` (all on by default).
- `gearbox` is `automatic`, `hybrid` or `manual`. `energyMode` is `harvest`,
  `balanced`, `attack` or `qualifying`.
- The episode ends (`done: true`) after `maxLaps` laps (1–100) or `maxSeconds`
  simulated seconds (1–7200).
- The simulation has no randomness. `seed` (a whole number) is echoed in every reply
  of the episode, for clients and for the AI drivers' own noise.

The reply comes at the green light. The standing-start countdown has already run, so
the lap is being timed from 0.

`step` drives for `steps` simulation steps of 1/60 s (1–600, default 1) with the same
controls:

```json
{ "type": "step", "throttle": 1, "brake": 0, "steer": -0.2, "deploy": false, "shift": "up", "steps": 4 }
```

- `throttle` and `brake` run from 0 to 1. `steer` runs from −1 (full left) to +1
  (full right). All three are required.
- `deploy` asks for full ERS deployment (like holding Shift).
- `shift` (`"up"` or `"down"`) is one gear change, made on the first step.

`close` ends the environment. The server replies `{ "type": "closed" }` and exits.

## Replies

```json
{ "type": "observation", "controlVersion": 1, "seed": 1,
  "observation": { ... }, "events": [ ... ], "done": false }
```

A malformed or out-of-order message gets an error reply, and the episode carries on:

```json
{ "type": "error", "controlVersion": 1, "error": "throttle must be a number from 0 to 1, got 2" }
```

Out-of-order messages are a step before any reset, a step after `done`, or anything
after `close`.

### Observation

| Field                         | Meaning                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `simSeconds`                  | Time since this episode's green light                                                                                                                                    |
| `position`, `rotation`        | World pose, metres and a quaternion; y is up                                                                                                                             |
| `yawRad`                      | Heading about +y; 0 faces +z, positive turns toward +x                                                                                                                   |
| `velocity`, `speedMps`        | World velocity; speed along the chassis (negative in reverse)                                                                                                            |
| `yawRateRadS`                 | Rotation rate about +y                                                                                                                                                   |
| `gear`, `rpm`                 | Gear (−1 is reverse) and engine speed                                                                                                                                    |
| `wheels[4]`                   | FL, FR, RL, RR: `inContact`, `slip` (none, locked, spinning, sliding) and `surface` (road, kerb, grass, gravel, asphalt)                                                 |
| `track.distanceM`             | Along the centreline from the start line                                                                                                                                 |
| `track.lateralM`              | From the centreline; positive is left                                                                                                                                    |
| `track.headingErrorRad`       | Car heading less the track's; positive points left of it                                                                                                                 |
| `track.halfWidthM`, `lengthM` | Road half-width and lap length                                                                                                                                           |
| `track.ahead`                 | 32 samples, `spacingM` (10 m) apart from the car: `curvature` (1/m, positive turns left), and `leftBarrierM` and `rightBarrierM` (distance from the centreline, or null) |
| `lap`                         | `completed` laps; the running lap's `elapsedS`, `sector` and `valid`; `lastLapS` and `bestLapS` (valid laps)                                                             |
| `energy`                      | `mode`, `socJ` (battery), `deployW` and `regenW`                                                                                                                         |

### Events

Each step reply lists what happened during its steps, in order:

- `{ "type": "sector", "sector": 2, "elapsedS": 31.2 }`: the car entered a sector.
- `{ "type": "lap", "timeS": 108.4, "valid": true, "sectorsS": [...] }`: a lap was
  completed.
- `{ "type": "offTrack" }` and `{ "type": "backOnTrack" }`: all four tyres left the
  road and kerbs, and later came back.
- `{ "type": "reset" }` comes in the reset reply.

## Determinism

Headless, each reset builds a fresh simulation. The same reset message and the same
step messages give the same replies, bit for bit, on the same build and machine. In the
browser, a reset restarts the page's session instead, so its episodes are consistent
with each other but are not guaranteed to match the headless ones exactly.
