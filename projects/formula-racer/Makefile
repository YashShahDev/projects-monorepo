SHELL := /bin/sh
.DEFAULT_GOAL := help
# mise selects project-local versions without changing global defaults.
RUN := MISE_AUTO_INSTALL=0 mise exec --

.PHONY: help setup install doctor verify-prerequisites browsers-install build test lint clean
help:
	@echo "Formula Racer P0: setup doctor verify-prerequisites build test lint clean"
	@echo "Browser application/dev server arrive in P1; assets and benchmarks in P4/P5."
setup: install browsers-install
install:
	$(RUN) bun install --frozen-lockfile
browsers-install:
	$(RUN) bun run browsers:install
doctor:
	$(RUN) bun run doctor
verify-prerequisites:
	$(RUN) bun run verify:prerequisites
build:
	$(RUN) bun run build
test:
	$(RUN) bun run test
lint:
	$(RUN) bun run lint
clean:
	rm -rf dist build coverage .cache test-results playwright-report
