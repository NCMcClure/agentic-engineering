# Issue tracker: GitHub

Issues for this project are published as GitHub issues through the `gh` CLI
and, when a board is named below, mirrored into a GitHub Project for a
cross-sprint, cross-epic view. The plan tree under `plan/` remains the
**source of truth** for structure; the tracker is where work is grabbed and
closed.

`plan/publish-issues.mjs` reads this file to learn where and how to publish,
`plan/plan-status.mjs` to keep each ticket in step with the plan, and
`build-next-issue` to learn where to look for completion state. The
repository is the one behind this clone's `origin`.

## Triage labels

The default vocabulary. Edit the Label column to match the repo's own:

| Role | Label | Meaning |
|------|-------|---------|
| ready-for-agent | `ready-for-agent` | Fully specified, ready for an autonomous (AFK) agent |
| ready-for-human | `ready-for-human` | Needs a human in the loop (HITL) |
| ready-for-review | `ready-for-human` | Human visual-verification gate (REVIEW); name a dedicated label here to tell it from HITL |
| needs-info | `needs-info` | Waiting on more information |
| wontfix | `wontfix` | Will not be actioned |

An issue is published with the label for its type. The publisher creates a
label the repo does not have yet.

## Gate notification

- **Notify**: `{{NOTIFY_HANDLE}}`

When an autonomous run defers on a human gate (a HITL issue it was not
authorized to decide, or any REVIEW issue), it posts one **`Human gate`**
comment on the issue mentioning this handle; GitHub emails mentions. Leave it
unset to disable. GitHub never notifies you of your own actions: if the
agent's `gh` is signed in as this same account the comment lands and no email
is sent, so give the agent a second account if you want the email.

## GitHub Project (optional)

- **URL**: `{{PROJECT_BOARD_URL}}`  &nbsp; **Owner**: `{{PROJECT_OWNER}}`  &nbsp; **Number**: `{{PROJECT_NUMBER}}`

| Field  | Type | Allowed values |
|--------|------|----------------|
| Epic   | single-select | one per epic (`E01`, `E02`, ...) |
| Sprint | single-select | `EE-SS` (epic-sprint, `01-01`) |
| Type   | single-select | `HITL`, `AFK`, `REVIEW` |
| Status | single-select (built-in) | `Todo`, `In Progress`, `Done` |

Field and option ids are not stable across boards; look them up when needed:
`gh project field-list <NUMBER> --owner <OWNER> --format json`.

## Who updates what

`plan-publish` creates an issue and, when a board is named above, sets its
Epic, Sprint and Type fields. Every status change after that goes through the
funnel, never by hand:

```bash
node plan/plan-status.mjs set 01-03-07 in-progress
node plan/plan-status.mjs set 01-03-07 blocked --evidence "waiting on the ADR"
node plan/plan-status.mjs set 01-03-07 done --evidence "checkpoint exits 0"
```

It writes the plan markdown first, then closes the issue on `done` (reopens it
on anything else), sets the board item's Status (`not-started` and `blocked`
are `Todo`, `in-progress` is `In Progress`, `done` is `Done`), and posts a
blocked reason as a comment. `done --cancelled` closes the issue as not
planned. With `gh` missing, offline, or the issue still `<unassigned>`, the
markdown is updated and the tracker step is a warning.
