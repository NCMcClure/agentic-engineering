# codebase-optimizer

A Claude Code plugin that runs a **staged, autonomous codebase optimizer** over a
Python repository. It folds three loops into one engine, each gated by CI-faithful
validation with revert-on-red:

| Stage | What it does |
|-------|--------------|
| **ORGANIZE** | Tidy the file tree — history-preserving `git mv` + reference rewriting, driven by the bundled `codebase-organizer` skill (plan → apply → verify → commit → re-scan). |
| **DECOMPOSE** | Split oversized god-files into focused modules behind re-export shims, via AST codemod. Lane-plan → parallel find → decision panel → validate + repair → commit; revert any extraction that reds. Optional multi-file concurrency via git worktrees. |
| **DEEPEN** | Reshape shallow modules / leaky seams (bundled `improve-codebase-architecture` methodology), applied sequentially with revert. |

The engine is a Claude Code **dynamic Workflow** that fans out many subagents. It is
self-contained: the methodology files it reads at runtime
(`LANGUAGE.md`/`DEEPENING.md`, the organizer's `philosophy.md`/`language-layouts.md`),
the two organize sub-workflows, `repo_scan.py`, and the structure verifier are all
bundled and resolved via `${CLAUDE_PLUGIN_ROOT}`.

## Requirements

- A **git** repository (nothing is ever pushed; work lands on a dedicated branch).
- **Python + `uv`** (the engine runs tests/lint/imports through `uv run` / `uvx`).

## Install

```
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install codebase-optimizer@agentic-engineering
```

Then ask Claude to "optimize / decompose / organize / deepen" the codebase, or invoke
the `optimize-codebase` skill directly. The skill launches the Workflow with the
bundled paths already wired.

## What it does automatically

A **Setup DETECT** pass reads `pyproject.toml` + the source layout (+ `repo_scan.py`)
and derives repo-appropriate defaults for the source root, packages, test root, env
command, base import-smoke set, and linter — so it works on a normal Python repo without
per-repo tuning. Every value is overridable via args (an explicit arg always wins).

## Safety model

- Runs on a branch (default `optimize-codebase/auto`); **never pushes**.
- Each change is validated (import smoke + targeted pytest + lint) against a per-round
  oracle of pre-existing failures, and **reverted on any new failure**.
- A baseline **import-smoke oracle** drops modules already broken on the clean tree, so a
  pre-existing bad import can't block every commit.
- `git clean` is **banned**; a protected-untracked set captured at Setup keeps revert
  from ever deleting pre-existing untracked content (`.venv`, `node_modules`, `archive/`).
- Cruft is **quarantined to `archive/`**, never deleted.

## Reviewing results

The Workflow returns a rollup and leaves per-round commits on the branch. Review the
per-file `lines_start → lines_end` + `extractions_applied`, anything quarantined under
`archive/`, and any `unmerged_conflict_branches`, then run the test suite and merge.
Re-running is safe (finished files are skipped on re-discovery).

## Limitations

Python/uv only. See the "Known issues / limitations" section of
`skills/optimize-codebase/SKILL.md` for the full list (pool-reuse approximate ranges,
org-aware placement vs. concurrency, chair-unavailable consensus fallback, observational
org audit).

## Layout

```
.claude-plugin/plugin.json
skills/
  optimize-codebase/{SKILL.md, workflows/optimize-codebase.js}
  improve-codebase-architecture/{SKILL,LANGUAGE,DEEPENING,INTERFACE-DESIGN,HTML-REPORT}.md
  codebase-organizer/{SKILL.md, references/, scripts/{repo_scan.py, verify_source_structure.py}, workflows/}
```

## Changelog

- **0.1.0** — initial release via the agentic-engineering marketplace (plugin renamed from `optimize-codebase` to `codebase-optimizer`; the entry skill keeps its `optimize-codebase` name).
