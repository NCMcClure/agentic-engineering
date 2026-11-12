---
name: build-assess-drift
description: >
  Triages recorded drift items against the live code: settles what is fixed or
  by design and opens a routed tracker issue per survivor; it fixes nothing.
  Use when open drift has piled up, at a sprint boundary, or when asked to
  triage drift.
---

# build-assess-drift: is this drift still real, and what's the fix?

`build-next-issue` *records* cross-cutting problems as drift files under
`.agents/plan/progress/drift/`, but nothing ever re-checks them. A noted defect may already
be fixed; a smell may have moved when the code was refactored; a checkpoint bug may
still be biting every run. This skill closes that loop: it re-derives each open
drift item's relevance **from the live code**, plans how to fix the ones that
survive, and turns them into grabbable tracker issues that point the implementer at
the right skill.

It does not implement the fixes. It triages, plans, and tickets, then hands each
item to its route skill (`spec-edit`, `build-improve-architecture`, `build-tdd`)
via a tracker issue. `build-next-issue` is the skill you run afterwards to actually
build those issues.

## What it reads

- `.agents/plan/progress/drift-status.mjs`, the read-only index of every drift item
  (`id / status / kind / where / route / file`). Run it to triage *which* files to
  open, instead of reading the whole `drift/` directory up front. This skill
  *consumes and advances* the drift-file format owned by `build-next-issue`; it does
  not redefine it.
- `.agents/plan/progress/drift/drift-*.md`, the individual write-ups, read only for the
  items the index says are actionable.
- The code each item points at, its `where:` location (a spec path, a sprint, or a
  code location), walked against the tree as it exists today.
- `.agents/plan/tracker.md`, where issues go and how (repo, labels, optional Project board).
- Git history, to tell "fixed since it was surfaced" from "never a real problem."

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose, nothing
is edited or created until the user approves.

### 1. List the drift, then read only what's actionable

Run the index rather than reading every file:

```bash
node .agents/plan/progress/drift-status.mjs --open
```

`--open` lists just the `open` and `routed` items (skip `resolved`, those are
history) as an aligned table of `id / status / kind / where / route / file`. Use that
table to decide which write-ups are worth opening, then read **only those**
`drift/drift-*.md` files for the paragraph that explains what was claimed and where
to look. This keeps the skill cheap even when the drift directory is large.

> **Script missing?** If `.agents/plan/progress/drift-status.mjs` doesn't exist,
> `node "${CLAUDE_PLUGIN_ROOT}/skills/spec-init/scaffold.mjs"` copies it in (it
> writes only files that are missing). As a one-off fallback you can grep
> instead: `grep -l 'status: \(open\|routed\)' .agents/plan/progress/drift/drift-*.md`.

### 2. Re-assess each against the codebase

For every collected item, reach a verdict, **still-relevant**, **already-resolved**,
**changed**, **by-design**, or **human-or-future**: using the method in
[REASSESS.md](REASSESS.md). It reuses the
"re-derive a claim from evidence" posture of
[build-next-issue's ASSESSMENT.md](../build-next-issue/ASSESSMENT.md) and an
`subagent_type=Explore` walk of the `where:` location (the same exploration discipline
as [build-improve-architecture](../build-improve-architecture/SKILL.md)). Record the
evidence that settled each verdict, don't assert relevance, demonstrate it.

### 3. Close what won't become an issue

Some items end here instead of earning a ticket, flip the drift file's `status:` and
note the evidence; don't delete the file, the history stays:

- **already-resolved** → `resolved`, record what convinced you it's fixed.
- **by-design** → `by-design`, record why the code is intentionally this way.
- **human-or-future** → `human-or-future`, record what human decision or future work
  it's parked on.

No issue is created for any of these. Annotating the status with how/when you settled it, `resolved (drift-triage 2026-06-06)`, is fine; tools classify on the leading keyword.

> Drift `status:` is a plain-file lifecycle. `plan-status.mjs` owns plan and tracker
> status; it does **not** own drift files, so advancing a drift item is a direct file
> edit, not a funnel call.

### 4. Plan the fix for the survivors

For each **still-relevant** (or **changed**: re-scoped) item, write a short fix plan:

- **Scope**: what actually needs to change, refreshed by the re-assessment.
- **Route skill**: by `kind`: `defect` → `spec-edit`, `checkpoint-bug` →
  `spec-edit`, architecture `smell` → `build-improve-architecture`, a concrete
  bounded fix → `build-tdd`.
- **Acceptance criteria**: 2-4 checkable bullets that say when the drift is gone.

Present the batch, verdicts, resolutions, and the issues you're about to open, and
get the user's approval before publishing anything.

### 5. Open a tracker issue per survivor

Publish one issue per surviving item on the tracker `.agents/plan/tracker.md`
names. Read the labels and the board from that file, never hardcode them, and
**do not invoke `plan-publish`** (it is sprint and plan-tree bound; drift
items are not).

- Build the body and pick the label per [ISSUE-FORMAT.md](ISSUE-FORMAT.md).
- **GitHub**: `gh issue create --title ... --label <label> --body-file -`,
  the body on stdin; the number is the tail of the URL it prints. If
  `tracker.md` names a Project board, add the issue to it and set its `Type`
  field ([plan-publish's TRACKER-GITHUB.md](../plan-publish/TRACKER-GITHUB.md)
  has the commands); leave `Epic` and `Sprint` unset.
- **GitLab**: `glab issue create -R <project> --title ... --label <label>
  --description ... --yes`; the iid is the tail of the URL it prints. No
  epic label and no milestone.
- **Local markdown**: there is nothing to create. Record the fix plan in the
  drift file and stop.

Drift is not bound to a sprint, and leaving the sprint fields empty keeps the
board honest.

**Idempotency.** If a drift file's `route:` already names a `follow-up issue #NNN`,
it's already published: skip it, never open a duplicate.

### 6. Backfill and advance the drift file

For each item you published, edit its drift file: set
`route: follow-up issue #NNN` and flip `status:` to `routed`. Then refresh the
**Open cross-cutting items** list in `.agents/plan/progress/index.md` so the progress hub
reflects what's now triaged.

### 7. Report

Give the user a tight read: a table of **item × verdict × action** (resolved, or
issue `#NNN` → route skill), and call out anything that needs a human decision, a
**changed** item whose fix is now ambiguous, or a `where:` location that has vanished
and may mean the drift is stale.

## Autonomous mode

At **5+ open items**, offer the bundled workflow, parallel re-assessment with
evidence, serial settling of terminal verdicts, and (opt-in) publishing:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-assess-drift/workflows/triage-drift.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/build-assess-drift",
    // optional: items: ["D1", ...] to limit the run,
    // publish: true, create the tracker issues (default false)
  }
})
```

Two-step gate: run with `publish: false`, present the item × verdict × plan
batch for approval, then re-invoke with `publish: true, items: [<survivor
ids>]`, the second pass is cheap because the first already annotated each
drift file with its verdict. A fully pre-authorized autonomous caller may run
`publish: true` directly. **Converged when** every open item is settled to a
terminal status or routed to a `follow-up issue #NNN`.

Where the session has no `Workflow()` tool, run the same phases with parallel
subagents instead, in the same order, with the parent session owning every
shared file and the status funnel:
[references/subagent-fallback.md](../../references/subagent-fallback.md) is
the contract, and it is what keeps an autonomous run there from quietly
becoming a different, unverified run.

## Scope boundary

The one non-obvious edge: this skill touches only drift `status:` fields (and
the issues it opens), never the plan tree's `Status:` fields, the spec, or the
plan itself. Everything else it hands off is stated where it happens above.
