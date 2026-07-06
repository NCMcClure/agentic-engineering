# Keeping spec ↔ plan ↔ tracker in sync

Change propagates along the **spec anchors** that link plan issues to the spec
files they realise (see `plan-4-plan`'s SPEC-ANCHORS reference). Because anchors are
concrete relative paths, you can mechanically find what a change affects. This
file is the procedure for doing that without leaving drift behind.

## Finding the issues a spec change affects

When one or more spec files change, find every plan issue anchored to them. Grep
the plan tree for the spec path:

```bash
# Which issues realise spec/02-runtime/event-loop.md ?
grep -rl "spec/02-runtime/event-loop.md" .plan/plan/*/*/issues/
```

(Anchors in issue files use a `../../../../spec/...` prefix, but the readable
link text and the `**Spec anchors**` lines in epic/sprint files contain the bare
`spec/...` path, so grepping the bare path finds them. Epics and sprints carry
anchors too — check those for coarser ripples.)

For each affected issue, classify and act:

| Situation | Action |
|-----------|--------|
| The change doesn't touch what the issue builds | Leave it; note you checked |
| The behaviour changed but the slice is still one slice | Update the issue's `## What to build` and `## Acceptance criteria`; bump nothing else |
| The slice is now too big / too small | Re-cut via `plan-4-plan` (split, merge, or replace), preserving anchors |
| The spec section is gone | The issue is obsolete — mark it, and if published, close the ticket with a reason |

Surface the affected-issue list to the user **before** editing, so they see the
blast radius of the spec change.

## Published vs unpublished issues

- **Unpublished** (`**GitHub**: <unassigned>`): edit freely — no external ticket exists yet.
- **Published** (a real reference like `#42`): the plan issue and the live ticket are now out
  of agreement, and editing the plan file is not enough. **Sync the ticket as part of the
  propagation** — don't stop at flagging it. A live ticket that quietly diverges from its plan
  issue is the worst drift because someone may already be building it.

Never edit a published issue's scope without also surfacing the ticket that needs
to change.

### Syncing published tickets

The plan file stays the source of truth: after the plan-side edit lands, **regenerate the
ticket from the file** rather than hand-editing both sides. The tracker mechanics (commands,
label vocabulary, body shape) live in `.plan/tracker.md` and the matching
`plan-5-publish-issues` reference (TRACKER-GITHUB.md / TRACKER-GITLAB.md); the bundled
`publish-issues.py sync --iid NNN` rebuilds a ticket's title/body from its plan file
mechanically. This table is *what* to do; those are *how*:

| Plan-side change | Ticket action |
|------------------|---------------|
| `## What to build` / `## Acceptance criteria` edited | Rebuild the ticket body from the issue file; update the title if the H1 changed |
| Issue re-cut (split / merge / replace) | Close the old ticket with a comment linking its replacement(s); publish the new issue(s); backfill the new refs |
| Issue obsolete (spec section gone) | Close the ticket with the reason; mark the plan issue |
| New issue added to an **already-published sprint** | Publish it immediately — a plan-only issue in a live sprint is invisible to whoever works the board |
| `Type` changed (HITL ↔ AFK) | Swap the type label |
| Issue moved to another sprint | Update the ticket's sprint assignment (milestone / board field) |
| `## Blocked by` changed | Update the ticket **body's** Blocked-by list too — published bodies cite blockers by their real refs (e.g. `#41`), so a dependency re-cut stales the body even when nothing else about the issue changed |

Surface the affected list (plan issues **plus their ticket refs**) before editing, so the
user sees the blast radius on the live board — then sync the tickets in the same pass as the
plan edits, not as deferred follow-up. When many tickets are affected, batch the updates in
dependency order (blockers first), the same order `plan-5-publish-issues` creates them in.
If the whole plan was published up front (the lazy-publish default was overridden), assume
*every* affected issue has a live ticket and budget the sync accordingly.

## Moving or renaming a spec file

If a change relocates a spec file, every anchor pointing at it breaks. Update the
anchors in the affected issues (and the `**Spec anchors**` lines in their epic/
sprint files) to the new path. The plan verifier is your safety net: a stale
anchor stops resolving and fails `verify-plan-tree.py`, so run it after any spec
restructure.

## Glossary and ADR ripples

- **Renamed a term** in the glossary? Issue titles and `## What to build` text use domain vocabulary — grep the plan tree (and the rest of the spec) for the old term and reconcile, so the plan keeps speaking the project's current language.
- **Reversed or superseded a decision** (ADR)? Find spec prose and issues that assumed the old decision and update them; mark the old ADR `superseded by ADR-NNNN` rather than deleting it.

## Always re-verify

After any propagation, run both:

```bash
python .plan/spec/scripts/verify-spec-tree.py
python .plan/plan/verify-plan-tree.py
```

The verifiers don't understand intent, but they catch the mechanical fallout of a
half-finished propagation: a broken anchor, a sprint table that no longer matches
its issues on disk, a `relates-to` pointing at a moved file. A clean pair of
verifier runs is the signal that the change landed consistently across `.plan/`.
