# `diagram.json` schema (v3)

The backing file is the contract between you (the agent) and the canvas. Its
TypeScript source of truth is `src/types.ts`; this restates it.

```jsonc
{
  "schemaVersion": 3,
  "workflow": "deep-research",          // usually meta.name
  "source": "deep-research.js",         // back-compat name of the source .js; the studio uses exportPath
  "nodes": [ /* DiagramNode[] */ ],
  "edges": [ /* DiagramEdge[] */ ],
  "groups": [ /* Group[] */ ],
  "variables": [ /* Variable[] — declared, typed; emitted as const/let */ ],
  "types": [ /* StructDef[] — custom struct types */ ]
}
```

v3 notes: a node's `subtitle` is renamed **`note`**; functional config lives in
pins and in `data.params` (a `NodeParam[]` of `{ key, type, value }`). A
`DataType` is a primitive or a `struct:<id>` ref into `types`. Variable/param
values use the kind-tagged `TypedValue` model (see `types.ts`). The codegen
sidecar fence is `@workflow-graph:v3` (import still accepts `v2`).

### DiagramNode

```jsonc
{
  "id": "verify",            // unique, stable, slug-ish; reuse across regenerations
  "kind": "verify",          // a catalog key (see primitive-vocabulary.md)
  "label": "refute panel",   // the headline on the node
  "note": "schema: VERDICT", // optional freeform annotation
  "position": { "x": 540, "y": 90 }, // free-drag — author a sensible position
  "data": { "thenCount": 3 },        // optional kind-specific extras (variadic pins, etc.)
  "pinOverrides": { "cond": { "name": "ready?" } }, // optional: rename/retype a pin
  "group": "g-find",         // optional: id of the comment group this node sits in
  "subgraph": { /* SubGraph */ } // only on kind "function" (set by Collapse)
}
```

Positions live **on the node** — author them, and reuse ids so the user's
hand-placed nodes survive a regeneration. `data` drives variadic pins:
`{ "thenCount": n }` on a `sequence`, `{ "outCount": n }` on a `multiGate`,
`{ "cases": ["a","b"] }` on a `switch`, `{ "stageCount": n }` on a `pipeline`.

### DiagramEdge — pin to pin

```jsonc
{
  "id": "e3",
  "source": { "node": "find", "pin": "results" },  // an OUT pin
  "target": { "node": "verify", "pin": "work" },    // an IN pin
  "role": "data",            // "exec" (white wire) | "data" (typed color)
  "label": "optional"
}
```

`role` must match both pins' role. Exec wires connect exec-out → exec-in; data
wires connect data-out → data-in and the value types must be compatible. Find a
node's pin ids in the catalog (`primitive-vocabulary.md` / `catalog.ts`).

### Group — comment frame

```jsonc
{
  "id": "g-find",
  "label": "Find",
  "rect": { "x": 200, "y": 40, "w": 360, "h": 220 },
  "color": "gray"            // optional
}
```

A group is a labelled frame; membership is by `node.group === group.id`. It's
visual only (dragging the frame moves its members) — it is **not** a node in the
flow and carries no pins. Use groups for phases.

### SubGraph — a collapsed function

Set only on a `function` node. It holds the inner `nodes`/`edges`, including two
special nodes that materialize the boundary:

- an **`input`** node — its `data.pins` (all `direction: "out"`) are the
  function's inputs; wire them forward into the body.
- an **`output`** node — its `data.pins` (all `direction: "in"`) are the
  function's outputs; wire the body into them.

The function node's external pins derive from these (inputs prefixed `i_`,
outputs `o_`, so the two sides never collide). You rarely hand-author a subgraph;
let the canvas create it via **Collapse** or by dropping a `function`. (Iteration-1
diagrams used a `boundary` array instead; those are normalized to `input`/`output`
nodes on load.)

### Constant values

A `lit*` node carries its value in `data.value` (a string the inspector edits;
`litNumber` parses it, `litBool` is `"true"`/`"false"`, `litArray`/`litObject`
hold a JS/JSON literal). Its data-out feeds wherever it's wired.

## Rules that make round-tripping work

- **You own `nodes`, `edges`, `groups`, `workflow`, `source`. The canvas owns the
  `position` values once the user drags** (it writes them on Save). Seed sensible
  positions; preserve existing ones when regenerating.
- **Keep ids stable across regenerations.** Reuse the same `id` for a node that
  still exists so the user's layout and any collapsed functions survive.
- **`kind` must be a catalog key**, and an edge's pins must exist on their nodes
  (an unknown kind or pin silently drops). Stick to `catalog.ts`.
- **Every working node should be on the exec spine.** Following exec wires from
  `start` should reach every node that does work, and lead toward `end`. Data
  wires carry values alongside; they don't define order.

## The `@workflow-graph` sidecar (in the compiled `.js`)

When the canvas compiles the graph, it appends a fence to the `.js`:

```js
/* @workflow-graph:v3
{ "schemaVersion": 3, "nodes": [...], "edges": [...], "groups": [...], "variables": [...], "types": [...] }
*/
```

This is the lossless channel: `importJs` (`src/importGraph.ts`) recovers the
exact graph from it, so compile → import → compile is byte-stable. If the fence
is **absent** (a hand-written script), import returns only a scaffold and you
rebuild the graph by hand (see the mapping guide). If the fence is **present but
the body was hand-edited away from it**, import flags the graph as *stale* —
reconcile the body's changes rather than trusting the fence.

A complete, valid v3 example ships at `src/diagram.json`.
