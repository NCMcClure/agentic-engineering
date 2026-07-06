# Node catalog

These are the node kinds the canvas knows how to render and compile. Each entry
in `src/catalog.ts` owns its pins, accent color, geometry, and
codegen template — that file is the single source of truth; keep this doc in
lockstep. When you author `diagram.json`, pick the kind that matches what the
script is *doing* at that point.

## Pins

Every node has **pins**, split by role:

- **exec** (white): execution flow. A node has one `exec-in` and one or more
  named exec outs. Multiple exec outs are how a node branches: Branch →
  `True`/`False`, For Each → `Loop Body`/`Completed`, Sequence → `Then 0…N`.
- **data** (colored by type): typed values wired pin→pin. Types: `string`,
  `number`, `bool`, `object`, `array`, `agent-result`, `schema`, `any`.

An edge connects a `(node, pin)` **source** (an `out` pin) to a `(node, pin)`
**target** (an `in` pin) and carries `role: "exec" | "data"`. Exec ins accept
many wires (merges); data ins accept one (it replaces on reconnect).

## Domain nodes (the agent-workflow primitives)

| kind | use it for | key pins |
| --- | --- | --- |
| `start` | the script's entry. | exec-out; `Args` (object) out |
| `end` | the final `return`. | exec-in; `Value` (any) in |
| `agent` | one `agent(prompt, {schema})` call. | exec-in/out; `Prompt`, `Schema` in; `Result` (agent-result) out |
| `parallel` | `parallel([...])` fan-out **with a barrier**. | `Tasks` (array) in; `Results` (array) out |
| `pipeline` | `pipeline(items, …stages)` — no barrier. | `Items` in; variadic `Stage k` in; `Results` out |
| `verify` | adversarial critic that passes or routes back. | `Work` in; `OK`/`Revise` exec-outs; `Verdict` out |
| `synthesize` | one agent reconciling many results / writing the report. | `Inputs` in; `Result` out |
| `gate` | build/verify gate. | `Check` in; `Pass`/`Fail` exec-outs |
| `schema` | a structured-output schema, as its own badge. | `Schema` (schema) out, no exec |
| `log` | a `log()` narration beat. Passes exec through. | `Message` in; exec-out |

## Core control flow

| kind | use it for | key pins |
| --- | --- | --- |
| `sequence` | run each branch in order. | variadic `Then 0…N` exec-outs (`data.thenCount`) |
| `branch` | if/else on a bool. | `Condition` (bool) in; `True`/`False` exec-outs |
| `doOnce` | let execution through only the first time. | `Completed` exec-out |
| `forEach` | loop over an array. | `Array` in; `Loop Body`/`Completed` exec-outs; `Element`/`Index` out |
| `whileLoop` | repeat while a condition holds. | `Condition` (bool) in; `Loop Body`/`Completed` exec-outs |

## Extended flow

| kind | use it for |
| --- | --- |
| `doN` | let execution through the first N times (`data.n`). |
| `multiGate` | route to a different out each fire (variadic `Out k`, `data.outCount`). |
| `flipFlop` | alternate between `A` and `B`. |
| `forLoop` | counted loop `First…Last` with an `Index` out. |
| `switch` | route by matching `Value` against named `cases` (`data.cases: string[]`). |

## Async / timing

| kind | use it for |
| --- | --- |
| `delay` | pause `Ms` then continue. |
| `retryUntil` | run `Body` up to `Max Attempts` times. |
| `race` | run `Tasks` concurrently; continue with the first (`Winner`). |
| `timeout` | race work against a deadline: `Completed`/`Timed Out`. |

## Value (constants)

Constant source nodes: no exec, one typed data-out, value in `node.data.value`
(edited in the inspector). `outExpr` emits the literal.

| kind | out type |
| --- | --- |
| `litString` | string |
| `litNumber` | number |
| `litBool` | bool |
| `litArray` | array (a JS/JSON literal) |
| `litObject` | object (a JS/JSON literal) |
| `getVar` | read a declared variable; the out pin carries its type. Spawned from the palette (`Get <name>`). |
| `setVar` | assign a declared variable; passes exec through. Spawned from the palette (`Set <name>`). |

## Utility

| kind | use it for |
| --- | --- |
| `reroute` | a wire knot to tidy the graph. Polymorphic via `data.role`: a data-`any` pass-through by default, or an exec pass-through when `data.role === 'exec'` (dragging off an exec pin creates one automatically; toggle in the inspector). |
| `getField` | read a named field from an object/struct value, e.g. `start`'s Args → `args.root`, or an agent `result` → `result.ready`. The field name is set in the inspector (`data.field`); the out pin is `(object).field`. |
| `function` | a collapsed subgraph. Its external pins mirror the subgraph's `input`/`output` nodes (below). Created by **Collapse** or from the palette (seeds an empty Input/Output subgraph). Compiles by inlining the subgraph. |
| `input` | inside a function subgraph: the function's inputs, shown as OUT pins. Pins live on `node.data.pins` and are edited in the inspector. |
| `output` | inside a function subgraph: the function's outputs, shown as IN pins (`node.data.pins`). |

Comment **groups** (labelled frames) are not catalog nodes — they live in the
diagram's `groups` array (see `diagram-schema.md`).

## Pins & wires (rendering)

Exec pins are white right-pointing triangles (flow direction); data pins are
circles colored by value type. A pin fills with its color when wired, hollow when
not. Exec wires are white; data wires take the source pin's type color.

## Choosing well

- **Read intent, not syntax.** A `for` that re-runs a round until it's empty is a
  `whileLoop`/`forEach` with a back-edge; a `for` that serially processes a fixed
  list is a chain of `agent` nodes.
- **Wire data, not just exec.** If an agent's result feeds the next step, draw the
  `data` wire from `Result` to that step's input — that's what becomes the
  variable binding in the compiled `.js`.
- **One barrier marker per `parallel`.** If the script does `parallel(...)` then
  consumes all results, that's one `parallel` node; `pipeline(...)` (no barrier)
  is `pipeline`.
- **Collapse helpers.** A reusable sub-routine → select its nodes and **Collapse**
  into a `function`; its boundary pins become the call signature.
