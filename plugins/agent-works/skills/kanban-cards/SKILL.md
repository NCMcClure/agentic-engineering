---
name: kanban-cards
description: Use for out-of-scope work you notice, a card handed over, an owed check, or task status.
---

# kanban-cards

Tasks and their status live on one board: cards in the main working tree's `.agents/kanban/`, so every worktree
and every agent works the same one. The owner sees it as a pane (`/kanban`). You reach it through tools in a
session, or through `aw kanban` anywhere: both read and write the same cards.

| In a session | From a shell, a script, a sub-agent |
|---|---|
| `mcp__agent-works__surface_task` | `aw kanban add "<title>" --suggest` |
| `mcp__agent-works__list_tasks` | `aw kanban list` |
| `mcp__agent-works__move_task` | `aw kanban move <id> <column>` |
| `mcp__agent-works__plan_task` | `aw kanban plan <id> --epic <id> --sprint <id\|active\|none>` |
| (the pane, the owner's) | `aw kanban epics`, `aw kanban sprint list\|new\|start\|close` |
| `mcp__agent-works__owe_gate` | `aw kanban owe "<title>" --ref <ref> --needs "<what>"` |
| `mcp__agent-works__settle_gate` | `aw kanban settle <id> --evidence "<what ran, what it showed>"` |

A card is a Markdown file; never edit its frontmatter by hand. Only the pane starts an agent from a card or syncs
with GitHub or GitLab issues.

## Step 1 — Where things stand

```
aw status
```

The active sprint, the open epics, the board by column, the gates still owed, the locks, leases and claims in
force, and the last merges. Nothing in it is written by hand, so nothing in it is stale. `aw kanban list --kind
gate` lists the owed checks alone.

`list_tasks` and `aw kanban list` list one **scope**: the active sprint while there is one, every card otherwise,
and say how many open cards they left out. Looking for a card that is not there, ask for `scope: "all"` (`--scope
all`) before concluding it does not exist.

*Done when: you know which cards are in progress, which are yours, and which gates are owed.*

## Step 2 — Surface work that is outside your change

A bug seen in passing, a repeated pattern, stale documentation, missing tests, a follow-up your change makes
necessary: put it on the board and carry on. Not a hunch, and not something you can fix inline in your change.

The card must stand alone for an agent with none of your conversation. Write its body from
`${CLAUDE_PLUGIN_ROOT}/assets/templates/card.md`: what was seen, why it matters, where to look, what done looks
like, the files. It lands in the Suggested lane; the owner accepts or dismisses it.

*Done when: the card exists with the five parts filled, and you are back at your own task.*

## Step 3 — Work a card and hand it back

A card handed to you is your task's definition: its "Done looks like" is your done. When it is met, move the card
to the review column (`aw kanban move <id> review`, or the column id `aw kanban list` shows) and say in your
report what you verified. The owner moves it to done. If you stop early, leave the card where it is and write in
your report what remains.

*Done when: the card is in review with its done-criteria met, or still in progress with what remains reported.*

## Step 4 — Work inside epics and sprints

An **epic** is a card of `kind: epic` holding a goal larger than one session; its cards name it (`epic:`). A
**sprint** is the time box the owner is working in; the owner starts and closes sprints, never you.

- A card of an epic arrives with the epic's goal and its other open cards in your first message. Keep your change
  inside your card; what you see that belongs to another slice of the epic becomes a card of the epic:
  `surface_task` with `epic`, or `aw kanban add "<title>" --epic <id> --suggest`.
- Handed an **epic** itself, you slice it, you do not build it: read the code it touches, then file one card per
  slice, in order, each standing alone (`aw kanban add "<title>" --epic <id> --details "…"`). Write a new epic's
  body from `${CLAUDE_PLUGIN_ROOT}/assets/templates/epic-card.md`.
- `plan_task` / `aw kanban plan` puts a card in an epic or a sprint when it was filed without one.

*Done when: every card you filed for an epic names it, and an epic you sliced has its cards, in order.*

## Step 5 — Owe a check you cannot run

A check that must pass before the work counts as verified, and that you cannot run now (it needs the main
checkout, a resource you could not get, another machine, the owner), becomes a **gate** card. Never skip it
silently and never report it as passed.

```
aw kanban owe "<the check, as an imperative>" --ref <the pull request, issue or card> --needs "<what running it needs>" --from-file <body>
```

The body follows `${CLAUDE_PLUGIN_ROOT}/assets/templates/gate-card.md`: the exact command, what passing looks
like, why it could not run now, what it guards. Name the gate's id in your report under "not verified".

*Done when: every check you skipped has a gate card, and each id is in your report.*

## Step 6 — Settle a gate

Whoever can run it, runs it. When it passed:

```
aw kanban settle <id> --evidence "<the command that ran and what it showed>"
```

The evidence is appended to the card and the card moves to done. A gate that **failed** is not settled: it stays
owed, and the failure becomes a card for whoever owns the change (`--ref` the gate).

*Done when: each gate you ran is settled with its evidence, or has a card for its failure.*

## Step 7 — Keep the board true

```
aw kanban lint
```

`KANBAN_STALE_START`: a card in progress that nobody touched for days is finished, handed back or moved out.
`GATE_OWED_OLD`: a gate owed for days gets run, or gets an owner. `TASKS_TWO_HOMES`: tasks kept in a second place
(a TODO file, a "next" list in a memory) become cards and the list is deleted. `KANBAN_SPRINT_OVERDUE`: the
active sprint is past its end; tell the owner, who closes it. `KANBAN_CARD_INVALID`, `KANBAN_STATUS_UNKNOWN`,
`KANBAN_EPIC_UNKNOWN` and `KANBAN_SPRINT_UNKNOWN` name the card and what is wrong with it.

*Done when: `aw kanban lint` reports nothing about cards you own.*
