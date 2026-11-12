# codebase-optimizer

Codebases accrete. Roots fill with loose files, modules balloon into god-files,
and shallow pass-through layers pile up until neither a newcomer nor an agent
can navigate the tree, and hand-refactoring it is slow and risky. This plugin
runs a staged optimizer over a repository that has already drifted: tidy the
tree, split the god-files, deepen the shallow modules, each stage checked
against the repo's own tests and put back when it reds.

## How it works

Three stages, one engine, run in order on a dedicated branch:

- **ORGANIZE** tidies the file tree with history-preserving `git mv` and
  reference rewriting, then writes an `AGENTS.md` orientation hub in the root
  and every non-leaf code directory: one honest line per child, what it holds
  and when to descend.
- **DECOMPOSE** splits god-files into focused modules behind compatibility
  shims (re-export shims, barrel files, same-package splits, per ecosystem).
- **DEEPEN** reshapes shallow modules and leaky seams, one at a time.

Four things hold for all of them:

1. **Nothing moves until you have seen the plan.** The organizer stops between
   its plan and its apply; the sweep shows its run plan and waits. The
   workflows refuse to start without that yes.
2. **Every change is validated and reverted on red.** Smoke or compile check,
   targeted tests and lint run against a baseline of failures already present;
   anything newly red is put back. Nothing is ever pushed, `git clean` is
   banned, and cruft is quarantined to `archive/`, never deleted.
3. **Scripts supply the facts.** `repo-scan.mjs` profiles the tree,
   `verify-hubs.mjs` checks the hubs against it, and `verify-structure.mjs`
   grades both: a critical finding fails a stage, a warning is reported.
4. **Decisions are written down.** An architecture review reads the glossary
   at `.agents/CONTEXT.md` and the decision records under `.agents/decisions/`,
   and offers a new record when a choice would otherwise be re-argued.

It detects Python, JS/TS, Go, and Rust from the manifests and runs a generic
mode on anything else. The detail (ecosystem profiles, the hubs, the severity
ladder, the safety model, reviewing results, limitations) is in
[docs/how-it-works.md](docs/how-it-works.md).

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install codebase-optimizer@agentic-engineering
```

Requirements:

- A **git** repository.
- The repo's **own toolchain** on PATH, whatever the ecosystem already uses
  (`uv` and `pytest`, `npm` and `tsc`, `go`, `cargo`). The engine detects it and
  never installs anything.
- **Node 22** for the bundled scripts, which run on a repo of any language.
  Without it the ORGANIZE stage and the structure checks are skipped with a
  note; DECOMPOSE and DEEPEN still run.

## Skills

Ask for what you need ("optimize this repo", "tidy the file tree", "these
modules are too shallow"). All three are model-invoked, and none changes the
repository without your yes.

| Skill | Reach for it when |
|---|---|
| `optimize-codebase` | The whole sweep: organize, decompose, deepen, in that order, on one branch (default `optimize-codebase/auto`). |
| `codebase-organizer` | The file tree alone: plan, your approval, moves and reference rewrites, hubs, verification. Also "just add hubs to my repo". |
| `improve-codebase-architecture` | The seams alone: a visual report of deepening candidates, then a design conversation about the one you pick. |

The result of a sweep is per-round commits on a branch and a rollup to review
before you run the tests and merge. Re-running is safe: finished work is
skipped.

## The scripts, by hand

They are ordinary commands, useful outside the skills. From the plugin's own
directory:

```bash
node skills/codebase-organizer/scripts/repo-scan.mjs <repo>                      # the tree's profile, as JSON
node skills/codebase-organizer/scripts/verify-hubs.mjs <repo>                    # hubs against the tree; exit 1 on a finding
node skills/codebase-organizer/scripts/verify-structure.mjs <repo> --subtree ""  # everything, graded; exit 2 on a critical finding
```
