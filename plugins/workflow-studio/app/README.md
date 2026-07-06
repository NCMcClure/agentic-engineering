# workflow-editor

An Unreal-Engine-Blueprint-style visual **studio** for **Claude Code dynamic
workflows** (`.claude/workflows/*.js`). Organize work into **projects**, each
holding many **workflows** persisted to disk. Build agent workflows on a node
canvas — typed exec/data pins, a right-click node finder, variables & custom
struct types, comment groups, collapse-to-function — and compile the graph to a
runnable workflow `.js`, with a lossless round-trip back into the graph.

> Extracted from a Claude Code skill into a standalone app. The authoring
> philosophy and the diagram protocol live in [`docs/`](./docs).

## Run it

```bash
npm install
npm run dev      # Vite dev server, usually http://localhost:5173/
```

`npm run build` runs `tsc` (strict) + `vite build` — the project's only gate.

## What it does

- **Pin-based graph.** White **exec** pins carry execution flow (Sequence's
  `Then 0/1`, Branch's `True/False`, For Each's `Loop Body/Completed`); colored
  **data** pins carry typed values wired pin→pin. Connections are type-checked.
- **Node catalog.** Agent-workflow primitives (agent, parallel, pipeline, verify,
  synthesize, gate, log, schema) + control flow (sequence, branch, do-once,
  for-each, while, switch, multi-gate, flip-flop, …) + async (delay, retry, race,
  timeout) + utilities (reroute, getField, function) + constants and Get/Set.
- **Variables & struct types.** Declare typed variables (string/number/bool/
  array/object/schema, or a custom **struct**) in the left panel, with a recursive
  value editor and a visual **JSON-schema builder**. Drop them in as **Get/Set**
  nodes. Codegen emits them as top-level `const`/`let`.
- **Functions.** Collapse a selection into a `function` node with editable typed
  Input/Output pins; double-click to enter its subgraph. Functions inline at the
  call site on compile.
- **Round-trip codegen.** `Compile & Export` walks the exec graph (exec →
  statement order, data → variable bindings) and appends a `@workflow-graph` JSON
  sidecar, so `compile → import → compile` is byte-stable. It always writes the
  studio's core copy and, when a per-workflow **export path** is set in the
  toolbar, that target too — so a copy always lives in the studio.
- **Projects & workflows.** A launcher home screen lists your projects; each
  project holds many workflows. A toolbar switcher jumps between workflows or back
  to the launcher. Everything persists to disk; the open workflow live-syncs when
  its file changes out-of-band (e.g. an agent rewriting it).

## Storage

Projects and workflows live under a **studio root** (default `./studio`,
overridable with the `STUDIO_ROOT` env var):

```
studio/<project-id>/project.json                          project metadata
studio/<project-id>/workflows/<workflow-id>/diagram.json  the graph (source of truth)
studio/<project-id>/workflows/<workflow-id>/compiled.js   the studio's core compiled copy
```

The Vite dev server exposes the studio API: `GET /api/projects`,
`POST /api/projects/{create,rename,delete}`, `GET /api/workflows?project=…`,
`GET /api/workflows/load?project=…&workflow=…`,
`POST /api/workflows/{create,save,rename,delete}`, and `POST /api/compile`
(writes the core copy + the export path). On first run the in-repo
`src/diagram.json` is seeded into a **Sample** project. `studio/` is gitignored.

## Project layout

```
src/
  catalog.ts         single source of truth for every node kind (pins, codegen)
  types.ts           the Diagram / Pin / Variable / TypedValue contract
  codegen.ts         graph → .js (+ sidecar); loop recovery; function inlining
  importGraph.ts     .js → graph (via the sidecar fence)
  App.tsx            the React Flow canvas + wiring
  DetailsPanel.tsx   the right inspector (node / variable / struct / edge / comment)
  VariablesPanel.tsx the left "My Blueprint" panel
  value/             recursive ValueEditor + SchemaBuilder + valueToJs emitter
  nodes/             BaseNode (pin rendering), Pin, CommentNode
  theme.css          the UE-dark theme (CSS variables)
docs/
  AUTHORING.md       how to author a diagram (the wiring philosophy)
  primitive-vocabulary.md   the node catalog reference
  mapping-guide.md          control flow → graph
  diagram-schema.md         the diagram.json shape
```

## Authoring, in one line

**Author for humans, not just the compiler:** wire every input, lift config into
variables, model domain data as structs, read object outputs with `getField`, and
keep notes for intent — so the graph, the `diagram.json`, and the compiled `.js`
are all legible and stay in sync. See [`docs/AUTHORING.md`](./docs/AUTHORING.md).

## License

MIT
