---
name: board
description: "Use for anything on the kanban board: out-of-scope work to put on it instead of doing it now, what is ready or in progress, moving or planning a card, owing a check this session cannot run, settling one with evidence."
argument-hint: "[status|ready|add|move|owe|settle ...]"
---

# board

Work that is not this session's job gets lost when it lives in a chat message, and a check nobody could run is
forgotten once the turn ends. The board holds both. It is a folder of Markdown cards in the main checkout
(`.agents/kanban/` unless the config's `paths.kanban` says otherwise), shared by every worktree of the repository,
and the person sees it as a pane (`/kanban`). The board is the record: when memory and the board disagree, the
board wins.

## The command

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board <action> [arguments]
```

`aw board` below means that. Run it from any worktree; it finds the main checkout by itself. Every action takes
`--json` except `brief` and `wait`. The board is working state, kept out of git through the repository's own
`info/exclude`, so it never shows in `git status`; a repository that shares its board through git says
`"kanban": { "tracked": true }` in `.agents/agent-works.json`.

In a session the same cards are reachable through six tools, each one run of the same command:

| Tool | The same as |
|---|---|
| `mcp__agent-works__surface_task` | `aw board add "<title>" --suggest` |
| `mcp__agent-works__list_tasks` | `aw board list` |
| `mcp__agent-works__move_task` | `aw board move <id> <column>` |
| `mcp__agent-works__plan_task` | `aw board plan <id> --epic <id> --sprint <id\|active\|none>` |
| `mcp__agent-works__owe_gate` | `aw board owe "<title>" --ref <ref> --needs "<what>"` |
| `mcp__agent-works__settle_gate` | `aw board settle <id> --evidence "<what ran, what it showed>"` |

| Action | What it does |
|---|---|
| `status [--brief]` | Every lane, the active sprint, ready and owed counts. `--brief` is the line the session briefing prints. `aw status` adds locks, leases, claims and the last merges. |
| `ready` | Backlog tasks nobody has to unblock: no `needs`, every `after` card finished. Highest priority first. |
| `list [--scope sprint\|backlog\|all\|gates\|plan\|<epic id>] [--kind K] [--all]` | Cards in board order. It lists one scope (the active sprint while there is one) and says how many open cards it left out: ask for `--scope all` before concluding a card does not exist. |
| `show <id>` | The card; for an epic, its cards and progress too. |
| `add "<title>" [--details T\|--from-file F] [--epic ID] [--files a,b] [--after ids] [--labels a,b] [--skills a,b] [--priority P] [--owner O] [--suggest]` | A new task card. A title already on the board is refused with the card that holds it. `--skills` names the skills its agent loads first. |
| `epic "<title>"` | A card that groups others through their `epic` field. |
| `edit <id> [--title\|--details\|--append\|--files\|--after\|...]` | Change a card's fields or body. |
| `move <id> <column\|suggested\|archived> [--mr NUMBER]`, `reorder <id> <index>` | Columns are `backlog`, `in-progress`, `review`, `done` unless `board.json` names others. A move to review takes the pull or merge request's number. A gate is never moved to done: it is settled. |
| `plan <id> --epic <id\|none> --sprint <id\|active\|none>` | Put a card in an epic or a sprint, or take it out. |
| `sprint new "<title>" [--goal --start --end]`, `sprint start\|close [<id>]`, `sprint list` | One sprint is active at a time. Closing archives what finished and rolls the rest to the next planned sprint, or to the backlog. Starting and closing are the person's. |
| `owe "<title>" --ref R --needs N [--owner O] [--from-file F]` | A gate: a check this session cannot run, what it is owed for, and what running it needs. |
| `settle <id> --evidence "<the command and its result>"` | Records the evidence on the gate and moves it to done. The only way a gate closes. |
| `note <id> "<text>"` | A dated line under `## Notes`: where the card stands, or why it moved. It counts as a change, so it also quiets the card-sync reminder. |
| `evidence [<ids>\|--scope in-flight\|backlog\|suggested]` | What git on this machine knows about each card's work. The `sync-cards` skill starts from it. |
| `abandon <id>` | Back to the backlog; the card's session, branch, worktree, request and push grant go. |
| `remote status\|on\|off\|sync [--dry-run]` | Keep cards in step with GitHub (`gh`) or GitLab (`glab`) issues. Ask the person before `remote on`: `unlinked` in `remote status --json` is how many issues the first pass opens. |
| `config [--start-mode new-session\|queue] [--parallel N]` | What starting a card does, and how many run side by side. |
| `lint [--fix]` | The findings below. `--fix` renumbers a duplicate id and moves an unknown status to the first column. |

The loop's actions (`propose`, `grant`, `brief`, `bind`, `claim`, `done`, `wait`) belong to the `orchestrate`,
`dispatch`, `work-card` and `review-card` skills.

Exit codes: 0 ok; 1 a finding, a refusal or a duplicate; 2 usage; 3 `wait` at its timeout. Read the code, not only
the text.

## When to reach for it

- **Out-of-scope work turns up** (a bug seen in passing, stale documentation, a missing test, a follow-up your
  change makes necessary). Do not fix it in passing and do not leave it in prose: `add ... --suggest`. It waits in
  the Suggested lane until the person accepts it. Write the body from
  `${CLAUDE_PLUGIN_ROOT}/assets/templates/card.md`, so the card stands alone for an agent with none of your
  conversation.
- **You cannot run a check the work needs** (credentials, a device, the main checkout, a person's eye). `owe` it,
  with the body of `${CLAUDE_PLUGIN_ROOT}/assets/templates/gate-card.md`, and name the gate's id in your report
  under "not verified". Never mark the work verified.
- **The check has been run and passed.** `settle` with the evidence. A gate that failed is not settled: it stays
  owed, and the failure becomes a card for whoever owns the change.
- **Asked what is next.** `ready`, then `show` the card you pick.
- **A card was handed to you.** Its `## Done when` is your done. When it is met, `move <id> review` (with `--mr`
  when there is a request) and say in your report what you verified. The person, or the session that reviews it,
  moves it to done.
- **The card-sync hook says a card is behind.** It names the move the card is owed (a request opened owes review,
  a merge owes done, work on a backlog card owes in progress) or asks whether a card you worked on still stands
  where it is. Make the move, or `note` where it stands.
- **The board and the work disagree across many cards.** `/agent-works:sync-cards`.

## Epics and sprints

An **epic** is a card of `kind: epic` holding a goal larger than one session; its cards name it. A **sprint** is
the time box the person works in.

- What you notice that belongs to another slice of your card's epic becomes a card of that epic:
  `add "<title>" --epic <id> --suggest`.
- Handed an epic itself, you slice it, you do not build it: read the code it touches, then file one card per slice,
  in order, each standing alone. A new epic's body follows `${CLAUDE_PLUGIN_ROOT}/assets/templates/epic-card.md`.

## Plan issues

Where a plan lives as issue files under `.agents/plan/plan/` (but-first-planning writes them), every issue is a
card too, with its coordinates as the id (`01-02-03`). They are read from the base branch, never a working tree,
and are read-only here: the plan's own `plan-status.mjs` changes their status. A move of a plan card runs that
script in the worktree the card is bound to; a move to done is refused, because the issue is done when its request
merges; `plan`, `settle` and `lint --fix` never touch one.

## A card

`NNNN-<slug>.md`: one-line `key: value` frontmatter (lists are JSON), then Markdown. Edit the body freely; change
the frontmatter through the command, so the file stays in its canonical form. The body's sections: `## Done when`
(checkable criteria; a card without them is not ready to build, and `## Done looks like` on an older card is read
the same), `## Notes`, `## Review` (findings sent back), `## Evidence` (on a gate).

## What lint reports

`KANBAN_CARD_INVALID`, `KANBAN_STATUS_UNKNOWN`, `KANBAN_EPIC_UNKNOWN`, `KANBAN_SPRINT_UNKNOWN`,
`KANBAN_SPRINT_OVERDUE` (tell the person, who closes it), `KANBAN_STALE_START` (in progress and untouched for 7
days), `GATE_OWED_OLD` (owed for more than 3), `KANBAN_REVIEW_UNLINKED` (in review with no request on the card),
`KANBAN_GRANT_ORPHAN` (a push grant with no card in flight on its branch), `KANBAN_OLD_FOLDER`, `KANBAN_UNTRACKED`.
Report owed gates and stale cards to the person; do not settle or archive them on their behalf.
