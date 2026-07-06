---
name: author-workflow
description: >-
  Author, edit, or reason about Claude Code dynamic workflows
  (.claude/workflows/*.js) and their Blueprint-style diagram.json graphs by
  hand — node/pin vocabulary, exec-wire vs data-wire semantics, the
  @workflow-graph sidecar, and lossless js↔graph round-tripping. Use when
  writing or modifying a workflow script or diagram.json directly, mapping
  existing JS to a graph, or answering questions about the workflow-diagram
  protocol — no GUI needed.
---

# Author Workflow (no GUI)

Hand-author Claude Code dynamic workflows and their Blueprint-style graphs.
The full protocol lives in the vendored docs — read them progressively; do not
guess node names or pin semantics from memory.

## Routing map (progressive disclosure)

Read only what the task needs, in this order:

1. `${CLAUDE_PLUGIN_ROOT}/app/docs/primitive-vocabulary.md` — read this FIRST
   when choosing nodes: the node/pin vocabulary and what each primitive does.
2. `${CLAUDE_PLUGIN_ROOT}/app/docs/mapping-guide.md` — rules for mapping
   existing JS to a graph (js → graph direction).
3. `${CLAUDE_PLUGIN_ROOT}/app/docs/diagram-schema.md` — the exact
   `diagram.json` v2 shape, when you need field-level precision.
4. `${CLAUDE_PLUGIN_ROOT}/app/docs/AUTHORING.md` — the full authoring protocol,
   when generating a graph from scratch.

Ground truth and examples:

- TypeScript source of truth: `${CLAUDE_PLUGIN_ROOT}/app/src/types.ts` and
  `${CLAUDE_PLUGIN_ROOT}/app/src/catalog.ts`.
- Worked example graph: `${CLAUDE_PLUGIN_ROOT}/app/src/diagram.json`.

## Hard rules

- **Round-trip byte-stability contract**: js ↔ graph conversion must be
  lossless. A graph compiled to JS and re-imported must produce the same graph;
  respect the contract in every edit.
- **Never hand-edit `compiled.js` without regenerating the `@workflow-graph`
  sidecar** — a stale sidecar silently breaks round-tripping.
- **When the user wants VISUAL editing**, do not do it by hand: launch the
  studio via the **workflow-studio** skill instead.

## Known stale note in the vendored docs

`AUTHORING.md` predates extraction into this plugin and claims "this skill
drives everything itself — installing deps, starting the dev server". That is
stale: server launch belongs to the **workflow-studio** skill, not this one.
Do NOT edit the vendored doc; just ignore that section.
