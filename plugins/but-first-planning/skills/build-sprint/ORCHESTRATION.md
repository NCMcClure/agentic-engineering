# Orchestration mechanics: dispatch, isolation, integration

How to run parallel builders without creating the messes they are prone to.
These rules are specific and load-bearing; several were learned by hitting the
failure first.

They are for builders inside one session. If agent-works is installed and the
sprint is built on its board instead (one session per issue, each in its own
git worktree, each landing as its own change request), the isolation this
file asks you to verify is given. Everything here still holds for a
`Workflow()` run or a subagent fan-out.

## Dispatch by the *true* graph, not the declared one

`build-next-issue`'s dispatch plan already recovers implicit dependencies and file-overlaps.
Honour both:

- **Never dispatch an issue whose real prerequisites aren't built**, even if its
  `Blocked by` says `None`. If issue B's checkpoint runs an artifact issue A
  produces, A must land (and re-checkpoint green) before B starts.
- **Only batch issues whose file sets are disjoint.** Two logically-independent
  issues that edit the same file cannot run concurrently in the same tree. When in
  doubt, serialise, a wrong "disjoint" guess costs a merge tangle that costs more
  than the parallelism saved.
- **Cluster same-module issues into one builder.** Three issues that all extend
  `host_profile.py` are one builder doing them in sequence, one commit each, not
  three builders racing the same file.

## Isolation: prefer serial-on-the-branch; worktrees for parallelism

Keep builders from colliding.

- **Serial on the sprint branch (default, robust).** Dispatch builders one at a
  time; each works directly in the main working tree on the sprint branch and
  commits there. No merges, no races. This is the safe default and it is plenty
  fast for most sprints.
- **If you parallelize, one isolated worktree per builder.** Only if each builder
  truly gets its *own* git worktree/checkout (the `Agent` tool's
  `isolation: worktree`). **Verify this**: do not assume the request actually gave
  every agent a separate checkout. Observed failure: of three "isolated" builders,
  only one got its own worktree; the other two shared the main checkout and
  **stacked commits on each other's branch.** It was recoverable only because each
  commit touched disjoint files. If you can't confirm real isolation, fall back to
  serial.

The rule all of this serves is stated once, in SKILL.md's coordination model, the coordinator never lets two agents write the same working tree concurrently.
This section is the how and the observed failure when it's violated.

## What each builder must do

Brief every builder to:

1. Read the spec anchor and the issue file first.
2. Implement **test-first** (`build-tdd`): red, green, refactor. A subagent
   loads no skill you did not name, so name in the briefing the ones this
   session has: `/agentic-teamwork:tdd` (the loop and this repo's lane
   commands) and `/code-diet:ladder` (build at the first rung that holds)
   when those plugins are installed.
3. Make the checkpoint **genuinely runnable**. If the templated checkpoint names
   tooling that doesn't exist yet, build the behaviour, verify against the
   acceptance criteria + the structural verifiers, and **flag the drift**: don't
   invent the missing tooling, and don't fake a pass.
3b. Keep the AGENTS.md hubs current (`build-tdd`'s hub
   duties): a new non-leaf directory gets a hub (and a sibling `CLAUDE.md` when
   the root has one that imports `AGENTS.md`), a changed directory's hub is updated in the same commit,
   and no source file lands beside an `AGENTS.md`. The rules live in the root
   `AGENTS.md` / `spec-write`'s CODEBASE-LAYOUT.md.
