---
name: workflow-studio
description: >-
  Launch the Workflow Studio — a visual, Unreal-Blueprint-style node editor for
  Claude Code dynamic workflows — in the browser (a local Vite dev server). Use
  when the user wants to open the studio, visually build or edit a workflow
  graph, or asks to "open the canvas".
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
   the first line computes the studio root, falling back to `$HOME` when there
   is no project directory:

   ```bash
   STUDIO_ROOT="${CLAUDE_PROJECT_DIR:-$HOME}/.claude/workflow-studio"
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/launch-studio.sh" "${CLAUDE_PLUGIN_ROOT}" "$STUDIO_ROOT" "${CLAUDE_PLUGIN_DATA}"
   ```

2. First run: the script copies the app into `${CLAUDE_PLUGIN_DATA}/app` and
   runs `npm ci` — expect ~30–60 seconds and note that it needs network access
   once. Subsequent launches skip the install and start in a few seconds.
3. Poll the background task output and wait for Vite's `Local:` line. Give the
   user THAT exact URL — Vite may pick a port other than 5173 if it is taken.
   Do not guess or hardcode the port.

## Storage layout

The canonical path tree lives in the plugin README's "Storage layout" section
(project metadata, per-workflow `diagram.json` and compiled output under the
studio root; Publish exports to `.claude/workflows/*.js`). Two operational
facts to act on: a live file-watcher hot-syncs on-disk `diagram.json` edits
into the open canvas (hand-editing while the studio is open is safe), and
nothing outside the studio root changes until the user hits Publish.

## Stopping and troubleshooting

- To stop the studio, kill the background task running the dev server.
- If the install is corrupted or behaving strangely, delete
  `${CLAUDE_PLUGIN_DATA}/app` and relaunch for a clean reinstall.
- The script fails fast with a friendly message if `node`/`npm` are missing or
  Node is older than 20 (Vite 6 requires Node 20+).

## Related

For hand-authoring or editing workflows and `diagram.json` graphs without the
GUI, use the **author-workflow** skill instead.
