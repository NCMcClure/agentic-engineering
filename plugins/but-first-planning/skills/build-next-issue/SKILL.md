---
name: build-next-issue
description: Reconcile plan tree, tracker, and git; verify done-claims; report the next unblocked issue or parallel dispatch plan. Run when build work pauses/resumes, the user asks what's next, or a done-claim needs checking.
---

# build-next-issue — what's done, and what's next

Keep the user from having to remember where things stand. This skill answers two
questions, in order: **what is genuinely complete?** and **what should I build
next?** It does the bookkeeping — reconciling the plan, the tracker, and git —
and verifies that issues claimed "done" actually meet their acceptance criteria,
so "done" means done, not merely closed.

Run it whenever work pauses or resumes. It's idempotent and read-mostly: it reads
state, verifies completion, records it through the status funnel and into
`.plan/progress/`, and reports — it does not implement issues. When work will be built in parallel by multiple builders, its report
also includes a **dispatch plan** — the parallel-safe build frontier — that
`build-sprint` consumes to fan builders out across a sprint.

## What it reads

- The plan tree under `.plan/plan/` — `Status:` fields and `Blocked by` chains.
- `.plan/tracker.md` — where the tracker is and how to query it.
- The tracker itself — closed issues / a Done column (GitHub: `gh issue list --state closed`; local mode: there's no remote, so lean on the plan + git).
- Git history — merged branches and commits that reference an issue file or slug.
- `.plan/progress/completed/` — what was already verified-complete in past runs (per-epic ledgers); `.plan/progress/notes/` — past reconciliation narrative.
- `.plan/progress/drift/` — open cross-cutting items (`status: open` or `routed`) and any `route: follow-up issue #NNN` they've been ticketed as. Untriaged drift (`open`) is work waiting to be turned into issues by `build-assess-drift`; routed drift points at a real follow-up issue you can build.
- **Implicit dependencies** — derived, not declared: artifacts an issue's *checkpoint command* or *What to build* needs that another issue produces. A `Blocked by: None` routinely hides a real ordering; see [DISPATCH-PLAN.md](DISPATCH-PLAN.md).

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves.

### 1. Gather state from all sources

Pull the four signals above. Expect them to disagree — an issue can be `done` in
the plan but its ticket still open, or a ticket closed but the plan never updated,
or a branch merged with no status change anywhere. Those disagreements are the
point; surface them rather than trusting any single source.

### 2. Verify the "done" claims

For every issue marked `done` (in the plan) or closed (in the tracker) that
`progress/completed/` hasn't already recorded as verified, **check the claim** rather than taking it
at face value. Run the issue's testing-checkpoint command, confirm the acceptance
criteria are actually satisfiable, and confirm the spec anchors still resolve.
The full method — and how strict to be — is in [ASSESSMENT.md](ASSESSMENT.md). An
issue passes only when its own checkpoint passes; if it doesn't, it's not done,
and that goes in the report.

### 3. Record progress (through the funnel)

Never hand-edit a `Status` field or a ledger by retyping. Drive everything through
`plan-status.py`:

- **Reconcile status to reality.** For each issue whose real state differs from the
  plan, run `python .plan/plan/plan-status.py set EE-SS-II <status>` — flip a
  genuinely-finished issue to `done`, or a falsely-done one back to `in-progress`
  (or `blocked`). The funnel rolls the change up through the sprint/epic tables and
  fields, the plan index, and the tracker in one step.
- **Log verified-complete work.** When an issue passes verification, record it with
  `set EE-SS-II done --evidence "<what convinced you>"` — this appends a row to
  `.plan/progress/completed/<epic>.md` (the per-epic ledger). Pass `--evidence` only
  when *you* have verified it; that's what keeps unverified rows out of the ledger.
- **Write the reconciliation narrative** for this run to a new
  `.plan/progress/notes/YYYY-MM-DD-NN-MM-slug.md` file (one file per run): build/verify
  method, issues that claimed done but failed, plan/tracker drift, merged-but-unmarked
  work, checkpoint health, test totals. Mirror any cross-cutting plan/spec defect or
  architecture smell into its own file under `.plan/progress/drift/` — one
  `drift-<slug>.md` per item — so it's tracked once, not restated every run. This
  skill owns the drift-file format — frontmatter fields, status lifecycle, and the
  one-time old-workspace migration are in [DRIFT-FORMAT.md](DRIFT-FORMAT.md); reuse
  an existing item's file (bump its `status`) rather than opening a duplicate for a
  recurring one.
- **Refresh the snapshot.** Update the `## Status snapshot` and `## Open cross-cutting
  items` lists in `.plan/progress/index.md` from the current roll-up
  (`plan-status.py check` gives you the rolled-up numbers).

### 4. Select the next issue

**Check for drift first.** Before walking the plan tree, glance at the open drift
items. If any are still `status: open` (recorded but never triaged), recommend running
`build-assess-drift` to re-assess them against the live code and turn the real ones into
issues. Drift that's already `routed` to a `follow-up issue #NNN` is buildable work too —
treat those follow-up issues as candidates alongside the plan-tree issues below.

Pick the **single** next issue to implement: the lowest-numbered `not-started`
issue whose blockers are all verified-complete, respecting sprint and epic order.
The selection rule (and how to handle ties, parallel-available issues, and a fully
blocked frontier) is in [NEXT-SELECTION.md](NEXT-SELECTION.md).

### 4b. Build the dispatch plan (for parallel builds)

One next issue tells a person where to start; a *parallel build* needs the whole
parallel-safe frontier. Derive the set of issues that can be built **now,
concurrently, without colliding**, plus the dependency edges and file-overlaps
among the rest, so an orchestrator (`build-sprint`) can fan out without
tripping over undeclared dependencies. The method — recovering implicit
dependencies (the `Blocked by: None` that lies), file-overlap batching, the
per-sprint human-gate (HITL/REVIEW) map, and the wave-ordered output shape — is in
[DISPATCH-PLAN.md](DISPATCH-PLAN.md). Skip this step when you're only answering
"what's the one next thing" for a human.

### 5. Report

Give the user a tight status read:

- **Where we are** — issues complete vs total, current sprint, % through the current epic.
- **Anything off** — issues that claimed done but failed verification; plan/tracker drift (point at `spec-4-edit` if the *plan* is wrong, not just the bookkeeping); open cross-cutting drift items (point at `build-assess-drift` to triage them into issues, and list any drift-derived `follow-up issue #NNN` in the buildable set).
- **Next issue** — its title, type (HITL/AFK/REVIEW), tracker reference (or `<unassigned>`), spec anchors, and acceptance criteria, so the user (or an agent) can start immediately without opening anything else.
- **On deck** — the 1–3 issues that unlock after the next one, so the path is visible.
- **Dispatch plan** *(parallel builds)* — the wave-ordered frontier (issues safe to build concurrently now), the intra-sprint dependency DAG, and file-overlap hints. This is the hand-off to `build-sprint`.
- **Human gates** — the HITL and REVIEW issues in the current/next sprint and whether any AFK work depends on them, so it's clear up front whether the sprint runs autonomously or stalls on a human.
- **Checkpoint health** — any checkpoint that isn't runnable in the current tree (names tooling not built yet) or can't pass by construction (a pattern that never matches the real artifact). These are issue defects, not failures — route them to `spec-4-edit`.

If the next issue is `<unassigned>` (its sprint hasn't been published), note that
the user should run `plan-1-publish-issues` for that sprint first.

## Autonomous mode

When **5+ done-claims** need verification, or a parallel build needs a dispatch
plan, offer the bundled workflow — four parallel state readers, an independent
checkpoint verifier per done-claim, one serial funnel/bookkeeping agent, and a
selection stage that can also emit the dispatch JSON:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-next-issue/workflows/reconcile.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/build-next-issue",
    // optional: scope: "EE" or "EE-SS" to bound the run,
    // dispatch: true  — also derive the dispatch plan and write
    //                   .plan/progress/dispatch/EE-SS.json (the build-sprint contract),
    // verifyLimit: 20 — cap the verification fan-out (deferred claims are reported, never passed)
  }
})
```

**Converged when** every in-scope done-claim is verified or explicitly flagged
(failed / not-yet-runnable / broken-checkpoint) and, with `dispatch: true`, the
dispatch JSON exists. Nothing stays gated — this run is read-mostly and records
only through the funnel; it's the verification layer the other autonomous modes
lean on.

## Why verify, not just count

A plan that trusts its own `done` flags drifts into fiction — issues get closed
optimistically, acceptance criteria go unmet, and the "next issue" sits on a
foundation that isn't really there. Re-deriving completion from runnable
checkpoints and git, every time, is what makes the progress report trustworthy
enough to act on without double-checking.
