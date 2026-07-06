---
name: build-assess-drift
description: Triage recorded drift against the live code — resolve what's already fixed, park what's by-design, and open a routed tracker issue per surviving item.
disable-model-invocation: true
---

# build-assess-drift — is this drift still real, and what's the fix?

`build-next-issue` *records* cross-cutting problems as drift files under
`.plan/progress/drift/`, but nothing ever re-checks them. A noted defect may already
be fixed; a smell may have moved when the code was refactored; a checkpoint bug may
still be biting every run. This skill closes that loop: it re-derives each open
drift item's relevance **from the live code**, plans how to fix the ones that
survive, and turns them into grabbable GitHub issues that point the implementer at
the right skill.

It does not implement the fixes. It triages, plans, and tickets — then hands each
item to its route skill (`plan-6-edit`, `build-improve-architecture`, `build-tdd`)
via a GitHub issue. `build-next-issue` is the skill you run afterwards to actually
build those issues.

## What it reads

- `.plan/progress/drift-status.py` — the read-only index of every drift item
  (`id / status / kind / where / route / file`). Run it to triage *which* files to
  open, instead of reading the whole `drift/` directory up front. This skill
  *consumes and advances* the drift-file format owned by `build-next-issue`; it does
  not redefine it.
- `.plan/progress/drift/drift-*.md` — the individual write-ups, read only for the
  items the index says are actionable.
- The code each item points at — its `where:` location (a spec path, a sprint, or a
  code location), walked against the tree as it exists today.
- `.plan/tracker.md` — where issues go and how (repo, labels, optional Project board).
- Git history — to tell "fixed since it was surfaced" from "never a real problem."

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves.

### 1. List the drift, then read only what's actionable

Run the index rather than reading every file:

```bash
python .plan/progress/drift-status.py --open
```

`--open` lists just the `open` and `routed` items (skip `resolved` — those are
history) as an aligned table of `id / status / kind / where / route / file`. Use that
table to decide which write-ups are worth opening, then read **only those**
`drift/drift-*.md` files for the paragraph that explains what was claimed and where
to look. This keeps the skill cheap even when the drift directory is large.

> **Older workspace?** If `.plan/progress/drift-status.py` doesn't exist (the
> workspace predates it), backfill it by copying `plan-0-init`'s
> `assets/drift-status.py` to `.plan/progress/drift-status.py` (the idempotent
> backfill in `plan-0-init`'s "When NOT to scaffold"). As a one-off fallback you can
> grep instead: `grep -l 'status: \(open\|routed\)' .plan/progress/drift/drift-*.md`.

### 2. Re-assess each against the codebase

For every collected item, reach a verdict — **still-relevant**, **already-resolved**,
**changed**, **by-design**, or **human-or-future** — using the method in
[REASSESS.md](REASSESS.md). It reuses the
"re-derive a claim from evidence" posture of
[build-next-issue's ASSESSMENT.md](../build-next-issue/ASSESSMENT.md) and an
`subagent_type=Explore` walk of the `where:` location (the same exploration discipline
as [build-improve-architecture](../build-improve-architecture/SKILL.md)). Record the
evidence that settled each verdict — don't assert relevance, demonstrate it.

### 3. Close what won't become an issue

Some items end here instead of earning a ticket — flip the drift file's `status:` and
note the evidence; don't delete the file, the history stays:

- **already-resolved** → `resolved` — record what convinced you it's fixed.
- **by-design** → `by-design` — record why the code is intentionally this way.
- **human-or-future** → `human-or-future` — record what human decision or future work
  it's parked on.

No issue is created for any of these. Annotating the status with how/when you settled it
— `resolved (drift-triage 2026-06-06)` — is fine; tools classify on the leading keyword.

> Drift `status:` is a plain-file lifecycle. `plan-status.py` owns plan and tracker
> status; it does **not** own drift files, so advancing a drift item is a direct file
> edit, not a funnel call.

### 4. Plan the fix for the survivors

For each **still-relevant** (or **changed** — re-scoped) item, write a short fix plan:

- **Scope** — what actually needs to change, refreshed by the re-assessment.
- **Route skill** — by `kind`: `defect` → `plan-6-edit`, `checkpoint-bug` →
  `plan-6-edit`, architecture `smell` → `build-improve-architecture`, a concrete
  bounded fix → `build-tdd`.
- **Acceptance criteria** — 2-4 checkable bullets that say when the drift is gone.

Present the batch — verdicts, resolutions, and the issues you're about to open — and
get the user's approval before publishing anything.

### 5. Open a GitHub issue per survivor

Publish one issue per surviving item, *inspired by* the recipe in
[plan-5-publish-issues/TRACKER-GITHUB.md](../plan-5-publish-issues/TRACKER-GITHUB.md) —
read `.plan/tracker.md` for the repo/labels/board, don't hardcode them, and **don't
invoke `plan-5-publish-issues`** (it's sprint/plan-tree-bound; drift items aren't).

- Build the body and pick the label per [ISSUE-FORMAT.md](ISSUE-FORMAT.md).
- `gh issue create` with that label; capture the issue number from the printed URL.
- If `tracker.md` names a Project board, mirror the issue in and set its `Type` field.
  Leave `Epic`/`Sprint` unset — drift isn't bound to a sprint, and saying so keeps the
  board honest.

**Idempotency.** If a drift file's `route:` already names a `follow-up issue #NNN`,
it's already published — skip it, never open a duplicate.

### 6. Backfill and advance the drift file

For each item you published, edit its drift file: set
`route: follow-up issue #NNN` and flip `status:` to `routed`. Then refresh the
**Open cross-cutting items** list in `.plan/progress/index.md` so the progress hub
reflects what's now triaged.

### 7. Report

Give the user a tight read: a table of **item × verdict × action** (resolved, or
issue `#NNN` → route skill), and call out anything that needs a human decision — a
**changed** item whose fix is now ambiguous, or a `where:` location that has vanished
and may mean the drift is stale.

## Autonomous mode

At **5+ open items**, offer the bundled workflow — parallel re-assessment with
evidence, serial settling of terminal verdicts, and (opt-in) publishing:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-assess-drift/workflows/triage-drift.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/build-assess-drift",
    // optional: items: ["D1", ...] to limit the run,
    // publish: true — create the tracker issues (default false)
  }
})
```

Two-step gate: run with `publish: false`, present the item × verdict × plan
batch for approval, then re-invoke with `publish: true, items: [<survivor
ids>]` — the second pass is cheap because the first already annotated each
drift file with its verdict. A fully pre-authorized autonomous caller may run
`publish: true` directly. **Converged when** every open item is settled to a
terminal status or routed to a `follow-up issue #NNN`.

## What this skill does not do

- It does not implement the fix — that's the route skill the issue points at.
- It does not edit the spec or plan, or touch any `Status:` field — only drift
  `status:` and the issue it opens.
- It does not redefine the drift-file format — `build-next-issue` owns it.
- It does not invoke `plan-5-publish-issues`; it only borrows its GitHub recipe.
