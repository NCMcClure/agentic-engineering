// The node catalog — the single source of truth for node identity. Every fact
// about a kind (its pins, accent, category, geometry floor, and codegen) lives
// here once; BaseNode, the palette, layout, edge validation, and codegen all
// READ this and never re-encode a kind. If you reach for `switch (kind)`
// anywhere else, that logic belongs here instead.

import type {
  DataType,
  DiagramNode,
  NodeDef,
  Pin,
} from './types';

// ── pin builders (keep entries terse + consistent) ───────────────────────

const execIn = (name = ''): Pin => ({ id: 'exec-in', name, direction: 'in', role: 'exec', dataType: 'exec' });
const execOut = (id = 'exec-out', name = ''): Pin => ({ id, name, direction: 'out', role: 'exec', dataType: 'exec' });
const dIn = (id: string, name: string, dataType: DataType, def?: string): Pin => ({
  id, name, direction: 'in', role: 'data', dataType, ...(def !== undefined ? { default: def } : {}),
});
const dOut = (id: string, name: string, dataType: DataType): Pin => ({ id, name, direction: 'out', role: 'data', dataType });

// A function node mirrors its subgraph's input/output nodes as its external pins.
// Prefixes keep the two sides' ids unique on the function (an input pin and an
// output pin may share a base id like 'exec'). codegen + collapse use these.
export const FN_IN_PREFIX = 'i_';
export const FN_OUT_PREFIX = 'o_';

// ── the registry ──────────────────────────────────────────────────────────

