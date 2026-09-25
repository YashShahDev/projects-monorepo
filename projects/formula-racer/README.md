# Formula Racer

A desktop browser racing game with original 2026-style open-wheel cars.
First release: accessible time trials, one circuit, one detailed chassis and three
fictional team liveries. Physics is designed to improve incrementally.

**Current delivery: Phase 0 documentation and prerequisites. There is no game yet.**

Start with [STATUS](docs/STATUS.md), [setup](docs/SETUP.md) and the
[documentation index](docs/INDEX.md). The [roadmap](docs/ROADMAP.md) describes P0–P5.

## Planned stack

Bun manages packages, development serving, browser bundling and unit tests.
TypeScript is checked independently with `tsc`; Oxlint and Oxfmt handle lint and format checks. Three.js renders WebGL2; Rapier
WASM owns rigid bodies and collisions. Blender exports optimized GLB assets.
Plain HTML/CSS supports the menus and HUD. Production is statically hosted.

## Commands

From this directory, follow `docs/SETUP.md` to install pinned prerequisites, then:

```sh
make setup
make doctor
make test
make lint
make build
```

From the repository root, use `make test PROJECT=formula-racer` and
`make lint PROJECT=formula-racer`. During P0, build explicitly reports that the
browser entrypoint arrives in P1. Tests cover setup tooling, not gameplay.
Game development, asset exports and benchmarks are added in later checkpoints.
