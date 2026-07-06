# Authoring guide (workflow-diagram protocol)

_Adapted from the Claude Code skill this project was extracted from._

# workflow-diagram

Render a Claude Code dynamic workflow as a **Blueprint-style node graph** the user
can edit in the browser — free-form nodes, typed pins, exec wires, a right-click
node finder, comment groups, and collapse-to-function — backed by a `diagram.json`
that round-trips with the workflow script. Two jobs: **generate** a graph from a
workflow, and **sync** edits between the graph and the `.js`.

This skill drives everything itself — installing deps, starting the dev server,
opening the browser. **Never tell the user to run commands.**

## Read first

Before authoring any graph, read these (they're short and they're the spec):

- `references/primitive-vocabulary.md` — the node catalog: every kind, its pins,
  and what JS it compiles to. Mirrors `src/catalog.ts`.
- `references/mapping-guide.md` — how control flow maps to the graph: **exec
  wires are statement order, data wires are variable bindings.**
- `references/diagram-schema.md` — the exact `diagram.json` shape (pin-based
  edges, groups, function subgraphs, the `@workflow-graph` sidecar).

The TypeScript contract is `src/types.ts`; the catalog is
`src/catalog.ts`; a complete example is
`src/diagram.json`.

## The model (what changed from a plain flow diagram)

- **Pins, not whole-node edges.** Every node has typed pins. White **exec** pins
  carry execution flow (a node can have several named exec outs — Sequence's
  `Then 0/1`, Branch's `True/False`, For Each's `Loop Body/Completed`). Colored
  **data** pins carry typed values wired pin→pin. An edge connects a
  `(node, pin)` source to a `(node, pin)` target and has a `role` of `exec` or
  `data`.
- **Free-form layout.** Positions live on each node; the canvas never auto-lays
  out on load. "Auto-arrange" (dagre over the exec spine) is on demand.
- **Comment groups** wrap a selection in a labelled frame (drag the frame, the
  members follow). **Collapse** turns a selection into a single `function` node.
  A function's boundary is materialized as **`input`/`output` nodes** inside its
  subgraph (UE Tunnel nodes): the `input` node's out pins are the function's
  inputs, the `output` node's in pins are its outputs. Double-click a function to
  enter it (even when empty), and add/rename/retype its typed I/O pins in the
  inspector. Functions **compile** by inlining their subgraph at the call site.
- **Right-click** the canvas for the node finder (search the whole catalog,
  spawn at the cursor). Dragging off a pin opens the finder filtered to
  compatible pins and auto-wires the new node.
- **Data inputs:** set a literal value for any unwired data-in pin in the
  inspector, or drop a **constant node** (`litString`/`litNumber`/`litBool`/
  `litArray`/`litObject`) and wire it in.
- **Variables & struct types (v3).** The left panel declares typed **variables**
  (string/number/bool/array/object/schema, or a custom **struct**) with a
  recursive value editor (incl. a visual JSON-schema builder). Variables are
  searchable in the right-click finder as **Get/Set** nodes; a `getVar` out pin
  carries the variable's type. Codegen emits each as a top-level `const`/`let`.
  Custom **structs** (e.g. `Task { name, prompt }`) are usable as a variable type
  and array element type. `Diagram.variables` / `Diagram.types` hold them.
- **Node parameters & note.** Each node has a freeform **note** (was `subtitle`)
  and a typed **parameters** list (`data.params`) the inspector edits and codegen
  merges into the node's options (e.g. agent options). Edge **labels** and comment
  **label/body/color** are editable from the details panel.

## Author for humans, not just for the compiler

This is the most important part of the skill. **The diagram is a shared artifact
between you and the user.** You build the first draft; they read it at a glance,
rearrange and rewire it, declare a variable, retype a struct — and you reconcile
their changes. That back-and-forth is how the two of you converge on the workflow
they actually want. It only works if the graph is **self-explanatory**: someone
who can't read the `.js` should understand the entire run by looking at the nodes
and the wires. So author every diagram to be **fully wired and legible** — never a
sketch with dangling pins and prose:

- **Wire every input.** No data-in pin should be empty. Connect it to an upstream
  output or give it a value. An empty `prompt`/`tasks`/`command` pin is a hole in
  the workflow, and a hollow pin literally tells the human "nothing flows here."
