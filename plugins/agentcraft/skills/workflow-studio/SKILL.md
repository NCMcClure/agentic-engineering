---
name: workflow-studio
description: "Use when the person wants to open the visual editor for Claude Code dynamic workflows, or to write or change a workflow script or its diagram.json graph by hand. Routes are its arguments, not skills: author-workflow (write or edit a workflow script or its graph by hand)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# workflow-studio

A Claude Code dynamic workflow is a script, and a script with a dozen agents, branches, and barriers is hard to hold in the head. This area gives it two forms that compile to each other without loss: a graph on a canvas (a node editor in the browser, in the Unreal Blueprint style: typed pins, exec and data wires, variables) and the `.claude/workflows/*.js` file the host runs.

Two jobs come here. Opening the studio is this area's own, done from "Launch" below; it is not a route. Writing or changing a workflow script or its `diagram.json` graph by hand, with no canvas, is the `author-workflow` route: read its file before you act or ask.

The data directory for this area is `${CLAUDE_PLUGIN_DATA}/workflow-studio`. The app is installed and run from there, so it survives a plugin update.

## Launch

1. Run this exact command with the Bash tool and `run_in_background: true`. The first lines compute the studio root and the Publish containment root, falling back to `$HOME` when there is no project directory:

   ```bash
   STUDIO_ROOT="${CLAUDE_PROJECT_DIR:-$HOME}/.claude/workflow-studio"
   WORKFLOW_EXPORT_ROOT="${CLAUDE_PROJECT_DIR:-$HOME}" \
     node "${CLAUDE_PLUGIN_ROOT}/skills/workflow-studio/scripts/launch-studio.mjs" "${CLAUDE_PLUGIN_ROOT}/skills/workflow-studio" "$STUDIO_ROOT" "${CLAUDE_PLUGIN_DATA}/workflow-studio"
   ```

   If a studio is already running for this studio root, the launcher prints its `Local:` URL and exits 0: treat that exactly like a fresh launch.
2. First run: the launcher copies the app into `app/` under the data directory and runs `npm ci`. Expect 30 to 60 seconds, and it needs network access once. Later launches skip the install and start in a few seconds.
3. Poll the background task's output and wait for Vite's `Local:` line. Give the person that exact URL: Vite may pick a port other than 5173 if it is taken. Do not guess or hardcode the port.

## While it runs

- Workflow projects persist under the studio root: project metadata, each workflow's `diagram.json`, and its compiled output. The README's "Storage layout" section has the tree.
- A file watcher syncs on-disk `diagram.json` edits into the open canvas, so editing by hand while the studio is open is safe.
- Nothing outside the studio root changes until the person hits Publish, which writes `.claude/workflows/*.js` inside the project directory. Compile only writes the studio's own copy.
- To stop the studio, kill the background task running the dev server. If the install is corrupted, delete `app/` under the data directory and relaunch.
- The launcher stops with a plain message if `npm` is missing or Node is older than 20. The fix is the same when the shell says `node` was not found: install Node.js 20 or newer, then relaunch.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `author-workflow`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `author-workflow` | write or edit a workflow script or its graph by hand | Use when writing or modifying a workflow script or graph directly, mapping existing JS to a graph, or answering workflow-diagram protocol questions — no GUI needed. |  | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
