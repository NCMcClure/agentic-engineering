# Issue tracker: local markdown

This project has no external issue tracker. The plan tree under `plan/` is the
**only** source of truth: each `NN_issue_*.md` file *is* the issue. There is
nothing to publish to and nothing to mirror.

`plan-publish` in local mode simply transitions an issue's plan-tree
`Status:` from `not-started` to `in-progress` (and records the active branch, if
any) rather than calling a tracker API. `build-next-issue` reads completion
state from the plan-tree `Status:` fields, the `progress/` log, and git history
(merged branches / commits referencing the issue file).

Status is still set through the funnel `plan/plan-status.mjs`. In local mode it
updates only the plan-tree markdown surfaces (the issue field, the sprint and
epic tables and fields, the plan index) and calls no tracker:

```bash
node plan/plan-status.mjs set 01-03-07 in-progress
node plan/plan-status.mjs set 01-03-07 done --evidence "checkpoint exits 0"
```

## Status vocabulary

Plan-tree `Status:` uses `not-started` / `in-progress` / `blocked` / `done`.
There is no separate label: the `Type` field (`HITL` / `AFK` / `REVIEW`)
lives in the issue file itself. There is no notification channel either: when
an autonomous run defers on a HITL or REVIEW gate, the gate surfaces in the
run's report, not as a comment.

## Switching to an external tracker later

Replace this file with the GitHub or GitLab stub from `spec-init`'s assets and
fill its placeholders. The plan tree does not change; only the publish and
status steps gain a remote to keep in step.
