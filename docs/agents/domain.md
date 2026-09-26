# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a multi-context monorepo: every project under `projects/<name>/` is an independent context with its own vocabulary and decisions.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: it points at one `projects/<name>/CONTEXT.md` per project. Read the one for the project you're working in (and any other it names as relevant).
- **`projects/<name>/docs/decisions/`**: read ADRs that touch the area you're about to work in.
- **`docs/adr/`** at the repo root: repo-wide decisions (root Makefile, templates, CI, cross-project conventions).

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT-MAP.md                 ← points at each project's CONTEXT.md
├── docs/adr/                      ← repo-wide decisions
└── projects/
    ├── formula-racer/
    │   ├── CONTEXT.md
    │   └── docs/decisions/        ← ADR-001-bun-toolchain.md, ...
    └── text-tools/
        ├── CONTEXT.md
        └── docs/decisions/
```

Project ADRs use the naming formula-racer already established: `ADR-NNN-slug.md` in `projects/<name>/docs/decisions/`. Don't introduce a parallel `docs/adr/` inside a project.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the project's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-002 (physics boundary), but worth reopening because…_
