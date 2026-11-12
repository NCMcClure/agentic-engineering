# Publishing to GitHub

The default tracker. `publish-issues.mjs` creates the issues through `gh`; if
`.agents/plan/tracker.md` names a GitHub Project board, you mirror each one
into it. The repository is the one behind the clone's `origin`.

Read the board's owner and number and the label strings from
`.agents/plan/tracker.md`. Do not hardcode them.

## Who does what

- **Publish (`publish-issues.mjs`)** creates the issue with its triage label
  and writes `**Tracker**: #NNN` back. A new issue lands in the board's
  default Status (`Todo`); publishing does not drive Status.
- **Status (`plan-status.mjs`)** owns every later move: it closes the issue on
  `done` and reopens it on anything else, sets the board item's Status, posts
  a blocked reason as a comment, and closes a `--cancelled` issue as not
  planned.

So the publisher runs once per issue; the funnel runs every time an issue's
status changes after that.

## What the publisher creates

One issue per plan issue, titled with the issue file's H1, its body built
from the file:

```markdown
## What to build

<the issue's "What to build" section, spec links turned into paths>

Spec anchor: `.agents/plan/spec/02-runtime/event-loop.md`

## Acceptance criteria

- [ ] The behaviour in the title is implemented end-to-end
- [ ] The testing checkpoint command passes

## Blocked by

- #41 event type is defined
```

Label by type, with the exact strings from `tracker.md`: `AFK` gets the
ready-for-agent label, `HITL` the ready-for-human label, `REVIEW` the
ready-for-review label (the ready-for-human one when `tracker.md` has no
ready-for-review row). The publisher creates a label that does not exist yet.

## Mirror into the GitHub Project (if configured)

Field and option ids are not stable across boards: look them up once per
session.

```bash
# 1. Add the issue (answers the item id)
gh project item-add <NUMBER> --owner <OWNER> --url "<issue-url>" --format json

# 2. The field and option ids
gh project field-list <NUMBER> --owner <OWNER> --format json

# 3. Set each field (the project id is the PVT_... node id from field-list)
gh project item-edit --id <ITEM_ID> --project-id <PROJECT_ID> \
  --field-id <EPIC_FIELD_ID> --single-select-option-id <EPIC_OPTION_ID>
```

Repeat step 3 for Sprint and Type. The Epic option is the issue's epic
(`E01`), Sprint is `EE-SS` (`01-01`), Type is `HITL`, `AFK` or `REVIEW`.

If the board has an "Auto-add to project" workflow for the ready-for-agent
label, step 1 happens by itself, but the three fields are still yours to set.
When `item-add` says the issue is already in the project, skip step 1.

## Changing a published issue

The plan file is the source of truth: regenerate the ticket from it, never
hand-edit both sides.

```bash
node .agents/plan/plan/publish-issues.mjs sync EE-SS-II   # or: sync '#NNN'
```

rebuilds the title and the body. A type change is a label swap you make with
`gh issue edit <n> --add-label <new> --remove-label <old>`. A re-cut or
obsolete issue gets a comment naming its replacement, then
`node .agents/plan/plan/plan-status.mjs set EE-SS-II done --cancelled`.

## Idempotency

An issue that already carries `#NNN` is never created again. The write-back
per issue is what makes that hold across an interrupted run.
