import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './theme.css';

import { nodeTypes } from './nodes';
import { nodeOf, type WfNodeData } from './nodes/BaseNode';
import { ConnectedContext } from './connected';
import { layout } from './layout';
import { saveWorkflow, compileAndExport, loadWorkflow } from './api';
import { compile } from './codegen';
import { Palette, type PaletteItem } from './Palette';
import { DetailsPanel, type DetailsHandlers, type Selection } from './DetailsPanel';
import { VariablesPanel } from './VariablesPanel';
import { Launcher } from './Launcher';
import { ProjectSwitcher } from './ProjectSwitcher';
import { catalogList, defOf, pinsOf, FN_IN_PREFIX, FN_OUT_PREFIX } from './catalog';
import { canConnect, edgeClass, edgeRoleOf, fromRFEdge, toRFEdge, typeCompatible } from './edges';
import { groupFromSelection } from './groups';
import { collapseToFunction, emptyFunctionSubgraph, normalizeFunction } from './collapse';
import { makeVariable, snapshotOf } from './variables';
import {
  SCHEMA_VERSION,
  type DataType,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Group,
  type PinDirection,
  type PinRole,
  type Project,
  type StructDef,
  type SubGraph,
  type Variable,
  type WorkflowSummary,
} from './types';

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

/** A fresh node of the given kind, seeded from the catalog. A function gets an
 *  empty Input/Output subgraph so it's valid and enterable immediately. */
function makeNode(kind: string, position: { x: number; y: number }): DiagramNode {
  const def = defOf(kind);
  const node: DiagramNode = { id: `n-${shortId()}`, kind, label: def.tag || kind, position };
  if (kind === 'function') node.subgraph = emptyFunctionSubgraph();
  return node;
}

/** Normalize a loaded diagram: v2→v3 (rename `subtitle`→`note`, default the new
 *  `variables`/`types` arrays) and upgrade iteration-1 functions (boundary
 *  mapping, no Input/Output nodes) to the node-based model, remapping parent
 *  edges to the prefixed function pins. */
function migrateDiagram(d: Diagram): Diagram {
  const renamed = d.nodes.map((n) => {
    const legacy = (n as { subtitle?: string }).subtitle;
    if (legacy === undefined) return n;
    const rest = { ...n } as DiagramNode & { subtitle?: string };
    delete rest.subtitle;
    rest.note = rest.note ?? legacy;
    return rest as DiagramNode;
  });

  const remaps = new Map<string, Map<string, string>>();
  const nodes = renamed.map((n) => {
    if (n.kind === 'function' && n.subgraph?.boundary && !n.subgraph.nodes.some((x) => x.kind === 'input' || x.kind === 'output')) {
      const m = new Map<string, string>();
      n.subgraph.boundary.forEach((b) => m.set(b.pin.id, (b.pin.direction === 'in' ? FN_IN_PREFIX : FN_OUT_PREFIX) + b.pin.id));
      remaps.set(n.id, m);
      return normalizeFunction(n);
    }
    return n;
  });

  const base: Diagram = { ...d, nodes, variables: d.variables ?? [], types: d.types ?? [] };
  if (!remaps.size) return base;
  const edges = d.edges.map((e) => {
    const sm = remaps.get(e.source.node);
    const tm = remaps.get(e.target.node);
    return {
      ...e,
      source: sm?.has(e.source.pin) ? { ...e.source, pin: sm.get(e.source.pin)! } : e.source,
      target: tm?.has(e.target.pin) ? { ...e.target, pin: tm.get(e.target.pin)! } : e.target,
    };
  });
  return { ...base, edges };
}

// ── Diagram <-> React Flow mappers ──────────────────────────────────────

function diagramNodesToRF(nodes: DiagramNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: n.position,
    data: { node: n } as WfNodeData,
  }));
}

function groupsToRF(groups: Group[]): Node[] {
  return groups.map((gr) => ({
    id: gr.id,
    type: 'comment',
    position: { x: gr.rect.x, y: gr.rect.y },
    data: { label: gr.label, color: gr.color, body: gr.body },
    style: { width: gr.rect.w, height: gr.rect.h },
    zIndex: -1,
    selectable: true,
    draggable: true,
  }));
}

