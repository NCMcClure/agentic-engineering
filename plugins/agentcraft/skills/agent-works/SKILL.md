---
name: agent-works
description: "Use to run several tasks as child sessions from a kanban board, and to keep a repo's agent-facing facts in one home each: putting work on the board, starting, working, or reviewing a card, memory and decisions, AGENTS.md hubs, the guard, and locking a port or another resource one session can hold. Routes are its arguments, not skills: orchestrate (run several tasks or a sprint in parallel, resume a round); board (file out-of-scope work, read or move cards, owe a check); dispatch (start an approved card as a child session in a worktree); work-card (this session was started to build one card); review-card (a child reports its card in review: check, land, close); sync-cards (the board drifted from the work); resource-locks (a port, simulator, GPU, or database one session may hold); coordinate (a heavy job or timing run on a machine agents share); memory (read project memory, record a lesson, update status); decisions (a hard-to-reverse choice, a new term, a contract page); hubs (a directory added or moved, an AGENTS.md hub finding); guard (the guard refused or warned, or a mistake must not recur); doctor (agent files bloated or repeated, or the machine lacks a tool); setup (set a repository up for agent work, install the launcher)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# agent-works

Agent workflows rot the same way in every repository: `AGENTS.md` grows until nobody reads it, one rule is stated in four places that then disagree, a round of parallel work lives in one conversation and dies with it, and two sessions on one machine wreck each other's measurements. This area gives every kind of agent-facing fact one home under `.agents/` with a size budget, keeps tasks on a kanban board the person and the agents share, runs a goal bigger than one change from that board as child sessions in their own worktrees, and guards the files and runs that need it.

`aw` is the area's command line. Call it as `node "${CLAUDE_PLUGIN_ROOT}/skills/agent-works/scripts/aw.mjs" <command>`: that works in every shell and needs nothing on the PATH. Where the plugin's `bin/` or the launcher is on the PATH, plain `aw` is the same program. Every command has `--help`.

A fact that fits two rows below, or none, has its home in `${CLAUDE_PLUGIN_ROOT}/skills/agent-works/references/homes.md`: the whole table, with budgets and what never goes where.

Two kinds of session come through here. The orchestrator plans a round, starts the children, and reviews them. A child was started with a brief for one card, and its route is `work-card`.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **One home per fact.** A lesson, a decision, a status, a task: each has one place, and its route says where. Nothing agent-facing goes under `./docs`.
- **The board is the record.** Memory loses to it: after a restart or a compaction, a round is resumed from the board, never from what a session remembers.
- **The person's yes comes first.** Nothing starts, is pushed, or merges without one. Setting a repository up is theirs to start too: `aw doctor` opens with "no .agents/agent-works.json" where it has not been, and the checks then ran on defaults with the guard off.
- **A claim is not a check.** A child's "passed" is a claim until its diff is read, and a check a session cannot run is owed on the board, never claimed.
- **A route that hands on to another names it through this area**, `/agentcraft:agent-works <route>`: a file to read next, never a skill to call.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `doctor`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `orchestrate` | run several tasks or a sprint in parallel, resume a round | Use when the person wants several tasks built, a backlog or a sprint worked, work run in parallel, briefs written for a round of agents, or a round resumed after a restart or a compaction: this session becomes the orchestrator. | `[the goal, or nothing to resume]` | agent |
| `board` | file out-of-scope work, read or move cards, owe a check | Use for anything on the kanban board: out-of-scope work to put on it instead of doing it now, what is ready or in progress, moving or planning a card, owing a check this session cannot run, settling one with evidence. | `[status\|ready\|add\|move\|owe\|settle ...]` | agent |
| `dispatch` | start an approved card as a child session in a worktree | Use when a card on the board should start: the person approved a parallel set, the orchestrator picked the next ready card, or the kanban pane asked to start one. | `<card id> [--serial]` | agent |
| `work-card` | this session was started to build one card | Use when this session was started to work one card from the board, by a brief or by a work-card command naming the card. | `<card id>` | agent |
| `review-card` | a child reports its card in review: check, land, close | Use when a child session reports its card in review, by its CARD line, a note from its session, or a board wait waking: check the diff against the done criteria, send findings back, land it on green, close the card. | `<card id>` | agent |
| `sync-cards` | the board drifted from the work | Use when the board may have drifted from the work: a request merged or closed under a card in flight, backlog cards already started or landed, suggestions piling up, the briefing says cards have not changed for a day, or the person asks to sync or groom the board. | `[in-flight\|backlog\|suggested] [card ids]` | agent |
| `resource-locks` | a port, simulator, GPU, or database one session may hold | Use before starting anything only one session on this machine can use at a time: a dev-server port, a simulator, a GPU, a shared database, a timing-sensitive test run. | `[run\|acquire\|release\|status] <resource> ...` | agent |
| `coordinate` | a heavy job or timing run on a machine agents share | Use before a heavy job, a timing run or shared use of a GPU on a machine agents share, and to leave a note, claim a shared counter or record a lesson for other sessions. |  | agent |
| `memory` | read project memory, record a lesson, update status | Use to read project memory before a task, record a lesson, or update status. |  | agent |
| `decisions` | a hard-to-reverse choice, a new term, a contract page | Use for a hard-to-reverse choice, a new project term, or an agent contract page. |  | agent |
| `hubs` | a directory added or moved, an AGENTS.md hub finding | Use when adding, moving, renaming or removing a directory, when aw hubs reports a finding, or when a tree needs a new AGENTS.md hub. |  | agent |
| `guard` | the guard refused or warned, or a mistake must not recur | Use when the agent guard refuses, questions or warns about a command or an edit, or a mistake must not happen again. |  | agent |
| `doctor` | agent files bloated or repeated, or the machine lacks a tool | Use when AGENTS.md, memory or status bloats, rules repeat, ./docs holds agent files, or a command fails because the machine lacks Node, git or the forge's command line. |  | agent |
| `setup` | set a repository up for agent work, install the launcher | Run to set a repository up for agent work, adopt the agent files it already has, or install the aw launcher. A person starts it. |  | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
