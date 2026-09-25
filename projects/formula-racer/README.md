# Formula Racer

A desktop browser racing game with original 2026-style open-wheel cars.
First release: accessible time trials, one circuit, one detailed chassis and three
fictional team liveries. Physics is designed to improve incrementally.

**Current delivery: Phase 1 browser foundation. There is no gameplay yet.**

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
make dev        # http://localhost:3000/
make test
make lint
make build
```

From the repository root, use `make test PROJECT=formula-racer` and
`make lint PROJECT=formula-racer`. `make build` writes a static site to `dist/`;
`make preview` serves it. Asset exports and benchmarks are added in later phases.
