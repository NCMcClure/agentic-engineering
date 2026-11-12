---
name: plan-publish
description: >
  Publishes a sprint of the plan tree to GitHub or GitLab, blockers first, and
  writes each `#NNN` back into the plan. Use when a sprint is about to start
  or the user asks to publish issues; local-markdown mode publishes nothing.
---

# plan-publish: push a sprint to the tracker

Turn the markdown issues in a sprint into tracker tickets and link them back.
The plan tree stays the **source of truth** for structure and dependencies; the
tracker is where work gets grabbed, assigned, and closed. After publishing,
each issue file carries a real reference (`#42`) instead of `<unassigned>`.

## Publish lazily, by sprint

Do not publish the whole plan up front: that produces a wall of stale tickets
for work that is months out and may still change as the spec evolves. Publish
a sprint's issues when that sprint is about to start. Default to one sprint
per run; publish more only if the user asks.

## Read the tracker config first

`.agents/plan/tracker.md` (written by `spec-init`) says where issues go and
how. Read it before doing anything. It is one of:

- **GitHub** (the default): `gh`, with a triage label per issue type and an
  optional Project board. Recipe in [TRACKER-GITHUB.md](TRACKER-GITHUB.md).
- **GitLab**: `glab`, epics as scoped labels and sprints as milestones, on
  gitlab.com or a self-hosted instance, group or personal namespace. Recipe in
  [TRACKER-GITLAB.md](TRACKER-GITLAB.md).
- **Local markdown**: no external tracker; the plan tree is the tracker.
  Procedure in [TRACKER-LOCAL.md](TRACKER-LOCAL.md).

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose. Nothing
is edited or created until the user approves.

### 1. Pick the sprint and read its issues

Confirm which sprint to publish (the user names it, or it is the next one with
`<unassigned>` issues). Read its `sprint.md` and every issue file under its
`issues/`. Note the `Blocked by` chains: they set publish order.

### 2. Run the publisher

The parse, sort, create, write-back loop is deterministic, so it is a script,
not prose: `.agents/plan/plan/publish-issues.mjs`. It reads the forge from
`tracker.md`, publishes blockers before the issues they block (so a blocked
body cites a real `#NNN`), builds each ticket body from the issue file's
`## What to build`, `## Acceptance criteria` and `## Blocked by` sections,
applies the labels (and on GitLab the milestone), and writes `#NNN` into the
issue file and the sprint table at once, per issue. It is idempotent: an
issue that already carries a ref is skipped, so a run that stopped halfway is
finished by running it again.

```bash
node .agents/plan/plan/publish-issues.mjs publish --sprint EE-SS --dry-run  # show the order
node .agents/plan/plan/publish-issues.mjs publish --sprint EE-SS            # create the tickets
```

Show the user the dry-run order before publishing for real. With no
`--sprint`, the script takes the first sprint that still has unpublished
issues; `--all` publishes everything and needs the user's explicit say-so.

It talks to the forge through `gh` or `glab`, whichever `tracker.md` names,
signed in as the person already is. A CLI that is missing or signed out fails
with the one line that fixes it.

### 3. Handle what the script does not

- **GitHub Project board fields** (adding the item, then Epic, Sprint, Type)
  are not scripted: field ids differ per board. Follow
  [TRACKER-GITHUB.md](TRACKER-GITHUB.md) for each created issue when a board
  is configured. GitLab boards are label-driven and need nothing here.
- If the script reports failures (exit 1, a `failures` list in its last
  line), fix the cause and run it again: only the failed issues are retried.

### 4. Status stays untouched

Leave `Status` at `not-started`: publishing makes a ticket exist, it does not
start the work. `plan-status.mjs` owns every later transition.

### 5. Verify and report

Run `node .agents/plan/plan/verify-plan-tree.mjs`: it accepts both
`<unassigned>` and `#NNN`, so a partly published plan still passes. Tell the
user which issues were created, with their references, and which sprint is
now live. `node .agents/plan/plan/publish-issues.mjs status --sprint EE-SS`
reads the tickets back if you want proof.

## What this skill does not do

- It does not create, close, or edit a ticket for an epic or a sprint: only
  for issues. An epic is a label (GitLab) or a board field (GitHub).
- It does not change the plan's structure or acceptance criteria. If those
  need to change, that is `spec-edit`, not a publish.
- It does not mark work done. That is `plan-status.mjs` and `build-next-issue`.