export const CATALOG: Record<string, NodeDef> = {
  // ── domain: the agent-workflow primitives ───────────────────────────────
  start: {
    kind: 'start', category: 'domain', tag: 'start', accentVar: '--accent-start',
    size: { w: 150, h: 72 }, blurb: 'Workflow entry. The args it reads ride the Args pin.',
    pins: [execOut(), dOut('args', 'Args', 'object')],
    codegen: {
      emit: (ctx) => ctx.execBranch('exec-out'),
      outExpr: () => 'args',
    },
  },
  end: {
    kind: 'end', category: 'domain', tag: 'end', accentVar: '--accent-end',
    size: { w: 150, h: 72 }, blurb: 'Final return — the combined result of the run.',
    pins: [execIn(), dIn('value', 'Value', 'any', 'undefined')],
    codegen: { emit: (ctx) => [`return ${ctx.dataIn('value')};`] },
  },
  agent: {
    kind: 'agent', category: 'domain', tag: 'agent', accentVar: '--accent-agent',
    size: { w: 230, h: 116 }, blurb: 'One subagent call: one prompt, one task, one result.',
    pins: [execIn(), dIn('prompt', 'Prompt', 'string', "''"), dIn('schema', 'Schema', 'schema'),
      execOut(), dOut('result', 'Result', 'agent-result')],
    codegen: {
      emit: (ctx) => {
        const opts = [`label: ${JSON.stringify(ctx.node.label)}`];
        if (ctx.pinWired('schema')) opts.push(`schema: ${ctx.dataIn('schema')}`);
        const extra = ctx.paramsObject();
        if (extra) opts.push(extra);
        return [`const ${ctx.varName} = await agent(${ctx.dataIn('prompt')}, { ${opts.join(', ')} });`, ...ctx.execBranch('exec-out')];
      },
      outExpr: (ctx) => ctx.varName,
    },
  },
  parallel: {
    kind: 'parallel', category: 'domain', tag: 'parallel', accentVar: '--accent-parallel',
    size: { w: 230, h: 116 }, blurb: 'Fan out a list of thunks and wait for every result (barrier).',
    pins: [execIn(), dIn('tasks', 'Tasks', 'array', '[]'), execOut(), dOut('results', 'Results', 'array')],
    codegen: {
      emit: (ctx) => [`const ${ctx.varName} = await parallel(${ctx.dataIn('tasks')});`, ...ctx.execBranch('exec-out')],
      outExpr: (ctx) => ctx.varName,
    },
  },
  pipeline: {
    kind: 'pipeline', category: 'domain', tag: 'pipeline', accentVar: '--accent-pipeline',
    size: { w: 230, h: 116 }, blurb: 'Stream items through stages with no barrier between them.',
    pins: [execIn(), dIn('items', 'Items', 'array', '[]'), execOut(), dOut('results', 'Results', 'array')],
    derivePins: (node) => {
      const n = Number(node.data?.stageCount ?? 1);
      return [execIn(), dIn('items', 'Items', 'array', '[]'),
        ...Array.from({ length: n }, (_, i) => dIn(`stage-${i}`, `Stage ${i}`, 'any')),
        execOut(), dOut('results', 'Results', 'array')];
    },
    codegen: {
      emit: (ctx) => {
        const n = Number(ctx.node.data?.stageCount ?? 1);
        const stages = Array.from({ length: n }, (_, i) => ctx.dataIn(`stage-${i}`)).join(', ');
        return [`const ${ctx.varName} = await pipeline(${ctx.dataIn('items')}${stages ? `, ${stages}` : ''});`, ...ctx.execBranch('exec-out')];
      },
      outExpr: (ctx) => ctx.varName,
    },
  },
  verify: {
    kind: 'verify', category: 'domain', tag: 'verify', accentVar: '--accent-verify',
    size: { w: 220, h: 124 }, blurb: 'Adversarial critic: passes work through, or routes it back to revise.',
    pins: [execIn(), dIn('work', 'Work', 'any'), execOut('ok', 'OK'), execOut('revise', 'Revise'), dOut('verdict', 'Verdict', 'object')],
    codegen: {
      emit: (ctx) => [
        `const ${ctx.varName} = await verify(${ctx.dataIn('work')});`,
        `if (${ctx.varName}.ok) {`, ...ctx.indent(ctx.execBranch('ok')),
        `} else {`, ...ctx.indent(ctx.execBranch('revise')), `}`,
      ],
      outExpr: (ctx, pin) => (pin === 'verdict' ? `${ctx.varName}.verdict` : ctx.varName),
    },
  },
  synthesize: {
    kind: 'synthesize', category: 'domain', tag: 'synthesize', accentVar: '--accent-synthesize',
    size: { w: 230, h: 116 }, blurb: 'A single agent that reconciles many results or writes the report.',
    pins: [execIn(), dIn('inputs', 'Inputs', 'array', '[]'), execOut(), dOut('result', 'Result', 'any')],
    codegen: {
      emit: (ctx) => [
        `const ${ctx.varName} = await agent(\`Synthesize: \${JSON.stringify(${ctx.dataIn('inputs')})}\`, { label: ${JSON.stringify(ctx.node.label)} });`,
        ...ctx.execBranch('exec-out'),
      ],
      outExpr: (ctx) => ctx.varName,
    },
  },
  gate: {
    kind: 'gate', category: 'domain', tag: 'gate', accentVar: '--accent-gate',
    size: { w: 210, h: 110 }, blurb: 'Build/verify gate: Pass on green, Fail on red.',
    pins: [execIn(), dIn('command', 'Check', 'string', "'npm run build'"), execOut('pass', 'Pass'), execOut('fail', 'Fail')],
    codegen: {
      emit: (ctx) => [
        `if (await gate(${ctx.dataIn('command')})) {`, ...ctx.indent(ctx.execBranch('pass')),
        `} else {`, ...ctx.indent(ctx.execBranch('fail')), `}`,
      ],
    },
  },
  schema: {
    kind: 'schema', category: 'domain', tag: 'schema', accentVar: '--accent-schema',
    size: { w: 180, h: 78 }, blurb: 'A structured-output schema, shown as its own badge.',
    pins: [dOut('schema', 'Schema', 'schema')],
    codegen: {
      emit: () => [],
      outExpr: (ctx) => String(ctx.node.data?.ref ?? ctx.node.label),
    },
  },
  log: {
    kind: 'log', category: 'domain', tag: 'log', accentVar: '--accent-log',
    size: { w: 200, h: 90 }, blurb: 'A log() narration beat. Passes execution straight through.',
    pins: [execIn(), dIn('message', 'Message', 'string', "''"), execOut()],
    codegen: { emit: (ctx) => [`log(${ctx.dataIn('message')});`, ...ctx.execBranch('exec-out')] },
  },

  // ── core control flow ───────────────────────────────────────────────────
  sequence: {
    kind: 'sequence', category: 'core-flow', tag: 'seq', accentVar: '--accent-sequence',
    size: { w: 170, h: 96 }, blurb: 'Run each Then output in order, one after another.',
    pins: [execIn()],
    derivePins: (node) => {
      const n = Number(node.data?.thenCount ?? 2);
      return [execIn(), ...Array.from({ length: n }, (_, i) => execOut(`then-${i}`, `Then ${i}`))];
    },
    codegen: {
      emit: (ctx) => {
        const n = Number(ctx.node.data?.thenCount ?? 2);
        return Array.from({ length: n }, (_, i) => ctx.execBranch(`then-${i}`)).flat();
      },
    },
  },
  branch: {
    kind: 'branch', category: 'core-flow', tag: 'if', accentVar: '--accent-branch',
    size: { w: 160, h: 116 }, blurb: 'If/else: route execution on a boolean condition.',
    pins: [execIn(), dIn('cond', 'Condition', 'bool', 'true'), execOut('true', 'True'), execOut('false', 'False')],
    codegen: {
      emit: (ctx) => [
        `if (${ctx.dataIn('cond')}) {`, ...ctx.indent(ctx.execBranch('true')),
        `} else {`, ...ctx.indent(ctx.execBranch('false')), `}`,
      ],
    },
  },
  doOnce: {
    kind: 'doOnce', category: 'core-flow', tag: 'do once', accentVar: '--accent-doonce',
    size: { w: 180, h: 96 }, blurb: 'Let execution through only the first time it is reached.',
    pins: [execIn(), execOut('completed', 'Completed')],
    codegen: {
      emit: (ctx) => [
        `if (!${ctx.varName}_done) {`,
        ...ctx.indent([`${ctx.varName}_done = true;`, ...ctx.execBranch('completed')]),
        `}`,
      ],
    },
  },
  forEach: {
    kind: 'forEach', category: 'core-flow', tag: 'foreach', accentVar: '--accent-loop',
    size: { w: 200, h: 150 }, blurb: 'Loop over an array. The Loop Body fires per element, then Completed.',
    pins: [execIn(), dIn('array', 'Array', 'array', '[]'),
      execOut('body', 'Loop Body'), dOut('item', 'Element', 'any'), dOut('index', 'Index', 'number'), execOut('done', 'Completed')],
    codegen: {
      emit: (ctx) => [
        `for (let ${ctx.varName}_i = 0; ${ctx.varName}_i < (${ctx.dataIn('array')}).length; ${ctx.varName}_i++) {`,
        ...ctx.indent([`const ${ctx.varName}_el = (${ctx.dataIn('array')})[${ctx.varName}_i];`, ...ctx.execBranch('body')]),
        `}`,
        ...ctx.execBranch('done'),
      ],
      outExpr: (ctx, pin) => (pin === 'item' ? `${ctx.varName}_el` : `${ctx.varName}_i`),
    },
  },
  whileLoop: {
    kind: 'whileLoop', category: 'core-flow', tag: 'while', accentVar: '--accent-loop',
    size: { w: 190, h: 116 }, blurb: 'Repeat the Loop Body while the condition holds, then Completed.',
    pins: [execIn(), dIn('cond', 'Condition', 'bool', 'true'), execOut('body', 'Loop Body'), execOut('done', 'Completed')],
    codegen: {
      emit: (ctx) => [
        `while (${ctx.dataIn('cond')}) {`, ...ctx.indent(ctx.execBranch('body')), `}`,
        ...ctx.execBranch('done'),
      ],
    },
  },

  // ── extended flow ───────────────────────────────────────────────────────
  doN: {
    kind: 'doN', category: 'extended-flow', tag: 'do n', accentVar: '--accent-doonce',
    size: { w: 180, h: 110 }, blurb: 'Let execution through the first N times it is reached.',
    pins: [execIn(), dIn('n', 'N', 'number', '1'), execOut('loop', 'Exit'), dOut('counter', 'Counter', 'number')],
    codegen: {
      emit: (ctx) => [
        `for (let ${ctx.varName}_i = 0; ${ctx.varName}_i < ${ctx.dataIn('n')}; ${ctx.varName}_i++) {`,
        ...ctx.indent(ctx.execBranch('loop')), `}`,
      ],
      outExpr: (ctx) => `${ctx.varName}_i`,
    },
  },
  multiGate: {
    kind: 'multiGate', category: 'extended-flow', tag: 'multigate', accentVar: '--accent-multigate',
    size: { w: 180, h: 110 }, blurb: 'Send execution to a different output each time it fires.',
    pins: [execIn()],
    derivePins: (node) => {
      const n = Number(node.data?.outCount ?? 2);
      return [execIn(), ...Array.from({ length: n }, (_, i) => execOut(`out-${i}`, `Out ${i}`))];
    },
    codegen: {
      emit: (ctx) => {
        const n = Number(ctx.node.data?.outCount ?? 2);
        return Array.from({ length: n }, (_, i) => ctx.execBranch(`out-${i}`)).flat();
      },
    },
  },
  flipFlop: {
    kind: 'flipFlop', category: 'extended-flow', tag: 'flipflop', accentVar: '--accent-multigate',
    size: { w: 180, h: 110 }, blurb: 'Alternate between output A and output B on each call.',
    pins: [execIn(), execOut('a', 'A'), execOut('b', 'B'), dOut('isA', 'Is A', 'bool')],
    codegen: {
      emit: (ctx) => [`// FlipFlop alternates A/B across calls`, ...ctx.execBranch('a'), ...ctx.execBranch('b')],
    },
  },
  forLoop: {
    kind: 'forLoop', category: 'extended-flow', tag: 'for', accentVar: '--accent-loop',
    size: { w: 190, h: 130 }, blurb: 'Counted loop from First to Last; Loop Body fires each index.',
    pins: [execIn(), dIn('first', 'First', 'number', '0'), dIn('last', 'Last', 'number', '0'),
      execOut('body', 'Loop Body'), dOut('index', 'Index', 'number'), execOut('done', 'Completed')],
    codegen: {
      emit: (ctx) => [
        `for (let ${ctx.varName}_i = ${ctx.dataIn('first')}; ${ctx.varName}_i <= ${ctx.dataIn('last')}; ${ctx.varName}_i++) {`,
        ...ctx.indent(ctx.execBranch('body')), `}`,
        ...ctx.execBranch('done'),
      ],
      outExpr: (ctx) => `${ctx.varName}_i`,
    },
  },
  switch: {
    kind: 'switch', category: 'extended-flow', tag: 'switch', accentVar: '--accent-switch',
    size: { w: 190, h: 120 }, blurb: 'Route execution by matching a value against named cases.',
    pins: [execIn(), dIn('value', 'Value', 'any')],
    derivePins: (node) => {
      const cases = (node.data?.cases as string[] | undefined) ?? [];
      return [execIn(), dIn('value', 'Value', 'any'),
        ...cases.map((c, i) => execOut(`case-${i}`, c)), execOut('default', 'Default')];
    },
    codegen: {
      emit: (ctx) => {
        const cases = (ctx.node.data?.cases as string[] | undefined) ?? [];
        const lines = [`switch (${ctx.dataIn('value')}) {`];
        cases.forEach((c, i) => {
          lines.push(`  case ${JSON.stringify(c)}: {`, ...ctx.indent(ctx.indent(ctx.execBranch(`case-${i}`))), `    break;`, `  }`);
        });
        lines.push(`  default: {`, ...ctx.indent(ctx.indent(ctx.execBranch('default'))), `  }`, `}`);
        return lines;
      },
    },
  },

  // ── async / timing ──────────────────────────────────────────────────────
  delay: {
    kind: 'delay', category: 'async', tag: 'delay', accentVar: '--accent-async',
    size: { w: 180, h: 90 }, blurb: 'Pause for a number of milliseconds, then continue.',
    pins: [execIn(), dIn('ms', 'Ms', 'number', '1000'), execOut()],
    codegen: { emit: (ctx) => [`await new Promise((r) => setTimeout(r, ${ctx.dataIn('ms')}));`, ...ctx.execBranch('exec-out')] },
  },
  retryUntil: {
    kind: 'retryUntil', category: 'async', tag: 'retry', accentVar: '--accent-async',
    size: { w: 200, h: 130 }, blurb: 'Run the body up to Max Attempts times until it succeeds.',
    pins: [execIn(), dIn('maxAttempts', 'Max Attempts', 'number', '3'),
      execOut('body', 'Body'), execOut('done', 'Done'), dOut('attempt', 'Attempt', 'number')],
    codegen: {
      emit: (ctx) => [
        `for (let ${ctx.varName}_a = 1; ${ctx.varName}_a <= ${ctx.dataIn('maxAttempts')}; ${ctx.varName}_a++) {`,
        ...ctx.indent(ctx.execBranch('body')), `}`,
        ...ctx.execBranch('done'),
      ],
      outExpr: (ctx) => `${ctx.varName}_a`,
    },
  },
  race: {
    kind: 'race', category: 'async', tag: 'race', accentVar: '--accent-async',
    size: { w: 200, h: 110 }, blurb: 'Run tasks concurrently; continue with the first to finish.',
    pins: [execIn(), dIn('tasks', 'Tasks', 'array', '[]'), execOut(), dOut('winner', 'Winner', 'any')],
    codegen: {
      emit: (ctx) => [`const ${ctx.varName} = await Promise.race(${ctx.dataIn('tasks')});`, ...ctx.execBranch('exec-out')],
      outExpr: (ctx) => ctx.varName,
    },
  },
  timeout: {
    kind: 'timeout', category: 'async', tag: 'timeout', accentVar: '--accent-async',
    size: { w: 200, h: 110 }, blurb: 'Race the work against a deadline: Completed or Timed Out.',
    pins: [execIn(), dIn('ms', 'Ms', 'number', '5000'), execOut('completed', 'Completed'), execOut('timedOut', 'Timed Out')],
    codegen: {
      emit: (ctx) => [`// race the work against a ${ctx.dataIn('ms')}ms timeout`, ...ctx.execBranch('completed')],
    },
  },

  // ── value: constant source nodes (no exec; one typed data-out) ──────────
  litString: {
    kind: 'litString', category: 'value', tag: 'string', accentVar: '--accent-litString',
    size: { w: 160, h: 64 }, blurb: 'A string constant.',
    pins: [dOut('value', '', 'string')],
    codegen: { emit: () => [], outExpr: (ctx) => JSON.stringify(String(ctx.node.data?.value ?? '')) },
  },
  litNumber: {
    kind: 'litNumber', category: 'value', tag: 'number', accentVar: '--accent-litNumber',
    size: { w: 160, h: 64 }, blurb: 'A number constant.',
    pins: [dOut('value', '', 'number')],
    codegen: {
      emit: () => [],
      outExpr: (ctx) => {
        const n = Number(ctx.node.data?.value ?? 0);
        return Number.isFinite(n) ? String(n) : '0';
      },
    },
  },
  litBool: {
    kind: 'litBool', category: 'value', tag: 'bool', accentVar: '--accent-litBool',
    size: { w: 150, h: 64 }, blurb: 'A boolean constant.',
    pins: [dOut('value', '', 'bool')],
    codegen: {
      emit: () => [],
      outExpr: (ctx) => (ctx.node.data?.value === true || ctx.node.data?.value === 'true' ? 'true' : 'false'),
    },
  },
  litArray: {
    kind: 'litArray', category: 'value', tag: 'array', accentVar: '--accent-litArray',
    size: { w: 170, h: 64 }, blurb: 'An array literal (JS/JSON).',
    pins: [dOut('value', '', 'array')],
    codegen: { emit: () => [], outExpr: (ctx) => String(ctx.node.data?.value ?? '[]') || '[]' },
  },
  litObject: {
    kind: 'litObject', category: 'value', tag: 'object', accentVar: '--accent-litObject',
    size: { w: 170, h: 64 }, blurb: 'An object literal (JS/JSON).',
    pins: [dOut('value', '', 'object')],
    codegen: { emit: () => [], outExpr: (ctx) => String(ctx.node.data?.value ?? '{}') || '{}' },
  },

  // Get/Set declared variables. They stay pure functions of the node by reading a
  // denormalized snapshot ({ varName, varType }) written on node.data at spawn.
  getVar: {
    kind: 'getVar', category: 'value', tag: 'get', accentVar: '--accent-getvar',
    size: { w: 150, h: 56 }, blurb: 'Read a declared variable.',
    pins: [dOut('value', 'value', 'any')],
    derivePins: (node) => [dOut('value', String(node.data?.varName ?? 'var'), (node.data?.varType as DataType) ?? 'any')],
    codegen: { emit: () => [], outExpr: (ctx) => String(ctx.node.data?.varName ?? 'undefined') },
  },
  setVar: {
    kind: 'setVar', category: 'value', tag: 'set', accentVar: '--accent-setvar',
    size: { w: 180, h: 88 }, blurb: 'Assign a declared variable; passes exec through.',
    pins: [execIn(), dIn('value', 'value', 'any'), execOut(), dOut('value', 'value', 'any')],
    derivePins: (node) => {
      const t = (node.data?.varType as DataType) ?? 'any';
      const nm = String(node.data?.varName ?? 'var');
      return [execIn(), dIn('value', nm, t), execOut(), dOut('value', nm, t)];
    },
    codegen: {
      emit: (ctx) => [`${String(ctx.node.data?.varName ?? 'undefined')} = ${ctx.dataIn('value')};`, ...ctx.execBranch('exec-out')],
      outExpr: (ctx) => String(ctx.node.data?.varName ?? 'undefined'),
    },
  },

  // ── util ────────────────────────────────────────────────────────────────
  reroute: {
    kind: 'reroute', category: 'util', tag: '', accentVar: '--accent-reroute',
    size: { w: 36, h: 36 }, blurb: 'A wire knot — route a value or exec through to tidy the graph.',
    pins: [dIn('in', '', 'any'), dOut('out', '', 'any')],
    // Polymorphic: an exec knot when data.role === 'exec', else a data-any knot.
    derivePins: (node) =>
      node.data?.role === 'exec'
        ? [
            { id: 'in', name: '', direction: 'in', role: 'exec', dataType: 'exec' },
            { id: 'out', name: '', direction: 'out', role: 'exec', dataType: 'exec' },
          ]
        : [dIn('in', '', 'any'), dOut('out', '', 'any')],
    codegen: {
      emit: (ctx) => (ctx.node.data?.role === 'exec' ? ctx.execBranch('out') : []),
      outExpr: (ctx) => ctx.dataIn('in'),
    },
  },
  getField: {
    kind: 'getField', category: 'util', tag: 'get .', accentVar: '--accent-getfield',
    size: { w: 170, h: 64 }, blurb: 'Read a named field from an object/struct value (e.g. args.root).',
    pins: [dIn('object', 'Object', 'any'), dOut('value', 'value', 'any')],
    derivePins: (node) => [dIn('object', 'Object', 'any'), dOut('value', String(node.data?.field ?? 'field'), 'any')],
    codegen: { emit: () => [], outExpr: (ctx) => `(${ctx.dataIn('object')}).${String(ctx.node.data?.field ?? 'field')}` },
  },
  function: {
    kind: 'function', category: 'util', tag: 'fn', accentVar: '--accent-function',
    size: { w: 200, h: 110 }, blurb: 'A collapsed subgraph with editable typed inputs and outputs.',
    pins: [],
    // External pins mirror the subgraph's input node (→ function inputs) and
    // output node (→ function outputs), prefixed so the two sides never collide.
    derivePins: (node) => {
      const sg = node.subgraph;
      if (!sg) return [];
      const inNode = sg.nodes.find((n) => n.kind === 'input');
      const outNode = sg.nodes.find((n) => n.kind === 'output');
      const inPins = inNode ? pinsOf(inNode).map((p) => ({ ...p, id: `${FN_IN_PREFIX}${p.id}`, direction: 'in' as const })) : [];
      const outPins = outNode ? pinsOf(outNode).map((p) => ({ ...p, id: `${FN_OUT_PREFIX}${p.id}`, direction: 'out' as const })) : [];
      if (inPins.length || outPins.length) return [...inPins, ...outPins];
      return sg.boundary?.map((b) => b.pin) ?? []; // legacy, pre-normalization
    },
    // Inlined at the call site by codegen.ts.
    codegen: { emit: () => [] },
  },

  // The subgraph boundary, materialized as nodes you can wire and edit. `input`
  // shows the function's inputs as OUT pins (wire them forward); `output` shows
  // its outputs as IN pins. Their pins live on node.data.pins.
  input: {
    kind: 'input', category: 'util', tag: 'inputs', accentVar: '--accent-input',
    size: { w: 150, h: 70 }, blurb: 'Function inputs — the subgraph entry. Edit its pins in the inspector.',
    pins: [],
    derivePins: (node) => (node.data?.pins as Pin[] | undefined) ?? [{ id: 'exec', name: '', direction: 'out', role: 'exec', dataType: 'exec' }],
    codegen: { emit: () => [] },
  },
  output: {
    kind: 'output', category: 'util', tag: 'outputs', accentVar: '--accent-output',
    size: { w: 150, h: 70 }, blurb: 'Function outputs — the subgraph exit. Edit its pins in the inspector.',
    pins: [],
    derivePins: (node) => (node.data?.pins as Pin[] | undefined) ?? [{ id: 'exec', name: '', direction: 'in', role: 'exec', dataType: 'exec' }],
    codegen: { emit: () => [] },
  },
};

