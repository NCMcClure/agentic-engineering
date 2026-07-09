# Publishing to GitHub

The default tracker. Issues are created with the `gh` CLI and, if a GitHub
Project board is configured in `.plan/tracker.md`, mirrored into it with custom
fields. The repo is inferred from `git remote -v` when `gh` runs in the clone.

Read the project board URL / owner / number and the label strings from
`.plan/tracker.md` — don't hardcode them here.

## Division of labour with `plan-status.py`

Publishing and status-tracking are split:

- **Publish (this skill)** — *create* the issue and set its **immutable** fields:
  the Epic/Sprint/Type project fields and the `**GitHub**: #NNN` backfill. New
  issues land in the default Status (`Todo`); publish does **not** drive Status.
- **Status transitions (`.plan/plan/plan-status.py`)** — every later `Todo → In
  Progress → Done` move, and `gh issue close/reopen`, is done by the funnel as
  issues are built and verified. Don't set Status from here.

So this skill runs once per issue (at publish); `plan-status.py` runs every time an
issue's status changes thereafter.

## Create an issue

Build the body from the issue file's sections. Use a heredoc for multi-line
bodies:

```bash
gh issue create \
  --title "Event type is defined and round-trips through the store" \
  --label "ready-for-agent" \
  --body "$(cat <<'EOF'
## What to build

<from the issue's "What to build" section>

Spec anchor: spec/02-runtime/event-loop.md

## Acceptance criteria

- [ ] The behaviour in the title is implemented end-to-end
- [ ] The testing checkpoint command passes

## Blocked by

- None  (or: #41)
EOF
)"
```

The command prints the new issue URL; capture the number from it.

Label by type: `AFK` → the ready-for-agent label, `HITL` → the ready-for-human
label, `REVIEW` → the ready-for-review label (exact strings from `tracker.md`;
when tracker.md predates a ready-for-review row, REVIEW falls back to the
ready-for-human string).

## Mirror into the GitHub Project (if configured)

If `tracker.md` names a project board, add the issue and set its fields. Field and
option IDs are **not stable** — look them up at runtime and cache them for the
session.

```bash
# 1. Add the issue (returns the item id)
item_id=$(gh project item-add <NUMBER> --owner <OWNER> \
  --url "<issue-url>" --format json | jq -r '.id')

# 2. Look up field + option ids (once per session)
gh project field-list <NUMBER> --owner <OWNER> --format json | \
  jq '.fields[] | select(.name=="Epic" or .name=="Sprint" or .name=="Type") |
      {name, id, options: (.options | map({name,id}))}'

# 3. Set each field (PROJ_ID is the PVT_... node id from field-list)
gh project item-edit --id "$item_id" --project-id "$PROJ_ID" \
  --field-id "$EPIC_FIELD_ID"   --single-select-option-id "$EPIC_OPTION_ID"
gh project item-edit --id "$item_id" --project-id "$PROJ_ID" \
  --field-id "$SPRINT_FIELD_ID" --single-select-option-id "$SPRINT_OPTION_ID"
gh project item-edit --id "$item_id" --project-id "$PROJ_ID" \
  --field-id "$TYPE_FIELD_ID"   --single-select-option-id "$TYPE_OPTION_ID"
```

The Epic option is the issue's epic (e.g. `E01`); Sprint is `NN-MM` (epic-sprint,
e.g. `01-01`); Type is `HITL`/`AFK`/`REVIEW`.

### Auto-add workflow

If the board has an "Auto-add to project" workflow for the ready-for-agent label,
the *add* (step 1) happens automatically — but it does **not** set
Epic/Sprint/Type, so you still run the `item-edit` calls. If `item-add` reports
the issue is already in the project, the auto-add fired: skip step 1 and look up
the existing item id via `gh project item-list <NUMBER> --owner <OWNER>`.

## Backfill the plan files

After each create, edit the issue file (`**GitHub**: <unassigned>` → `**GitHub**:
#NNN`) and the matching row in the sprint's `## Issues` table (`<unassigned>` →
`#NNN`). Do this as you go, so an interrupted run leaves an accurate record of
what's already published.

## Idempotency

The canonical rule is in SKILL.md step 2 — an issue that already carries a
`#NNN` ref is never re-created. The as-you-go backfill above is what makes that
rule work across interrupted runs.
