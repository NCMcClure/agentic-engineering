---
name: plan-6-edit
description: Change an existing spec or plan, keeping spec, plan tree, and tracker in sync via spec anchors. Use for any change after planning — "the design changed", "add a feature". Requires .plan/.
---

# plan-6-edit — change the plan, keep everything in sync

Once a project has been specced, grilled, architected, and planned, change
doesn't stop — requirements shift, a design assumption breaks, a new feature
arrives. This skill is the front door for all of that. Its job is twofold:
**route** the change to the specialised skill that does the actual work, and
**propagate** the consequences so the spec, the plan tree, and the tracker don't
drift out of agreement.

The danger after initial planning is silent drift: someone edits a spec file and
the issues that realise it quietly become wrong, or a plan issue is rewritten and
the published ticket no longer matches. This skill exists to make change
deliberate and consistent across all three layers.

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves.

### 0a. Pick up inline spec comments

Before anything else, check for `.plan/spec-comments.json` — the review queue the
spec site writes when someone highlights text and leaves a comment. If it exists,
read it and filter to the entries with `"resolved": false`; each unresolved
comment is a requested change. The comment's `specFile` names the spec page it
sits on, so it is exactly the changed-spec-file input the rest of this skill runs
on: it drives **routing** (which owning skill below) and **propagation** (the
spec-anchor grep in [SYNC.md](SYNC.md)). The `quote`/`body` say *what* on that
page to change. (`specFile` is derived from the page URL; if it doesn't resolve
on disk, try the section-index form — replace `<name>.md` with `<name>/index.md`.)

Fold these into the same gated flow as any other change: surface the unresolved
comments to the user before editing. **After** a comment's change lands and
propagates, set that entry's `"resolved"` to `true` in `spec-comments.json` (edit
the file directly — do **not** delete the entry; keeping it preserves the review
trail, and the site reflects the flip on its next refresh). The file's own
`_instructions` field restates this contract for any agent that opens it cold.

## Route the change

Figure out what's really changing and reuse the skill that owns it — don't
reimplement their methods here:

| The change is… | Route to | …then propagate |
|----------------|----------|-----------------|
| New or revised behaviour / a new spec section | `plan-1-specify` | down into the plan |
| Ambiguity, terminology, an internal contradiction | `plan-2-grill-spec` | into spec edits, then plan |
| A structural / architectural rethink | `plan-3-architect-spec` | into spec edits, then plan |
| New work to break out, or re-cutting issues | `plan-4-plan` | into the tracker if published |
| Issues that need to become live tickets | `plan-5-publish-issues` | — |

Most real changes touch several of these in sequence (grill → edit spec →
re-plan the affected sprint). Walk them in order; don't skip the grill just
because the user arrived with a "small" change — small changes are exactly where
drift hides.

The routed skills are user-invoked, so you can't fire them as skills from here:
**read and follow the target's SKILL.md directly** — resolve it relative to this
skill's directory (e.g. `../plan-2-grill-spec/SKILL.md`) and apply its process
in-session, including its bundled reference files and workflows.

## Propagate the consequences

This is the part unique to `plan-6-edit`. After the routed work is done, follow the
change through the layers using the **spec anchors** that link plan issues to
spec files. The full procedure — how to find affected issues, what to do for
published vs unpublished ones, and how to keep anchors valid — is in
[SYNC.md](SYNC.md). The shape of it:

1. **Spec changed?** Find every plan issue whose spec anchor points at the changed file(s). For each, decide: still valid, needs its acceptance criteria updated, needs re-cutting, or now obsolete. Surface the list to the user before editing. For a wide blast radius (roughly **10+ affected issues**), run the bundled propagation workflow after the user approves the list — `Workflow({scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/plan-6-edit/workflows/propagate.js", args: {root, changedSpecFiles, changeSummary}})` — which classifies every affected issue, applies the update/obsolete edits, syncs the published tickets (including blocked-by body ripples), and re-runs both verifiers; it flags `re-cut` verdicts back to you rather than applying them (those route through `plan-4-plan`).
2. **Plan changed?** If the affected issues are already published (have a real tracker reference), the tickets are now stale — sync each ticket from its updated plan file **in the same pass** (SYNC.md's published-issue table says what; `.plan/tracker.md` says how: rebuild bodies, swap labels/milestones, close obsoleted tickets with a reason, publish issues newly added to live sprints). Never silently diverge a live ticket from its plan issue.
3. **Glossary / ADR touched?** A renamed term or a reversed decision can invalidate spec prose and issue titles elsewhere — grep for the old term and reconcile.
4. **Re-verify.** Run both verifiers (`verify-spec-tree.py`, `verify-plan-tree.py`) after edits; a broken anchor link is the tripwire that catches a propagation you missed.

## Autonomous mode

The propagation workflow above IS this skill's autonomous mode. **Converged
when** both verifiers exit 0, every published ticket is synced, and no `re-cut`
verdict is left unpropagated — the workflow returns `recutsNeedingSkill` with
each re-cut's spec anchors so an autonomous caller can feed them straight into
a scoped `plan-4-plan` workflow run (`pages:` = the union of those anchors),
then republish per [SYNC.md](SYNC.md). What stays gated: the affected-issue
list is approved by the user before the workflow runs.

## Keep the source-of-truth order straight

Spec is the source of truth for *what the system is*; the plan is the source of
truth for *what work remains*; the tracker is a live view of the plan. Changes
flow **spec → plan → tracker**, not backwards. If a change originates in the
tracker (someone closed a ticket with a different scope), bring it back to the
plan and spec deliberately rather than letting the three drift.

## Hand off

Summarise what changed in each layer (spec files edited, glossary/ADR updates,
plan issues added/changed/obsoleted, tickets that need tracker action) so the
user has a clear record of the ripple. If the change opened new questions, point
back at `plan-2-grill-spec`; if it created publishable work, point at
`plan-5-publish-issues`; to check overall status, `build-next-issue`.
