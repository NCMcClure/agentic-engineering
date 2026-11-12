# {{PROJECT_NAME}} Implementation Plan

<!-- plan-format: 5.0. Do not remove: verify-plan-tree.mjs reads this marker to
     enforce the issue rules that a hand-built tree only gets warned about (the
     **User-facing** line) at CRITICAL level. -->

This tree decomposes the specification at [`../spec/`](../spec/index.md) into an
executable backlog of **tracer-bullet vertical-slice** issues. Its shape mirrors
the spec's progressive-disclosure structure so a reader can descend from this
index to a single issue without losing context.

Tracker references default to `<unassigned>`; real IDs are
filled in when each sprint's issues are published via `plan-publish`.

## Conventions

- Numeric-prefix + kebab-case directories (mirrors `spec/`).
- Issue files: `NN_issue_ISSUE-NAME.md` (uppercase slug, underscores).
- `Tracker: <unassigned>` until published; then the ticket's `#NNN`.
- On publication each issue becomes a ticket on the tracker `../tracker.md`
  names, labelled by type (and, on GitLab, by epic, in a milestone per sprint).
- Each issue cuts a thin end-to-end path and links the spec sections it realises
  ("spec anchors"), so changes propagate and the verifier can check them.

## Epics

<!-- plan-decompose maintains this table: one row per NN-<epic>/ directory. -->

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