- **Lift configuration into variables.** Prompts, build commands, schemas, model
  options — declare them in the left panel as named **variables** and wire **Get**
  nodes into the pins. They compile to `const PRE_PROMPT = …` at the top of the
  file, exactly where a human looks to tweak a workflow. One `BUILD_CMD` variable
  beats the same string typed into three gates.
- **Model domain data as structs, not `any`.** A list of audit tasks is
  `array<Task>` where `Task { label, prompt }` — not an opaque blob. The user gets
  a typed **form** to edit each one, and the compiled literal reads like real data:
  `[{ label: "arch-audit", prompt: "…" }]`.
- **Read object outputs with `getField`.** Pull the field you need from `start`'s
  **Args** or an agent's **result** (`args.root`, `result.ready`) and wire it on —
  branch on it. Don't hide "args: root, date" in a note with the pin dangling.
- **Notes annotate intent; pins carry data.** A `note` says *why*; the wiring says
  *what*. Functional info trapped in prose can't be edited as a value by the human
  or emitted by the compiler.
- **Group by phase, collapse sub-routines.** Comment groups become `phase()`
  markers and functions fold repeated structure — both make a big run scannable.

Done this way, the same workflow is legible **three ways that stay in sync** — the
**visual graph** (for the non-coder), the hand-editable **`diagram.json`**, and the
compiled **`.js`** (whose named consts and structure a developer can tweak and
re-import). That triple-legibility is the point: it lets a human and the agent
build the perfect workflow together, each editing in the form they prefer.

## Generate a graph from a workflow

1. **Resolve the target.** Accept a path (`.claude/workflows/foo.js`) or a
   `meta.name`. Read the **entire** script — `meta` and the body after it.
2. **Derive the workspace.** `<meta.name>-workspace` under the same
   `.claude/workflows/` directory, e.g. `.claude/workflows/deep-research-workspace/`.
3. **Create or reuse it.**
   - If it doesn't exist: copy the whole `./` directory into it.
   - If it exists: **don't re-copy.** Read its current `src/diagram.json` so you
     can preserve node ids (and thus saved positions), then rewrite that file.
4. **Author `src/diagram.json` — fully wired (see "Author for humans" above).**
   Set `schemaVersion: 3`, `workflow`, `source` (a **workspace-relative** flow
   file, e.g. `<name>-flow.js`), `nodes` (each with a `position`), `edges`
   (pin-based, with a `role`), `groups`, and any `variables`/`types`. Pick each
   node's `kind` from the catalog; wire **exec** pins for control flow and **data**
   pins for values. Lift prompts/commands/schemas into `variables` + Get nodes,
   model domain data as `types` (structs), read object outputs with `getField`,
   and leave **no input pin empty**. Reuse ids for nodes that still exist so the
   user's layout survives.
5. **Launch it (you do this, not the user).**
   - Run `npm install` in the workspace (skip if `node_modules` exists).
   - Start the dev server **in the background**: `npm run dev`.
   - Wait for Vite's URL (e.g. `http://localhost:5173/`), then open it
     (`open <url>` on macOS). Vite auto-bumps the port; use the printed one.
   - If a dev server is already running for the workspace, skip the launch — HMR
     refreshes the open page from your new `diagram.json`.
6. **Report** the URL and a one-line summary (node count, notable loops/branches).
   Tell the user they can right-click to add nodes, drag freely, wire pins, group
   and collapse, hit **Save** to persist the graph, and **Compile** to write the
   `.js` — and that you can reconcile their changes whenever they ask.

## Keep them in sync (bidirectional)

The on-disk `src/diagram.json` is the source of truth the canvas and you share.
The canvas writes it on **Save**; it writes the workflow `.js` on **Compile**.

**Compile writes INSIDE the workspace; Publish promotes to the workflows root.**
The diagram's `source` is a **workspace-relative** path (e.g. `<meta.name>-flow.js`,
resolved inside the `-workspace/` directory) — **Compile** writes there, never
touching a hand-written workflow. When the user is ready, the **Publish ↑** button
copies the compiled `.js` up to `.claude/workflows/<workflow>.js` (overwrites, with
a confirm). So author `source` as a workspace-local flow file, and only the user's
explicit Publish moves it to the root. The diagram→`.js` codegen is a faithful
structural *map*, not a reconstruction (it can't recover rich prompts,
schemas-as-objects, or helper functions from arbitrary JS); the loaded graph is
deterministic from the flow file's embedded sidecar.