const isComment = (n: Node) => n.type === 'comment';
const diagramNodesOf = (nodes: Node[]): DiagramNode[] => nodes.filter((n) => !isComment(n)).map((n) => nodeOf(n.data));

function clientXY(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY };
  const t = event.changedTouches[0];
  return { x: t.clientX, y: t.clientY };
}

/** Where a drag-off-a-pin started, so the palette can filter to compatible kinds
 *  and auto-wire the spawned node. */
interface DragOrigin {
  node: string;
  pin: string;
  role: PinRole;
  dataType: DataType;
  /** the handle we dragged FROM: 'source' needs a compatible 'in' on the new
   *  node, 'target' needs a compatible 'out'. */
  from: 'source' | 'target';
}

interface PaletteState {
  screen: { x: number; y: number };
  flow: { x: number; y: number };
  origin?: DragOrigin;
}

// ── Canvas ──────────────────────────────────────────────────────────────

function Canvas({
  initial,
  project,
  workflows,
  markSaving,
  onBack,
  onSwitch,
}: {
  initial: Diagram;
  project: Project;
  workflows: WorkflowSummary[];
  markSaving: () => void;
  onBack: () => void;
  onSwitch: (wf: WorkflowSummary) => void;
}) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([
    ...groupsToRF(initial.groups),
    ...diagramNodesToRF(initial.nodes),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initial.edges.map((e) => toRFEdge(e, initial.nodes)),
  );
  // Unified single-selection: a {kind, id} ref resolved against live state into a
  // Selection for the details panel. `selectedIds` (multi) stays separate.
  const [sel, setSel] = useState<{ kind: Selection['kind']; id: string } | null>(null);
  const selectedNodeId = sel?.kind === 'node' ? sel.id : null;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [variables, setVariables] = useState<Variable[]>(initial.variables);
  const [types, setTypes] = useState<StructDef[]>(initial.types);
  const [exportPath, setExportPath] = useState<string>(initial.exportPath ?? '');
  const [addKind, setAddKind] = useState<string>('agent');
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Stack of parent graphs while inside collapsed-function subgraphs. Held in a
  // ref so enter/exit don't fight React state batching; breadcrumb mirrors it
  // for the UI. While nested (depth > 0), disk save is paused until you exit.
  const viewStack = useRef<Array<{ fnId: string; label: string; nodes: Node[]; edges: Edge[] }>>([]);
  const nested = breadcrumb.length > 0;
  const commentPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  // A pin drag that ends on empty pane opens the palette via onConnectEnd, but the
  // browser then fires a pane `click` that would close it. This one-shot guard
  // lets the palette survive that trailing click.
  const suppressPaneClick = useRef(false);

  // Resolve the selection ref into a live Selection for the details panel.
  const selection = useMemo<Selection | null>(() => {
    if (!sel) return null;
    if (sel.kind === 'node') {
      const n = nodes.find((x) => x.id === sel.id && !isComment(x));
      return n ? { kind: 'node', node: nodeOf(n.data) } : null;
    }
    if (sel.kind === 'comment') {
      const n = nodes.find((x) => x.id === sel.id && isComment(x));
      if (!n) return null;
      const d = n.data as { label?: string; color?: Group['color']; body?: string };
      const w = typeof n.style?.width === 'number' ? n.style.width : 240;
      const hh = typeof n.style?.height === 'number' ? n.style.height : 160;
      return { kind: 'comment', group: { id: n.id, label: d.label ?? 'Comment', body: d.body, rect: { x: n.position.x, y: n.position.y, w, h: hh }, color: d.color } };
    }
    if (sel.kind === 'edge') {
      const e = edges.find((x) => x.id === sel.id);
      return e ? { kind: 'edge', edge: fromRFEdge(e) } : null;
    }
    if (sel.kind === 'variable') {
      const v = variables.find((x) => x.id === sel.id);
      return v ? { kind: 'variable', variable: v } : null;
    }
    const s = types.find((x) => x.id === sel.id);
    return s ? { kind: 'struct', struct: s } : null;
  }, [sel, nodes, edges, variables, types]);

  // Which pins currently carry a wire — drives the filled/hollow pin rendering.
  const connected = useMemo(() => {
    const s = new Set<string>();
    edges.forEach((e) => {
      if (e.sourceHandle) s.add(`${e.source}:${e.sourceHandle}`);
      if (e.targetHandle) s.add(`${e.target}:${e.targetHandle}`);
    });
    return s;
  }, [edges]);

  const serialize = useCallback((): Diagram => {
    const dnodes: DiagramNode[] = [];
    const groups: Group[] = [];
    nodes.forEach((n) => {
      if (isComment(n)) {
        const d = n.data as { label?: string; color?: Group['color']; body?: string };
        const w = typeof n.style?.width === 'number' ? n.style.width : 240;
        const h = typeof n.style?.height === 'number' ? n.style.height : 160;
        groups.push({
          id: n.id,
          label: d.label ?? 'Comment',
          ...(d.body ? { body: d.body } : {}),
          rect: { x: Math.round(n.position.x), y: Math.round(n.position.y), w, h },
          color: d.color,
        });
      } else {
        const node = nodeOf(n.data);
        dnodes.push({ ...node, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } });
      }
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      id: initial.id,
      projectId: initial.projectId,
      workflow: initial.workflow,
      source: initial.source,
      exportPath,
      nodes: dnodes,
      edges: edges.map(fromRFEdge),
      groups,
      variables,
      types,
    };
  }, [nodes, edges, initial, variables, types, exportPath]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const save = useCallback(
    async (announce = false) => {
      if (nested) return; // editing a subgraph — persisted into its function on exit
      const diagram = serialize();
      if (!diagram.projectId || !diagram.id) return;
      markSaving();
      await saveWorkflow(diagram.projectId, diagram.id, diagram);
      if (announce) showToast('Saved');
    },
    [nested, markSaving, serialize, showToast],
  );

  // Compile the graph to its runnable workflow .js (exec wires → order, data
  // wires → bindings). Always writes the studio's core copy, and — when an
  // export path is set — that target too. Only from the root.
  const compileExport = useCallback(async () => {
    if (nested) return;
    const diagram = serialize();
    if (!diagram.projectId || !diagram.id) return;
    markSaving();
    // Persist the diagram first so the saved export path matches the output.
    await saveWorkflow(diagram.projectId, diagram.id, diagram);
    const r = await compileAndExport(diagram.projectId, diagram.id, exportPath, compile(diagram));
    showToast(
      r.exportPath ? `Compiled → studio + ${r.exportPath}` : `Compiled → ${r.corePath} (no export path set)`,
    );
  }, [nested, serialize, exportPath, markSaving, showToast]);

  // Persist only when a drag completes — not on every pixel, and never on load.
  // Dragging a comment frame translates its member nodes with it.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      const shifts: Array<{ members: string[]; dx: number; dy: number }> = [];
      for (const c of changes) {
        if (c.type !== 'position' || !c.position) continue;
        const cn = nodes.find((n) => n.id === c.id);
        if (!cn || !isComment(cn)) continue;
        const prev = commentPos.current.get(c.id) ?? cn.position;
        const dx = c.position.x - prev.x;
        const dy = c.position.y - prev.y;
        commentPos.current.set(c.id, c.position);
        if (dx || dy) {
          shifts.push({
            members: nodes.filter((n) => !isComment(n) && nodeOf(n.data).group === c.id).map((n) => n.id),
            dx,
            dy,
          });
        }
      }
      if (shifts.length) {
        setNodes((nds) =>
          nds.map((n) => {
            const s = shifts.find((sh) => sh.members.includes(n.id));
            return s ? { ...n, position: { x: n.position.x + s.dx, y: n.position.y + s.dy } } : n;
          }),
        );
      }
      if (changes.some((c) => c.type === 'position' && c.dragging === false)) void save();
    },
    [nodes, onNodesChange, setNodes, save],
  );

  const isValid = useCallback((c: Connection | Edge) => canConnect(c, diagramNodesOf(nodes)), [nodes]);

  // Add a validated, typed edge. A data-in accepts a single wire (replace on
  // reconnect); exec-ins merge freely. Shared by manual connect + drag-to-create.
  const addConnection = useCallback(
    (c: Connection, dnodes: DiagramNode[]) => {
      if (!canConnect(c, dnodes)) return;
      const { role, dataType } = edgeRoleOf(c, dnodes);
      setEdges((eds) => {
        const kept = role === 'data'
          ? eds.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
          : eds;
        return kept.concat({
          id: `e-${shortId()}`,
          source: c.source as string,
          sourceHandle: c.sourceHandle as string,
          target: c.target as string,
          targetHandle: c.targetHandle as string,
          data: { role },
          className: edgeClass(role, dataType),
          type: 'default',
        });
      });
    },
    [setEdges],
  );

  const onConnect = useCallback((c: Connection) => addConnection(c, diagramNodesOf(nodes)), [addConnection, nodes]);

  // Right-click empty canvas → open the palette at the cursor (unfiltered).
  const onPaneContextMenu = useCallback(
    (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
      e.preventDefault();
      setSel(null);
      setPalette({
        screen: { x: e.clientX, y: e.clientY },
        flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      });
    },
    [screenToFlowPosition],
  );

  // Drag off a pin onto empty canvas → open the palette filtered to compatible
  // kinds, carrying the origin so the spawned node auto-wires.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, conn: { isValid: boolean | null; fromHandle: { nodeId: string; id?: string | null; type: 'source' | 'target' } | null }) => {
      if (conn.isValid || !conn.fromHandle || !conn.fromHandle.id) return;
      const fromNode = diagramNodesOf(nodes).find((n) => n.id === conn.fromHandle!.nodeId);
      const pin = fromNode && pinsOf(fromNode).find((p) => p.id === conn.fromHandle!.id);
      if (!fromNode || !pin) return;
      const xy = clientXY(event);
      suppressPaneClick.current = true; // survive the trailing pane click
      setPalette({
        screen: xy,
        flow: screenToFlowPosition(xy),
        origin: { node: fromNode.id, pin: pin.id, role: pin.role, dataType: pin.dataType, from: conn.fromHandle.type },
      });
    },
    [nodes, screenToFlowPosition],
  );

  type SpawnAction = { type: 'catalog'; kind: string } | { type: 'getVar' | 'setVar'; varId: string };

  // The first pin on a node that can connect back to the drag origin.
  const firstCompatPin = (n: DiagramNode, origin: DragOrigin): string | undefined => {
    const want: PinDirection = origin.from === 'source' ? 'in' : 'out';
    return pinsOf(n).find(
      (p) => p.direction === want && p.role === origin.role && (origin.role === 'exec' || typeCompatible(origin.dataType, p.dataType)),
    )?.id;
  };

  // A throwaway node for an action, used to test pin compatibility.
  const probeFor = useCallback(
    (action: SpawnAction): DiagramNode => {
      if (action.type === 'catalog') {
        return { id: '_', kind: action.kind, label: '', position: { x: 0, y: 0 }, data: palette?.origin ? { role: palette.origin.role } : undefined };
      }
      const v = variables.find((x) => x.id === action.varId);
      return { id: '_', kind: action.type, label: '', position: { x: 0, y: 0 }, data: v ? { ...snapshotOf(v) } : undefined };
    },
    [palette, variables],
  );

  // The full finder list: catalog nodes + Get/Set for each declared variable.
  const paletteAll = useMemo<Array<PaletteItem & { action: SpawnAction }>>(() => {
    const cat = catalogList().map((d) => ({ key: d.kind, label: d.kind, category: d.category, blurb: d.blurb, action: { type: 'catalog' as const, kind: d.kind } }));
    const vars = variables.flatMap((v) => [
      { key: `get:${v.id}`, label: `Get ${v.name}`, category: 'variable', blurb: `Read ${v.name} · ${v.type}`, action: { type: 'getVar' as const, varId: v.id } },
      { key: `set:${v.id}`, label: `Set ${v.name}`, category: 'variable', blurb: `Assign ${v.name} · ${v.type}`, action: { type: 'setVar' as const, varId: v.id } },
    ]);
    return [...cat, ...vars];
  }, [variables]);

  // Narrowed to compatible items when opened by a drag off a pin.
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const origin = palette?.origin;
    if (!origin) return paletteAll;
    const want: PinDirection = origin.from === 'source' ? 'in' : 'out';
    return paletteAll.filter((it) => {
      if (it.action.type === 'catalog' && it.action.kind === 'reroute') return true;
      return pinsOf(probeFor(it.action)).some(
        (p) => p.direction === want && p.role === origin.role && (origin.role === 'exec' || typeCompatible(origin.dataType, p.dataType)),
      );
    });
  }, [paletteAll, palette, probeFor]);

  const spawnFromPalette = useCallback(
    (key: string) => {
      if (!palette) return;
      const item = paletteAll.find((i) => i.key === key);
      if (!item) return;
      const action = item.action;
      let node: DiagramNode;
      if (action.type === 'catalog') {
        node = makeNode(action.kind, palette.flow);
        if (action.kind === 'reroute' && palette.origin) node.data = { ...node.data, role: palette.origin.role };
      } else {
        const v = variables.find((x) => x.id === action.varId);
        if (!v) return;
        node = makeNode(action.type, palette.flow);
        node.data = { ...snapshotOf(v) };
        node.label = (action.type === 'getVar' ? 'Get ' : 'Set ') + v.name;
      }
      const spawned = node;
      setNodes((nds) => nds.concat({ id: spawned.id, type: spawned.kind, position: spawned.position, data: { node: spawned } as WfNodeData }));
      if (palette.origin) {
        const pinId = firstCompatPin(spawned, palette.origin);
        if (pinId) {
          const o = palette.origin;
          const c: Connection = o.from === 'source'
            ? { source: o.node, sourceHandle: o.pin, target: spawned.id, targetHandle: pinId }
            : { source: spawned.id, sourceHandle: pinId, target: o.node, targetHandle: o.pin };
          addConnection(c, [...diagramNodesOf(nodes), spawned]);
        }
      }
      setSel({ kind: 'node', id: spawned.id });
      setPalette(null);
    },
    [palette, paletteAll, variables, nodes, setNodes, addConnection],
  );

  const addNode = useCallback(() => {
    const node = makeNode(addKind, { x: 80, y: 80 });
    setNodes((nds) => nds.concat({ id: node.id, type: node.kind, position: node.position, data: { node } as WfNodeData }));
    setSel({ kind: 'node', id: node.id });
  }, [addKind, setNodes]);

  // Delete the selected node (+ its edges), or the selected edge, or comment.
  const deleteSelected = useCallback(() => {
    if (!sel) return;
    const id = sel.id;
    if (sel.kind === 'edge') {
      setEdges((eds) => eds.filter((e) => e.id !== id));
    } else if (sel.kind === 'node' || sel.kind === 'comment') {
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setNodes((nds) => nds.filter((n) => n.id !== id));
    } else {
      return;
    }
    setSel(null);
  }, [sel, setNodes, setEdges]);

  const autoArrange = useCallback(() => {
    setNodes((nds) => layout(nds, edges));
    window.requestAnimationFrame(() => fitView({ duration: 300 }));
    void save();
  }, [edges, setNodes, fitView, save]);

  // Wrap the current selection in a comment frame; members carry its id so the
  // frame drags them along.
  const groupSelection = useCallback(() => {
    const dnodes = diagramNodesOf(nodes);
    const g = groupFromSelection(selectedIds, dnodes);
    if (!g) return;
    setNodes((nds) => {
      const withGroup = nds.map((n) =>
        selectedIds.includes(n.id) && !isComment(n)
          ? { ...n, data: { node: { ...nodeOf(n.data), group: g.id } } as WfNodeData }
          : n,
      );
      const frame: Node = {
        id: g.id,
        type: 'comment',
        position: { x: g.rect.x, y: g.rect.y },
        data: { label: g.label, color: g.color },
        style: { width: g.rect.w, height: g.rect.h },
        zIndex: -1,
        selectable: true,
        draggable: true,
      };
      return [frame, ...withGroup];
    });
    void save();
  }, [nodes, selectedIds, setNodes, save]);

  // Collapse the selection into a single function node with derived boundary pins.
  const collapseSelection = useCallback(() => {
    const dnodes = diagramNodesOf(nodes);
    const res = collapseToFunction(selectedIds, dnodes, edges.map(fromRFEdge));
    if (!res) return;
    const lookup = [...dnodes.filter((n) => !res.removedIds.includes(n.id)), res.fn];
    setNodes((nds) =>
      nds
        .filter((n) => !res.removedIds.includes(n.id))
        .concat({ id: res.fn.id, type: res.fn.kind, position: res.fn.position, data: { node: res.fn } as WfNodeData }),
    );
    setEdges((eds) => eds.filter((e) => !res.droppedIds.includes(e.id)).concat(res.rewired.map((e) => toRFEdge(e, lookup))));
    setSel({ kind: 'node', id: res.fn.id });
    setSelectedIds([res.fn.id]);
    void save();
  }, [nodes, edges, selectedIds, setNodes, setEdges, save]);

  // Double-click a function node → descend into its subgraph (parent snapshotted).
  const enterFunction = useCallback(
    (n: Node) => {
      if (isComment(n)) return;
      const fn = normalizeFunction(nodeOf(n.data));
      if (fn.kind !== 'function' || !fn.subgraph) return;
      viewStack.current.push({ fnId: n.id, label: fn.label, nodes, edges });
      setBreadcrumb(viewStack.current.map((v) => v.label));
      setNodes(diagramNodesToRF(fn.subgraph.nodes));
      setEdges(fn.subgraph.edges.map((e) => toRFEdge(e, fn.subgraph!.nodes)));
      setSel(null);
      window.requestAnimationFrame(() => fitView({ duration: 300 }));
    },
    [nodes, edges, setNodes, setEdges, fitView],
  );

  // Pop one level, writing the edited subgraph back into its function node.
  const exitFunction = useCallback(() => {
    const frame = viewStack.current.pop();
    if (!frame) return;
    const subNodes = diagramNodesOf(nodes);
    const subEdges = edges.map(fromRFEdge);
    const parentNodes = frame.nodes.map((n) => {
      if (n.id !== frame.fnId) return n;
      const fn = nodeOf(n.data);
      const sg = (fn.subgraph ?? { boundary: [] }) as SubGraph;
      return { ...n, data: { node: { ...fn, subgraph: { ...sg, nodes: subNodes, edges: subEdges } } } as WfNodeData };
    });
    setBreadcrumb(viewStack.current.map((v) => v.label));
    setNodes(parentNodes);
    setEdges(frame.edges);
    setSel(null);
    window.requestAnimationFrame(() => fitView({ duration: 300 }));
  }, [nodes, edges, setNodes, setEdges, fitView]);

  // Apply an arbitrary update to the selected node's DiagramNode.
  const mutateSelected = useCallback(
    (fn: (node: DiagramNode) => DiagramNode) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId || isComment(n)) return n;
          const next = fn(nodeOf(n.data));
          return { ...n, type: next.kind, data: { node: next } as WfNodeData };
        }),
      );
    },
    [selectedNodeId, setNodes],
  );

  const patchSelected = useCallback(
    (patch: Partial<Pick<DiagramNode, 'label' | 'note' | 'kind'>>) => mutateSelected((n) => ({ ...n, ...patch })),
    [mutateSelected],
  );
  const patchData = useCallback(
    (data: Record<string, unknown>) => mutateSelected((n) => ({ ...n, data: { ...n.data, ...data } })),
    [mutateSelected],
  );
  const patchPinDefault = useCallback(
    (pinId: string, value: string) =>
      mutateSelected((n) => ({
        ...n,
        pinOverrides: { ...n.pinOverrides, [pinId]: { ...n.pinOverrides?.[pinId], default: value } },
      })),
    [mutateSelected],
  );

  // ── variable / struct / edge / comment mutators ──────────────────────────
  const patchVariable = useCallback(
    (patch: Partial<Variable>) => {
      if (sel?.kind !== 'variable') return;
      const id = sel.id;
      setVariables((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
      if (patch.name !== undefined || patch.type !== undefined || patch.elementType !== undefined) {
        // re-sync getVar/setVar snapshots that reference this variable
        setNodes((nds) =>
          nds.map((n) => {
            if (isComment(n)) return n;
            const node = nodeOf(n.data);
            if ((node.kind === 'getVar' || node.kind === 'setVar') && node.data?.varId === id) {
              const d = node.data ?? {};
              const next: DiagramNode = {
                ...node,
                data: {
                  ...d,
                  varName: patch.name ?? d.varName,
                  varType: patch.type ?? d.varType,
                  varElementType: patch.elementType ?? d.varElementType,
                },
              };
              return { ...n, data: { node: next } as WfNodeData };
            }
            return n;
          }),
        );
      }
    },
    [sel, setNodes],
  );
  const deleteVariable = useCallback(() => {
    if (sel?.kind !== 'variable') return;
    const id = sel.id;
    setVariables((vs) => vs.filter((v) => v.id !== id));
    setSel(null);
  }, [sel]);
  const patchStruct = useCallback(
    (patch: Partial<StructDef>) => {
      if (sel?.kind !== 'struct') return;
      const id = sel.id;
      setTypes((ts) => ts.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [sel],
  );
  const deleteStruct = useCallback(() => {
    if (sel?.kind !== 'struct') return;
    const id = sel.id;
    setTypes((ts) => ts.filter((s) => s.id !== id));
    setSel(null);
  }, [sel]);
  const patchEdge = useCallback(
    (patch: Partial<Pick<DiagramEdge, 'label'>>) => {
      if (sel?.kind !== 'edge') return;
      const id = sel.id;
      setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, label: patch.label } : e)));
    },
    [sel, setEdges],
  );
  const patchComment = useCallback(
    (patch: Partial<Pick<Group, 'label' | 'body' | 'color'>>) => {
      if (sel?.kind !== 'comment') return;
      const id = sel.id;
      setNodes((nds) => nds.map((n) => (n.id === id && isComment(n) ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [sel, setNodes],
  );

  const handlers = useMemo<DetailsHandlers>(
    () => ({
      types,
      connectedKeys: connected,
      onPatchNode: patchSelected,
      onPatchNodeData: patchData,
      onPatchPinDefault: patchPinDefault,
      onPatchVariable: patchVariable,
      onDeleteVariable: deleteVariable,
      onPatchStruct: patchStruct,
      onDeleteStruct: deleteStruct,
      onPatchEdge: patchEdge,
      onPatchComment: patchComment,
      onSave: () => void save(true),
    }),
    [types, connected, patchSelected, patchData, patchPinDefault, patchVariable, deleteVariable, patchStruct, deleteStruct, patchEdge, patchComment, save],
  );

  const addVariable = useCallback(() => {
    const v = makeVariable('newVar', 'string', types);
    setVariables((vs) => [...vs, v]);
    setSel({ kind: 'variable', id: v.id });
  }, [types]);
  const addStruct = useCallback(() => {
    const s: StructDef = { id: `struct-${shortId()}`, name: 'NewStruct', fields: [] };
    setTypes((ts) => [...ts, s]);
    setSel({ kind: 'struct', id: s.id });
  }, []);

  return (
    <div className="app">
      <header className="toolbar">
        <ProjectSwitcher
          project={project}
          workflows={workflows}
          currentWorkflowId={initial.id ?? null}
          onBack={onBack}
          onSwitch={onSwitch}
        />
        <select className="select" value={addKind} onChange={(e) => setAddKind(e.target.value)}>
          {catalogList().map((d) => (
            <option key={d.kind} value={d.kind}>
              {d.kind}
            </option>
          ))}
        </select>
        <button className="btn" onClick={addNode}>
          + Add
        </button>
        <button
          className="btn btn--danger"
          onClick={deleteSelected}
          disabled={!sel || sel.kind === 'variable' || sel.kind === 'struct'}
        >
          Delete
        </button>
        <button className="btn" onClick={groupSelection} disabled={!selectedIds.length}>
          Group
        </button>
        <button className="btn" onClick={collapseSelection} disabled={!selectedIds.length}>
          Collapse
        </button>
        <button className="btn" onClick={autoArrange}>
          Auto-arrange
        </button>
        {nested ? (
          <span className="breadcrumb">
            <button className="btn" onClick={exitFunction}>
              ↑ Up
            </button>
            <span className="breadcrumb__path">{['root', ...breadcrumb].join(' / ')}</span>
          </span>
        ) : null}
        <div className="toolbar__spacer" />
        <label className="export-field" title="Compiled .js is written here in addition to the studio's core copy">
          <span className="export-field__label">Export →</span>
          <input
            className="input export-field__input"
            type="text"
            value={exportPath}
            placeholder="path/to/workflow.js"
            onChange={(e) => setExportPath(e.target.value)}
            disabled={nested}
          />
        </label>
        <button
          className="btn"
          onClick={() => void compileExport()}
          disabled={nested}
          title="Compile and write to the studio copy + export path"
        >
          Compile &amp; Export
        </button>
        <button className="btn btn--accent" onClick={() => void save(true)} disabled={nested}>
          Save
        </button>
      </header>

      <div className="canvas-wrap">
        <ConnectedContext.Provider value={connected}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onPaneContextMenu={onPaneContextMenu}
          isValidConnection={isValid}
          onNodeClick={(_, n) => setSel(isComment(n) ? { kind: 'comment', id: n.id } : { kind: 'node', id: n.id })}
          onNodeDoubleClick={(_, n) => enterFunction(n)}
          onEdgeClick={(_, e) => setSel({ kind: 'edge', id: e.id })}
          onSelectionChange={({ nodes: selNodes }) => setSelectedIds(selNodes.filter((n) => !isComment(n)).map((n) => n.id))}
          onPaneClick={() => {
            if (suppressPaneClick.current) {
              suppressPaneClick.current = false;
              return;
            }
            setSel(null);
            setPalette(null);
          }}
          fitView
          minZoom={0.15}
        >
          <Background gap={22} size={1.5} color="var(--grid)" />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        </ConnectedContext.Provider>

        {palette ? (
          <>
            <div className="palette-overlay" onClick={() => setPalette(null)} onContextMenu={(e) => e.preventDefault()} />
            <Palette
              screen={palette.screen}
              items={paletteItems}
              onPick={spawnFromPalette}
              onClose={() => setPalette(null)}
            />
          </>
        ) : null}

        {toast ? <div className="toast">{toast}</div> : null}

        <VariablesPanel
          variables={variables}
          types={types}
          selectedId={sel && (sel.kind === 'variable' || sel.kind === 'struct') ? sel.id : null}
          onSelectVariable={(id) => setSel({ kind: 'variable', id })}
          onSelectStruct={(id) => setSel({ kind: 'struct', id })}
          onAddVariable={addVariable}
          onAddStruct={addStruct}
        />

        {selection ? <DetailsPanel selection={selection} h={handlers} /> : null}
      </div>
    </div>
  );
}

// ── App: studio shell — launcher ↔ editor, fetch-on-demand + live sync ──

export default function App() {
  const [view, setView] = useState<'launcher' | 'editor'>('launcher');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeWf, setActiveWf] = useState<WorkflowSummary | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Suppress the live-sync reload that our own save triggers (the watcher sees
  // the file we just wrote). A timestamp tolerates chokidar's duplicate events.
  const lastSaveRef = useRef(0);

  const projectId = activeProject?.id ?? null;
  const workflowId = activeWf?.id ?? null;

  // Fetch the active diagram whenever the selection (or reload nonce) changes.
  useEffect(() => {
    if (!projectId || !workflowId) {
      setDiagram(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadWorkflow(projectId, workflowId)
      .then((d) => {
        if (!cancelled) setDiagram(migrateDiagram({ ...d, id: workflowId, projectId }));
      })
      .catch(() => {
        if (!cancelled) setDiagram(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workflowId, reloadNonce]);

  // Live sync: refresh when the open workflow changes on disk out-of-band.
  useEffect(() => {
    if (!import.meta.hot) return;
    const handler = (data: { projectId: string; workflowId: string }) => {
      if (data.projectId !== projectId || data.workflowId !== workflowId) return;
      if (Date.now() - lastSaveRef.current < 1500) return; // our own write
      setReloadNonce((n) => n + 1);
    };
    import.meta.hot.on('studio:changed', handler);
    return () => {
      import.meta.hot?.off('studio:changed', handler);
    };
  }, [projectId, workflowId]);

  const openWorkflow = useCallback((project: Project, wf: WorkflowSummary, wfList: WorkflowSummary[]) => {
    setActiveProject(project);
    setActiveWf(wf);
    setWorkflows(wfList);
    setView('editor');
  }, []);

  if (view === 'launcher') {
    return <Launcher onOpen={openWorkflow} />;
  }

  if (!activeProject || !activeWf || loading || !diagram) {
    return <div className="studio-loading">Loading…</div>;
  }

  return (
    <ReactFlowProvider>
      <Canvas
        key={`${activeProject.id}:${activeWf.id}:${reloadNonce}`}
        initial={diagram}
        project={activeProject}
        workflows={workflows}
        markSaving={() => {
          lastSaveRef.current = Date.now();
        }}
        onBack={() => setView('launcher')}
        onSwitch={(wf) => setActiveWf(wf)}
      />
    </ReactFlowProvider>
  );
}
