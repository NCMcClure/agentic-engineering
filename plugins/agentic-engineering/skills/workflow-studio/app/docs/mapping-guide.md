# Mapping a workflow `.js` to a blueprint graph

A dynamic workflow is arbitrary JavaScript. The graph is a **Blueprint**: a
faithful, legible map of its control and data flow, built from typed pins. The
two rules that drive everything:

> **Exec wires are statement order. Data wires are variable bindings.**

`compile()` walks the exec graph from `start`, emitting each node's statements in
the order the exec wires reach them; a data wire from node A's output pin into
node B's input pin makes B reference A's bound variable. Read the whole script
first (`meta` and the body after it), then translate.

## The translation patterns

- **Top-level sequence of `await` calls** → chain the nodes with **exec** wires in
  order: `start.exec-out → A.exec-in`, `A.exec-out → B.exec-in`, …, `… → end`.
- **`await agent(prompt, {label, schema})`** → an `agent` node. Put the prompt on
  its `Prompt` data-in (a literal default, or a data wire from upstream), the
  schema on `Schema`. Its `Result` data-out feeds whatever consumes it — draw that
  **data** wire.
- **`await parallel([...])`** → a `parallel` node (barrier). Its `Results` array
  data-out wires into the consumer.
- **`await pipeline(items, s1, s2, …)`** → a `pipeline` node (set `data.stageCount`
  for the stage pins). No barrier.
- **`if (cond) { … } else { … }`** → a `branch` node: wire `cond` to `Condition`,
  and the two arms off `True`/`False` exec-outs.
- **`for`/`while` that repeats a round** (loop-until-dry, budget loop, bounded
  rounds) → `forEach`/`whileLoop`/`forLoop`: the body hangs off `Loop Body`, the
  exit off `Completed`. A back-edge (an exec wire from inside the body back to an
  upstream node) reads as the loop; codegen marks it.
- **A build/verify gate** (`npm run build`, "commit on green, revert on red") →
  a `gate` node; continue off `Pass`, handle failure off `Fail`.
- **Adversarial verify** (refute panels, "≥ majority refutes → drop") → a `verify`
  node; continue off `OK`, send work back off `Revise`.
- **`switch`/tier filters/`args`-driven routing** → a `switch` (named `cases`) or a
  `branch`. One arm may go straight to `end`.
- **Final aggregation / report** → a `synthesize` node → `end`.
- **`log(...)`** → a `log` node only when the beat matters (it passes exec
  through); otherwise omit.
- **A reusable sub-routine** → model it once, then **Collapse** the selection into
  a `function` node; its `input`/`output` nodes are the call signature, and it
  compiles by inlining the subgraph at the call site.
- **A constant a data input needs** → a `lit*` node wired in, or just type the
  literal on the unwired data-in pin in the inspector.

## Worked example

This body —

```js
phase('Find')
const found = (await parallel(FINDERS.map(f => () => agent(f.prompt, {schema: BUGS}))))
const verdict = await verify(found)
if (verdict.ok) {
  if (await gate('npm run build')) {
    const report = await agent('Write the report', {schema: REPORT})
    return report
  }
}
```

— becomes (exec wires in **bold**, data wires plain):

- `start` **→** `parallel:find` **→** `verify` ; `find.Results → verify.Work`
- `verify.OK` **→** `gate` ; `gate.Pass` **→** `agent:report` **→** `end`
- `report.Result → end.Value`

The `Find` phase can be a **comment group** wrapping the `parallel`. The whole
graph compiles back to the same shape, with a `@workflow-graph` sidecar so the
next import is exact. (See `src/diagram.json` for a ready example.)

## Keep it legible

- Aim for the ~5–15 nodes that capture the run, not one node per line.
- Wire the **data** that matters (an agent result feeding the next prompt) and
  don't drop the real loops/branches — those are the interesting parts.
- Use comment groups for phases and `function` collapse for sub-routines instead
  of flattening everything into one wall of nodes.
