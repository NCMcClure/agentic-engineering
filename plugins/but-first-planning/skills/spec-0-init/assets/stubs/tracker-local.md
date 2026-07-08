# Issue tracker: local markdown

This project has no external issue tracker. The plan tree under `plan/` is the
**only** source of truth: each `NN_issue_*.md` file *is* the issue. There is
nothing to publish to and nothing to mirror.

`plan-1-publish-issues` in local mode simply transitions an issue's plan-tree
`Status:` from `not-started` to `in-progress` (and records the active branch, if
any) rather than calling a tracker API. `build-next-issue` reads completion
state from the plan-tree `Status:` fields, the `progress/` log, and git history
(merged branches / commits referencing the issue file).

Status is still set through the funnel `plan/plan-status.py` — in local mode it
updates only the plan-tree markdown surfaces (issue field + sprint/epic tables and
fields + plan index) and makes no `gh` calls:

```bash
python plan/plan-status.py set 01-03-07 in-progress
python plan/plan-status.py set 01-03-07 done --evidence "checkpoint exits 0"
```

## Status vocabulary

Plan-tree `Status:` uses `not-started` / `in-progress` / `blocked` / `done`.
There is no separate "label" — the `Type` field (`HITL` / `AFK`) lives in the
issue file itself.

## Switching to an external tracker later

Re-run `spec-0-init` (or edit this file) to point at GitHub or another tracker. The
plan tree does not change; only the publish/assess steps gain a remote to sync
with.
