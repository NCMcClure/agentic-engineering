# codebase-optimizer

Codebases accrete: roots fill with loose files, modules balloon into god-files,
and shallow pass-through layers pile up until neither a newcomer nor an agent
can navigate the tree; hand-refactoring it is slow and risky. This plugin
runs a **staged, autonomous codebase optimizer** over a repository instead. It
folds three loops into one engine, each gated by CI-faithful validation with
revert-on-red:

| Stage | What it does |
|-------|--------------|
| **ORGANIZE** | Tidy the file tree: history-preserving `git mv` + reference rewriting, driven by the bundled `codebase-organizer` skill (plan → apply → verify → commit → re-scan). Also writes/refreshes **AGENTS.md orientation hubs** (see below). |
| **DECOMPOSE** | Split oversized god-files into focused modules behind compat shims (re-export shims, barrel files, or same-package splits, per ecosystem), via scripted/AST codemod. Lane-plan → parallel find → decision panel → validate + repair → commit; revert any extraction that reds. Optional multi-file concurrency via git worktrees. |
| **DEEPEN** | Reshape shallow modules / leaky seams (bundled `improve-codebase-architecture` methodology), applied sequentially with revert. |

The engine is a Claude Code **dynamic Workflow** that fans out many subagents. It is
self-contained: the methodology files it reads at runtime
(`LANGUAGE.md`/`DEEPENING.md`, the organizer's `philosophy.md`/`language-layouts.md`),
the two organize sub-workflows, `repo_scan.py`, and the structure verifier are all
bundled and resolved via `${CLAUDE_PLUGIN_ROOT}`.

## Requirements

- A **git** repository (nothing is ever pushed; work lands on a dedicated branch).
- The repo's **own toolchain** on PATH: whatever the ecosystem already uses
  (`uv`/`pytest` for Python, `npm`/`tsc` for JS/TS, `go`, `cargo`). The engine
  detects it; it never installs anything.
- **`python3`** for the bundled recon scripts (`repo_scan.py` + the structure
  verifier; stdlib-only, used on repos of *any* language). Without it the
  ORGANIZE stage and org audits are skipped with a note; DECOMPOSE/DEEPEN still run.

## Install

```
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install codebase-optimizer@agentic-engineering
```

Then ask Claude to "optimize / decompose / organize / deepen" the codebase, or invoke
the `optimize-codebase` skill directly. The skill launches the Workflow with the
bundled paths already wired.

## What it does automatically

A **Setup DETECT** pass identifies the ecosystem from the repo's manifests
(`pyproject.toml` → Python, `package.json` → JS/TS, `go.mod` → Go,
`Cargo.toml` → Rust) and derives the toolchain from an ecosystem profile: env setup, test command,
smoke/compile check (`import` smoke, `tsc --noEmit`, `go build ./...`,
`cargo check`), linter, source root, and test root. The profile also drives the
language-specific *mechanics* injected into every agent prompt: the compat-shim
strategy (Python re-export shims, JS/TS barrel re-exports, Go same-package file
splits, Rust `pub use`), the test-seam census (`patch()` / `jest.mock` paths that
must keep biting), and the codemod tooling. Every value is overridable via args
(an explicit arg always wins); repos outside the four profiles run in a `generic`
mode where ORGANIZE works out of the box and DECOMPOSE/DEEPEN activate once you
pass a test command.

## AGENTS.md hubs

A tidy tree still can't tell an agent what each subtree is for. The ORGANIZE
stage (and the standalone `codebase-organizer` skill) therefore writes an
`AGENTS.md` orientation hub in the repo root and every non-leaf code directory:
one honest line per direct child — what it holds, when to descend — drafted
from the actual post-move tree, never aspiration. The rules (hub isolation:
no source files beside a hub; direct-children-only scope; update-on-change)
live in `skills/codebase-organizer/references/agent-hubs.md`, checked by the
bundled `verify_agents_hubs.py`, and the DECOMPOSE/DEEPEN stages keep hubs
current in the same commit as any file they move or create. Sibling
`CLAUDE.md` files (containing `@AGENTS.md`, so Claude Code loads the hubs
natively) are opt-in, asked once per repo. Existing AGENTS.md/CLAUDE.md files
are merged, never clobbered. "Just add hubs to my repo" works too — the
organizer runs with `hubs: "only"` (zero moves). The contract is kept in
intentional sync with the but-first-planning plugin's greenfield equivalent.

## Safety model

- Runs on a branch (default `optimize-codebase/auto`); **never pushes**.
- Each change is validated (smoke/compile check + targeted tests + lint) against a
  per-round oracle of pre-existing failures, and **reverted on any new failure**.
- A baseline **smoke oracle** drops checks already broken on the clean tree, so a
  pre-existing failure can't block every commit.
- `git clean` is **banned**; a protected-untracked set captured at Setup keeps revert
  from ever deleting pre-existing untracked content (`.venv`, `node_modules`, `archive/`).
- Cruft is **quarantined to `archive/`**, never deleted.

## Reviewing results

The Workflow returns a rollup and leaves per-round commits on the branch. Review the
per-file `lines_start → lines_end` + `extractions_applied`, anything quarantined under
`archive/`, and any `unmerged_conflict_branches`, then run the test suite and merge.
Re-running is safe (finished files are skipped on re-discovery).

## Limitations

Support is tiered by how battle-tested each profile is: **Python** is the original,
most-proven path; **JS/TS, Go, and Rust** get first-class profiles (shim strategy,
seam census, compile gates) but less mileage; anything else runs `generic`:
ORGANIZE always, DECOMPOSE/DEEPEN only with a caller-supplied test command, and no
compat-shim mechanism is assumed (every extraction rewrites all references). See the
"Known issues / limitations" section of `skills/optimize-codebase/SKILL.md` for the
full list (pool-reuse approximate ranges, org-aware placement vs. concurrency,
chair-unavailable consensus fallback, observational org audit).

## Layout

```
.claude-plugin/plugin.json
skills/
  optimize-codebase/{SKILL.md, workflows/optimize-codebase.js}
  improve-codebase-architecture/{SKILL,LANGUAGE,DEEPENING,INTERFACE-DESIGN,HTML-REPORT}.md
  codebase-organizer/{SKILL.md, references/, assets/agents-root.md,
    scripts/{repo_scan.py, verify_source_structure.py, verify_agents_hubs.py}, workflows/}
```

## Changelog

- **0.3.0**: AGENTS.md progressive-disclosure hubs. The organizer plans and writes orientation hubs on the post-move tree — a new `HubDraft` phase places them (root always, every non-leaf code dir) and drafts honest one-line-per-child Layout sections from the real files; apply writes/merges them (user prose never clobbered) with opt-in `CLAUDE.md` siblings containing `@AGENTS.md` (asked once per repo, detected from the root import thereafter); the Design phase now includes the nesting moves hub isolation requires (no source files beside a hub). New owning contract `references/agent-hubs.md` (philosophy gains principle 9), new `verify_agents_hubs.py` verifier (whole-repo, warn-ramp until a root hub exists, then isolation is critical) gating the organize apply and reported baseline→final by optimize-codebase; the DECOMPOSE/DEEPEN engine prompts carry a hub-currency duty so moved/split files update their governing hub in the same commit. Hubs-only runs (`hubs: "only"`) retrofit hubs onto an already-tidy repo with zero moves.
- **0.2.3**: emitted recon/verify commands resolve `python3` or `python` rather than hardcoding `python3`, matching the existing "python3 or python" availability check so a `python`-only box (e.g. Windows/Git-Bash) doesn't drop to degraded mode.
- **0.2.2**: README reworded.
- **0.2.1**: bundled CONTEXT-FORMAT.md/ADR-FORMAT.md (fixing links that escaped the plugin); always-on description footprint cut from ~574 to ~194 est tokens with distinct triggers per skill; HTML report skeleton ships as an asset; flat-max threshold single-sourced in repo_scan.py; workflow fixes (Measure phase in meta, schema'd recon-scan, real plan path in the verify prompt, soft-judgment panel lenses floored at sonnet).
- **0.2.0**: language-agnostic engine: ecosystem profiles (Python, JS/TS, Go, Rust + `generic` fallback) detected at Setup drive the toolchain commands, shim strategy, seam census, and codemod guidance; host-repo leftovers removed from the defaults; ORGANIZE degrades gracefully when `python3` is absent.
- **0.1.0**: initial release via the agentic-engineering marketplace (plugin renamed from `optimize-codebase` to `codebase-optimizer`; the entry skill keeps its `optimize-codebase` name).
