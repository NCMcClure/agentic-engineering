# Keeping spec ↔ plan ↔ tracker in sync

Change propagates along the **spec anchors** that link plan issues to the spec
files they realise (see `plan-decompose`'s SPEC-ANCHORS reference). Because anchors are
concrete relative paths, you can mechanically find what a change affects. This
file is the procedure for doing that without leaving drift behind.

## Finding the issues a spec change affects

One common source of the changed-spec-file set is `.agents/plan/spec-comments.json`: the
`specFile` of each unresolved inline comment is a spec file the user wants
changed, so those paths seed the grep below (and, for a wide blast radius, the
`changedSpecFiles` arg to `workflows/propagate.js`) just like a hand-edited file
would. Flip each comment to `resolved` once its edit has propagated.

When one or more spec files change, find every plan issue anchored to them. Grep
the plan tree for the spec path:

```bash
# Which issues realise spec/02-runtime/event-loop.md ?
grep -rl "spec/02-runtime/event-loop.md" .agents/plan/plan/*/*/issues/
```

(Anchors in issue files use a `../../../../spec/...` prefix, but the readable
link text and the `**Spec anchors**` lines in epic/sprint files contain the bare
`spec/...` path, so grepping the bare path finds them. Epics and sprints carry
anchors too, check those for coarser ripples.)

For each affected issue, classify and act:

| Situation | Action |
|-----------|--------|
| The change doesn't touch what the issue builds | Leave it; note you checked |
| The behaviour changed but the slice is still one slice | Update the issue's `## What to build` and `## Acceptance criteria`; bump nothing else |
| The slice is now too big / too small | Re-cut via `plan-decompose` (split, merge, or replace), preserving anchors |
| The spec section is gone | The issue is obsolete, mark it, and if published, close the ticket with a reason |

Surface the affected-issue list to the user **before** editing, so they see the
blast radius of the spec change.

## Published vs unpublished issues

- **Unpublished** (`**Tracker**: <unassigned>`): edit freely, no external ticket exists yet.
- **Published** (a real reference like `#42`): the plan issue and the live ticket are now out
  of agreement, and editing the plan file is not enough. **Sync the ticket as part of the
  propagation**, don't stop at flagging it. A live ticket that quietly diverges from its plan
  issue is the worst drift because someone may already be building it.

Never edit a published issue's scope without also surfacing the ticket that needs
to change.

### Syncing published tickets

The plan file stays the source of truth: after the plan-side edit lands, **regenerate the
ticket from the file** rather than hand-editing both sides. The tracker mechanics (commands,
body shape) live in `.agents/plan/tracker.md` and the matching `plan-publish`
reference (TRACKER-GITHUB.md or TRACKER-GITLAB.md); `publish-issues.mjs sync EE-SS-II`
rebuilds a published ticket's title and body from its plan file, on either forge.
This table is *what* to do; those are *how*:

| Plan-side change | Ticket action |
|------------------|---------------|
| `## What to build` / `## Acceptance criteria` edited | Rebuild the ticket body from the issue file; update the title if the H1 changed |
| Issue re-cut (split / merge / replace) | Comment the old ticket with its replacement(s), then `plan-status.mjs set <coords> done --cancelled` (closes it as not planned); publish the new issue(s), which writes their refs back |
| Issue obsolete (spec section gone) | Comment the reason on the ticket, then `plan-status.mjs set <coords> done --cancelled` |
| New issue added to an **already-published sprint** | Publish it immediately: a plan-only issue in a live sprint is invisible to whoever works the board |
| `Type` changed (HITL ↔ AFK ↔ REVIEW) | Swap the label: the triage label on GitHub (`gh issue edit <n> --add-label <new> --remove-label <old>`), the `type::` label on GitLab (`glab issue update <n> --label type::<TYPE>`); on a GitHub Project board, its Type field too |
| Issue moved to another sprint | GitLab: move it to the new sprint's milestone (publish that sprint first, so the milestone exists). GitHub: change the board item's Sprint field, when there is a board |
| `## Blocked by` changed | Update the ticket **body's** Blocked-by list too (`sync` does): published bodies cite blockers by their refs (`#41`), so a dependency re-cut stales the body even when nothing else about the issue changed |

Surface the affected list (plan issues **plus their ticket refs**) before editing, so the
user sees the blast radius on the live board, then sync the tickets in the same pass as the
plan edits, not as deferred follow-up. When many tickets are affected, batch the updates in
dependency order (blockers first), the same order `plan-publish` creates them in.
If the whole plan was published up front (the lazy-publish default was overridden), assume
*every* affected issue has a live ticket and budget the sync accordingly.

## Moving or renaming a spec file

If a change relocates a spec file, every anchor pointing at it breaks. Update the
anchors in the affected issues (and the `**Spec anchors**` lines in their epic/
sprint files) to the new path. The plan verifier is your safety net: a stale
anchor stops resolving and fails `verify-plan-tree.mjs`, so run it after any spec
restructure.

## Glossary and ADR ripples

- **Renamed a term** in the glossary? Issue titles and `## What to build` text use domain vocabulary, grep the plan tree (and the rest of the spec) for the old term and reconcile, so the plan keeps speaking the project's current language.
- **Reversed or superseded a decision** (ADR)? Find spec prose and issues that assumed the old decision and update them; mark the old ADR `superseded by ADR-NNNN` rather than deleting it.

## User-docs and AGENTS.md ripples

Two more surfaces a spec change can stale, checked in the same pass as the
anchor grep:

- **End-user docs.** If the change touches `user-docs-plan.md`, an issue whose
  `**User-facing**` line says `yes`, or behaviour already shipped (a page in
  `.agents/plan/progress/docs.md`'s managed set describes it), the product docs are
  now stale. Flag the affected pages and **route the rewrite to
  `build-user-docs`** (read and follow `../build-user-docs/SKILL.md` like any
  routed skill): its gate, grounding, and ownership rules apply unchanged.
  `spec-edit` never writes product docs directly.
- **Codebase hubs.** If the change touches `repository-layout.md` or moves a
  module boundary (a directory appears, disappears, or changes purpose), list
  the source directories whose `AGENTS.md` hubs need review (contract:
  [CODEBASE-LAYOUT.md](../spec-write/CODEBASE-LAYOUT.md)); if agent-works is
  installed, run its hub check after the edits.

Any issue this pass creates or re-cuts carries the `**User-facing**` line; the format is owned by [PLAN-FORMAT.md](../plan-decompose/PLAN-FORMAT.md);
dropping it on a re-cut is exactly the drift the verifier now catches.

## Always re-verify

After any propagation, run both:

```bash
node .agents/plan/spec/scripts/verify-spec-tree.mjs
node .agents/plan/plan/verify-plan-tree.mjs
```

When the change rippled into source directories or `repository-layout.md`,
and agent-works is installed, run its hub check too.

The verifiers don't understand intent, but they catch the mechanical fallout of a
half-finished propagation: a broken anchor, a sprint table that no longer matches
its issues on disk, a `relates-to` pointing at a moved file. A clean pair of
verifier runs is the signal that the change landed consistently across `.agents/plan/`.
