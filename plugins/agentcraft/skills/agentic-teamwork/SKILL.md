---
name: agentic-teamwork
description: "Routes are its arguments, not skills: audit-project (); bootstrap (); init-project (); land (); ship (); tdd ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# agentic-teamwork

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `audit-project` |  | Use when the guards or the CI gate seem off, after a plugin update, or when asked to audit or verify the setup. | `[--fix]` | agent |
| `bootstrap` |  | Use when the session briefing says the repo is not on the team conventions yet, or when starting a project in an empty folder. |  | person |
| `init-project` |  | Use when starting a new repo, when the session briefing or audit-project says to run the upgrade, or to turn on the strict test gate with --strict. | `[--upgrade] [--name <n>] [--template library\|node-service] [--forge github\|gitlab\|none] [--strict] [--dry-run]` | person |
| `land` |  | Use when a reviewed pull request or merge request should land: its checks are waited on in the background and it is merged on green. | `<number> \| --branch <b>` | agent |
| `ship` |  | Use when the user says ship it, open a PR, open an MR, or push this. | `[--stack] [--draft]` | agent |
| `tdd` |  | Use when writing or changing tests, when a change needs a failing test first, when wiring a new repo's lanes, or when deciding what to mock and what to run for real. |  | agent |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
