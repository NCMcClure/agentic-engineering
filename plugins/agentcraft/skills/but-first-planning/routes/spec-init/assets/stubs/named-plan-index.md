# {{TITLE}}: implementation plan

<!-- plan-format: 5.0. Do not remove: verify-plan-tree.mjs reads this marker to
     enforce the issue rules that a hand-built tree only gets warned about (the
     **User-facing** line) at CRITICAL level. -->

This tree decomposes the specification at [`../spec/`](../spec/index.md) into
**tracer-bullet vertical-slice** issues. It is the plan of one named workspace,
`.agents/plans/{{NAME}}/`, so an issue here is said with the workspace's name:
`{{NAME}}.EE-SS-II`.

Tracker references default to `<unassigned>`; real IDs are filled in when a
sprint's issues are published via `plan-publish`.

## Conventions

- Numeric-prefix + kebab-case directories.
- Issue files: `NN_issue_ISSUE-NAME.md` (uppercase slug, underscores).
- `Tracker: <unassigned>` until published; then the ticket's `#NNN`.
- Issues are published where `tracker.md` says: this workspace's own if it has
  one, else the project's (`.agents/plan/tracker.md`), else nowhere. A ticket
  carries the workspace's name (a `plan:{{NAME}}` label on GitHub; the epic
  label and the milestone on GitLab).
- Each issue cuts a thin end-to-end path and links the spec pages it realises
  ("spec anchors"), so changes propagate and the verifier can check them.

## Epics

<!-- plan-decompose maintains this table: one row per NN-<epic>/ directory. A
     plan this size is often one epic. -->

_No epics yet. Run `plan-decompose` to decompose the spec into epics, sprints, and issues._

Status legend: `not-started` / `in-progress` / `blocked` / `done`.

## Verification

Run `node plan/verify-plan-tree.mjs` to assert the tree is well-formed
(structure, required fields, blocked-by links, and spec-anchor integrity).

## Status

Never hand-edit a `Status` field or table cell. Run `node plan/plan-status.mjs
set EE-SS-II <status>`: it propagates the change across the issue file, the
sprint/epic tables and fields, this index, and the tracker in one deterministic
step. `node plan/plan-status.mjs check [EE[-SS[-II]]]` reports the rolled-up
status and verifies every surface agrees.

The scripts in this workspace are launchers: each runs the copy every named
workspace shares, `.agents/plans/_scripts/`, against this one.
