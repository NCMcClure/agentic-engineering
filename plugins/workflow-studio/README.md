# Workflow Studio

An Unreal-Blueprint-style visual editor for Claude Code dynamic workflows:
drag nodes, wire pins, and compile the graph losslessly to
`.claude/workflows/*.js`. No blueprint compiler errors, though. Mostly.

## Quick start

1. Install the plugin.
2. Run `/workflow-studio`.
3. Open the printed `Local:` URL in your browser (Vite picks the port; trust
   the printout, not 5173).

First launch copies the app into `~/.claude/plugins/data/workflow-studio/app`
and runs `npm ci`; expect 30–60 seconds, Node 20+, and network access, once.
After that, launches are near-instant and offline-friendly.

## Skills

| Skill | What it does |
|---|---|
| `/workflow-studio` | Launches the visual studio (Vite dev server) and hands you the URL. |
| `/author-workflow` | Hand-author or edit workflows and `diagram.json` graphs: no GUI, just the protocol docs. |

## Storage layout

Workflow projects persist under the current project's
`.claude/workflow-studio/` directory (falling back to
`~/.claude/workflow-studio/` outside a project):

```
<studio-root>/
  <project-id>/
    project.json                          # studio project metadata
    workflows/
      <workflow-id>/
        diagram.json                      # the graph (hot-synced into the open canvas)
        compiled.js                       # compiled output
```

**Compile** writes only the studio-internal `compiled.js`; **Publish** promotes
it to the workflow's publish path (default `.claude/workflows/<workflow>.js`,
where Claude Code runs it), confirmed first and confined to the project
directory — the server rejects any target outside it. A live file-watcher syncs
on-disk `diagram.json` edits into an open canvas, so hand edits and the GUI
coexist peacefully. A `.studio.lock` under the studio root lets the launcher
detect an already-running instance and hand back its URL instead of starting a
second one.

## Manual fallback

If you'd rather skip the launcher script:

```bash
cd app
npm install
STUDIO_ROOT=/path/to/your/.claude/workflow-studio npm run dev
```

## Provenance

The `app/` directory was vendored from
[github.com/NCMcClure/workflow-editor](https://github.com/NCMcClure/workflow-editor)
@ `studio-overhaul`, commit `8c65333534077e44cced1bc37beb3fc937512195`, and
**has since diverged**: as of 0.2.0 this plugin is the primary home of the app
code (security hardening, Publish flow, launcher lock), and upstream sync is a
manual, by-hand merge in whichever direction is wanted — never a blind re-copy.

(`app/docs/` was already plugin-maintained before the divergence — its
authoring protocol was rewritten for the studio layout in 0.1.1.)

## Changelog

- **0.3.0**: Data-safety release. Every mutation now autosaves (debounced;
  config edits, adds, deletes, and connects previously never saved), with a
  dirty/saving/failed status chip, retryable save errors, and a
  close-tab guard. Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, capped snapshot
  history per view) with toolbar buttons. Deletion unified into one
  multi-select-aware path (Del/Backspace included; React Flow's native
  Backspace bypass disabled) that clears group membership; changing a node's
  kind or shrinking variadic pins now prunes dangling edges. Live-sync echo
  detection is content-based (no more 1.5 s window): clean editors reload
  external edits, dirty editors get an explicit Reload / Keep-mine conflict
  choice. Launcher mutations surface errors in a dismissible banner.
- **0.2.0**: Security + robustness release. The `/api` backend now rejects
  non-local Host/Origin (blocks CSRF/DNS-rebinding drive-bys), caps request
  bodies, and validates saved diagrams. Compile & Export split into **Compile**
  (studio-internal only) and **Publish** (confirmed, and confined to the
  project directory — the old endpoint could write any absolute path, and
  resolved relative paths against the app install dir). Launcher now retries a
  failed `npm ci` (success-stamped installs) and detects an already-running
  studio via `.studio.lock` + `/api/health` instead of starting a duplicate.
  Codegen guards data-wire cycles (previously infinite recursion) and memoizes
  data-pull resolution. Docs: diagram-schema v3 headline/examples fixed,
  provenance marked as diverged from upstream.
- **0.1.2**: README reworded.
- **0.1.1**: studio-root fallback now actually applied in the launch command; storage layout single-sourced in this README; AUTHORING.md de-sedimented (workspace model replaced with the studio layout, dead references/ paths fixed, stale skill notes removed); compilation routed to the studio's codegen instead of hand-emulation; trimmed skill descriptions (~219 → ~138 est passive tokens).
- **0.1.0**: Initial release: vendored studio app (workflow-editor @
  `studio-overhaul`, `8c65333`), `launch-studio.sh` with persistent install
  home and lockfile-aware `npm ci`, `/workflow-studio` and `/author-workflow`
  skills.
