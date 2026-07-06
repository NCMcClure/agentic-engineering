// The contract between the agent (which authors diagram.json) and the canvas.
// v2: a pin-based Blueprint graph. Every node declares typed pins; edges connect
// a (node, pin) source to a (node, pin) target. This file is the single source
// of truth for the diagram shape; references/diagram-schema.md mirrors it.

export const SCHEMA_VERSION = 3 as const;

// ── Pins ────────────────────────────────────────────────────────────────

/** A white execution wire vs a colored typed-data wire. */
export type PinRole = 'exec' | 'data';
export type PinDirection = 'in' | 'out';

/** The built-in typed-data palette. `exec` is not a data type — it is carried on
 *  exec pins only, so a Pin's role and dataType stay in lockstep. */
export type PrimitiveDataType =
  | 'exec'
  | 'string'
  | 'number'
  | 'bool'
  | 'object'
  | 'array'
  | 'agent-result' // the resolved value of an agent() call
  | 'schema' //       a structured-output schema reference
  | 'any'; //         wildcard — connects to anything (reroute, log)

/** A reference to a user-defined struct in `Diagram.types`. All `struct:`
 *  parsing is funneled through types-registry.ts — never branch on it elsewhere. */
export type StructRef = `struct:${string}`;

/** A pin/value type: a primitive or a struct reference. */
export type DataType = PrimitiveDataType | StructRef;

// ── Custom struct types (the type registry) ───────────────────────────────

export interface StructField {
  name: string; // JS-identifier-safe key
  type: DataType;
  /** for array fields, the element type */
  elementType?: DataType;
}
export interface StructDef {
  id: string; // stable; referenced as `struct:<id>`
  name: string; // display + emitted type name
  fields: StructField[];
}

// ── Typed values (the recursive value model the editors read/write) ───────

export type SchemaScalar = 'string' | 'number' | 'boolean';
export type SchemaNode =
  | { type: SchemaScalar; description?: string }
  | { type: 'object'; description?: string; fields: SchemaProp[] }
  | { type: 'array'; description?: string; items: SchemaNode };
export interface SchemaProp {
  name: string;
  required: boolean;
  node: SchemaNode;
}

/** Kind-tagged so a single emitter (valueToJs) serializes any value without
 *  consulting the declared type. The declared DataType only constrains the
 *  editor UI. `expr` is a raw-JS escape hatch (and lit-node back-compat). */
export type TypedValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'array'; elementType: DataType; items: TypedValue[] }
  | { kind: 'object'; entries: Array<{ key: string; value: TypedValue }> }
  | { kind: 'struct'; structId: string; fields: Record<string, TypedValue> }
  | { kind: 'schema'; root: SchemaNode }
  | { kind: 'expr'; expr: string };

// ── Variables ─────────────────────────────────────────────────────────────

export interface Variable {
  id: string; // stable
  name: string; // JS identifier; also the emitted const name
  type: DataType;
  /** for array variables, the element type */
  elementType?: DataType;
  value: TypedValue;
}

/** A named, typed node parameter (rides node.data.params). */
export interface NodeParam {
  key: string;
  type: DataType;
  value: TypedValue;
}

/** A pin as defined on a catalog template OR materialized on a node. */
export interface Pin {
  /** stable within its node, e.g. 'exec-in', 'then-0', 'item' */
  id: string;
  /** human label rendered next to the handle ('' for a bare exec pin) */
  name: string;
  direction: PinDirection;
  role: PinRole;
  /** 'exec' when role === 'exec'; otherwise the wire's value type */
  dataType: DataType;
  /** literal source expression emitted when a data-in is left unwired */
  default?: string;
}

// ── Catalog (NodeDef) ─────────────────────────────────────────────────────

export type NodeCategory = 'core-flow' | 'extended-flow' | 'async' | 'domain' | 'util' | 'value';

/** kind-specific extras, e.g. { thenCount: 3 } on a Sequence, { cases: [...] }
 *  on a Switch, { barrier: 'wait all' } on a Parallel. */
export type NodeData = Record<string, unknown>;

/** The contract the catalog hands the code emitter (implemented in codegen.ts).
 *  Defined here because NodeDef.codegen references it. */
export interface EmitContext {
  node: DiagramNode;
  /** JS expression that produces a data-in pin's value: the wired upstream
   *  source's outExpr, or the pin's `default` literal when unwired. */
  dataIn(pinId: string): string;
  /** The compiled statement block that runs when an exec-out pin fires
   *  (Then 0, the True arm, a Loop Body, …). */
  execBranch(pinId: string): string[];
  /** Whether a pin currently has any wire attached. */
  pinWired(pinId: string): boolean;
  /** A stable, unique JS identifier bound to this node's primary data-out. */
  varName: string;
  /** Indent a block by one level (used when nesting branch/loop bodies). */
  indent(lines: string[]): string[];
  /** This node's params (data.params) as a `key: value, …` options fragment,
   *  or '' when there are none. Merge into the node's emitted options object. */
  paramsObject(): string;
}

