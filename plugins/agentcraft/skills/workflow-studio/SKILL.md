---
name: workflow-studio
description: "Routes are its arguments, not skills: author-workflow ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# Workflow Studio

## What this does

Starts the Workflow Studio, a browser-based visual node editor (Unreal-Blueprint
style: node canvas, typed pins, exec and data wires, variables) for Claude Code
dynamic workflows. Graphs are edited on a canvas and compiled losslessly to
`.claude/workflows/*.js`. The app is a Vite dev server run from a persistent
install home; workflow projects persist under the studio root so they survive
restarts and plugin updates.

## Launch procedure

1. Run this exact command with the Bash tool and `run_in_background: true` —
   the first lines compute the studio root and the Publish containment root,
   falling back to `$HOME` when there is no project directory:

   ```bash
   STUDIO_ROOT="${CLAUDE_PROJECT_DIR:-$HOME}/.claude/workflow-studio"
   WORKFLOW_EXPORT_ROOT="${CLAUDE_PROJECT_DIR:-$HOME}" \
     node "${CLAUDE_PLUGIN_ROOT}/skills/workflow-studio/scripts/launch-studio.mjs" "${CLAUDE_PLUGIN_ROOT}" "$STUDIO_ROOT" "${CLAUDE_PLUGIN_DATA}"
   ```

   If a studio is already running for this studio root, the launcher prints
   its `Local:` URL and exits 0 — treat that exactly like a fresh launch.

2. First run: the launcher copies the app into `${CLAUDE_PLUGIN_DATA}/app` and
   runs `npm ci` — expect ~30–60 seconds and note that it needs network access
   once. Subsequent launches skip the install and start in a few seconds.
3. Poll the background task output and wait for Vite's `Local:` line. Give the
   user THAT exact URL — Vite may pick a port other than 5173 if it is taken.
   Do not guess or hardcode the port.

## Storage layout

The canonical path tree lives in the plugin README's "Storage layout" section
(project metadata, per-workflow `diagram.json` and compiled output under the
studio root; Publish exports to `.claude/workflows/*.js`, confined to the
project directory). Two operational facts to act on: a live file-watcher
hot-syncs on-disk `diagram.json` edits into the open canvas (hand-editing
while the studio is open is safe), and nothing outside the studio root changes
until the user hits Publish — Compile only writes the studio-internal copy.

## Stopping and troubleshooting

- To stop the studio, kill the background task running the dev server.
- If the install is corrupted or behaving strangely, delete
  `${CLAUDE_PLUGIN_DATA}/app` and relaunch for a clean reinstall.
- The launcher stops with a plain message if `npm` is missing or Node is older
  than 20 (Vite 6 requires Node 20+). If the shell itself says `node` was not
  found, the fix is the same: install Node.js 20 or newer from
  https://nodejs.org/ or a package manager, then relaunch.

## Related

For hand-authoring or editing workflows and `diagram.json` graphs without the
GUI, use the **author-workflow** skill instead.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `author-workflow` |  | Use when writing or modifying a workflow script or graph directly, mapping existing JS to a graph, or answering workflow-diagram protocol questions — no GUI needed. |  | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
