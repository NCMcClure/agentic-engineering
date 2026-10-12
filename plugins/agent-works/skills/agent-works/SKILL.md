---
name: agent-works
description: Use when unsure where an agent-facing fact goes, or which agent-works skill owns it.
---

# agent-works

A repository set up with agent-works keeps every kind of fact in one home, each with a size budget, and checks them
with one command. This skill finds the home and hands over to the skill that owns it.

`aw` is the plugin's command line. It is on the Bash tool's PATH while the plugin is enabled. In PowerShell or a
terminal it needs the launcher (`aw setup --install-launcher`, once), or call it as
`python -B "${CLAUDE_PLUGIN_ROOT}/cli/aw.py" <command>`. Every command has `--help`.

## Step 1 — See whether the repository is set up

```
aw doctor
```

"no .agents/agent-works.json" in the first line means it is not: the checks ran on defaults and the guard is off.
Setting it up is the `setup` skill. Otherwise `.agents/README.md` in the repository is the project's own copy of
the homes table.

*Done when: you know whether the config exists and how many findings `aw doctor` printed.*

## Step 2 — Find the home, hand over

| You have, or need | Home | Skill | Command |
|---|---|---|---|
| What a folder holds; a new, moved or renamed directory | root `AGENTS.md` and the hubs | `hubs` | `aw hubs`, `aw twins` |
| A reason, a measurement, a lesson; where the project stands | `.agents/memory/` | `memory` | `aw memory new`, `aw memory touch` |
| A choice that is hard to reverse; a new term; a protocol or format page | `.agents/decisions/`, `.agents/CONTEXT.md`, `.agents/contracts/` | `decisions` | `aw decisions new` |
| Work to do; a check to run later; what is in progress | `.agents/kanban/` | `kanban-cards` | `aw status`, `aw kanban owe` |
| Several agents on one repository | `.agents/briefs/` | `orchestrate` | `aw claim`, `aw status` |
| A scarce application, a heavy job, a timing run, another session on the machine | the machine's store | `coordinate` | `aw lock run`, `aw lease`, `aw sys`, `aw note` |
| A refusal from the guard; a file agents must not touch; a run too expensive to repeat | `.agents/agent-works.json` | `guard` | `guard.py --explain` |
| Bloat, duplication, stale indexes, agent files under `./docs` | all of the above | `doctor` | `aw doctor` |

The whole table, with budgets and what never goes where, is `${CLAUDE_PLUGIN_ROOT}/core/references/homes.md`: read
it when a fact fits two rows or none.

Outside this plugin's job, by the specialists of this marketplace: planning and specs are but-first-planning (its
workspace is `.agents/plan/`); reorganising a file tree and deepening architecture are codebase-optimizer; work
judged by eye or ear is perceptual-loop; team version-control guardrails are agentic-teamwork.

*Done when: the fact has exactly one home and you have invoked the skill that owns it, or run its command.*
