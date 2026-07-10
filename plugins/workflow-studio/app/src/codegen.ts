// Compile a Blueprint graph to a runnable workflow .js. Exec wires become
// statement order; data wires become variable bindings. Each node's emit() (from
// the catalog) produces its statements, recursing into the blocks reached by its
// exec-out pins — so Branch/ForEach/Sequence nest as real JS blocks.
//
// Fidelity features:
//  - Functions are inlined at the call site (input pins → outer exprs, output
//    pins captured as the function's outputs).
//  - Comment groups become phase('…') calls + meta.phases.
//  - gate/verify get a self-contained agent-backed helper preamble.
//  - Reducible loops are recovered: a back-edge becomes `while (true) { … }` with
//    `continue` for the back-edge and `break` for the exit, so the post-loop
//    spine flattens instead of nesting in the converged `else`.
//
// Everything is deterministic, so the `@workflow-graph` sidecar round-trip stays
// byte-stable. Irreducible / unhandled shapes fall back to a `// ↻` comment
// rather than emitting wrong control flow.

import { defOf, pinOf, pinsOf, FN_IN_PREFIX, FN_OUT_PREFIX } from './catalog';
import { jsKey, valueToJs } from './value/valueToJs';
import type { Diagram, DiagramEdge, DiagramNode, EmitContext, NodeParam } from './types';

const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');
const indent = (lines: string[]): string[] => lines.map((l) => `  ${l}`);

// Self-contained helpers (agent-backed) so the compiled file runs without
// undefined functions. Built with string concatenation to avoid nested template
// literals in the emitted code.
const GATE_HELPER =
  "const gate = async (cmd) => (await agent('Run ' + cmd + ' and report whether it passed (reply pass:true|false).', " +
  "{ label: 'gate', schema: { type: 'object', required: ['pass'], properties: { pass: { type: 'boolean' } } } })).pass;";
const VERIFY_HELPER =
  "const verify = async (work) => await agent('Adversarially verify this work; reply ok:true if it holds: ' + JSON.stringify(work), " +
  "{ label: 'verify', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, verdict: { type: 'object' } } } });";

interface LoopFrame {
  header: string;
  body: Set<string>;
  exits: string[];
}

