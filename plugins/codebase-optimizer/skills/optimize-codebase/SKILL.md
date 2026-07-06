---
name: optimize-codebase
description: Staged, autonomous codebase optimizer that folds three loops into one engine — ORGANIZE (tidy the file tree via history-preserving git mv + reference rewriting), DECOMPOSE (split god-files into focused modules behind re-export shims), and DEEPEN (architectural deepenings of shallow modules / leaky seams) — each behind CI-faithful validation with revert-on-red. Built for Python/uv repos; a Setup pass auto-detects the src root, packages, test root, env command, and linter. Use when the user wants to optimize / refactor / restructure / clean up / tidy / reorganize a codebase, split large "god" files, break up an overstuffed directory, improve or deepen architecture, or reduce a repo's file-navigability friction — phrases like "optimize this codebase", "decompose these huge files", "organize the folder structure", "improve the architecture", "this repo is a mess / hard to navigate". Drives a Claude Code dynamic Workflow that fans out many subagents; stages are toggleable (organize / decompose / deepen).
---

# Optimize Codebase

Runs a staged, autonomous optimizer over a **Python** repository. One shared Setup +
Conventions pass feeds three toggleable stages, run in order:

1. **ORGANIZE** — tidy the file tree (codebase-organizer): plan → human-implicit apply
   (history-preserving `git mv` + reference rewriting) → CI verify → commit → re-scan
   until converged.
2. **DECOMPOSE** — split oversized god-files: lane-plan → parallel find → decision panel
   → line-disjoint carve-outs → AST codemod leaving re-export shims → validate + repair →
   commit; revert any extraction that reds. Optional multi-file concurrency via worktrees.
3. **DEEPEN** — reshape shallow modules / leaky seams (improve-codebase-architecture),
   applied sequentially with revert.

Every mutation is gated by a **CI-faithful validation** step (import smoke + targeted
pytest + lint) measured against a per-round oracle, and reverted on any *new* failure.
`git clean` is banned; a protected-untracked set is captured at Setup so revert can never
delete pre-existing untracked content (`.venv`, `node_modules`, `archive/`, …).

## Prerequisites

- The target is a **git repository** (absolute path known).
- **Python + `uv`** are available (the engine runs everything through `uv run` / `uvx`).
- Ideally a clean-ish working tree — Setup will make one baseline commit if it's dirty.
- Work happens on a dedicated branch (default `optimize-codebase/auto`); nothing is pushed.

## How to run it

Invoke the bundled dynamic Workflow, resolving all bundled paths via
`${CLAUDE_PLUGIN_ROOT}`. Pass the absolute repo path and today's date (the workflow
sandbox has no clock):

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/optimize-codebase/workflows/optimize-codebase.js",
  args: {
    projectDir: "<absolute repo root>",
    dateToday:  "<YYYY-MM-DD>",

    // Bundled skill/methodology + tooling — ALWAYS pass these when running from the plugin:
    skillDir:          "${CLAUDE_PLUGIN_ROOT}/skills/improve-codebase-architecture",
    organizerSkillDir: "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer",
    structVerifier:    "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/scripts/verify_source_structure.py",
    scanScript:        "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/scripts/repo_scan.py",

    // OPTIONAL — omit to let the Setup DETECT step auto-derive them for the repo:
    //   stages: ["organize","decompose","deepen"]   // subset/order; default = all three
    //   organizeOnly: true                            // or mode: "organize"|"decompose"|"deepen"
    //   target: "src/pkg/huge.py"                     // single-file mode (engine stages only)
    //   maxFiles: 25, deepMaxFiles: 15, fileConcurrency: 3
    //   discoverLines: 1500, targetLines: 1000
    //   branch: "optimize-codebase/auto"
    //   scanRoots, testRoot, baseImports, keepSet, envSetup, lintCmd, testDirsFor  // detection overrides
    //   orgPlanDir: "<abs scratch dir outside the repo>"
  }
})
```

The Setup **DETECT** step reads `pyproject.toml` + the source layout (+ `repo_scan.py`)
and fills repo-appropriate defaults for `scanRoots`, `testRoot`, `baseImports`,
`keepSet`, `envSetup`, and the linter. **Any explicit arg you pass always wins** over
detection — use the override args above when detection guesses wrong.

### Choosing stages

- **Whole-repo tidy + split + deepen** (default): omit `stages` — runs
  `organize → decompose → deepen` (organize first so new modules land in an already-tidy
  tree).
- **Just tidy the tree:** `organizeOnly: true`.
- **Just split god-files:** `mode: "decompose"` (or `stages: ["decompose"]`).
- **Just deepen architecture:** `mode: "deepen"`.
- **One file:** `target: "src/pkg/huge.py"` (organize is skipped in single-file mode).

## Reviewing the results

The workflow returns a rollup and leaves all work as **per-round commits on the branch**
— nothing is pushed. Review:

- `organize.total_moves` / `decompose_deepen.files` (per-file `lines_start → lines_end`,
  `extractions_applied`, `convergence`).
- Files under `archive/` — cruft the organizer **quarantined** (never deleted); confirm
  before removing.
- `unmerged_conflict_branches` — child branches kept for human review after a
  merge-conflict retry was exhausted (concurrent decompose only).
- The Setup **baseline commit** (if the tree was dirty) is marked "safe to drop later" —
  drop it if you don't want it in history.

Then run the repo's own test suite once more, and merge the branch when satisfied.
Re-running is safe: finished files are skipped on re-discovery, so you can resume after a
budget stop.

## Known issues / limitations (by design)

- **Python/uv only.** The shim + AST-codemod machinery and the env/test/lint commands
  assume Python + `uv` + pytest. Non-ruff repos are handled (per-round lint becomes a
  no-op when no linter is detected), but other ecosystems are out of scope.
- **Pool-reuse batches on approximate line ranges** — in DECOMPOSE reuse passes, disjoint
  batching is judged on line ranges that may have drifted; an accidental overlap self-heals
  via sequential apply + revert but can waste a round.
- **Org-aware placement vs. concurrency** — steering two concurrently-decomposed files
  into the same concern subpackage can collide their `__init__.py` (merge conflict → the
  file is re-run fresh, bounded by `mergeRetries`). Lower `fileConcurrency` to 1 if this
  churns.
- **Chair-unavailable fallback** — if the panel chair (Opus) is unreachable after retries
  but the panel approved with no veto, the change proceeds on consensus with a minimal
  mandate, relying on validate + revert as the safety net.
- **Org audit is observational** — it reports structure findings on touched dirs but never
  reverts, and audits the primary touched package only.
