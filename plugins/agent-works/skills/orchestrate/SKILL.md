---
name: orchestrate
description: "Use when the person wants several tasks built, a backlog or a sprint worked, work run in parallel, briefs written for a round of agents, or a round resumed after a restart or a compaction: this session becomes the orchestrator."
argument-hint: "[the goal, or nothing to resume]"
---

# orchestrate

A goal bigger than one pull or merge request runs one of two bad ways: one long session doing everything in turn,
or subagents fanned out inside one session where nobody can open, steer, or review them. Here every task is a
child session in its own git worktree, the person approves each parallel set before it starts, and this session
reviews and lands each request. The board holds the round, so a compaction or a restart loses nothing.

`aw` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs"`: call it that way. The `board` skill has every action
of `aw board`.

Deciding what to build and breaking a spec into a backlog is planning (but-first-planning, where it is installed).
This skill is who works where, on what, with which rules, and what comes back.

## The rules of the round

- **The board is the record.** Memory loses to the board. A card moves to in progress at dispatch (`bind`), to
  review when the child opens its request (`move --mr`), and to done at merge (`done`). After a compaction the
  session briefing prints the board's state; start again from Step 0.
- **Nothing starts without the person's yes**, and nothing merges without a review. The yes is recorded on the
  cards with `aw board grant`; never record a grant the person did not give.
- **Never poll by hand.** A child wakes this session when it ends a turn; a terminal child is waited on with a
  background `aw board wait`. No hand-written poll loops, no scheduled wake-ups.
- **A child's "passed" is a claim until checked.** Review reads the diff and re-runs what the risk calls for.
- **What a child cannot do is not dropped.** Anything after `owed=` in its CARD line becomes a gate card; a card it
  filed with `--suggest` is offered to the person.

## Step 0: Orient

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board status
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board lint
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" who
```

Each card resumes from its fields: `session`, `branch`, `worktree`, `mr`. A card in review whose child has
reported goes to `/agent-works:review-card`. Report orphan grants, stale cards and owed gates to the person; do
not settle or archive them yourself. When the briefing says cards in flight have not changed for a day,
`/agent-works:sync-cards in-flight` checks them against the work.

*Done when: you can say, from the board, what is in flight, what is in review, and what is ready.*

## Step 1: Cut the tasks, and put them on the board

Share intent, done criteria, out of scope, risks, likely files and checks with the person first (where
but-first-planning is installed, `/but-first-planning:grill`). A child cannot ask what you meant, so a card goes
out only with done criteria a stranger could check; `aw board brief` refuses one without.

For each candidate task, list what it needs that only one agent can have at a time: files and modules, the main
checkout, a locked application, a shared counter, a baseline its change will move. Two tasks that share one are
not parallel: queue them with `--after`, or cut them differently. A change that moves everyone's references (a
format, a layout, a schema) is one card, run first and alone.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board epic "<goal>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board add "<task>" --epic <epic id> --files src/a.mjs,test/a.test.mjs --after <id> --from-file <body>
```

The body follows `${CLAUDE_PLUGIN_ROOT}/assets/templates/card.md`, `## Done when` included. No card, no task. A
task judged by eye or ear gets `--labels look` (or `motion`, `sound`), and `--skills` names what its child loads
first.

*Done when: every task is a card with done criteria, and `aw board ready` lists the ones nobody has to unblock.*

## Step 2: The briefs that outlive a card

A card's brief is generated (`aw board brief`). What holds for every agent, or for this round, is written once,
in tracked files under `.agents/briefs/`, because a rule only a scratch file holds is lost with it (`aw doctor`
reports one as `BRIEF_STRAY`).

| File | From the template | Holds | Budget |
|---|---|---|---|
| `.agents/briefs/common.md` | `brief-common.md` | how any agent works here: workspace, git, locks, measuring, verification, the report | 120 lines |
| `.agents/briefs/rounds/<date>-<slug>.md` | `brief-round.md` | this round only: who does what, collisions, what must not move, rulings, the integration pass | 80 lines |
| a prompt written by hand, where a task is not a card's child session | `brief-task.md` | the one task: goal, what is known, scope, verification, done | not a file |

