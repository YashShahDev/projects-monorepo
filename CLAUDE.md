# Working in this repo

Guidance for Claude Code (and humans) working anywhere in this monorepo.
A project may add its own `projects/<name>/CLAUDE.md` for rules that only
apply there; it wins over this file on conflicts.

## Layout and commands

- Every project lives in `projects/<name>/` and owns its own `Makefile`.
- Create projects with `make new PROJECT=<name> LANG=<generic|python|node|go>`,
  never by hand — it keeps the target names consistent.
- Every project's `Makefile` must implement `build`, `test`, `lint`, `clean`.
  If a target genuinely doesn't apply, make it a no-op that says so rather
  than deleting it — the root dispatcher calls it either way.
- Run `make test` (all projects) or `make test PROJECT=<name>` (one) from the
  repo root before calling any change done.
- Projects are independent. Don't import across `projects/` boundaries. If two
  projects need the same code, that's the signal to discuss extracting a
  shared library, not to reach sideways into a sibling folder.

## Tests

- Every behavior change ships with tests. New project, new feature, new bug
  fix — all of them.
- A bug fix starts with a failing test that reproduces the bug. Watch it fail,
  then fix it, then watch it pass. A fix without that step is a guess.
- Cover the boring path and the sharp edges: empty input, zero, one, many,
  duplicates, unicode, concurrent access, the error branch you just wrote.
- Test behavior through the public surface, not private internals. Tests that
  assert on implementation details break on every refactor and teach us
  nothing.
- Never delete, skip, or weaken a failing test to get green. The test is the
  messenger. Fix the code, or if the test is genuinely wrong, say so
  explicitly and explain why before changing it.
- Tests must be deterministic. No real network, no wall-clock races, no
  dependence on test execution order. Seed randomness and print the seed.

## Performance

- Correct first, then fast. A fast wrong answer is worthless.
- **Measure before you optimize.** Never claim something is faster without a
  number. "This should be faster" is a hypothesis, not a result.
- Profile before optimizing; the bottleneck is routinely somewhere nobody
  guessed. Reach for the language's standard tooling:
  - Python: `cProfile` + `snakeviz`, `pytest-benchmark`, `py-spy` for live processes
  - Node: `node --prof` / `--cpu-prof`, Chrome DevTools, `clinic`
  - Go: `go test -bench` + `pprof`, `-benchmem` for allocations
- Do watch algorithmic complexity from the start — an accidental O(n²) over a
  list that will grow is a design bug, not a micro-optimization, and it is far
  cheaper to avoid now than to find later.
- Don't micro-optimize without profiler data backing it. Unrolled loops and
  clever bit tricks in cold code cost readability and buy nothing.
- Watch allocations and I/O before CPU. Most real slowness is a query in a
  loop, an unbuffered read, or a copy nobody noticed.
- When you optimize, record the before/after numbers in the commit message so
  the next person knows what the tradeoff bought.

## Comments

Write comments the way a thoughtful colleague would — sparingly, and only
where they earn their space.

- Explain **why**, not **what**. The code already says what it does. The
  comment exists for the reasoning that isn't in the syntax.
- Good reasons to leave one: a non-obvious constraint, a subtle invariant, a
  workaround for a specific upstream bug (link it), a deliberate tradeoff, or
  behavior that would genuinely surprise a careful reader.
- Bad comments to avoid: `# increment counter`, restating the signature in
  prose, or a banner over every trivial block. Noise trains people to skim
  past the comments that matter.
- Write like a person, in plain sentences. Not a template, not a form to fill
  in, not a wall of tags.
- Don't narrate the task, the ticket, or who called it — `// added for the new
  checkout flow` is stale the moment that flow ships. That context belongs in
  the commit message and the PR.
- If a comment is doing the work of a good name, rename instead.
- Keep comments true. A comment that contradicts the code is worse than none,
  so when you change the code, change the comment above it.

## Quality bar

- Match the surrounding style before introducing your own.
- Smallest change that solves the problem. No speculative abstraction, no
  refactoring the neighborhood while fixing a bug, no half-built features.
- Validate at the boundaries — user input, network, files, external APIs.
  Trust internal code; defensive checks for impossible states just hide real
  bugs.
- Handle errors where you can actually do something about them. Never swallow
  one silently; if you're deliberately ignoring it, write the one line saying
  why.
- No secrets, tokens, or credentials in code, tests, fixtures, or commit
  messages. Read from the environment.
- `make lint` and `make test` pass before commit. If you can't get something
  passing, say so plainly rather than working around the check.
- Say what you actually verified. "Tests pass" means you ran them. If you
  couldn't test something — a UI path, a production-only integration — state
  that instead of implying it works.

## Pull requests

- Work happens on a branch and lands through a PR. Don't push to `main`
  directly, even for a one-liner.
- One PR, one purpose. A bug fix and a refactor in the same PR are two PRs
  that haven't been split yet.
- Fill in `.github/pull_request_template.md` properly — it's the record of why
  this change exists, and it's what a reviewer (human or not) reads first.
  Delete sections that genuinely don't apply rather than leaving them empty.
- **Performance changes carry numbers.** Before/after, how it was measured, on
  what input. A perf PR without a measurement in the description isn't ready.
- **Bug fixes state the root cause**, not just the symptom, and name the test
  that now covers it. "Fixed the crash" says nothing a year from now.
- PRs are **squash-merged**, so the PR title becomes the commit subject on
  `main`. Write it like one: imperative mood, under ~70 characters, describing
  the change rather than the activity ("Cache parsed configs per run", not
  "Various fixes").
- Don't merge on red. If CI fails, fix it or explain in the PR why the failure
  isn't this change's.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `YashShahDev/projects-monorepo`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: a root `CONTEXT-MAP.md` points to one `projects/<name>/CONTEXT.md` per project. See `docs/agents/domain.md`.
