# Orchestration mechanics — dispatch, isolation, integration

How to run parallel builders without creating the messes they are prone to.
These rules are specific and load-bearing; several were learned by hitting the
failure first.

## Dispatch by the *true* graph, not the declared one

`build-next-issue`'s dispatch plan already recovers implicit dependencies and file-overlaps.
Honour both:

- **Never dispatch an issue whose real prerequisites aren't built**, even if its
  `Blocked by` says `None`. If issue B's checkpoint runs an artifact issue A
  produces, A must land (and re-checkpoint green) before B starts.
- **Only batch issues whose file sets are disjoint.** Two logically-independent
  issues that edit the same file cannot run concurrently in the same tree. When in
  doubt, serialise — a wrong "disjoint" guess costs a merge tangle that costs more
  than the parallelism saved.
- **Cluster same-module issues into one builder.** Three issues that all extend
  `host_profile.py` are one builder doing them in sequence, one commit each — not
  three builders racing the same file.

## Isolation: prefer serial-on-the-branch; worktrees for parallelism

Keep builders from colliding.

- **Serial on the sprint branch (default, robust).** Dispatch builders one at a
  time; each works directly in the main working tree on the sprint branch and
  commits there. No merges, no races. This is the safe default and it is plenty
  fast for most sprints.
- **If you parallelize — one isolated worktree per builder.** Only if each builder
  truly gets its *own* git worktree/checkout (the `Agent` tool's
  `isolation: worktree`). **Verify this** — do not assume the request actually gave
  every agent a separate checkout. Observed failure: of three "isolated" builders,
  only one got its own worktree; the other two shared the main checkout and
  **stacked commits on each other's branch.** It was recoverable only because each
  commit touched disjoint files. If you can't confirm real isolation, fall back to
  serial.

The non-negotiable: **never run two agents that write the same working tree at the
same time.**

## What each builder must do

Brief every builder to:

1. Read the spec anchor and the issue file first.
2. Implement **test-first** (`build-tdd`): red → green → refactor.
3. Make the checkpoint **genuinely runnable**. If the templated checkpoint names
   tooling that doesn't exist yet, build the behaviour, verify against the
   acceptance criteria + the structural verifiers, and **flag the drift** — don't
   invent the missing tooling, and don't fake a pass.
4. Flip status via the funnel — `python .plan/plan/plan-status.py set EE-SS-II done`
   (no `--evidence`; the verified ledger row is build-next-issue's to add). This updates the
   issue file (status + acceptance boxes) and rolls up the sprint/epic/index; never
   hand-edit a `Status` field.
5. Commit **one commit per issue (or per same-module cluster)** on the sprint
   branch, with a message naming the issue/ticket. Do **not** push (the coordinator
   owns the per-sprint PR). `git add` only the issue's files — never `-A`.
6. Report a structured result: branch/sha, checkpoint command + exit code, files
   changed, `done | blocked | partial`, and any drift or merge-risk flag.

## Integration is serial and re-checkpointed

- Bring builder work onto the sprint branch **one at a time**. Disjoint files merge
  cleanly; if two overlap, you batched wrong — resolve and tighten the next wave.
- **Re-run the full checkpoint suite after every integration.** The sprint branch is
  green at every step or you stop and fix it. A green branch is the only state from
  which the next wave may launch.
- Run the status funnel **serially, from the coordinator**, as each builder's work
  lands: `plan-status.py set EE-SS-II done`. The funnel rewrites shared parent files
  (`sprint.md`, `epic.md`, `plan/index.md`), so it must never be fanned out across
  parallel builders/worktrees — only the coordinator runs it, one issue at a time,
  which the serial integration above already guarantees. Write the per-run narrative
  to `.plan/progress/notes/YYYY-MM-DD-NN-MM-slug.md` and mirror any plan/spec defects
  or architecture smells into their own files under `.plan/progress/drift/`
  (one `drift-<slug>.md` each). Keep these bookkeeping
  edits on the same branch but in their own commit, so the issue commits stay clean.

## The scaffolded plan-tree integrity gate

`plan-0-init` doesn't just *describe* a hook — it **scaffolds** one. It drops
`plan-gate.py` into `.plan/plan/` and wires it into the project's
`.claude/settings.json` on the `TaskCompleted` hook event (fires as a task is being
marked done), blocking on exit code `2`.

On that event the gate runs `verify-plan-tree.py` and **blocks (exit 2) only on
*critical* plan-tree corruption** — a `Status` hand-edited into disagreement with its
parents, a broken link, an orphaned spec anchor. So no task is marked done on top of
a corrupted tree. The gate is **read-only and self-disables**
when there's no `.plan/` workspace, so it costs nothing outside plan projects.

Know its boundary, and don't lean on it for more than it does: the gate **cannot run
the per-issue `## Testing checkpoint`.** That command is authored per issue and is
project-specific; a hook only receives `session_id`/`cwd`/`hook_event_name`, not the
issue coords or its checkpoint command. **Re-running each checkpoint green on serial
integration stays the coordinator's job** (see above) — the gate is a corruption
backstop, not a substitute for the checkpoint suite. (`TaskCreated` is available as a
further gate, e.g. to reject out-of-DAG tasks, but is intentionally not scaffolded.)

## Permissions for autonomous runs

Before fanning out for an autonomous run, **pre-approve the common build/test
commands** in your permission settings so builder permission requests don't stall
the cadence mid-wave.

## HITL handling: draft → review → sign-off → commit

When the cadence is "pause and ask," don't block the whole run on a human typing.
Instead:

1. A builder (or you) **drafts** the human-gated artifact (an ADR, a host profile,
   a design doc) to disk — uncommitted.
2. You **review and correct** it; **ground any factual claims** against real sources
   before presenting (e.g. confirm tool/host behaviour against current docs rather
   than shipping a guess).
3. Present the draft with the genuine judgement calls highlighted; the human
   **signs off** or adjusts.
4. Only then commit it as the issue's deliverable.

This keeps autonomous work moving up to the gate while still putting the human
decision where it belongs.

## Failure recovery

- **Stacked/cross-contaminated commits** (isolation misfired): if each commit still
  touches only its own issue's files, you can recover by merging the clean,
  disjoint commits onto a fresh sprint branch and re-checkpointing. Inspect the
  commit contents before trusting them.
- **A builder reports `blocked`/`partial`:** treat its prerequisite as unbuilt, pull
  the dependent issue back into a later wave, and finish the blocker first.
- **A checkpoint is broken by construction** (can never pass): don't loop on it —
  flag it for `plan-6-edit`, verify the slice against its acceptance criteria,
  and record the defect.

## The cadence is the user's, and it's a hard stop

"Stop at each sprint boundary," "run to epic completion," and "one issue at a time"
are real constraints, not suggestions. At a stop point, open the PR, report, and
**wait** — including waiting for the human on every HITL gate the policy says to
pause on. Approval to build one sprint is not approval to build the next.
