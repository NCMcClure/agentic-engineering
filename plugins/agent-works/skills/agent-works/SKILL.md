---
name: agent-works
description: Use when unsure where an agent-facing fact goes in a repository, or which agent-works skill owns a task.
---

# agent-works

A repository set up with agent-works keeps every kind of fact in one home, each with a size budget, and checks them
with one command. This skill finds the home and hands over to the skill that owns it.

`aw` is the plugin's command line. Call it as `node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" <command>`: that works
in every shell and needs nothing on the PATH. Where the plugin's `bin/` or the launcher is on the PATH, plain `aw`
is the same program. Every command has `--help`.

## Step 1: See whether the repository is set up

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" doctor
```

"no .agents/agent-works.json" in the first line means it is not: the checks ran on defaults and the guard is off.
Setting it up is the person's to start: ask them to run `/agent-works:setup`. Otherwise `.agents/README.md` in the
repository is the project's own copy of the homes table.

*Done when: you know whether the config exists and how many findings `aw doctor` printed.*

## Step 2: Find the home, hand over

| You have, or need | Home | Skill | Command |
|---|---|---|---|
| What a folder holds; a new, moved or renamed directory | root `AGENTS.md` and the hubs | `hubs` | `aw hubs`, `aw twins` |
| A reason, a measurement, a lesson; where the project stands | `.agents/memory/` | `memory` | `aw memory new`, `aw memory touch` |
| A choice that is hard to reverse; a new term; a protocol or format page | `.agents/decisions/`, `.agents/CONTEXT.md`, `.agents/contracts/` | `decisions` | `aw decisions new` |
| Work to do; a check to run later; what is in progress | the board, `.agents/kanban/` | `board` | `aw status`, `aw board owe` |
| The board drifted from the work | the board | `sync-cards` | `aw board evidence` |
| A goal bigger than one change: several tasks, in parallel | the board and `.agents/briefs/` | `orchestrate`, with `dispatch`, `work-card`, `review-card` | `aw board propose` |
| Something only one session can use at a time | the machine's store | `resource-locks` | `aw lock run` |
| A heavy job, a timing run, another session on the machine, a shared counter | the machine's store | `coordinate` | `aw lease`, `aw sys`, `aw note`, `aw claim` |
| A refusal from the guard; a file agents must not touch; a run too expensive to repeat | `.agents/agent-works.json` | `guard` | `node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs" --explain` |
| Bloat, duplication, stale indexes, agent files under `./docs`; a machine missing a prerequisite | all of the above | `doctor` | `aw doctor`, `aw doctor --machine` |

The whole table, with budgets and what never goes where, is `${CLAUDE_PLUGIN_ROOT}/references/homes.md`: read it
when a fact fits two rows or none.

Outside this plugin's job, where those plugins are installed: planning and specs are but-first-planning (its
workspace is `.agents/plan/`); reorganising a file tree and deepening architecture are codebase-optimizer; work
judged by eye or ear is perceptual-loop; team version-control guardrails are agentic-teamwork.

*Done when: the fact has exactly one home and you have invoked the skill that owns it, or run its command.*