**Wire it up — don't describe data flow in notes.** Use the pins: an agent's
`prompt`/`schema`, a gate's `command`, a branch's `cond` should be **wired** from
upstream outputs or **given a literal** (a raw-JS expression). Read object/struct
outputs (like `start`'s **Args**) with a **`getField`** node (`args.root`). Drive
a branch from an agent result (`getField(result, "ready") → cond`). Feed
`parallel`/`pipeline` task pins a thunk-array literal (`[() => agent(...)]`). A
node with everything in its `note` and nothing on its pins is not wired.

**Compile is lossless by design.** `compile()` (`src/codegen.ts`) walks the exec
graph from `start`, turning exec wires into statement order and data wires into
variable bindings, and appends a `/* @workflow-graph:v3 … */` JSON sidecar with
the exact graph. Re-importing that fence reproduces the graph exactly
(compile∘import∘compile is byte-stable).

**Diagram → workflow** ("I changed the graph, update the workflow"):
1. Read the workspace's `src/diagram.json` (the user's saved edits).
2. Either trust the user already hit **Compile** (the `.js` + fence are current),
   or regenerate the `.js` yourself from the graph the same way `compile()` does.
3. Explain each change; ask before anything destructive or ambiguous.

**Workflow → diagram** ("I changed the workflow, update the diagram"):
1. Re-read the `.js`. If it carries a `@workflow-graph` sidecar (v2 or v3), that
   fence is the graph — recover it losslessly (`importJs` in `src/importGraph.ts`), but if
   the body has been hand-edited away from the fence (`importJs` flags this as
   *stale*), reconcile the body changes into the graph rather than trusting the
   fence blindly.
2. If there's **no** sidecar (a hand-written script), **you** translate it: read
   the control flow and author `nodes`/`edges` per the mapping guide. (Import
   returns only a scaffold for fence-less scripts — it never guesses typed pins
   from arbitrary JS.) From then on, Compile keeps it lossless.
3. Rewrite `src/diagram.json`, preserving existing `positions`/ids for nodes that
   still exist. HMR updates the open page; otherwise relaunch per step 5 above.

## Design notes

- **Catalog is the single owner.** Node identity — pins, accent, geometry,
  codegen — lives only in `src/catalog.ts`. To add or change a node kind, edit
  the catalog; rendering, the palette, layout, validation, and codegen follow.
  Keep `references/primitive-vocabulary.md` in lockstep.
- **Codegen fidelity.** Compile emits `phase('…')` calls + `meta.phases` from the
  comment groups, a self-contained `gate`/`verify` helper preamble (agent-backed)
  so the file runs without undefined functions, and recovers **reducible loops**:
  a back-edge becomes `while (true) { … }` with `continue` for the back-edge and
  `break` for the exit, so the post-loop spine flattens instead of nesting in the
  converged `else`. Irreducible / unhandled shapes fall back to a `// ↻` comment
  rather than emitting wrong control flow.
- **Honest limits.** Lossless round-trip holds for graphs/JS the tool produces
  (via the sidecar). The compiled `.js` is a faithful **map of the diagram** — so
  whatever you put *into* the graph (prompts/commands/schemas as variables or pin
  literals, structs as `types`) compiles out and round-trips; but the tool cannot
  *reverse-parse* an arbitrary hand-written `.js` into typed pins (it reads the
  sidecar, or you re-author by hand). `parallel`/`pipeline` want thunks, so a
  struct/data array on a `tasks` pin is a faithful stand-in, not real `() => …`.
  Nested loops use innermost `break`/`continue` only.
- **Theme is an Unreal-Engine-Blueprint dark theme** (no light mode), wired via
  CSS variables in `src/theme.css`: dark dot-grid canvas, dark nodes with a
  colored title bar, bezier wires. Exec pins are white right-pointing triangles;
  data pins are circles colored by value type; a pin fills with its wire color
  when connected. Don't add per-component color overrides.
- **Keep graphs legible while fully wired.** Capture the real loops and branches
  (they're the interesting parts). Full wiring adds helper nodes (Get-variable,
  `getField`) — that's expected and good; keep the graph scannable with comment
  groups per phase and collapse-to-function for sub-routines. Legible *and* fully
  wired, not one or the other.

> Auto-triggering: this skill is set `disable-model-invocation: true` to match
> the repo convention, so it runs when invoked as `/workflow-diagram`. To let it
> fire automatically on phrases like "visualize this workflow," remove that line
> from the frontmatter.