export function compile(diagram: Diagram): string {
  const hoists: string[] = [];
  const usedKinds = new Set<string>();
  const phaseOrder: string[] = []; // group ids in the order phases are announced
  const groupLabel = new Map(diagram.groups.map((g) => [g.id, g.label]));

  function scope(
    nodes: DiagramNode[],
    edges: DiagramEdge[],
    prefix: string,
    inputExpr: (innerPin: string) => string,
    capture: (innerPin: string, expr: string) => string,
  ) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const dataEdges = edges.filter((e) => e.role === 'data');
    const execEdges = edges.filter((e) => e.role === 'exec');
    const emitted = new Set<string>();
    const funcOutVars = new Map<string, string>();
    const varOf = (n: DiagramNode) => `${prefix}v_${sanitize(n.id)}`;

    // exec adjacency + predecessors, for loop detection.
    const execAdj = new Map<string, string[]>();
    const execPreds = new Map<string, string[]>();
    for (const e of execEdges) {
      (execAdj.get(e.source.node) ?? execAdj.set(e.source.node, []).get(e.source.node)!).push(e.target.node);
      (execPreds.get(e.target.node) ?? execPreds.set(e.target.node, []).get(e.target.node)!).push(e.source.node);
    }
    let loopByHeader = new Map<string, { body: Set<string>; latches: Set<string> }>();
    const loopStack: LoopFrame[] = [];

    function detectLoops(entry: string): Map<string, { body: Set<string>; latches: Set<string> }> {
      const color = new Map<string, number>(); // 0 white, 1 gray (on stack), 2 black
      const back: Array<[string, string]> = []; // [header, latch]
      const visit = (n: string) => {
        color.set(n, 1);
        for (const t of execAdj.get(n) ?? []) {
          const c = color.get(t) ?? 0;
          if (c === 1) back.push([t, n]);
          else if (c === 0) visit(t);
        }
        color.set(n, 2);
      };
      visit(entry);
      const map = new Map<string, { body: Set<string>; latches: Set<string> }>();
      for (const [header, latch] of back) {
        const body = new Set<string>([header]);
        const wl = [latch];
        while (wl.length) {
          const x = wl.pop()!;
          if (body.has(x)) continue;
          body.add(x);
          for (const p of execPreds.get(x) ?? []) if (!body.has(p)) wl.push(p);
        }
        const existing = map.get(header);
        if (existing) {
          body.forEach((b) => existing.body.add(b));
          existing.latches.add(latch);
        } else {
          map.set(header, { body, latches: new Set([latch]) });
        }
      }
      return map;
    }

    // Data-pull resolution is recursive (outExpr may pull its own data-ins), so a
    // cycle of data wires (reroute → reroute) would recurse forever, and a deep
    // shared chain would recompute exponentially. `visiting` breaks cycles;
    // `memo` collapses re-pulls (skipped for function outputs, whose value only
    // exists after the function inlines).
    const dataVisiting = new Set<string>();
    const dataMemo = new Map<string, string>();

    function dataInExpr(node: DiagramNode, pinId: string): string {
      const key = `${node.id}:${pinId}`;
      const cached = dataMemo.get(key);
      if (cached !== undefined) return cached;
      if (dataVisiting.has(key)) return 'undefined /* data cycle */';
      dataVisiting.add(key);
      try {
        const e = dataEdges.find((d) => d.target.node === node.id && d.target.pin === pinId);
        if (!e) return pinOf(node, pinId)?.default ?? 'undefined';
        const src = byId.get(e.source.node);
        if (!src) return 'undefined';
        if (src.kind === 'input') return inputExpr(e.source.pin);
        if (src.kind === 'function') return funcOutVars.get(`${src.id}:${e.source.pin}`) ?? 'undefined';
        const def = defOf(src.kind);
        const expr = def.codegen.outExpr ? def.codegen.outExpr(makeCtx(src), e.source.pin) : varOf(src);
        dataMemo.set(key, expr);
        return expr;
      } finally {
        dataVisiting.delete(key);
      }
    }

    // Follow one exec edge, honoring the innermost loop frame: a back-edge to the
    // header becomes `continue`, an edge leaving the loop body becomes `break`
    // (and the target is compiled after the loop).
    function followExec(targetId: string): string[] {
      const frame = loopStack[loopStack.length - 1];
      if (frame) {
        if (targetId === frame.header) return ['continue;'];
        if (!frame.body.has(targetId)) {
          if (!frame.exits.includes(targetId)) frame.exits.push(targetId);
          return ['break;'];
        }
      }
      return compileFrom(targetId);
    }

    function makeCtx(node: DiagramNode): EmitContext {
      return {
        node,
        varName: varOf(node),
        indent,
        pinWired: (pinId) =>
          edges.some(
            (e) =>
              (e.target.node === node.id && e.target.pin === pinId) ||
              (e.source.node === node.id && e.source.pin === pinId),
          ),
        dataIn: (pinId) => dataInExpr(node, pinId),
        execBranch: (pinId) =>
          execEdges.filter((e) => e.source.node === node.id && e.source.pin === pinId).flatMap((e) => followExec(e.target.node)),
        paramsObject: () => {
          const params = (node.data?.params as NodeParam[] | undefined) ?? [];
          return params.map((p) => `${jsKey(p.key)}: ${valueToJs(p.value, diagram.types ?? [])}`).join(', ');
        },
      };
    }

    // The phase('…') line when this node is the first of a not-yet-announced
    // comment group (top-level scope only).
    function phasePrefix(node: DiagramNode): string[] {
      if (prefix !== '' || !node.group || !groupLabel.has(node.group) || phaseOrder.includes(node.group)) return [];
      phaseOrder.push(node.group);
      return [`phase(${JSON.stringify(groupLabel.get(node.group))});`];
    }

    function emitNode(node: DiagramNode): string[] {
      if (node.kind === 'input') {
        return pinsOf(node)
          .filter((p) => p.role === 'exec' && p.direction === 'out')
          .flatMap((p) => makeCtx(node).execBranch(p.id));
      }
      if (node.kind === 'output') {
        return pinsOf(node)
          .filter((p) => p.role === 'data')
          .map((p) => {
            const expr = dataInExpr(node, p.id);
            return `const ${capture(p.id, expr)} = ${expr};`;
          });
      }
      if (node.kind === 'function') return inlineFunction(node);
      if (node.kind === 'doOnce') hoists.push(`let ${varOf(node)}_done = false;`);
      return defOf(node.kind).codegen.emit(makeCtx(node));
    }

    function compileFrom(nodeId: string): string[] {
      const node = byId.get(nodeId);
      if (!node) return [];
      if (emitted.has(nodeId)) return [`// ↻ ${node.label || node.id} (already run)`];
      usedKinds.add(node.kind);
      const pre = phasePrefix(node);

      const loop = loopByHeader.get(nodeId);
      if (loop && !loopStack.some((f) => f.header === nodeId)) {
        emitted.add(nodeId);
        const frame: LoopFrame = { header: nodeId, body: loop.body, exits: [] };
        loopStack.push(frame);
        const inner = emitNode(node);
        loopStack.pop();
        const after = frame.exits.flatMap((ex) => compileFrom(ex));
        return [...pre, 'while (true) {', ...indent(inner), '}', ...after];
      }

      emitted.add(nodeId);
      return [...pre, ...emitNode(node)];
    }

    const continueAfter = (fnNode: DiagramNode) =>
      execEdges.filter((e) => e.source.node === fnNode.id).flatMap((e) => followExec(e.target.node));

    function inlineFunction(fnNode: DiagramNode): string[] {
      const sg = fnNode.subgraph;
      const inNode = sg?.nodes.find((n) => n.kind === 'input');
      if (!sg || !inNode) return continueAfter(fnNode);
      const fnVar = varOf(fnNode);
      const inner = scope(
        sg.nodes,
        sg.edges,
        `${fnVar}_`,
        (innerPin) => makeCtx(fnNode).dataIn(`${FN_IN_PREFIX}${innerPin}`),
        (innerPin, _expr) => {
          const v = `${fnVar}_o_${sanitize(innerPin)}`;
          funcOutVars.set(`${fnNode.id}:${FN_OUT_PREFIX}${innerPin}`, v);
          return v;
        },
      );
      const body = inner.run(inNode.id);
      const cont = continueAfter(fnNode);
      return [`// ▼ ${fnNode.label}()`, ...body, `// ▲ ${fnNode.label}`, ...cont];
    }

    return {
      run: (entryId: string) => {
        loopByHeader = detectLoops(entryId);
        return compileFrom(entryId);
      },
    };
  }

  const start = diagram.nodes.find((n) => n.kind === 'start') ?? diagram.nodes[0];
  const top = scope(diagram.nodes, diagram.edges, '', () => 'undefined', (_p, _e) => '_unused');
  const body = start ? top.run(start.id) : [];

  const metaLines = [
    'export const meta = {',
    `  name: ${JSON.stringify(diagram.workflow)},`,
    `  description: ${JSON.stringify(`Generated from the ${diagram.workflow} blueprint graph.`)},`,
  ];
  if (phaseOrder.length) {
    metaLines.push(`  phases: [${phaseOrder.map((id) => `{ title: ${JSON.stringify(groupLabel.get(id))} }`).join(', ')}],`);
  }
  metaLines.push('};');

  const preamble: string[] = [];
  if (usedKinds.has('gate')) preamble.push(GATE_HELPER);
  if (usedKinds.has('verify')) preamble.push(VERIFY_HELPER);

  // Declared variables → const (or let, if any setVar reassigns it). Walk all
  // nodes (incl. function subgraphs) to find reassignment.
  const allNodes: DiagramNode[] = [];
  const collect = (ns: DiagramNode[]) => ns.forEach((n) => { allNodes.push(n); if (n.subgraph) collect(n.subgraph.nodes); });
  collect(diagram.nodes);
  const reassigned = new Set(allNodes.filter((n) => n.kind === 'setVar').map((n) => String(n.data?.varId)));
  // Sorted by id (matching the canonical sidecar) so compile∘import∘compile is
  // byte-stable regardless of the variables' array order.
  const varDecls = [...(diagram.variables ?? [])]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((v) => `${reassigned.has(v.id) ? 'let' : 'const'} ${v.name} = ${valueToJs(v.value, diagram.types ?? [])};`);

  const sidecar = ['/* @workflow-graph:v3', stableStringify(canonical(diagram)), '*/'];

  return [
    ...metaLines,
    '',
    ...preamble,
    ...(preamble.length ? [''] : []),
    ...varDecls,
    ...(varDecls.length ? [''] : []),
    ...hoists,
    ...(hoists.length ? [''] : []),
    ...body,
    '',
    ...sidecar,
  ].join('\n') + '\n';
}

// ── lossless sidecar (canonical so round-trip is byte-stable) ─────────────

function canonical(d: Diagram): Diagram {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    schemaVersion: d.schemaVersion,
    workflow: d.workflow,
    source: d.source,
    nodes: [...d.nodes].sort(byId),
    edges: [...d.edges].sort(byId),
    groups: [...d.groups].sort(byId),
    variables: [...(d.variables ?? [])].sort(byId),
    types: [...(d.types ?? [])].sort(byId),
  };
}

/** Deterministic JSON: object keys sorted recursively (arrays keep order).
 *  Also the editor's canonical-string primitive for dirty/echo detection. */
export function stableStringify(value: unknown): string {
  const seen = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(seen);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = seen(o[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(seen(value));
}
