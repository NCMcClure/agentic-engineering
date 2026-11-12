---
name: optimize-codebase
description: >
  The whole sweep and the entry point for the other two skills here: organize
  the tree, split god-files, deepen shallow modules, each stage on a branch
  behind the repo's own tests with revert on red. Use when the ask is a
  multi-stage refactor over a repository that has accreted ("optimize this
  codebase", "decompose these huge files"). Nothing starts until the person has
  seen the run plan and said yes. For the tree alone use codebase-organizer;
  for seams alone use improve-codebase-architecture.
---

# Optimize Codebase

Runs a staged, autonomous optimizer over a repository. One shared Setup +
Conventions pass feeds three toggleable stages, run in order:

1. **ORGANIZE**: tidy the file tree (codebase-organizer): plan → apply
   (history-preserving `git mv` + reference rewriting) → CI verify → commit → re-scan
   until converged; a round that reds is reverted and the stage stops. Also
   writes/refreshes the AGENTS.md orientation hubs: every non-leaf code directory
   gets one, per the organizer's `references/agent-hubs.md`.
2. **DECOMPOSE**: split oversized god-files: lane-plan → parallel find → decision panel
   → line-disjoint carve-outs → scripted/AST codemod leaving compat shims (re-export
   shims in Python, barrel re-exports in JS/TS, same-package splits in Go, `pub use`
   in Rust) → validate + repair → commit; revert any extraction that reds. Optional
   multi-file concurrency via worktrees.
3. **DEEPEN**: reshape shallow modules / leaky seams (improve-codebase-architecture),
   applied sequentially with revert.

Every mutation is gated by a **CI-faithful validation** step (smoke/compile check +
targeted tests + lint, all via the detected toolchain) measured against a per-round
oracle, and reverted on any *new* failure.
`git clean` is banned; a protected-untracked set is captured at Setup so revert can never
delete pre-existing untracked content (`.venv`, `node_modules`, `archive/`, …).

## Prerequisites

- The target is a **git repository** (absolute path known).
- The repo's **own toolchain** is on PATH (`uv`/`pytest`, `npm`/`tsc`, `go`, `cargo`,
  whatever the detected ecosystem uses). `node` is additionally needed for the bundled
  recon scripts, which run on repos of any language; without it the ORGANIZE stage and
  the org audits are skipped.
- Ideally a clean-ish working tree: Setup will make one baseline commit if it's dirty.
- Work happens on a dedicated branch (default `optimize-codebase/auto`); nothing is pushed.

## How to run it

### First: show the run plan and wait for a yes

The engine runs for a long time, rewrites the tree, and cannot ask anybody
anything once it has started. So nothing starts until the person has seen what
it is about to do. Run the read-only recon:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/scripts/repo-scan.mjs" <repo> --large-min 1500
```

and tell them, in a few lines: the stages you will run and in what order, the
branch the work lands on, and what the scan found for each stage (loose files
at the root and overstuffed directories for ORGANIZE, the files over the line
threshold for DECOMPOSE). Say that ORGANIZE applies its own move plan, round by
round, without stopping to ask, and that every round is validated and reverted
if it reds. Then wait.

A person who asked for the sweep by name has agreed to a sweep, not to this
plan: they still see it, and their go-ahead can be one word. If they want to
read ORGANIZE's move list before anything moves, run `codebase-organizer` on its
own first (it stops for approval between plan and apply), then come back with
`stages: ["decompose", "deepen"]`. The engine enforces the gate from its side:
without `approved: true` it returns an error and changes nothing. Set that
argument only after the yes, never on your own judgment.

### Then: launch the engine

The engine is a Workflow. In a session without that tool, run the same phases
as a parallel-subagent fan-out under the contract in
[../../references/subagent-fallback.md](../../references/subagent-fallback.md):
phases stay sequential, the parent owns the branch and every commit, validation
is the repo's own commands rather than a judgement, and an extraction is not
landed until somebody who did not make it re-runs the checkpoint.

Invoke the bundled dynamic Workflow, resolving all bundled paths via
`${CLAUDE_PLUGIN_ROOT}`. Pass the absolute repo path and today's date (the workflow
sandbox has no clock):

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/optimize-codebase/workflows/optimize-codebase.js",
  args: {
    projectDir: "<absolute repo root>",
    dateToday:  "<YYYY-MM-DD>",
    approved:   true,   // only once the person has seen the run plan and said yes
    // Bundled skill/methodology + tooling: ALWAYS pass these when running from the plugin:
    skillDir:          "${CLAUDE_PLUGIN_ROOT}/skills/improve-codebase-architecture",
    organizerSkillDir: "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer",
    structVerifier:    "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/scripts/verify-structure.mjs",
    scanScript:        "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/scripts/repo-scan.mjs",
    // OPTIONAL: omit to let the Setup DETECT step auto-derive them for the repo:
    //   ecosystem: "python"|"node"|"go"|"rust"|"generic"   // override detection
    //   stages: ["organize","decompose","deepen"]   // subset/order; default = all three
    //   organizeOnly: true                            // or mode: "organize"|"decompose"|"deepen"
    //   target: "src/pkg/huge.py"                     // single-file mode (engine stages only)
    //   maxFiles: 25, deepMaxFiles: 15, fileConcurrency: 3
    //   discoverLines: 1500, targetLines: 1000
    //   branch: "optimize-codebase/auto"
    //   scanRoots, testRoot, keepSet, envSetup, lintCmd, testDirsFor   // detection overrides
    //   smokeCmd, testCmdPrefix, srcExts               // toolchain overrides (any ecosystem)
    //   baseImports                                    // python only: import-smoke module set
    //   orgPlanDir: "<abs scratch dir outside the repo>"
    //   hubs: "on"|"only"|"off", claudeMd: "detect"|true|false   // AGENTS.md hubs (see below)
  }
})
```

