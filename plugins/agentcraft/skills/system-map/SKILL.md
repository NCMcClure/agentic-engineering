---
name: system-map
description: "Use when a module or a call between modules is added in a repo that keeps a system map, when a checker reports the map stale, and for any diagram, flow, or architecture frame drawn on Miro from code. Routes are its arguments, not skills: diagrams-sync (a code change moved the system map or its board); miro-board (draw or update a frame, fix overlaps, pull layout back); diagrams-init (give a repo a system map generated from its code); browser-setup (the live check has no browser tools or cannot reach Miro)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# system-map

An architecture diagram is true on the day it is drawn. After that the code moves and the picture does not, and nobody finds out until a new person trusts it. This area moves the diagram into the code: each module declares what it is and whom it calls in `@system` annotations, the map is extracted from those lines into a committed file, and a checker holds that file to the real import graph. The map is then drawn where people look, on a Miro board, by generators whose output is linted before it is published and checked again as Miro drew it.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **The code is the source of the map.** A module or a call changes in its annotation, and the map file is regenerated, never edited by hand.
- **The lint is the reviewer.** Never zoom in on the board hunting for overlaps, never place items by eye, and never loosen a check to get past a finding.
- **Content changes in code, layout on the board.** A box, a caption, or a connector changes in its generator; a card the person moved in Miro is pulled back, not redrawn.
- **Signing in to Miro is the person's.** It happens in their browser window; never type a credential. Nothing on a board is deleted without their yes.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `diagrams-sync`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `diagrams-sync` | a code change moved the system map or its board | Use when adding a module or a call between modules in a repo that carries .agents/system-map.json, when the Stop hook, the checker or CI reports MAP_STALE, MAP_MISSING, UNDECLARED_IMPORT, UNDECLARED_RUN, or BOARD_BEHIND, or when the user says "update the diagram", "sync the board", or "redraw the system map". |  | agent |
| `miro-board` | draw or update a frame, fix overlaps, pull layout back | Use when drawing or updating a diagram, flow, or architecture frame on Miro. |  | agent |
| `diagrams-init` | give a repo a system map generated from its code | Use when a repo should get a diagram that is extracted from its code and checked against it, once per repo. | `[board name or URL]` | person |
| `browser-setup` | the live check has no browser tools or cannot reach Miro | Use when the miro-board route's live check has no evaluate_script or list_pages tool, when the system-map session note says the check cannot run on this machine, when the Miro tab cannot be found or reached, or to repair the browser for Miro. |  | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
