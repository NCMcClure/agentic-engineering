---
name: diagrams-sync
description: >
  Bring the system map and its Miro board level with a code change: fix the
  @system annotations, regenerate diagrams/system-map.json, and republish the
  board. Use when adding a module or a call between modules in a repo that
  carries .agents/system-map.json, when the checker or CI reports MAP_STALE,
  MAP_MISSING, UNDECLARED_IMPORT, UNDECLARED_RUN, or BOARD_BEHIND, or when the
  user says "update the diagram", "sync the board", or "redraw the system
  map". Also the whole-repo sweep, which assesses every module's annotations
  against its code: use it when asked to re-annotate the codebase or audit
  the map.
---

# diagrams-sync

The in-loop pass. The map is committed in the same change as the code it describes; the board follows it, in the same session when the Miro MCP is there, and otherwise as soon as someone runs this with it. For the whole repo rather than one change, run [the whole-repo sweep](#the-whole-repo-sweep) in place of steps 1 and 2.

`MAP` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/system-map.mjs"`. Run it from the repo root (or pass `--root <repo>`). The grammar is in [references/grammar.md](references/grammar.md). A repo with no `.agents/system-map.json` has no map yet: ask the person to run `/marvelous-miro:diagrams-init`, which is theirs to run.

## Step 1: What moved

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/system-map.mjs" --changed HEAD --json
```

Use `--changed <base>..HEAD` for a branch. Read each finding:

- `UNDECLARED_IMPORT` / `UNDECLARED_RUN`: a module now imports another, or runs one of its scripts as a child process, with no edge. Add the `calls` line in the calling module (the label says what passes), or move the code if the dependency is the mistake. One that deliberately needs no edge takes `Diagram: none, <why>` in the commit message.
- `NODE_MISSING`: a new directory of source files belongs to no node. Declare one in its entry file, or, if it is part of a neighbour's job, move it under that node's directory.
- `UNDECLARED_EXPORT` / `EXPORT_STALE`: a node's entry file exports a name with no `exposes` or `internal` line, or an `exposes` line names something it no longer exports.
- `LAYER_VIOLATION`: a call goes up the layers. Usually the callee is on the wrong layer, or the call belongs the other way round.
- `EGRESS_OUTSIDE_ADAPTER`: a network call outside an `adapter` node. Move it behind the adapter that owns that system, or accept it in the config with a why.
- `TARGET_MISSING`, `NODE_DUPLICATE`, `LAYER_UNKNOWN`, `CALLS_ORPHAN`, `PARSE`: the annotations do not make a map. The message names the line.
- `MAP_STALE` / `MAP_MISSING`: step 2 fixes them.

Also read the diff yourself. A new directory with a job of its own is a new `node`; an HTTP call, a queue publish, an event, or a script path built at runtime is a `calls` line nobody will flag. A new catalog, manifest directory, or outside caller that cannot hold a comment goes under `nodes` in the config.

*Done when: every finding but `MAP_STALE` and `BOARD_BEHIND` is fixed or accepted with a why.*

## Step 2: Regenerate the map

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/system-map.mjs" --write
```

Read the diff of `diagrams/system-map.json`; it is what the reviewer reads. A renamed node id orphans its board card, so rename the title, not the id, unless the module really is a different one.

*Done when: the checker prints `0 warning`.*

## Step 3: Republish the board

1. `MAP --can-publish`. If it refuses, publish nothing and say why: no board is recorded, or the config requires a classification label the board is not recorded as carrying. Either is the person's to settle; `/marvelous-miro:diagrams-init` (Step 3) walks them through it.
2. Run the miro-board skill's loop on the `system` view: build, publish the update, live check, pull.
3. `MAP --mark-published`, then commit `diagrams/` and the config together.

Without the Miro MCP, stop after step 2 and say so: the map is committed and the check passes, and the board reports `BOARD_BEHIND` until someone publishes it.

*Done when: `MAP` reports no findings, `BOARD_BEHIND` included.*

## The whole-repo sweep

Steps 1 to 3 follow one change. The sweep assesses every module against its code: what the checker flags, and what it cannot judge (a label that says nothing, an HTTP call nobody declared, a module on the wrong layer). Run it when the user asks for the whole repo (re-annotate the codebase, audit the map, a comprehensive update), and offer it when a repo that took the map up one change at a time shows findings across many modules without `--changed`. Never start it unasked from a checker or CI finding: in a large repo it runs several agents per module, and the person opts in to that.

1. Size it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/map-sweep.mjs" --root .
   ```

   It prints every module (annotated, in the config, or a directory of source files no node owns yet) with its findings, and `large` with the reason: 8 or more modules, or 150 or more source files.
2. **Not large:** run steps 1 and 2 without `--changed`, and read every module's lines against its code, not only the ones with findings. Then step 3.
3. **Large**, or the user wants the fan-out anyway: ask them to commit or stash first, so the sweep's diff is its own. Tell them how many modules it covers and that each gets a writer and a reviewer on the strongest model, then on their yes:

   ```
   Workflow({
     scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/diagrams-sync/workflows/sweep.js",
     args: { root: "<absolute repo path>", pluginRoot: "${CLAUDE_PLUGIN_ROOT}" }
   })
   ```

   Add `force: true` to run it on a repo under the threshold. [workflows/sweep.js](workflows/sweep.js) splits the work by model. The strongest plans it (which directories are modules, their ids and layers, the externals, and which writer each module gets), reviews every module's lines against its code, settles what only a config entry, a layer change, or a code move can fix, and critiques the finished map. The cheapest runs the scans and writes the small modules (up to 3 source files and 4 findings); the middle one writes the rest and applies every fix. Writers edit only their own module's files, so they run in parallel; the config and the map are written one step at a time. It never renames a node id, never moves code, and commits nothing.

   Where the host has no Workflow tool, run the same phases with subagents, or serially with none: [references/sweep-fallback.md](references/sweep-fallback.md).
4. Read what it returns: `skipped` (`small` sends you back to 2), the plan's new and revised nodes and its config changes, `moves` (code the user should move, whose finding stays until they do), `verify.open`, and the critic's notes. Show the user those, then the diff, `diagrams/system-map.json` first.
5. Step 3 publishes the board.

*Done when: the checker prints `0 warning` apart from findings parked as moves, and the user has seen the plan, the moves, and the critic's notes.*
