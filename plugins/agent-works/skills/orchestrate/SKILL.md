---
name: orchestrate
description: Use before dispatching parallel agents, writing briefs, or closing a round.
---

# orchestrate

Agents in parallel fail in the same few ways: two want the one thing only one can have, a rule lives in a scratch
brief nobody else read, a check gets skipped and nobody knows it is owed, and every report says "done". Each step
below closes one of those.

Deciding **what** to build, and breaking a spec into a backlog, is the but-first-planning plugin's work (in
`.agents/plan/`). How much to render and who looks at the pictures, for work judged by eye or ear, is
perceptual-loop's. This skill is the general half: who works where, on what, with which rules, and what comes back.

## Step 1 — Cut the tasks by what each needs exclusively

For each candidate task, list what it needs that only one agent can have at a time: files and modules, the main
checkout, a locked application, a shared counter, a baseline or reference that its change will move.

- Two tasks that share an exclusive need are not parallel. Queue them, or cut them differently.
- A change that invalidates everyone's references (a format, a layout, a schema) is one task for one agent,
  merged last.
- Each task is one card: `aw kanban add "<title>" --owner <agent name> --from-file <body>`, with the body of
  `${CLAUDE_PLUGIN_ROOT}/assets/templates/card.md`. No card, no task.

*Done when: every task has a card and an agent name, and no two parallel tasks share an exclusive need.*

## Step 2 — Write the briefs, in the repository

Briefs are tracked files under `.agents/briefs/`, because a rule that only a scratch file holds is lost with it.
A brief is written there and never in a scratch or run-output folder, where no other agent finds it (`aw doctor`
reports one as `BRIEF_STRAY`).

| File | From the template | Holds | Budget |
|---|---|---|---|
| `.agents/briefs/common.md` | `brief-common.md` | how any agent works here: workspace, git, locks, measuring, verification, the report. Written once, kept current. | 120 lines |
| `.agents/briefs/rounds/<date>-<slug>.md` | `brief-round.md` | this round only: who does what, collisions, what must not move, rulings, the integration pass | 80 lines |
| each agent's prompt | `brief-task.md` | the one task: goal, what is known, scope, verification, done | not a file |

The templates are in `${CLAUDE_PLUGIN_ROOT}/assets/templates/`. A brief links to the root `AGENTS.md` for the
project's rules and never restates them; a rule that turns out to bind beyond the round moves into `AGENTS.md`
before the round closes. Say what is already known and ruled out, point at files instead of retelling them, and
never hand an agent your conclusion to confirm. Name the skills the task needs (the root `AGENTS.md` § Agent
plugins says when each applies): a sub-agent opens a skill it was pointed at far more reliably than one it must think of.

*Done when: both briefs are within budget and tracked by git, and `aw dup` reports no rule that a brief repeats.*

## Step 3 — One workspace per agent

- Each agent gets its own git worktree on its own branch. The main checkout belongs to one named agent per round:
  the one whose work cannot run from a worktree.
- The common brief says what a fresh worktree lacks and the commands that provision it. A worktree has no build
  outputs.
- Each agent has a name: lower-case letters, digits and `-`. It is the `--as` of every `aw` command and the holder
  the guard checks.
- The board, the locks and the notes are shared by every worktree; nothing else is.

*Done when: each task prompt names its agent, its worktree and branch, and what to provision first.*

## Step 4 — While they run

```
aw status
aw who
aw notes
```

The board, the owed gates, who holds which lock, who claims which counter, and what the agents told each other.
Agents write `aw note` when they merge something others must pull; relay nothing by hand that a note already
says. Scarce resources, leases and timing runs are the `coordinate` skill. A counter several branches bump is
claimed at merge time, not at the start: `aw claim <counter>`.

*Done when: no lock is held by an agent that is not running, and no two agents claim one counter value.*

## Step 5 — Receive the reports

Every agent reports in the form of `${CLAUDE_PLUGIN_ROOT}/assets/templates/report.md`: verdict first, evidence,
what was not verified, what needs the owner. A report is a message, never a repository file.

- A report's "passed" is a claim. Check the evidence in proportion to the risk: read the diff, run the one command,
  open the artefact. Say in your own report what you checked and what you took on trust.
- Every "not verified" is a gate card (`aw kanban owe`) or it did not happen. Add the missing ones yourself.
- What an agent decided that was the owner's to decide goes to the top of your report.
- What the round learned goes into memory (the `memory` skill), not into the next brief.

*Done when: each finished task has its card in review, its owed checks as gate cards, and its open questions listed.*

## Step 6 — The integration pass

Lighter verification per task has a price: skipped full runs let breakage accumulate. After the merges, one agent,
in the main checkout, holding the locks it needs, runs once what the tasks owed and what only the merged whole can
show. Each gate that passes is settled with its evidence (`aw kanban settle <id> --evidence "…"`); each that fails
becomes a card for the task that caused it.

*Done when: `aw kanban list --kind gate` shows no gate of this round still owed without an owner and a reason.*

## Step 7 — Close the round

- Every card is in review or done; every claim is landed or released (`aw claims`); every lock and lease is free
  (`aw lock status`, `aw leases`).
- Rulings the owner made during the round that bind later work are decision records or rules in `AGENTS.md`.
- Merged worktrees and branches are removed. The round's brief is retired when the round closes: its lasting
  facts go to their homes (a rule to `AGENTS.md`, a lesson to memory, a ruling to a decision, what is left to
  cards); what remains of it in `.agents/briefs/rounds/` is the record, not a place the next round reads rules from.
- Your report to the owner: per task the verdict, what was verified and by whom, the gates settled and still
  owed, and what needs a decision, first.

*Done when: `aw status` shows nothing of this round in progress, and the owner has the report.*
