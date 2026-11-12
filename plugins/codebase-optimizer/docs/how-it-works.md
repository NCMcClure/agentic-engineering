# How codebase-optimizer works

The engine is a dynamic Workflow that fans out many subagents. It is
self-contained: the methodology files it reads at runtime, the two organize
sub-workflows, and the three scripts are all bundled and resolved through
`${CLAUDE_PLUGIN_ROOT}`. In a session without the Workflow tool the skills run
the same phases with plain subagents, and without those, one unit at a time;
`references/subagent-fallback.md` is the contract for both.

## The stages

| Stage | What it does |
|-------|--------------|
| **ORGANIZE** | Tidy the file tree: history-preserving `git mv` plus reference rewriting, driven by the bundled `codebase-organizer` skill (plan, apply, verify, commit, re-scan). Writes the `AGENTS.md` orientation hubs on the post-move tree. |
| **DECOMPOSE** | Split oversized god-files into focused modules behind compatibility shims (re-export shims, barrel files, or same-package splits, per ecosystem) via scripted or AST codemod. Lane plan, parallel find, decision panel, validate and repair, commit; revert any extraction that reds. Optional multi-file concurrency through git worktrees. |
| **DEEPEN** | Reshape shallow modules and leaky seams with the bundled `improve-codebase-architecture` methodology, applied sequentially with revert. |

## Asking first

Nothing is moved until the person has seen the plan, and the workflows hold
that line themselves rather than trusting the model to remember it:

- `codebase-organizer` plans read-only, shows the plan, and waits. Its apply
  workflow returns `aborted: "Approval"` and touches nothing unless it is
  called with `approved: true`.
- `optimize-codebase` runs the read-only scan, shows the run plan (stages,
  branch, what the scan found), and waits. The engine returns an error and
  changes nothing unless it is called with `approved: true`. Inside a sweep,
  ORGANIZE applies its move plans round by round without a further stop, so a
  person who wants to read every move first runs the organizer on its own.

## What it does automatically

A Setup DETECT pass identifies the ecosystem from the repo's manifests
(`pyproject.toml` for Python, `package.json` for JS/TS, `go.mod` for Go,
`Cargo.toml` for Rust) and derives the toolchain from an ecosystem profile: env
setup, test command, smoke or compile check (`import` smoke, `tsc --noEmit`,
`go build ./...`, `cargo check`), linter, source root, test root. The profile also
drives the language-specific mechanics injected into every agent prompt: the
compatibility-shim strategy (Python re-export shims, JS/TS barrel re-exports, Go
same-package file splits, Rust `pub use`), the test-seam census (`patch()` and
`jest.mock` paths that must keep biting), and the codemod tooling. Every value is
overridable by argument, an explicit argument always wins, and repos outside the
four profiles run in a `generic` mode where ORGANIZE works out of the box and
DECOMPOSE and DEEPEN activate once you pass a test command.

## The scripts

All three live in `skills/codebase-organizer/scripts/`, are Node 22 standard
library only, and run on a repo of any language.

- `repo-scan.mjs` is the recon: one JSON profile of what sits loose at the
  root, which directories are overstuffed and how their names cluster, which
  ecosystems the manifests imply, where cruft has accumulated, the largest
  source files, and, in a Python repo, the directories that hold modules and no
  `__init__.py`. It owns the flat-max threshold (25 files). The same tree gives
  the same profile on every machine.
- `verify-hubs.mjs` checks the hubs against the tree a commit would hold.
- `verify-structure.mjs` is the gate: it grades the other two's findings and
  exits 0 clean, 1 with warnings, 2 with a critical finding.

## AGENTS.md hubs

A tidy tree still cannot tell an agent what each subtree is for. The ORGANIZE stage
(and the standalone `codebase-organizer` skill) therefore writes an `AGENTS.md`
orientation hub in the repo root and every non-leaf code directory: one honest line
per direct child, what it holds and when to descend, drafted from the actual
post-move tree rather than from aspiration. The rules are in
`skills/codebase-organizer/references/agent-hubs.md`, and the DECOMPOSE and DEEPEN
stages keep hubs current in the same commit as any file they move or create.
Existing `AGENTS.md` files are merged, never clobbered. "Just add hubs to my repo"
works too: the organizer runs with `hubs: "only"` and zero moves.

