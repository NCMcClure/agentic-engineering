# AGENTS.md — {{project}}

Guidance for agents (and people) working in this repository. Read this file, then `.agents/README.md`, then the
status memory. Keep this file under 200 lines: every session loads it.

## What this is

<Two or three sentences: what the project does, for whom, and the one diagram or sentence that explains its shape.>

## Repo map

<One line per top-level folder, led by its name in a code span: what it holds and when to open it. Direct children
only. Every non-leaf code directory has its own AGENTS.md that does the same one level down.>

## Build, test, run

<The commands, what each costs, and which to run while iterating and which once at the end.>

## Rules

<One entry per rule, five lines at most: the rule, then a link to the decision or memory that says why. Rules that
a hook enforces say so. No status here, and no history.>

1. **Hubs follow the code.** When you add, move, rename or repurpose something in a directory, update the
   AGENTS.md that lists it in the same change.
2. **One home per fact.** Before writing something down, find its home in the table below; link to a fact, never
   copy it.

## Where things live

| What you have | Where it goes | How |
|---|---|---|
| A reason, a measurement, a lesson | project memory | `aw memory new`, `aw memory touch` |
| Where the project stands | the status memory, and the board | `aw status` |
| Work to do, a check still owed | a card on the kanban board | `aw kanban add`, `aw kanban owe` |
| A choice that is hard to reverse | a decision record | `aw decisions new` |
| The meaning of a word | the glossary | one row, in the same change |
| A protocol, a format, how to extend | a contracts page under .agents | changed with the code |
| A report | your final message, or the pull request | never a file |
| Documentation for users | the docs folder, and only that | |

The full table, the formats and the budgets are in `.agents/README.md`. `aw doctor` checks all of it.
