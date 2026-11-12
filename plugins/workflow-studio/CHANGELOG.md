# Changelog

- **0.5.0**: Architecture + polish release. Canvas logic decomposed into deep,
  unit-testable modules: `graph/document.ts` (pure node/edge operations),
  `palette-logic.ts`, `hooks/useSelection`, `hooks/useSubgraphNav` (joining the
  0.3.0 persistence/history hooks); the function-boundary id rule now lives
  only in the catalog. New: copy/paste/duplicate (Ctrl+C/V/D, in-app
  clipboard), structural changes commit as individual undo steps (typing still
  coalesces), toolbar Add spawns at the viewport centre, canvas empty-state
  hint, inline create/rename in the launcher (no more window.prompt), palette
  listbox ARIA + labelled icon buttons. Perf: memoized nodes, stable React
  Flow handlers via a nodes ref, connected-pin set keeps identity when
  membership is unchanged.
- **0.4.0**: Codegen-correctness release. `compileChecked` adds a diagnostics
  channel: errors block Compile/Publish and open a clickable diagnostics panel
  (click focuses the node; nodes get ⛔/⚠ badges). Diamond control flow is now
  compiled correctly for branch/switch/gate/verify (arms stop at their shared
  post-dominator; the join emits once after the if/else — previously one arm
  silently skipped it); irreducible joins, data-wire cycles, invalid/duplicate
  variable names error out; multi-exit loops, loop-node back-edge headers, and
  approximation nodes (multiGate/flipFlop/timeout/doN/retryUntil) warn.
  `getField` bracket-escapes non-identifier fields. Import migrates v2 sidecars
  to v3, and the staleness check ignores pure reformatting. Also fixes a React
  Flow selection-listener render loop introduced in 0.3.0. Note: the join fix
  changes emitted output for diamond-shaped graphs, so their pre-0.4.0
  compiled.js will read as hand-edited (stale) on first import.
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
