---
name: agent-works
description: "Routes are its arguments, not skills: board (); coordinate (); decisions (); dispatch (); doctor (); guard (); hubs (); memory (); orchestrate (); resource-locks (); review-card (); setup (); sync-cards (); work-card ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# agent-works

A repository set up with agent-works keeps every kind of fact in one home, each with a size budget, and checks them
with one command. This skill finds the home and hands over to the skill that owns it.

`aw` is the plugin's command line. Call it as `node "${CLAUDE_PLUGIN_ROOT}/skills/agent-works/scripts/aw.mjs" <command>`: that works
in every shell and needs nothing on the PATH. Where the plugin's `bin/` or the launcher is on the PATH, plain `aw`
is the same program. Every command has `--help`.

## Step 1: See whether the repository is set up

```
node "${CLAUDE_PLUGIN_ROOT}/skills/agent-works/scripts/aw.mjs" doctor
```

"no .agents/agent-works.json" in the first line means it is not: the checks ran on defaults and the guard is off.
Setting it up is the person's to start: ask them to run `/agentcraft:agent-works setup`. Otherwise `.agents/README.md` in the
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
| A refusal from the guard; a file agents must not touch; a run too expensive to repeat | `.agents/agent-works.json` | `guard` | `node "${CLAUDE_PLUGIN_ROOT}/skills/agent-works/hooks/guard.mjs" --explain` |
| Bloat, duplication, stale indexes, agent files under `./docs`; a machine missing a prerequisite | all of the above | `doctor` | `aw doctor`, `aw doctor --machine` |

The whole table, with budgets and what never goes where, is `${CLAUDE_PLUGIN_ROOT}/skills/agent-works/references/homes.md`: read it
when a fact fits two rows or none.

Outside this plugin's job, where those plugins are installed: planning and specs are but-first-planning (its
workspace is `.agents/plan/`); reorganising a file tree and deepening architecture are codebase-optimizer; work
judged by eye or ear is perceptual-loop; team version-control guardrails are agentic-teamwork.

*Done when: the fact has exactly one home and you have invoked the skill that owns it, or run its command.*

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `board` |  | Use for anything on the kanban board: out-of-scope work to put on it instead of doing it now, what is ready or in progress, moving or planning a card, owing a check this session cannot run, settling one with evidence. | `[status\|ready\|add\|move\|owe\|settle ...]` | agent |
| `coordinate` |  | Use before a heavy job, a timing run or shared use of a GPU on a machine agents share, and to leave a note, claim a shared counter or record a lesson for other sessions. |  | agent |
| `decisions` |  | Use for a hard-to-reverse choice, a new project term, or an agent contract page. |  | agent |
| `dispatch` |  | Use when a card on the board should start: the person approved a parallel set, the orchestrator picked the next ready card, or the kanban pane asked to start one. | `<card id> [--serial]` | agent |
| `doctor` |  | Use when AGENTS.md, memory or status bloats, rules repeat, ./docs holds agent files, or a command fails because the machine lacks Node, git or the forge's command line. |  | agent |
| `guard` |  | Use when the agent guard refuses, questions or warns about a command or an edit, or a mistake must not happen again. |  | agent |
| `hubs` |  | Use when adding, moving, renaming or removing a directory, when aw hubs reports a finding, or when a tree needs a new AGENTS.md hub. |  | agent |
| `memory` |  | Use to read project memory before a task, record a lesson, or update status. |  | agent |
| `orchestrate` |  | Use when the person wants several tasks built, a backlog or a sprint worked, work run in parallel, briefs written for a round of agents, or a round resumed after a restart or a compaction: this session becomes the orchestrator. | `[the goal, or nothing to resume]` | agent |
| `resource-locks` |  | Use before starting anything only one session on this machine can use at a time: a dev-server port, a simulator, a GPU, a shared database, a timing-sensitive test run. | `[run\|acquire\|release\|status] <resource> ...` | agent |
| `review-card` |  | Use when a child session reports its card in review, by its CARD line, a note from its session, or a board wait waking: check the diff against the done criteria, send findings back, land it on green, close the card. | `<card id>` | agent |
| `setup` |  | Run to set a repository up for agent work, adopt the agent files it already has, or install the aw launcher. A person starts it. |  | person |
| `sync-cards` |  | Use when the board may have drifted from the work: a request merged or closed under a card in flight, backlog cards already started or landed, suggestions piling up, the briefing says cards have not changed for a day, or the person asks to sync or groom the board. | `[in-flight\|backlog\|suggested] [card ids]` | agent |
| `work-card` |  | Use when this session was started to work one card from the board, by a brief or by a work-card command naming the card. | `<card id>` | agent |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
