SHELL := /bin/sh
.DEFAULT_GOAL := help
# mise selects project-local versions without changing global defaults.
RUN := MISE_AUTO_INSTALL=0 mise exec --

.PHONY: help setup install doctor verify-prerequisites browsers-install dev build preview bench test test-full test-unit test-browser test-browser-full assets assets-verify lint clean
help:
	@echo "Formula Racer: setup doctor verify-prerequisites dev build preview test test-full test-unit test-browser test-browser-full lint clean"
	@echo "test runs unit + Chromium dev checks; test-full adds the complete browser matrix."
	@echo "preview serves dist/; pass BASE=/some/path/ to check subpath hosting."
	@echo "bench runs the benchmark route in headed Chromium; QUALITY=low|medium|high (default medium)."
	@echo "assets rebuilds the car GLB in Blender; assets-verify checks the committed one is reproducible."
setup: install browsers-install
install:
	$(RUN) bun install --frozen-lockfile
browsers-install:
	$(RUN) bun run browsers:install
doctor:
	$(RUN) bun run doctor
verify-prerequisites:
	$(RUN) bun run verify:prerequisites
dev:
	$(RUN) bun run dev
build:
	$(RUN) bun run build
preview:
	$(RUN) bun run preview --base "$(or $(BASE),/)"
bench: build
	$(RUN) bun run tools/bench.ts --quality "$(or $(QUALITY),medium)"
test: test-unit test-browser
test-full: test-unit assets-verify test-browser-full
test-unit:
	$(RUN) bun run test
test-browser:
	$(RUN) bun run test:browser
# The full matrix serves dist/, so it always runs against a fresh production build.
test-browser-full: build
	$(RUN) bun run test:browser:full
assets:
	$(RUN) bun run tools/export-car.ts public/assets/cars/fr26.glb
assets-verify:
	$(RUN) bun run tools/verify-car-export.ts
lint:
	$(RUN) bun run lint
clean:
	rm -rf dist build coverage .cache test-results playwright-report