4. Flip status via the funnel, `node .agents/plan/plan/plan-status.mjs set EE-SS-II done`
   (no `--evidence`; the verified ledger row is build-next-issue's to add). This updates the
   issue file (status + acceptance boxes) and rolls up the sprint/epic/index; never
   hand-edit a `Status` field.
5. Commit **one commit per issue (or per same-module cluster)** on the sprint
   branch, with a message naming the issue/ticket. Do **not** push (the coordinator
   owns the per-sprint PR). `git add` only the issue's files, never `-A`.
6. Report a structured result: branch/sha, checkpoint command + exit code, files
   changed, `done | blocked | partial`, and any drift or merge-risk flag.

## Integration is serial and re-checkpointed

- Bring builder work onto the sprint branch **one at a time**. Disjoint files merge
  cleanly; if two overlap, you batched wrong, resolve and tighten the next wave.
- **Re-run the full checkpoint suite after every integration.** The sprint branch is
  green at every step or you stop and fix it. A green branch is the only state from
  which the next wave may launch.
- Run the status funnel **serially, from the coordinator**, as each builder's work
  lands: `plan-status.mjs set EE-SS-II done`. The funnel rewrites shared parent files
  (`sprint.md`, `epic.md`, `plan/index.md`), so it must never be fanned out across
  parallel builders/worktrees, only the coordinator runs it, one issue at a time,
  which the serial integration above already guarantees. Keep the bookkeeping edits
  (the per-run narrative and drift files SKILL.md step 7 writes) on the same branch
  but in their own commit, so the issue commits stay clean.

## The plan tree is verified by the coordinator

The plan tree's integrity is the coordinator's job, at two points in the
cadence. (A repo can also turn on the plugin's `TaskCompleted` gate with
`"taskGate": true` in `.agents/plan/config.json`; it is a backstop for the
same check, off by default, and no substitute for these two.)

- **Preflight**, before the first builder fans out: `node
  .agents/plan/plan/verify-plan-tree.mjs` exits 0 or 1. A 2 stops the run,
  because a corrupted tree (a `Status` hand-edited into disagreement with its
  parents, a broken link, an orphaned spec anchor) makes every later
  reconciliation wrong.
- **Serial integration**, after each builder's work lands: the same verifier
  again, plus the issue's own `## Testing checkpoint` re-run green. The
  checkpoint is authored per issue and is project-specific, so no generic
  check substitutes for it. Re-running each checkpoint on integration is what
  catches the builder whose branch passed alone and fails beside its siblings.

## Permissions for autonomous runs

Before fanning out for an autonomous run, **pre-approve the common build/test
commands** in your permission settings so builder permission requests don't stall
the cadence mid-wave.

## HITL handling: draft → review → sign-off → commit

When the cadence is "pause and ask," don't block the whole run on a human typing.
Instead:

1. A builder (or you) **drafts** the human-gated artifact (an ADR, a host profile,
   a design doc) to disk, uncommitted.
2. You **review and correct** it; **ground any factual claims** against real sources
   before presenting (e.g. confirm tool/host behaviour against current docs rather
   than shipping a guess).
3. Present the draft with the genuine judgement calls highlighted; the human
   **signs off** or adjusts.
4. Only then commit it as the issue's deliverable.

This keeps autonomous work moving up to the gate while still putting the human
decision where it belongs.

## REVIEW gates: prepare, don't perform

The draft → sign-off pattern does **not** fit `REVIEW` issues, there is
nothing to draft; the human's observation *is* the deliverable. What an agent
may do is **prepare the walkthrough**: confirm the surface serves (the issue's
serve/open step works on the sprint branch), seed any data the steps need, and
restate the walkthrough table with the branch/URL filled in. The human walks
it; the coordinator flips status through the funnel only after the sign-off,
recording who verified and on what ref in the run's progress note, that record
is what `build-next-issue`'s verifier later checks. Auto-implement never
applies.

When the run is headless and `tracker.md` names a `**Notify**` handle, each
deferred gate issue (REVIEW, and HITL under skip/draft policies) gets one
`**Human gate**` @mention comment on the tracker, idempotent (an existing
`Human gate` comment means skip), and skipped entirely in local mode or when
the handle is unset. The self-notification caveat (your own account's actions
don't email you) is documented in the tracker stub.

## Failure recovery

- **Stacked/cross-contaminated commits** (isolation misfired): if each commit still
  touches only its own issue's files, you can recover by merging the clean,
  disjoint commits onto a fresh sprint branch and re-checkpointing. Inspect the
  commit contents before trusting them.
- **A builder reports `blocked`/`partial`:** treat its prerequisite as unbuilt, pull
  the dependent issue back into a later wave, and finish the blocker first.
- **A checkpoint is broken by construction** (can never pass): don't loop on it, flag it for `spec-edit`, verify the slice against its acceptance criteria,
  and record the defect.

## The cadence is the user's, and it's a hard stop

"Stop at each sprint boundary," "run to epic completion," and "one issue at a time"
are real constraints, not suggestions. At a stop point, open the PR, report, and
**wait**: including waiting for the human on every HITL gate the policy says to
pause on. Approval to build one sprint is not approval to build the next.
