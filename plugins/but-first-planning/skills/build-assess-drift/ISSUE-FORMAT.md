# The GitHub issue for a drift fix

A drift-fix issue isn't a plan-tree issue — it has no epic/sprint and no spec-anchored
acceptance criteria authored up front. It's a grabbable ticket that says *what drifted*,
*where*, and *which skill to use to fix it*, so whoever picks it up (a human, or
`build-next-issue` dispatching an agent) can act without re-deriving the triage.

For the `gh` mechanics — `gh issue create`, reading the repo/labels/board from
`.plan/tracker.md`, mirroring into the GitHub Project, and re-reading to stay idempotent
— follow [plan-1-publish-issues/TRACKER-GITHUB.md](../plan-1-publish-issues/TRACKER-GITHUB.md).
This file only defines the **body shape** and the **label/route mapping**.

## Body template

```markdown
## What's drifting

<the drift write-up, refreshed with the re-assessment finding — what's actually
present in the code today, not the stale original description>

**Where:** <the `where:` location>   **Kind:** <defect | smell | checkpoint-bug | note>
**Drift item:** D<NN> (.plan/progress/drift/drift-<slug>.md)

## How to address it

Use the **<route skill>** skill — <one line on why it's the right tool: e.g.
"this is a spec/plan defect; spec-4-edit edits the affected spec files and keeps
spec ↔ plan ↔ tracker in sync">.

## Acceptance criteria

- [ ] <criterion 1 — the observable change that means the drift is gone>
- [ ] <criterion 2>
```

Keep the title short and specific — the fix, not the symptom (e.g. "Event-loop timing
assumption is unenforced" not "drift D3"). Always carry the `Drift item:` line so the
issue links back to its file; that's what lets a later run see the item is already
ticketed.

## Label and route mapping

The route skill drives both the label and the "How to address it" line:

| `kind`         | Route skill                  | Label            | Why |
|----------------|------------------------------|------------------|-----|
| `defect`       | `spec-4-edit`                | `ready-for-human`| Spec/plan change needs human design judgement. |
| `checkpoint-bug`| `spec-4-edit`               | `ready-for-human`| Fixing a checkpoint is a plan edit. |
| `smell`        | `build-improve-architecture` | `ready-for-agent`| A bounded refactor an agent can drive and verify. |
| `note`         | — (usually no issue)         | —                | An observation; settles to a terminal status. Only routes when it surfaced a latent defect — then route by what that defect *is*. |
| concrete fix   | `build-tdd`                  | `ready-for-agent`| A scoped, test-first code change. |

Use the **exact label strings from `.plan/tracker.md`** — the table's `ready-for-agent`
/ `ready-for-human` are the default canonical names, but a project may have renamed
them. Bump a `ready-for-agent` item to `ready-for-human` if the re-assessment shows the
fix actually needs a human call (e.g. a `smell` whose deepening reopens an ADR).
