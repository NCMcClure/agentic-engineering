---
name: workflow
description: >-
  Author, edit, or reason about Claude Code dynamic workflows
  (.claude/workflows/*.js) and their diagram.json graphs by hand. Use when
  writing or modifying a workflow script or graph directly, mapping existing
  JS to a graph, or answering workflow-diagram protocol questions — no GUI
  needed.
---

# Author Workflow (no GUI)

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

Hand-author Claude Code dynamic workflows and their Blueprint-style graphs.
The full protocol lives in the vendored docs — read them progressively; do not
guess node names or pin semantics from memory.

## Routing map (progressive disclosure)

Read only what the task needs, in this order:

1. `W/app/docs/primitive-vocabulary.md` — read this FIRST
   when choosing nodes: the node/pin vocabulary and what each primitive does.
2. `W/app/docs/mapping-guide.md` — rules for mapping
   existing JS to a graph (js → graph direction).
3. `W/app/docs/diagram-schema.md` — the exact
   `diagram.json` v2 shape, when you need field-level precision.
4. `W/app/docs/AUTHORING.md` — the full authoring protocol,
   when generating a graph from scratch.

Ground truth and examples:

- TypeScript source of truth: `W/app/src/types.ts` and
  `W/app/src/catalog.ts`.
- Worked example graph: `W/app/src/diagram.json`.

## Hard rules

- **Round-trip byte-stability contract**: js ↔ graph conversion must be
  lossless. A graph compiled to JS and re-imported must produce the same graph;
  respect the contract in every edit.
- **Never hand-edit `compiled.js` without regenerating the `@workflow-graph`
  sidecar** — a stale sidecar silently breaks round-tripping.
- **When the user wants VISUAL editing**, do not do it by hand: launch the
  studio via the **harness** area instead.
- **Compilation is the studio's job.** `compile()` in `app/src/codegen.ts` is
  the only deterministic graph→js compiler; when byte-stable output matters,
  compile in the studio rather than hand-emulating codegen.
