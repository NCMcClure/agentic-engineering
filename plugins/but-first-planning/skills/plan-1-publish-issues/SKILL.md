---
name: plan-1-publish-issues
description: Publish a sprint's issues to the configured tracker (GitHub, GitLab, or local) in dependency order via the bundled publish-issues.py, backfilling real #NNN refs into the plan.
disable-model-invocation: true
---

# plan-1-publish-issues — push a sprint to the tracker

Turn the markdown issues in a sprint into real tracker tickets and link them back.
The plan tree stays the **source of truth** for structure and dependencies; the
tracker is where work gets grabbed, assigned, and closed. After publishing, each
issue file carries a real reference (e.g. `#42`) instead of `<unassigned>`.

## Publish lazily, by sprint

Don't publish the whole plan up front — that produces a wall of stale tickets for
work that's months out and may still change as the spec evolves. Publish a
sprint's issues when that sprint is about to start. Default to one sprint per run;
publish more only if the user asks.

## Read the tracker config first

`.plan/tracker.md` (written by `spec-0-init`) says where issues go and how. Read it
before doing anything. It will point at one of:

- **GitHub** (default) — `gh` CLI plus an optional GitHub Project board. Full recipe in [TRACKER-GITHUB.md](TRACKER-GITHUB.md).
- **GitLab** — `glab` CLI; epics as scoped labels, sprints as milestones, label-driven boards. Works on self-hosted instances and personal namespaces. Full recipe in [TRACKER-GITLAB.md](TRACKER-GITLAB.md).
- **Local markdown** — no external tracker; the plan tree *is* the tracker. Procedure in [TRACKER-LOCAL.md](TRACKER-LOCAL.md).
- **Another tracker** — follow the conventions recorded in `tracker.md`; the GitHub/GitLab recipes are the templates to adapt.

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves.

### 1. Pick the sprint and read its issues

Confirm which sprint to publish (the user names it, or it's the next one with
`not-started` issues). Read its `sprint.md` and every issue file under its
`issues/`. Note the `Blocked by` chains — they set publish order.

### 2. Run the bundled publisher

The parse → toposort → create → backfill loop is deterministic, so it's a script,
not prose: `publish-issues.py` (bundled in this skill's `assets/`, copied to
`.plan/plan/` by `spec-0-init` — backfill it from `assets/` if an older workspace
lacks it). It reads the tracker backend from `tracker.md`, publishes blockers
before the issues they block (so blocked bodies cite real `#NNN` refs), builds
each ticket body from the issue file's `## What to build` / `## Acceptance
criteria` / `## Blocked by` sections, applies the epic/type labels, and backfills
`**GitHub**: #NNN` into the issue file and sprint table immediately per issue.
It is idempotent — issues that already carry a ref are skipped.

```bash
python .plan/plan/publish-issues.py publish --sprint EE-SS --dry-run  # show the order
python .plan/plan/publish-issues.py publish --sprint EE-SS            # create the tickets
```

Show the user the dry-run order before publishing for real. With no `--sprint`,
the script publishes the first sprint that still has unpublished issues (the lazy
default); `--all` publishes everything and needs the user's explicit say-so.

### 3. Handle what the script doesn't

- **GitHub Project board mirroring** (item-add + Epic/Sprint/Type fields) is not
  scripted — field IDs aren't stable across projects. Follow
  [TRACKER-GITHUB.md](TRACKER-GITHUB.md) for each created issue if a board is
  configured. (GitLab boards are label-driven and need nothing here.)
- If the script reports failures, fix the cause and re-run — idempotency means
  only the failed issues are retried.

### 4. Status stays untouched

Leave `Status` at `not-started` (publishing makes a ticket exist; it doesn't
start the work). The tracker's own state, not this step, reflects progress —
`build-next-issue` reconciles the two later.

### 5. Verify and report

Run `python .plan/plan/verify-plan-tree.py` — it accepts both `<unassigned>` and
`#NNN`, so a partially-published plan still passes. Tell the user which issues
were created (with their references) and which sprint is now live.

## What this skill does not do

- It does not close, reopen, or edit a **parent** epic/sprint ticket — only the issues.
- It does not change the plan's structure or acceptance criteria — if those need to change, that's `spec-4-edit`, not a publish.
- It does not mark work done — that's the tracker plus `build-next-issue`.
