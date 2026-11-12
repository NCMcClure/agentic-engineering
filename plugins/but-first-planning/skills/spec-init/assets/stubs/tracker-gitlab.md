# Issue tracker: GitLab

Issues for this project are published to GitLab through the `glab` CLI. The
plan tree under `plan/` remains the **source of truth** for structure,
dependencies, and acceptance criteria; GitLab is where work is grabbed,
labeled, and closed.

`plan/publish-issues.mjs` reads this file to learn where and how to publish,
`plan/plan-status.mjs` to keep each ticket in step with the plan, and
`build-next-issue` to learn where to look for completion state.

- **Project**: `{{GITLAB_PROJECT_PATH}}`
- **Project ID**: `{{GITLAB_PROJECT_ID}}`
- **Host**: `{{GITLAB_HOST}}` (where `glab` is signed in)

Group-level Epics and Iterations are not used, so this works in a personal
namespace too: epics are labels and sprints are milestones.

## Label vocabulary

| Label | Meaning |
|---|---|
| `epic::EE-<slug>` | Which epic the issue belongs to. Created by the publisher when an epic's first sprint is published. One hue per epic. |
| `status::in-progress` | Work started (the issue stays open) |
| `status::blocked` | Blocked; the reason is posted as a note |
| `type::HITL` | Needs a human in the loop |
| `type::AFK` | Agent-runnable without supervision |
| `type::REVIEW` | Human visual-verification gate |
| `decision` | A decision issue, in addition to `type::HITL` |

Scoped labels (`::`) need a tier that supports them. Where they are not
supported the same names are plain labels.

## Gate notification

- **Notify**: `{{NOTIFY_HANDLE}}`

When an autonomous run defers on a human gate (a HITL issue it was not
authorized to decide, or any REVIEW issue), it posts one **`Human gate`** note
on the issue mentioning this handle; GitLab emails mentions. Leave it unset to
disable. GitLab never notifies you of your own actions: if the agent's `glab`
is signed in as this same account the note lands and no email is sent, so give
the agent a second account if you want the email.

## Status mapping

| Plan status | GitLab state | Status label |
|---|---|---|
| `not-started` | open | none |
| `in-progress` | open | `status::in-progress` |
| `blocked` | open | `status::blocked`, and the reason as a note |
| `done` | closed | none (status labels are removed on close) |

Every transition goes through the funnel, never by hand on both sides:

```bash
node plan/plan-status.mjs set 01-03-07 in-progress
node plan/plan-status.mjs set 01-03-07 blocked --evidence "waiting on the ADR"
node plan/plan-status.mjs set 01-03-07 done --evidence "checkpoint exits 0"
```

It writes the plan markdown first, then swaps the `status::*` label, closes or
reopens the issue, and posts a blocked reason as a note. `done --cancelled`
closes the issue with a note saying it was dropped. With `glab` missing,
offline, or the issue still `<unassigned>`, the markdown is updated and the
tracker step is a warning.

## Sprints as milestones

One milestone per sprint, titled `EE-SS <sprint-slug>`, created by the
publisher when that sprint is published. Never pre-create milestones for the
whole plan.

## Board (optional)

Give the project board a list for `status::in-progress` and one for
`status::blocked` (the Open list is the backlog, the Closed list is done). It
is label-driven: the funnel's label swaps move the cards.
