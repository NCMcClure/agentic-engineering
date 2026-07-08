# Publishing to GitLab

For projects tracked on GitLab (including self-hosted instances) via the `glab`
CLI. GitLab replaces GitHub's Project-board fields with **labels + milestones**,
which turns out simpler: scoped labels are mutually exclusive within their scope,
and label-driven boards update themselves — no board API calls at publish or
status time.

Read the project path, numeric project ID, and label strings from
`.plan/tracker.md` — don't hardcode them here. The examples below use
`<project-path>` / `<project-id>` for those values.

## Field naming: `**GitHub**:` holds the GitLab ref

The plan-tree field name `**GitHub**:` is pinned by `verify-plan-tree.py` — do
**not** rename it. In a GitLab project it holds the **GitLab** issue reference:
`<unassigned>` before publish, `#NNN` (the issue **iid**) after. Everything that
reads `#NNN` (`plan-status.py`, ledgers, sprint tables) works unchanged.

## Organization model (no group Epics required)

Works in a **personal namespace**, where group-level Epics and Iterations are
unavailable:

| Plan concept | GitLab object |
|---|---|
| Epic | scoped label `epic::EE-<slug>` (one hue per epic; created lazily at first publish of the epic) |
| Sprint | milestone titled `EE-SS <sprint-slug>` (created lazily when the sprint is published) |
| Issue | issue (iid = the `#NNN` ref) |
| Type | `type::HITL` / `type::AFK`; decision issues also get `decision` |
| Status | open/closed + `status::in-progress` / `status::blocked` labels (owned by `plan-status.py`, never by publish) |

Scoped labels (`::`) need a GitLab tier that supports them — verify on the
instance; fall back to plain `epic-EE-<slug>` names if not.

## Division of labour with `plan-status.py`

Same split as GitHub: **publish creates** the issue with its immutable epic/type
labels and milestone; **`plan-status.py` (gitlab mode)** owns every later
transition — `status::*` label swaps, close/reopen, and posting the blocked
reason as a comment. New issues get **no** `status::*` label (open + unlabeled =
backlog).

## Per sprint, once

```bash
# Epic label (skip if it exists — check `glab label list -R <project-path>`)
glab api -X POST projects/<project-id>/labels \
  -f "name=epic::EE-<epic-slug>" -f "color=#6699cc" -f "description=Epic EE"
# Sprint milestone (skip if it exists — check `glab api projects/<project-id>/milestones`)
glab api -X POST projects/<project-id>/milestones -f "title=EE-SS <sprint-slug>"
```

## Create an issue

In `Blocked by` dependency order (blockers first, so blocked bodies can cite real
`#NNN` refs):

```bash
glab issue create -R <project-path> \
  --title "<issue H1 verbatim>" \
  --label "epic::EE-<epic-slug>,type::AFK" \
  --milestone "EE-SS <sprint-slug>" \
  --yes \
  --description "$(cat <<'EOF'
## What to build

<from the issue file's "What to build" section>

Spec anchor: .plan/spec/<path>

## Acceptance criteria

<the issue file's checklist, verbatim>

## Blocked by

- None  (or: #41 — the already-published blocker's GitLab ref)
EOF
)"
```

The command prints the issue URL; the trailing number is the iid `NNN`. Backfill
`**GitHub**: #NNN` (and the sprint-table row) **immediately per issue**, not
batched at the end — an interrupted run then shows exactly what's published.

Prefer the bundled `publish-issues.py` (copied into `.plan/plan/` by
`spec-0-init`) over hand-running these commands — it does the parse → toposort →
create → backfill loop deterministically and idempotently for both trackers.

## Updating a published issue (spec-4-edit sync)

The plan file is the source of truth — regenerate the ticket from the file
(`publish-issues.py sync --iid NNN` does exactly this), never hand-edit both
sides:

```bash
# Title/body changed → rebuild both from the plan file
glab api -X PUT projects/<project-id>/issues/<iid> \
  -f "title=<issue H1 verbatim>" -f "description=<regenerated body>"

# Type flipped HITL <-> AFK (scoped labels auto-swap within the type:: scope)
glab issue update <iid> -R <project-path> --label "type::AFK"

# Moved to another sprint (create the milestone first if that sprint is new)
glab api -X PUT projects/<project-id>/issues/<iid> -f "milestone_id=<id>"

# Re-cut or obsolete → comment the reason/replacements, then close
glab issue note <iid> -R <project-path> -m "Superseded by #NNN: <reason>"
glab issue close <iid> -R <project-path>
```

**Blocked-by ripples**: ticket bodies embed blocker refs (`#NNN`) — when a
dependency is re-cut, regenerate the *dependent* tickets' bodies too. Closing
with a comment beats deleting; the board history stays honest.

## glab traps (learned in production, v1.83)

- `glab issue delete` has **no `--yes`** — it can't run non-interactively. Use
  `glab api -X DELETE projects/<id>/issues/<iid>` (test artifacts only; real
  tickets get closed, not deleted).
- Board-list creation via the API needs the **typed** form:
  `glab api -X POST projects/<id>/boards/<bid>/lists -F label_id=<int>`
  (`-f` sends a string and is rejected).
- Issue **iids are never reused** — a deleted smoke-test issue permanently
  consumes its number. Don't burn iids casually.

## Idempotency

The canonical rule is in SKILL.md step 2 — an issue that already carries a ref
is never re-created; iids being non-reusable (above) makes duplicates extra
costly here.
