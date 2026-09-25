SHELL := /bin/sh
.DEFAULT_GOAL := help
# mise selects project-local versions without changing global defaults.
RUN := MISE_AUTO_INSTALL=0 mise exec --

.PHONY: help setup install doctor verify-prerequisites browsers-install dev build preview test test-unit test-browser lint clean
help:
	@echo "Formula Racer: setup doctor verify-prerequisites dev build preview test test-unit test-browser lint clean"
	@echo "preview serves dist/; pass BASE=/some/path/ to check subpath hosting."
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
test: test-unit test-browser
test-unit:
	$(RUN) bun run test
# Browser tests serve dist/, so they always run against a fresh production build.
test-browser: build
	$(RUN) bun run test:browser
lint:
	$(RUN) bun run lint
clean:
	rm -rf dist build coverage .cache test-results playwright-report
