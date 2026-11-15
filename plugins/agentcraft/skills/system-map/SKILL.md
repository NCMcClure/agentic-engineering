---
name: system-map
description: "Routes are its arguments, not skills: browser-setup (); diagrams-init (); diagrams-sync (); miro-board ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# system-map

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `browser-setup` |  | Use when the miro-board skill's live check has no evaluate_script or list_pages tool, when the system-map session note says the check cannot run on this machine, when the Miro tab cannot be found or reached, or to repair the browser for Miro. |  | person |
| `diagrams-init` |  | Use when a repo should get a diagram that is extracted from its code and checked against it, once per repo. | `[board name or URL]` | person |
| `diagrams-sync` |  | Use when adding a module or a call between modules in a repo that carries .agents/system-map.json, when the Stop hook, the checker or CI reports MAP_STALE, MAP_MISSING, UNDECLARED_IMPORT, UNDECLARED_RUN, or BOARD_BEHIND, or when the user says "update the diagram", "sync the board", or "redraw the system map". |  | agent |
| `miro-board` |  | Use when drawing or updating a diagram, flow, or architecture frame on Miro. |  | agent |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