// ── helpers (the single read surface for the rest of the app) ─────────────

export const catalogList = (): NodeDef[] => Object.values(CATALOG);

export const defOf = (kind: string): NodeDef => CATALOG[kind] ?? CATALOG.agent;

/** The live pin set for a node: template (or derivePins for variadic kinds),
 *  with any per-node pinOverrides applied. The one source used by rendering,
 *  layout sizing, edge validation, and codegen. */
export function pinsOf(node: DiagramNode): Pin[] {
  const def = defOf(node.kind);
  const base = def.derivePins ? def.derivePins(node) : def.pins;
  if (!node.pinOverrides) return base;
  return base.map((p) => {
    const ov = node.pinOverrides?.[p.id];
    return ov ? { ...p, ...ov } : p;
  });
}

export const pinOf = (node: DiagramNode, pinId: string): Pin | undefined =>
  pinsOf(node).find((p) => p.id === pinId);

// ── geometry (shared by BaseNode rendering and dagre auto-arrange) ────────

/** Header band height (tag + label + subtitle) and per-pin-row height. The
 *  renderer aligns each handle to `HEADER_H + rowIndex*ROW_H + ROW_H/2`, and
 *  footprint() reserves the matching box so dagre never overlaps tall nodes. */
export const HEADER_H = 48;
export const ROW_H = 22;
const PAD_Y = 12;

/** The rendered footprint of a node: the catalog floor, grown to fit its pins.
 *  The single sizing function used by both the renderer and the layout. */
export function footprint(node: DiagramNode): { w: number; h: number } {
  const def = defOf(node.kind);
  const pins = pinsOf(node);
  const ins = pins.filter((p) => p.direction === 'in').length;
  const outs = pins.filter((p) => p.direction === 'out').length;
  const rows = Math.max(ins, outs);
  return { w: def.size.w, h: Math.max(def.size.h, HEADER_H + rows * ROW_H + PAD_Y) };
}