export interface NodeCodegen {
  /** Statements emitted when control reaches this node. */
  emit(ctx: EmitContext): string[];
  /** How a data-out pin's value is referenced downstream. Defaults to the
   *  node's bound `varName`. */
  outExpr?(ctx: EmitContext, pinId: string): string;
}

export interface NodeDef {
  /** the registry key; equals node.kind and the React Flow node `type` */
  kind: string;
  category: NodeCategory;
  /** short corner label, e.g. 'seq', 'if', 'agent' */
  tag: string;
  /** CSS variable name for the accent, e.g. '--accent-agent' */
  accentVar: string;
  /** static pin template; variadic kinds compute pins via derivePins instead */
  pins: Pin[];
  /** for variadic kinds (Sequence, Switch, MultiGate, function): the live pin
   *  set derived from the node (its data, or its subgraph boundary). */
  derivePins?(node: DiagramNode): Pin[];
  /** geometry floor; dagre uses it and the renderer grows from it per pin count */
  size: { w: number; h: number };
  codegen: NodeCodegen;
  /** palette description; the search also matches against it */
  blurb: string;
}

// ── Diagram nodes / edges ────────────────────────────────────────────────

export interface DiagramNode {
  id: string;
  /** must be a catalog key */
  kind: string;
  label: string;
  /** optional freeform annotation (was `subtitle`). Functional config lives in
   *  pins and in `data.params` (NodeParam[]), not here. */
  note?: string;
  /** free-drag is the model: positions live on the node, not a side map */
  position: { x: number; y: number };
  /** per-node pin overrides: rename/retype/default a templated pin */
  pinOverrides?: Record<string, Partial<Pin>>;
  data?: NodeData;
  /** id of an owning comment group (visual grouping only), if any */
  group?: string;
  /** only on kind === 'function': the collapsed subgraph */
  subgraph?: SubGraph;
}

/** An endpoint: a specific pin on a specific node. */
export interface PinRef {
  node: string;
  pin: string;
}

export interface DiagramEdge {
  id: string;
  source: PinRef;
  target: PinRef;
  /** 'exec' (white wire) or 'data' (typed color) — matches both pins' role */
  role: PinRole;
  /** optional edge label */
  label?: string;
}

// ── Groups / comments ────────────────────────────────────────────────────

/** A free-form comment frame. Membership is by node.group === this id; the
 *  rect is purely visual (dragging it translates its members). */
export interface Group {
  id: string;
  label: string;
  /** optional freeform body text shown under the label */
  body?: string;
  rect: { x: number; y: number; w: number; h: number };
  color?: DataType | 'gray';
}

// ── Function subgraph ─────────────────────────────────────────────────────

/** A collapsed selection. The function node's pins ARE this boundary, so the
 *  collapse is lossless: every wire that crossed the selection becomes one
 *  boundary pin forwarding to/from the inner (node, pin) it connected. */
export interface SubGraph {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: Group[];
  /** Legacy (iteration 1) boundary mapping. The boundary is now expressed as
   *  `input`/`output` nodes inside `nodes`; this remains optional so old
   *  diagrams normalize on load. */
  boundary?: Array<{ pin: Pin; inner: PinRef }>;
}

// ── Studio: projects & workflows ───────────────────────────────────────────

/** A studio project — a named folder on disk that holds many workflows. */
export interface Project {
  id: string; //          opaque, == folder name under the studio root
  name: string; //        human display name
  description?: string;
  createdAt: string; //   ISO timestamp
  updatedAt: string; //   ISO timestamp
}

/** A lightweight projection of a workflow for browsing/switching, without the
 *  full graph payload. */
export interface WorkflowSummary {
  id: string; //          opaque, == workflow folder name
  name: string; //        human display name (mirrors Diagram.workflow)
  exportPath: string; //  the user's chosen export target (may be empty)
  updatedAt?: string;
}

// ── Root ──────────────────────────────────────────────────────────────────

export interface Diagram {
  schemaVersion: typeof SCHEMA_VERSION;
  /** workflow id (== folder name); injected by the loader. Optional for the
   *  in-repo seed and back-compat with pre-studio diagrams. */
  id?: string;
  /** owning project id; injected by the loader. */
  projectId?: string;
  /** human workflow name, e.g. "deep-research" (usually meta.name) */
  workflow: string;
  /** path to the source .js this diagram represents, relative to this workspace.
   *  Retained for back-compat; the studio now writes a core copy + `exportPath`. */
  source: string;
  /** the user's per-workflow export target. Compile writes the output here in
   *  addition to the studio's core copy. Empty means core-copy-only. */
  exportPath?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: Group[];
  /** declared variables (emitted as const/let; usable via Get/Set nodes) */
  variables: Variable[];
  /** user-defined struct types */
  types: StructDef[];
}
