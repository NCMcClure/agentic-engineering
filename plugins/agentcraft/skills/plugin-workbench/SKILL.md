---
name: plugin-workbench
description: "Routes are its arguments, not skills: create-plugin (); evaluate-plugin (); improve-plugin (); refresh-marketplace ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# plugin-workbench

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `create-plugin` |  | Use when someone wants to make a plugin, turn existing skills or scripts into one, or asks what a good plugin needs. | `<plugin idea \| existing dir to wrap> [--dir <parent>] [--bar <composite>]` | agent |
| `evaluate-plugin` |  | Use when someone wants a plugin or a bare skill directory evaluated, audited, or compared before installing it. | `<path \| owner/repo \| git URL>[#ref] [--output <dir>]` | person |
| `improve-plugin` |  | Use when someone wants a plugin improved, scorecard findings fixed, or a score pushed past a verdict tier. | `<path \| owner/repo \| git URL>[#ref] [--report <dir with score.json + grades.json>] [--bar <tier \| composite>] [--output <dir>]` | agent |
| `refresh-marketplace` |  | Use when someone has changed a plugin in a marketplace checkout and asks to refresh, reinstall, or try it. | `[--plugins a,b] [--dry-run]` | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