The templates are in `${CLAUDE_PLUGIN_ROOT}/assets/templates/`. A brief links to the root `AGENTS.md` for the
project's rules and never restates them; a rule that turns out to bind beyond the round moves into `AGENTS.md`
before the round closes. Say what is known and ruled out, point at files instead of retelling them, and never
hand an agent your conclusion to confirm. A small round needs neither file.

*Done when: any brief written is within budget and tracked, and `aw dup` reports no rule a brief repeats.*

## Step 3: Propose the parallel set, and ask

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board propose
```

It runs cards together only when their files are disjoint, neither waits on the other, and they share no
long-held lock. `kanban.conflicts` in `.agents/agent-works.json` refines the files: `rederived` ones never count,
`merge` ones only warn, a `shared` path always holds. Show the person the set, each held card with its reason,
the warnings, the locks each card needs, and the approval you are asking for: each child pushes its branch and
opens its request without asking; you merge on green after review.

If the person wants a held card run anyway, say what it costs (whichever lands second syncs, regenerates and
re-bumps) and run it on their word. On a clear yes:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" board grant <ids> --by "<their name>, <the time>"
```

Each card's branch defaults to `feat/` and its title's slug; to name one, grant that card alone with `--branch
<type>/<topic>`. A queue approved up front is re-checked with `propose` at each start and asked about again only
when the set changes.

*Done when: every card about to start carries the person's grant.*

## Step 4: Dispatch

`/agent-works:dispatch <id>` for each card in the set: it brings the base up to date, writes the brief, starts
the child in its own worktree, and binds it. The board, the locks and the notes are shared by every worktree;
nothing else is. Where this host can start no session and the person no terminal, the round runs serially:
`${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/references/subagent-fallback.md`.

## Step 5: While the children work

Answer a child that reports `blocked`, or ask the person for it. Offer the person each card a child filed with
`--suggest`. `aw status`, `aw who` and `aw notes` show the board, who holds which lock, who claims which counter,
and what the agents told each other; relay nothing by hand that a note already says. Scarce resources are
`/agent-works:resource-locks`; leases, timing runs and shared counters are the `coordinate` skill.

## Step 6: Review and land

When a child reports `review`, `/agent-works:review-card <id>`: review, findings back, land on green, close the
card, tell the others the base moved. Every "not verified" in a report is a gate card (`aw board owe`) or it did
not happen: add the missing ones yourself. What a child decided that was the person's to decide goes to the top
of your own report. Then back to Step 3 for the next set.

## Step 7: The integration pass

Lighter verification per card has a price: skipped full runs let breakage accumulate. After the merges, one
session, in the main checkout, holding the locks it needs, runs once what the cards owed and what only the merged
whole can show. Each gate that passes is settled with its evidence (`aw board settle <id> --evidence "..."`); each
that fails becomes a card for the task that caused it.

*Done when: `aw board list --scope gates` shows no gate of this round still owed without an owner and a reason.*

## Step 8: Close the round

- Every card is in review or done; `aw board lint` is clean; every claim is landed or released (`aw claims`);
  every lock and lease is free (`aw lock status`, `aw leases`); `git config --get-regexp agentic-engineering-push`
  shows no grant for a finished card.
- Rulings the person made that bind later work are decision records or rules in `AGENTS.md`; what the round
  learned goes into memory (the `memory` skill), not into the next brief. A round's brief is the record once the
  round closes, not a place the next round reads rules from.
- Merged worktrees and branches are removed, with the person's yes.
- Your report to the person: per card the verdict, what was verified and by whom, the gates settled and still
  owed, and what needs a decision, first.

*Done when: `aw status` shows nothing of this round in progress, and the person has the report.*