Beside each hub it writes goes a `CLAUDE.md` twin, so Claude Code loads the hub
natively: a symlink to `AGENTS.md`, or the one line `@AGENTS.md` in a checkout that
cannot hold a symlink. Whether to write them is read from the repo, not asked: a
root `AGENTS.md` with no root `CLAUDE.md` is a repo that goes without twins and
stays that way; `claudeMd: true` or `false` overrules the reading. A `CLAUDE.md`
with content of its own is left alone and reported.

## Which findings fail a stage

| Severity | Checks | Effect |
|---|---|---|
| CRITICAL | `MISSING_INIT` (a Python package directory with no `__init__.py`), `HUB_LOOSE_CODE` (source beside a hub, once the repo has a root hub) | Fails the stage that ran the gate. |
| WARNING | `HUB_MISSING_LINE`, `HUB_STALE_LINE`, `HUB_MISSING`, `CLAUDE_MD_NOT_TWIN`, `FLAT_DIR_BLOAT`, `CRUFT_PRESENT` | Reported, never fails a stage. |
| INFO | `OVERSIZED_MODULE`, `EPHEMERA_UNIGNORED` | For the record. |

The organize apply runs the gate with `--strict`: it has just written the hubs,
so a line it left out, a line it left stale, or source it left beside a hub is
critical there, whatever the repo looked like before. Inside the engine the gate
is otherwise observational: it records a baseline, reports what each DECOMPOSE
or DEEPEN commit added to it, and reports the final state. A legacy repo with no
root hub is warned, never failed: the first run's job is to write the hubs.

## Decision records and the glossary

The DEEPEN methodology reads the project's glossary and decision records so it
names seams in the project's own words and does not re-argue settled choices.
Their homes are `.agents/CONTEXT.md` and `.agents/decisions/NNNN-slug.md`, never
`./docs` (user-facing documentation only) and never the repo root; a repo with
`.agents/agent-works.json` names them there instead (`paths.glossary`,
`paths.decisions`). `improve-codebase-architecture` adds a glossary term when a
deepened module is named after a new concept, and offers a decision record when
a candidate is rejected for a reason a later review would need, in the formats
it ships. If the agent-works plugin is installed, numbering and indexing the
records is its job.

## Safety model

- Runs on a branch (default `optimize-codebase/auto`) and **never pushes**.
- Each change is validated (smoke or compile check, targeted tests, lint) against a
  per-round oracle of pre-existing failures, and **reverted on any new failure**.
  That holds for an extraction, a deepening, and an ORGANIZE round alike: a red
  round is put back, its plan and failing output kept for you, and the stage stops.
- A baseline smoke oracle drops checks already broken on the clean tree, so a
  pre-existing failure cannot block every commit.
- `git clean` is **banned**; a protected-untracked set captured at Setup keeps
  revert from ever deleting pre-existing untracked content (`.venv`,
  `node_modules`, `archive/`).
- Cruft is **quarantined to `archive/`**, never deleted.

The standalone organizer does not revert: it never commits and never touches
the branch you started from, so on red it reports what broke and leaves the
working branch for you to fix forward or discard.

## Reviewing results

The Workflow returns a rollup and leaves per-round commits on the branch. Review
the per-file `lines_start` to `lines_end` and `extractions_applied`, the
`structure.baseline` and `structure.final` counts with `structure.remaining`,
any organize round that went red (`stage: "verify"`, with `reverted`), anything
quarantined under `archive/`, and any `unmerged_conflict_branches`, then run the
test suite and merge. Re-running is safe: finished files are skipped on
re-discovery.

## Limitations

Support is tiered by how much mileage each profile has. Python is the
most-proven path; JS/TS, Go, and Rust get first-class profiles (shim strategy, seam
census, compile gates) with less mileage; anything else runs `generic`, meaning
ORGANIZE always, DECOMPOSE and DEEPEN only with a caller-supplied test command, and
no compatibility-shim mechanism assumed, so every extraction rewrites all
references. Hub isolation is strict about entry files a toolchain pins beside a
hub (`main.go`, `lib.rs`, `setup.py`): name them once in the root hub's
`<!-- verify-hubs: exempt ... -->` line. See the "Known issues / limitations"
section of `skills/optimize-codebase/SKILL.md` for the rest: approximate pool-reuse
ranges, org-aware placement against concurrency, the chair-unavailable consensus
fallback, and the observational org audit.
