---
name: build-sprint
description: Build a whole sprint with coordinated builder subagents from build-next-issue's dispatch plan, integrating serially with HITL gates. Use for autonomy asks — "build the sprint", "agents build epic N".
---

# build-sprint — run the builders that build a sprint

`build-next-issue` says *what* to build — it hands back a dispatch plan:
the parallel-safe frontier, the true dependency DAG, the HITL gates, the
checkpoint health. This skill **runs the builders that build it**. It is the
build-phase orchestrator: one coordinator drives a sprint to completion by fanning
ephemeral builder subagents out across the frontier, integrating their work onto a
sprint branch, and stopping at the human gates.

It does not re-derive plan state (that's `build-next-issue`) or implement a single issue's
tests (that's `build-tdd`, which each builder runs). It owns the layer between
them: **decomposition into safe parallel work, dispatch, integration, and the
human-gated cadence.**

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves. Exit plan mode once the user
approves the cadence, then build.

## Before you start: settle the cadence with the user

These are the user's calls, and they change the run. Surface them first:

- **HITL issues** — pause and ask, auto-implement, or skip-and-flag? (Default: pause and ask — HITL issues were flagged for a human on purpose.)
- **Git discipline** — commit per issue with a PR per sprint, leave uncommitted, push as you go? (Default: commit per issue, one PR per sprint.)
- **Cadence** — stop at each sprint boundary for go-ahead, run to epic completion, or one issue at a time? (Default: stop at each sprint boundary.)
- **Parallelism** — how aggressively to fan out (see the file-overlap rule below).

## The per-sprint loop

1. **Get a fresh dispatch plan.** Run `build-next-issue` (or read its latest report) for the
   current sprint: the wave-ordered frontier, the true DAG, file-overlaps, HITL
   gates, and checkpoint health. If there is no dispatch plan, you are not ready —
   produce one first.
2. **Gate on HITL.** If the frontier's lead is a HITL issue, or an AFK issue
   implicitly depends on one, handle it per the chosen policy *before* fanning out.
   The reliable pattern for "pause and ask" — draft → review → sign-off → commit,
   with factual claims grounded before sign-off — is in
   [ORCHESTRATION.md](ORCHESTRATION.md).
3. **Open a sprint branch** off the integration branch (usually `main`).
4. **Dispatch wave by wave.** For each wave, dispatch the parallel-safe, file-disjoint
   issues to builders; cluster issues that touch the same module into one builder /
   one commit. Each builder implements test-first (`build-tdd`), makes its checkpoint
   *genuinely* runnable (flagging any drift), updates its issue file to `done`, and
   commits. The dispatch and isolation rules — including the ones learned the hard
   way — are in [ORCHESTRATION.md](ORCHESTRATION.md).
5. **Integrate serially, re-checkpoint each time.** Bring each builder's work onto the
   sprint branch one at a time and re-run the full checkpoint suite after each. A
   green sprint branch is the invariant you never break.
6. **Run the sprint-exit checkpoints.** All issues `done`, the Layer-1 tests green,
   the plan-tree verifier green, plus any sprint-specific E2E. If a checkpoint is
   *broken by construction*, say so and route it to `plan-6-edit` — don't let a
   false-negative gate stall a genuinely-complete sprint.
7. **Record and hand back to build-next-issue.** Run `plan-status.py set EE-SS-II done` per
   built issue (the sprint, epic, and index roll up automatically — no separate
   "mark the sprint done" step). Write the per-run narrative to
   `.plan/progress/notes/` and mirror any drift/smells into their own files under
   `.plan/progress/drift/` (one `drift-<slug>.md` each; format in `build-next-issue`).
   Leave the verified-complete ledger rows (`completed/`) to `build-next-issue`, which owns
   verification. Don't hand-edit status anywhere. Open one PR per sprint.
8. **Stop at the boundary** per the cadence, and report: what shipped, verification
   results, any drift flagged, and the next sprint's HITL gates so the human knows
   whether the next leg is autonomous. Make sure no builder subagent is still
   running at the stop point — wait for (or stop) stragglers before reporting.

Then loop: re-assess with `build-next-issue` and build the next sprint.

## The coordination model

- **One coordinator** (you) stays in the driving loop so it can human-gate — pause
  for HITL, stop at sprint boundaries, decide merges. A fire-and-forget background
  run cannot cleanly pause to ask a person.
- **Ephemeral builder subagents**, one per issue or per same-module cluster, each
  scoped to a single slice and dispatched with the `Agent` tool. They report a
  structured result (branch/sha, checkpoint exit, files, status, flags) and finish.
  Builders launched in the background notify the coordinator when they complete, and
  a running builder can be nudged or queried mid-run via `SendMessage`.
- **The build-next-issue DAG is the work list.** Mirror it into the session task
  list (`TaskCreate`, one task per issue, encoding the true dependencies) so
  progress and blocking stay visible, and dispatch strictly in wave order — a task
  is claimable only once its prerequisites have landed and re-checkpointed green.
- The coordinator **never lets two agents write the same working tree concurrently.**
  This is the rule that keeps integration clean; the rationale, the isolation
  model, and the failure mode are in [ORCHESTRATION.md](ORCHESTRATION.md).
- **Giving builders the test-first role:** brief each builder subagent to follow
  `build-tdd` for its slice — the issue's acceptance criteria and spec anchors drive
  its tests. The builder briefing checklist is in
  [ORCHESTRATION.md](ORCHESTRATION.md).

## Autonomous mode

For a fully AFK sprint, offer the bundled workflow instead of coordinating
inline. The cadence questions above become its args; **"pause and ask" is not a
workflow option** (a workflow can't stop mid-run) — map that cadence to
`draft-and-defer`, or stay with the interactive coordinator. One run = one
sprint; for an epic or backlog, loop in the caller: reconcile → build → re-verify,
next sprint.

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-sprint/workflows/build-sprint.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/build-sprint",
    tddSkillPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-tdd/SKILL.md",
    sprint: "EE-SS",
    dispatch: "<the dispatch object, or the .plan/progress/dispatch/EE-SS.json path>",
    // hitlPolicy: "skip-and-flag" (default) | "draft-and-defer" | "auto-implement",
    // parallelism: "serial" (default, robust) | "worktree" (parallel file-disjoint units),
    // openPr: true, maxFailures: 2, prBase: "main"
  }
})
```

Run `build-next-issue`'s reconcile workflow with `dispatch: true` first — the
dispatch JSON is this workflow's required input. Pre-approve the project's
build/test/`gh` commands in permissions before launching, per
[ORCHESTRATION.md](ORCHESTRATION.md), so builders don't stall.

**Converged when** the sprint is complete (or the failure budget stopped the
run — `stoppedEarly`). **The human re-enters through the returned report** —
walk the user through it in this order:

1. **`drafts`** (draft-and-defer) — each drafted artifact's path and its
   judgement calls; the human signs off, then the drafts are committed and their
   issues built next run.
2. **`autoDecisions`** (auto-implement) — every decision an agent made, each
   recorded as an ADR; review or reverse them deliberately.
3. **`failed`** — each failed unit with its route (`plan-6-edit` for
   plan/checkpoint defects, `retry`, or `spec`).
4. **`drift`**, **`sprintExit`**, and the **`prUrl`** — then hand back to
   `build-next-issue`, whose reconcile independently re-verifies everything
   before any ledger row is written.

## Hand off

When the cadence says stop, report the sprint result and point back at
`build-next-issue` to re-derive the next dispatch plan. If the build
surfaced a *plan* problem — a broken checkpoint, an under-declared dependency, a
spec anchor that no longer fits — route it to `plan-6-edit` rather than papering
over it in the build. If a slice needs deeper test-first work than a wave allows,
that's `build-tdd` on its own.
