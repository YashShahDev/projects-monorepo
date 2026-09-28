---
id: ADR-003
title: Keep linked plans and checkpoints beside the code
type: decision
status: accepted
date: 2026-09-26
updated: 2026-09-26
summary: A shared Markdown graph and Git history make work resumable across agents and sessions.
---

# Keep linked plans and checkpoints beside the code

## Decision

Use the main checkout, a feature branch and one draft PR for P0–P5. The user explicitly
requested this over isolated primary work. Independent parallel work may use separate
worktrees; the integrating agent owns shared status and final acceptance.

Each record has a stable ID, typed frontmatter, summary and relative links. STATUS
points to the active checkpoint; ROADMAP defines acceptance; ADRs capture tradeoffs;
research records link primary sources and retrieval dates. Checkpoint commits bind
evidence to code. No knowledge-graph server or external tracker is required.

## Alternatives and consequences

Conversation-only tracking loses context between agents. A separate private vault
cannot be the only source for collaborators. A database adds maintenance without
initial benefit. Markdown links are sufficient for navigation and can be indexed later.

One long-lived PR is larger than usual repository convention; it is an explicit user
choice. Keep it draft, commit in reviewable checkpoints and update its description.
Do not equate installed tools with an implemented game or headless tests with FPS data.

Workflow: [WORKFLOW](../WORKFLOW.md). Resume: [STATUS](../STATUS.md).
