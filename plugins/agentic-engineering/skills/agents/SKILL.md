---
name: agents
description: "Use when this session was started to build a single card, and to run work in parallel from a kanban board that the person and the agents share: putting work on it, a goal or a sprint built by subagents (or child sessions when asked), starting or reviewing a card, and locking a port or another resource one session can hold. Routes are its arguments, not skills: orchestrate (run several tasks or a sprint in parallel, resume a round); board (file out-of-scope work, read or move cards, owe a check); dispatch (start an approved card: a subagent, or a session if asked); work-card (this session was started to build one card); review-card (a child reports its card in review: check, land, close); sync-cards (the board drifted from the work); locks (a port, simulator, GPU, or database one session may hold); coordinate (a heavy job or timing run on a machine agents share)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# agents

A round of parallel work fails the same way in every repository: it lives in one conversation and dies with it, two children change the same file, a child's "passed" is taken on its word, and two sessions on one machine wreck each other's measurements. This area keeps tasks on a kanban board the person and the agents share, runs a goal bigger than one change from that board as subagents (or child sessions, when the person asks) in their own worktrees, and holds the ports, simulators, and machines that only one session can use at a time.

`aw` is the area's command line. Call it as `node "${CLAUDE_PLUGIN_ROOT}/skills/agents/scripts/aw.mjs" <command>`: that works in every shell and needs nothing on the PATH. Where the plugin's `bin/` or the launcher is on the PATH, plain `aw` is the same program. Every command has `--help`.

Two kinds of session come through here. The orchestrator plans a round, starts the children, and reviews them. A child was started with a brief for one card, and its route is `work-card`. A repo's agent-facing setup (its hubs, memory, decisions, guard, and doctor) runs on the same `aw` and is the harness area's: `/agentic-engineering:harness setup` and its neighbours.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **The board is the record.** Memory loses to it: after a restart or a compaction, a round is resumed from the board, never from what a session remembers.
- **The person's yes comes first.** Nothing starts, is pushed, or merges without one, recorded with `aw board grant`.
- **A claim is not a check.** A child's "passed" is a claim until its diff is read, and a check a session cannot run is owed on the board, never claimed.
- **A route that hands on to another names it through its area**, `/agentic-engineering:agents <route>`: a file to read next, never a skill to call.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `board`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `orchestrate` | run several tasks or a sprint in parallel, resume a round | Use when the person wants several tasks built, a backlog or a sprint worked, work run in parallel, briefs written for a round of agents, or a round resumed after a restart or a compaction: this session becomes the orchestrator. | `[the goal, or nothing to resume]` | agent |
| `board` | file out-of-scope work, read or move cards, owe a check | Use for anything on the kanban board: out-of-scope work to put on it instead of doing it now, what is ready or in progress, moving or planning a card, owing a check this session cannot run, settling one with evidence. | `[status\|ready\|add\|move\|owe\|settle ...]` | agent |
| `dispatch` | start an approved card: a subagent, or a session if asked | Use when a card on the board should start: the person approved a parallel set, the orchestrator picked the next ready card, or the kanban pane asked to start one. | `<card id> [--serial]` | agent |
| `work-card` | this session was started to build one card | Use when this session was started to work one card from the board, by a brief or by a work-card command naming the card. | `<card id>` | agent |
| `review-card` | a child reports its card in review: check, land, close | Use when a child session reports its card in review, by its CARD line, a note from its session, or a board wait waking: check the diff against the done criteria, send findings back, land it on green, close the card. | `<card id>` | agent |
| `sync-cards` | the board drifted from the work | Use when the board may have drifted from the work: a request merged or closed under a card in flight, backlog cards already started or landed, suggestions piling up, the briefing says cards have not changed for a day, or the person asks to sync or groom the board. | `[in-flight\|backlog\|suggested] [card ids]` | agent |
| `locks` | a port, simulator, GPU, or database one session may hold | Use before starting anything only one session on this machine can use at a time: a dev-server port, a simulator, a GPU, a shared database, a timing-sensitive test run. | `[run\|acquire\|release\|status] <resource> ...` | agent |
| `coordinate` | a heavy job or timing run on a machine agents share | Use before a heavy job, a timing run or shared use of a GPU on a machine agents share, and to leave a note, claim a shared counter or record a lesson for other sessions. |  | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
