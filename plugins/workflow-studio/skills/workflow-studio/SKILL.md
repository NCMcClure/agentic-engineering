---
name: workflow-studio
description: >-
  Launch the Workflow Studio — a visual, Unreal-Blueprint-style node editor for
  Claude Code dynamic workflows (.claude/workflows/*.js) — in the browser. Use
  when the user wants to open, launch, or start the workflow studio/editor,
  visually build or edit a workflow graph, or asks to "open the canvas" for a
  workflow. Starts a local Vite dev server; workflow projects persist under the
  current project's .claude/workflow-studio directory.
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

1. Determine the studio root: use `${CLAUDE_PROJECT_DIR}/.claude/workflow-studio`.
   If there is no project directory (no `CLAUDE_PROJECT_DIR`), fall back to
   `"$HOME/.claude/workflow-studio"` as the studio root.
2. Run this exact command with the Bash tool and `run_in_background: true`:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/launch-studio.sh" "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_PROJECT_DIR}/.claude/workflow-studio" "${CLAUDE_PLUGIN_DATA}"
   ```

3. First run: the script copies the app into `${CLAUDE_PLUGIN_DATA}/app` and
   runs `npm ci` — expect ~30–60 seconds and note that it needs network access
   once. Subsequent launches skip the install and start in a few seconds.
4. Poll the background task output and wait for Vite's `Local:` line. Give the
   user THAT exact URL — Vite may pick a port other than 5173 if it is taken.
   Do not guess or hardcode the port.

## Storage layout

- `<studio-root>/<project-id>/project.json` — studio project metadata.
- `<studio-root>/<project-id>/workflows/<workflow-id>/diagram.json` — the graph.
- `<studio-root>/<project-id>/workflows/<workflow-id>/compiled.js` — compiled output.
- Compiled workflows export to `.claude/workflows/*.js` for Claude Code to run.
- A live file-watcher hot-syncs on-disk `diagram.json` edits into the open
  canvas, so editing the file by hand while the studio is open is safe.

## Stopping and troubleshooting

- To stop the studio, kill the background task running the dev server.
- If the install is corrupted or behaving strangely, delete
  `${CLAUDE_PLUGIN_DATA}/app` and relaunch for a clean reinstall.
- The script fails fast with a friendly message if `node`/`npm` are missing or
  Node is older than 20 (Vite 6 requires Node 20+).

## Related

For hand-authoring or editing workflows and `diagram.json` graphs without the
GUI, use the **author-workflow** skill instead.
