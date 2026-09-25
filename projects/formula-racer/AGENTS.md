# Working on Formula Racer

Read the repository's `CLAUDE.md` first, then [docs/STATUS.md](docs/STATUS.md),
[docs/INDEX.md](docs/INDEX.md), the active phase and its linked decisions.
The repository is the shared source of truth; conversation memory is not required.

## Before each phase

- Compare the branch, working tree and checkpoint commits with the status document.
- Give a short phase brief: scope, acceptance checks, assumptions and next checkpoint.
- Ask the user about unresolved decisions that materially change gameplay, assets,
  architecture or scope **before dependent work**. Continue independent work while waiting.
- Do not ask again for decisions already recorded. Routine implementation choices
  are within scope; record non-obvious choices as ADRs.
- Respect session boundaries: Phase 0 stops at documentation and verified tooling.
  Start another phase only when the session's instruction includes it.

## Branches and parallel work

The primary implementation runs in the **main working folder** on
`feat/formula-racer`, not on the `main` branch. Do not create a worktree for ordinary
serial work. Preserve unrelated local files and stage explicit project paths.
Use one draft PR for P0–P5, with small checkpoint commits; do not merge automatically.

For authorized, independent parallel tasks, use separate branches/worktrees with
clear ownership: Blender assets and UI are examples. Never edit the same `.blend`
file concurrently. Give each task a bounded deliverable and integration tests.
The integrating agent owns STATUS, the index and checkpoint closure; task agents
return their commit IDs, changed paths, tests and decisions. Integrate sequentially,
resolve interfaces, rerun relevant checks, then update the shared checkpoint.
This guidance does not itself authorize spawning agents.

## Engineering rules

- Bun, `bun test`, Oxlint, Oxfmt and strict TypeScript; no imports into sibling projects. Python is allowed
  for Blender tooling. Any new reusable shell script follows the global ~/scripts rules.
- Simulation has no DOM or Three.js dependencies. The renderer consumes snapshots;
  Rapier types stay behind the physics adapter. Use SI units internally.
- Validate external content at load boundaries. Keep track/team/rule data separate
  from engine code. Do not hide missing assets or tests behind success messages.
- Every behavior change has tests; bug fixes start with a failing reproducer.
- `make test PROJECT=formula-racer` and `make lint PROJECT=formula-racer` must pass
  before committing; also run build and relevant browser/asset checks when applicable.
- Benchmark before claiming performance improvements. Record before/after data,
  hardware, renderer backend, route, quality preset and exact commands.
- Never treat headless software rendering as a hardware FPS benchmark.
- Do not add large asset binaries before verifying the LFS upload/download path.

## Phase review

After each phase, get an independent review of that phase's commits before starting
the next one, trying reviewers in this order and noting which reviewer and model ran:

1. Codex with the `gpt-6-astra` model, via the Codex plugin's reviewer:
   `/codex:review --base <phase-start> --scope branch` (an agent that cannot invoke
   it runs the same script: `codex-companion.mjs review --wait --base <ref> --scope branch`).
2. If Codex is unavailable or out of usage: the Antigravity plugin's cross-model review,
   `/antigravity:review <phase-start>..HEAD` (it pipes the diff to `agy-delegate --tier pro`).
3. If neither is available: a freshly started review agent with no stake in the work.

Reproduce each finding before fixing it; record accepted and rejected findings with
reasons in the phase's checkpoint record.

## Usage limits and restarts

Any agent may hit a usage or rate limit mid-task. Before stopping, or when a limit is
near, bring the work to a coherent state: finish or revert the in-flight edit, run the
checks, commit completed checkpoint work, and update STATUS with the exact next action
and anything left uncommitted. After a limit or restart, resume from STATUS and the
checkpoint record rather than conversation memory, and continue the authorized phases
without asking again. Do not busy-wait on a limit; resume when it resets.

Pace long autonomous runs (user, 2026-09-26): after each committed slice, pause (for
example a background sleep) so usage lasts the rolling limit windows. Size the pause
from the _recent_ burn rate during active work, not a linear extrapolation from the
start of the window, and lengthen it sharply as the remaining budget shrinks; keep each
pause under the prompt-cache lifetime. Where `claude-pacer` is installed, run
`claude-pacer wait` in the background; `claude-pacer status` explains its figure.
Pausing spreads usage but does not reduce it, so still keep turns concise.

## Checkpoint and handoff

Follow [the workflow](docs/WORKFLOW.md). Update STATUS and the relevant checkpoint
in the same commit as completed work. Use IDs in commit subjects, for example
`P2-C1: add fixed-step vehicle simulation`. Record failures and unverified work
explicitly; do not mark a checkpoint done just because files exist.
