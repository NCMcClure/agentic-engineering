# Plan format — exact templates

Use these templates verbatim. The **field names and link shapes are checked by
`verify-plan-tree.py`** — `**Sprint**`, `**Type**`, `**GitHub**`, `**Status**`,
the `## ` section headings, the `(issues/NN_issue_SLUG.md)` links in a sprint
table, and the `(NN-slug/sprint.md)` links in an epic table all matter. Deviate
on prose, never on structure.

## Naming

- **Epic dir**: `NN-<kebab-slug>/` (e.g. `01-minimal-core/`).
- **Sprint dir**: `NN-<kebab-slug>/` under its epic (e.g. `01-scaffold/`).
- **Issue file**: `NN_issue_UPPERCASE-SLUG.md` — two-digit prefix, the word `issue`, then an UPPERCASE hyphenated slug (regex: `^[0-9]{2}_issue_[A-Z][A-Z0-9-]+\.md$`). Derive the slug from the title; truncate long slugs.

Numeric prefixes set ordering and must be unique within their directory.

## `index.md` (plan root)

`spec-0-init` left a stub. Replace its "Epics" section with a table, one row per epic:

```markdown
## Epics

| # | Epic | Sprints | Issues | Status |
|---|------|---------|--------|--------|
| 01 | [Minimal Core](01-minimal-core/epic.md) | 3 | 18 | not-started |
| 02 | [Persistence](02-persistence/epic.md) | 4 | 22 | not-started |
|   | **Total** | **7** | **40** | |
```

## `epic.md`

```markdown
# Epic 01: Minimal Core

**Spec anchors**: `spec/01-foundations/overview.md`, `spec/02-runtime/event-loop.md`
**GitHub epic**: <unassigned>
**Status**: not-started
**Issue count**: 18 across 3 sprints

## Goal

One or two sentences naming the coarse, observable outcome that means this epic
is done — phrased so anyone can check it.

## Sprints

| # | Sprint | Issues | Status |
|---|--------|--------|--------|
| 01 | [Scaffold](01-scaffold/sprint.md) | 6 | not-started |
| 02 | [Event intake](02-event-intake/sprint.md) | 7 | not-started |
| 03 | [Read path](03-read-path/sprint.md) | 5 | not-started |

## Sprint sequencing

How the sprints depend on each other (usually a data-flow chain). Where two are
parallel, say so.

## Testing checkpoints

### Coarse observable outcome (epic exit)

> Restate the goal as a checkable sentence.

### Runnable checkpoints

| Check | Command | Expected result |
|-------|---------|-----------------|
| All epic sprints done | `python .plan/plan/plan-status.py check 01` | exit 0 (`01-minimal-core: done`) |
| Plan tree verifier passes | `python .plan/plan/verify-plan-tree.py` | exit 0; `OK: ...` |

## Blocked by

- None (E01 is the root)   <!-- or a link to the prerequisite epic -->

## Blocks

- [E02 Persistence](../02-persistence/epic.md)
```

The `## Sprints` table links — `(01-scaffold/sprint.md)` — must match the sprint
directories on disk exactly (the verifier cross-checks).

## `sprint.md`

```markdown
# Sprint 01-01: Scaffold

**Epic**: [E01 Minimal Core](../epic.md)
**Spec anchors**: `spec/01-foundations/overview.md`
**Status**: not-started

## Goal

One or two sentences: the observable outcome that means this sprint is done.

## Issues

| # | Type | Title | GitHub | Status |
|---|------|-------|--------|--------|
| 01 | AFK | [Project skeleton exists and the verifier passes on it](issues/01_issue_PROJECT-SKELETON-EXISTS-AND-VERIFIER-PASSES.md) | <unassigned> | not-started |
| 02 | AFK | [Event type is defined and round-trips through the store](issues/02_issue_EVENT-TYPE-DEFINED-AND-ROUND-TRIPS.md) | <unassigned> | not-started |
| 03 | REVIEW | [Event intake is visually verified on the dashboard](issues/03_issue_REVIEW-EVENT-INTAKE.md) | <unassigned> | not-started |

## Sprint dependency notes

Issues are parallelizable unless an issue's own `Blocked by` says otherwise.

## Testing checkpoints

### Coarse observable outcome (sprint exit)

> Restate the goal as a checkable sentence.

### Runnable checkpoints

| Check | Command | Expected result |
|-------|---------|-----------------|
| All sprint issues done | `python .plan/plan/plan-status.py check 01-01` | exit 0 (`...: done`) |
| Plan tree verifier passes | `python .plan/plan/verify-plan-tree.py` | exit 0; `OK: ...` |

## Blocked by

- None

## Blocks

- [Sprint 01-02](../02-event-intake/sprint.md)
```