**The CLAUDE.md twins.** Beside each hub ORGANIZE writes, it writes a
`CLAUDE.md` twin (a symlink to `AGENTS.md`, or the one line `@AGENTS.md` where a
symlink cannot be made), so Claude Code loads the hub natively. Nobody is asked:
with the default `claudeMd: "detect"`, a repo that has a root `AGENTS.md` and no
root `CLAUDE.md` has chosen to go without twins and gets none; any other repo
gets them. Pass `claudeMd: true` or `false` to overrule the reading, and mention
which way it will go in the run plan.

The Setup **DETECT** step identifies the ecosystem from the repo's manifests
(`pyproject.toml` → python, `package.json` → node, `go.mod` → go, `Cargo.toml` → rust;
none → generic) and fills profile-appropriate defaults for `scanRoots`, `testRoot`,
`keepSet`, `envSetup`, the test/smoke commands, and the linter. The profile also
selects the language mechanics injected into every prompt: compat-shim strategy,
test-seam census, and codemod tooling. **Any explicit arg you pass always wins** over
detection: use the override args above when detection guesses wrong. In `generic`
mode, ORGANIZE runs as-is; DECOMPOSE/DEEPEN need `testCmdPrefix` (or `oracleCmd`)
before they'll mutate anything.

### Choosing stages

- **Whole-repo tidy + split + deepen** (default): omit `stages`. Runs
  `organize → decompose → deepen` (organize first so new modules land in an already-tidy
  tree).
- **Just tidy the tree:** `organizeOnly: true`.
- **Just split god-files:** `mode: "decompose"` (or `stages: ["decompose"]`).
- **Just deepen architecture:** `mode: "deepen"`.
- **One file:** `target: "src/pkg/huge.py"` (organize is skipped in single-file mode).

## Reviewing the results

The workflow returns a rollup and leaves all work as **per-round commits on the branch**: nothing is pushed. Review:

- `organize.total_moves` / `decompose_deepen.files` (per-file `lines_start → lines_end`,
  `extractions_applied`, `convergence`).
- `structure.baseline` to `structure.final`: the structure gate's counts
  (`critical`, `warning`, `info`) before and after the run, and
  `structure.remaining`, what is still critical or a warning at the end. ORGANIZE
  rounds write and refresh hubs, and the engine stages keep them current as files
  move. The ladder (which finding is which severity) is in the organizer's
  `references/agent-hubs.md`.
- Any organize round with `stage: "verify"`: it went red and was put back
  (`reverted: true`); its plan is kept at `plan_path` and the failing output in
  `verification`. `reverted: false` means the revert did not confirm a clean
  tree: look at the branch before trusting what followed.
- Files under `archive/`: cruft the organizer **quarantined** (never deleted); confirm
  before removing.
- `unmerged_conflict_branches`: child branches kept for human review after a
  merge-conflict retry was exhausted (concurrent decompose only).
- The Setup **baseline commit** (if the tree was dirty) is marked "safe to drop later": drop it if you don't want it in history.

Then run the repo's own test suite once more, and merge the branch when satisfied.
Re-running is safe: finished files are skipped on re-discovery, so you can resume after a
budget stop.

## Known issues / limitations (by design)

- **Tiered ecosystem support.** Python is the most battle-tested profile.
  JS/TS, Go, and Rust get first-class profiles (shim strategy, seam census, compile
  gates) with less mileage. Everything else runs `generic`: ORGANIZE works, DECOMPOSE/
  DEEPEN require a caller-supplied test command, and no compat-shim mechanism is
  assumed: extractions rewrite all references and lean on the validation gate.
  Linter-less repos are handled everywhere (per-round lint becomes a no-op).
- **`node` needed for recon.** `repo-scan.mjs`, `verify-hubs.mjs` and
  `verify-structure.mjs` are Node 22 stdlib scripts used on repos of any language;
  without `node` on PATH the ORGANIZE stage and the org audits are skipped (with a
  report note).
- **Pool-reuse batches on approximate line ranges**: in DECOMPOSE reuse passes, disjoint
  batching is judged on line ranges that may have drifted; an accidental overlap self-heals
  via sequential apply + revert but can waste a round.
- **Org-aware placement vs. concurrency**: steering two concurrently-decomposed files
  into the same concern subpackage can collide on shared scaffolding (e.g. a Python
  `__init__.py` or a barrel file; merge conflict → the file is re-run fresh, bounded by
  `mergeRetries`). Lower `fileConcurrency` to 1 if this churns.
- **Chair-unavailable fallback**: if the panel chair (Opus) is unreachable after retries
  but the panel approved with no veto, the change proceeds on consensus with a minimal
  mandate, relying on validate + revert as the safety net.
- **Org audit is observational.** After each DECOMPOSE or DEEPEN commit it runs the
  structure gate and reports the findings that are new against the baseline taken at
  Conventions, narrowed to the touched directories. It never reverts: inside the
  engine a critical structure finding fails only the ORGANIZE round that caused it.
- **ORGANIZE applies without a per-plan stop.** The run plan is approved once, up
  front; each round's move list is not shown before it is applied. Use
  `codebase-organizer` on its own when the person wants to read every move first.
