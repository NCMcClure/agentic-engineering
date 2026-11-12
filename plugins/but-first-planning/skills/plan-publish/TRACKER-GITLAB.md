# Publishing to GitLab

For projects tracked on GitLab, gitlab.com or self-hosted, through `glab`.
GitLab takes labels and milestones where GitHub takes Project-board fields,
which turns out simpler: scoped labels are mutually exclusive inside their
scope, and a label-driven board updates itself, so nothing calls a board API.

`.agents/plan/tracker.md` names the project path, its numeric id and the host.
`publish-issues.mjs` and `plan-status.mjs` pin every call to those, so they
mean the same project from any directory.

## How the plan maps

It needs no group-level Epics or Iterations, so it works in a personal
namespace too:

| Plan concept | GitLab object |
|---|---|
| Epic | scoped label `epic::EE-<slug>`, one hue per epic, created when the epic's first sprint is published |
| Sprint | milestone titled `EE-SS <sprint-slug>`, created when the sprint is published |
| Issue | issue; its iid is the `#NNN` in `**Tracker**:` |
| Type | `type::HITL`, `type::AFK`, `type::REVIEW`; a decision issue also gets `decision` |
| Status | open or closed, plus `status::in-progress` and `status::blocked` (the funnel's, never the publisher's) |

Scoped labels (`::`) need a tier that supports them. Check on the instance; on
one that does not, the same names are plain labels and nothing else changes.

## Who does what

- **Publish (`publish-issues.mjs`)** makes the epic label and the sprint
  milestone if they are missing, creates the issue with its epic and type
  labels in that milestone, and writes `**Tracker**: #NNN` back. A new issue
  gets no `status::*` label: open and unlabeled is the backlog.
- **Status (`plan-status.mjs`)** owns every later move: the `status::*` swap,
  close on `done` and reopen on anything else, the blocked reason as a note,
  and a note on a `--cancelled` issue saying it was dropped.

## Changing a published issue

The plan file is the source of truth: regenerate the ticket from it, never
hand-edit both sides.

```bash
node .agents/plan/plan/publish-issues.mjs sync EE-SS-II   # or: sync '#NNN'
```

rebuilds the title and the description. The rest is yours:

```bash
# Type flipped (scoped labels swap inside the type:: scope)
glab issue update <iid> -R <project-path> --label "type::AFK"

# Moved to another sprint (publish that sprint first, so its milestone exists)
glab issue update <iid> -R <project-path> --milestone "EE-SS <sprint-slug>"

# Re-cut or obsolete: say why, then let the funnel close it
glab issue note <iid> -R <project-path> -m "Superseded by #NNN: <reason>"
node .agents/plan/plan/plan-status.mjs set EE-SS-II done --cancelled
```

**Blocked-by ripples.** A ticket body cites its blockers by `#NNN`. When a
dependency is re-cut, `sync` the dependent tickets too. Closing with a note
beats deleting: the board's history stays honest.

## Traps

- `glab issue delete` cannot run without a prompt. A test ticket is removed
  with `glab api -X DELETE projects/<id>/issues/<iid>`; a real one is closed,
  not deleted.
- An iid is never reused: a deleted smoke-test issue keeps its number for
  good. Use `--dry-run` to rehearse, not a throwaway publish.

## Idempotency

An issue that already carries `#NNN` is never created again, and a label or a
milestone that already exists is left as it is.
