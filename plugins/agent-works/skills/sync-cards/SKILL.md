---
name: sync-cards
description: "Use when the board may have drifted from the work: a request merged or closed under a card in flight, backlog cards already started or landed, suggestions piling up, the briefing says cards have not changed for a day, or the person asks to sync or groom the board."
argument-hint: "[in-flight|backlog|suggested] [card ids]"
---

# sync-cards

The card-sync hook keeps the card a session is working in step as it works. What it cannot see goes stale anyway:
a pull or merge request merged from another machine, a child session that ended without moving its card, a
backlog card someone built by hand, a suggestion whose problem was fixed in passing. This skill checks one scope
of the board against the work and brings it level. `aw board` below is
`node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board`.

Keeping cards in step with a tracker's issues is a different thing: `aw board remote sync`.

## The scopes

| Scope | The cards | Moves it makes | Left to the person |
|---|---|---|---|
| `in-flight` (default) | tasks in progress or in review, plan issues too | open request: review with its number; merged: done at the merge commit; no request and work under way: in progress | abandon, when the request closed unmerged or the work stalled |
| `backlog` | loose tasks waiting to start | started on a branch: in progress; landed on the base: done | archive, when obsolete or a duplicate |
| `suggested` | suggestions agents filed | none: the reading goes on the card as a note | accept into the backlog, or archive |

Every move is preceded by `aw board note <id> "sync: ..."`, so the card says why it moved. Gates and epics are
never in scope: a gate is settled with evidence, and an epic closes with its last card.

## Step 1: Fetch and size

```
git fetch origin --prune
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board evidence --scope <scope>
```

`evidence` reads only what git on this machine knows, which is why the fetch comes first. It prints each card in
scope with what the evidence shows: the branch and how far ahead it is, a merge into the base, base commits that
name the card or touch its files, the worktree. `--json` is what the workflow reads; pass card ids instead of
`--scope` to check only those.

*Done when: you know the scope's card ids and how many there are.*

## Step 2: Small, or the workflow

**Three cards or fewer:** do it inline. For each card, read its signals, check its request where it has one
(`gh pr view <number> --json state,mergeCommit` or `glab mr view <number> --output json`), decide its state from
the table above, and run the note and the move yourself. Ask the person about anything in the last column.

**More than three:** tell the person how many cards it covers and what it runs (one assessor per 15 cards, one
investigator per card the evidence does not settle, a confirming pass in batches of 8), and ask before a run of
more than 20 cards. Then:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/sync-cards/workflows/sync.js",
  args: { root: "<absolute repo path>", pluginRoot: "${CLAUDE_PLUGIN_ROOT}", scope: "<scope>", ids: ["<id>", ...] }
})
```

`${CLAUDE_PLUGIN_ROOT}/skills/sync-cards/workflows/sync.js` runs three phases. The assessor reads
`aw board evidence --json` for each chunk and settles what the evidence already shows, writing a brief for each
card it cannot. An investigator per remaining card runs read-only checks (git against the base, the forge's
command line for the request, the files) and reports a state with the commands that showed it. The confirming
pass checks each verdict, re-running the one check a thin verdict rests on, and makes the moves its scope allows
through `aw board`, one batch at a time so two moves never renumber a lane at once. It changes no file outside
the board and no git state.

A host without the Workflow tool runs the same three phases by hand:
`${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/references/subagent-fallback.md`.

*Done when: the workflow returned, or every card was checked inline.*

## Step 3: Report, then ask

Read what it returns:

- `applied`: the moves it made. Show the person each one with its why.
- `proposed`: what the board leaves to the person. Ask about them in one list; on a yes,
  `aw board note <id> "sync: <why>"` and then the proposal's command.
- `kept`: cards that stand where they are, and why. Mention the count.
- `failed`: an investigator that returned nothing, or a move the command refused, with its words. Say what is left
  unchecked.
- `violations`: a move the confirming pass made that the scope does not allow. Show it, and offer to put the card
  back.

A request the machine could not read (no network, not signed in) leaves its card unclear. Say so and stop.

*Done when: the person has seen every move and answered every proposal.*