The `## Issues` table links — `(issues/NN_issue_SLUG.md)` — must match the issue
files on disk exactly.

## Issue file: `issues/NN_issue_SLUG.md`

```markdown
# Event type is defined and round-trips through the store

**Sprint**: [01-scaffold](../sprint.md)
**Epic**: [E01 Minimal Core](../../epic.md)
**Type**: AFK
**GitHub**: <unassigned>
**Status**: not-started

## Parent

[Sprint 01-01: Scaffold](../sprint.md)

## What to build

A concise description of this vertical slice — the end-to-end behaviour, not a
layer-by-layer to-do. After this ships, the behaviour in the title is observable
and verifiable on its own.

Anchor: [spec/02-runtime/event-loop.md](../../../../spec/02-runtime/event-loop.md)

## Acceptance criteria

- [ ] The behaviour in the title is implemented end-to-end
- [ ] The testing checkpoint command passes
- [ ] Spec-anchor invariants are preserved (no regression in related behaviour)

## Testing checkpoint

| Check | Command | Expected result |
|-------|---------|-----------------|
| Implementation satisfies the slice | `<command or manual step>` | Acceptance criteria all check off |

## Blocked by

- None - can start immediately
```

### REVIEW issue variant

A `REVIEW` issue is a **human verification gate**, not implementation work. Same
four bold fields and five sections (so the verifier stays green), but the
content is observation-shaped and the filename slug starts `REVIEW-`
(`NN_issue_REVIEW-<SLUG>.md`):

```markdown
# Event intake is visually verified on the dashboard

**Sprint**: [01-scaffold](../sprint.md)
**Epic**: [E01 Minimal Core](../../epic.md)
**Type**: REVIEW
**GitHub**: <unassigned>
**Status**: not-started

## Parent

[Sprint 01-01: Scaffold](../sprint.md)

## What to build

Nothing — this is a **human verification gate**. A developer opens the surface
named below and visually confirms the boundary under review matches the spec:
event submission, storage, and read-back, as observable on the events panel.

Anchor: [spec/03-ui/verification-surfaces.md](../../../../spec/03-ui/verification-surfaces.md)

## Acceptance criteria

- [ ] Every walkthrough step below was performed and the observed result matched
- [ ] Anything off-spec was recorded (a drift file, or routed to spec-4-edit) — not waved through
- [ ] The sign-off is recorded when status flips to done (who verified, on which branch/ref)

## Testing checkpoint

Manual walkthrough — a human performs each step and confirms what they see:

| Step | Where | Do | Expect (per spec) |
|------|-------|----|-------------------|
| 1 | events panel (`make dev`, open `/events`) | submit a valid event via the form | it appears in the list with its id (spec §events-panel) |
| 2 | same | submit an invalid event | rejection with the stated reason (spec §validation) |

## Blocked by

- [Event type is defined and round-trips through the store](./02_issue_EVENT-TYPE-DEFINED-AND-ROUND-TRIPS.md)
```

The `## Testing checkpoint` heading stays (the verifier checks section
presence); its table columns change because no tool parses them. Cut REVIEW
issues per the posture rules in [VERTICAL-SLICES.md](VERTICAL-SLICES.md).

!!! warning "Older workspaces"
    REVIEW plans need the ≥3.3 workspace scripts. On a workspace scaffolded by
    an older plugin version, re-copy `verify-plan-tree.py` and
    `publish-issues.py` into `.plan/plan/` (the spec-0-init backfill exception)
    before publishing — an old `publish-issues.py` silently labels REVIEW
    issues as agent-ready.

### Issue rules the verifier enforces

- All four bold fields present: `**Sprint**`, `**Type**`, `**GitHub**`, `**Status**`.
- `**Type**:` is exactly `AFK`, `HITL`, or `REVIEW` (the verifier rejects anything else).
- All five sections present: `## Parent`, `## What to build`, `## Acceptance criteria`, `## Testing checkpoint`, `## Blocked by`.
- `**GitHub**:` is exactly `<unassigned>` until published, then a real `#NNN` (or tracker reference).
- Every markdown link in `## What to build` that contains `spec/` must resolve — that's the spec anchor. The path from an issue file to the spec is `../../../../spec/...` (issues → sprint → epic → plan → `.plan/` → `spec/`). See [SPEC-ANCHORS.md](SPEC-ANCHORS.md).
- Every markdown link in `## Blocked by` must resolve to a real sibling issue file (use `[title](./NN_issue_OTHER.md)`), or say "None".
