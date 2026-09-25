---
id: WORKFLOW
title: Checkpoint and collaboration workflow
type: process
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: How agents resume, verify and hand off work without conversation memory.
---

# Checkpoint and collaboration workflow

## State and authority

Checkpoint states: `planned`, `in_progress`, `blocked`, `done`. Start only when
prerequisites are done. A blocked checkpoint states the concrete missing condition
and next unblock action; elapsed time does not imply approval. `done` requires the
listed acceptance checks and recorded evidence. STATUS is the current pointer;
checkpoint records contain evidence; Git is the history.

Before work, read STATUS, the phase, linked decisions and recent commits. Reconcile
any mismatch explicitly. Present a phase brief and ask only questions with material
unresolved consequences. Record the answer or the already-approved default. Continue
independent tasks when an answer is pending; do not guess a blocking product decision.

## Commits and PR

Use one `feat/formula-racer` branch and one draft PR in the main checkout. Stage
explicit project paths. Use subjects such as `P1-C2: verify browser WASM loading`.
Commit code, tests and checkpoint updates together. Run applicable tests and lint
before each commit. Use focused intermediate commits within a checkpoint if useful.
Do not amend or rewrite published history to hide failures. Never automatically merge.

Find checkpoint history with `git log --oneline --grep='P0-C'`. A document cannot
contain its own commit hash; use checkpoint IDs or previous commit IDs instead.
Update the PR summary/checklist as implemented scope changes, not as a transcript.

## Independent agents

Use separate worktrees only for independent parallel tasks authorized by the user
or applicable instructions. Assign ownership by path and interface; Blender and UI
can be separate after agreeing model node names and snapshot fields. Avoid concurrent
binary editing. Workers report commits, tests, assets, decisions and questions.
The integrating agent resolves conflicts sequentially, verifies the combined result
and alone closes shared checkpoints. One draft PR receives the integrated commits.

## Session end

Update STATUS and the checkpoint record with completed work, exact commands and
outcomes, known failures, deferred checks and the next executable action. Commit
coherent work; describe any remaining uncommitted state precisely. Link research to
its date and sources. Keep large logs/videos out of Git; record reproducible commands
and small summaries. Mirror durable decisions to the personal knowledge base, but
never require that private vault to resume the project.
