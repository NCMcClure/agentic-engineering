# Issue tracker: GitHub

Issues for this project are published as GitHub issues via the `gh` CLI, and
mirrored into a GitHub Project for a cross-sprint, cross-epic view. The plan tree
under `plan/` remains the **source of truth** for structure; the project board is
a denormalised query surface.

`plan-1-publish-issues` reads this file to learn where and how to publish;
`build-next-issue` reads it to learn where to look for completion state.

## CLI conventions

- **Create**: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies).
- **Read**: `gh issue view <number> --comments`.
- **List**: `gh issue list --state all --json number,title,state,labels`.
- **Label**: `gh issue edit <number> --add-label "ready-for-agent"`.
- **Close**: `gh issue close <number> --comment "..."`.

The repo is inferred from `git remote -v` when `gh` runs inside the clone.

## Triage labels

Default canonical vocabulary (edit the right column to match your repo):

| Role | Label | Meaning |
|------|-------|---------|
| ready-for-agent | `ready-for-agent` | Fully specified, ready for an autonomous (AFK) agent |
| ready-for-human | `ready-for-human` | Requires human implementation (HITL) |
| ready-for-review | `ready-for-human` | Human visual-verification gate (REVIEW) — point at a dedicated label to distinguish it from HITL |
| needs-info | `needs-info` | Waiting on more information |
| wontfix | `wontfix` | Will not be actioned |

Issues are published with `ready-for-agent` by default (override per issue for
HITL slices → `ready-for-human`, REVIEW gates → the ready-for-review label).

## Gate notification

- **Notify**: `{{NOTIFY_HANDLE}}`

When an autonomous run defers on a human gate (a HITL issue it wasn't
authorized to decide, or any REVIEW issue), it posts one **`Human gate`**
comment on the tracker issue @mentioning this handle — GitHub emails mentions.
Leave unset to disable. Caveat: GitHub never notifies you of your **own**
actions, so if the agent's `gh` CLI is authenticated as this same account the
comment lands but no email is sent — use a bot/second account for the agent if
you want real emails.

## GitHub Project (optional but recommended)

- **URL**: `{{PROJECT_BOARD_URL}}`  &nbsp; **Owner**: `{{PROJECT_OWNER}}`  &nbsp; **Number**: `{{PROJECT_NUMBER}}`

Field and option IDs are not stable across project recreation — look them up at
runtime: `gh project field-list <NUMBER> --owner <OWNER> --format json`.

| Field  | Type | Allowed values |
|--------|------|----------------|
| Epic   | single-select | one per epic (e.g. `E01`, `E02`, …) |
| Sprint | single-select | `NN-MM` (epic-sprint, e.g. `01-01`) |
| Type   | single-select | `HITL`, `AFK`, `REVIEW` |
| Status | single-select (built-in) | `Todo`, `In Progress`, `Done` |

Plan-tree `Status:` maps to project Status as `not-started → Todo`,
`in-progress → In Progress`, `done → Done`. `blocked` stays `Todo` with the
blockage surfaced in the issue body/labels.

## Who updates Status

Ongoing Status transitions are **not** done by hand or by `plan-1-publish-issues`.
The funnel `plan/plan-status.py` owns them: on every issue flip it closes/reopens
the GitHub issue and sets the project Status option (looking the field/option IDs
up at runtime), reading the **Owner** and **Number** above from this file. It
implements the mapping in the preceding paragraph. `plan-1-publish-issues` only
*creates* issues and sets the immutable Epic/Sprint/Type fields; new issues land
in `Todo`. If `gh` is unavailable or an issue is still `<unassigned>`, the funnel
updates the plan markdown and warns rather than failing.

If the project has an "Auto-add to project" workflow for `ready-for-agent`
issues, the add happens automatically — but Epic/Sprint/Type still must be set
explicitly after creation.
