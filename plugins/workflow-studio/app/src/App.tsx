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
import { DiagnosticsContext, type NodeSeverity } from './diagnostics';
import { layout } from './layout';
import { compileWorkflow, publishWorkflow, loadWorkflow } from './api';
import { compileChecked, stableStringify } from './codegen';
import { migrateDiagram } from './migrate';
import { usePersistence } from './hooks/usePersistence';
import { useHistory, type HistorySnapshot } from './hooks/useHistory';
import { useSelection } from './hooks/useSelection';
import { useSubgraphNav } from './hooks/useSubgraphNav';
import {
  applyShifts,
  buildEdge,
  clonePayload,
  commentDragShifts,
  copySelection,
  isComment,
  makeNode,
  pruneDanglingEdges,
  removeElements,
  shortId,
  toRFNode,
  type ClipboardPayload,
} from './graph/document';
import { filterCompatible, firstCompatPin, paletteCatalog, probeFor, type DragOrigin } from './palette-logic';
import { Palette } from './Palette';
import { DetailsPanel, type DetailsHandlers, type Selection } from './DetailsPanel';
import { VariablesPanel } from './VariablesPanel';
import { Launcher } from './Launcher';
import { ProjectSwitcher } from './ProjectSwitcher';
import { catalogList, pinsOf } from './catalog';
import { canConnect, edgeRoleOf, fromRFEdge, toRFEdge } from './edges';
import { groupFromSelection } from './groups';
import { collapseToFunction } from './collapse';
import { makeVariable } from './variables';
import {
  SCHEMA_VERSION,
  type Diagnostic,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Group,
  type Project,
  type StructDef,
  type Variable,
  type WorkflowSummary,
} from './types';

// ── Diagram <-> React Flow mappers ──────────────────────────────────────

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

const diagramNodesOf = (nodes: Node[]): DiagramNode[] => nodes.filter((n) => !isComment(n)).map((n) => nodeOf(n.data));

function clientXY(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY };
  const t = event.changedTouches[0];
  return { x: t.clientX, y: t.clientY };
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
  onExternalReload,
  onBack,
  onSwitch,
}: {
  initial: Diagram;
  project: Project;
  workflows: WorkflowSummary[];
  /** discard editor state and reload the diagram from disk (App remounts us) */
  onExternalReload: () => void;
  onBack: () => void;
  onSwitch: (wf: WorkflowSummary) => void;
}) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([
    ...groupsToRF(initial.groups),
    ...initial.nodes.map(toRFNode),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initial.edges.map((e) => toRFEdge(e, initial.nodes)),
  );
  // Live mirror of `nodes` so hot callbacks handed to React Flow can read the
  // current graph without re-identifying on every node change.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const { sel, setSel, rfSelection, setRfSelection, onSelectionChange, clearSelection, hasCanvasSelection } =
    useSelection();
  const selectedNodeId = sel?.kind === 'node' ? sel.id : null;
  const selectedIds = rfSelection.nodes; // non-comment node ids (Group/Collapse)
  const [conflict, setConflict] = useState(false);
  const [variables, setVariables] = useState<Variable[]>(initial.variables);
  const [types, setTypes] = useState<StructDef[]>(initial.types);
  const [exportPath, setExportPath] = useState<string>(initial.exportPath ?? '');
  const [addKind, setAddKind] = useState<string>('agent');
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const clipboard = useRef<ClipboardPayload | null>(null);

  // Subgraph navigation (collapsed functions). onNavigate resets per-view
  // history and edit tracking; it's bound via ref because history/persistence
  // are declared below.
  const onNavigateRef = useRef<(direction: 'enter' | 'exit') => void>(() => {});
  const onNavigate = useCallback((d: 'enter' | 'exit') => onNavigateRef.current(d), []);
  const {
    nested,
    breadcrumb,
    enter: enterFunction,
    exit: exitFunction,
  } = useSubgraphNav({ nodes, edges, setNodes, setEdges, diagramNodesOf, onNavigate });

  const commentPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  // A pin drag that ends on empty pane opens the palette via onConnectEnd, but the
  // browser then fires a pane `click` that would close it. This one-shot guard
  // lets the palette survive that trailing click.
  const suppressPaneClick = useRef(false);
  // True while a node/frame drag is in flight — the state-watch effect skips
  // scheduling saves per pixel and fires once on the settled position.
  const dragging = useRef(false);
  // Entering/exiting a subgraph rewrites nodes/edges without user edits; skip
  // that one state-watch tick so it isn't miscounted as a nested edit.
  const skipNextChange = useRef(false);

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
  // Identity is stable while the membership is unchanged, so the context
  // doesn't re-render every pin on edge-array churn that didn't rewire anything.
  const connectedRef = useRef<Set<string>>(new Set());
  const connected = useMemo(() => {
    const s = new Set<string>();
    edges.forEach((e) => {
      if (e.sourceHandle) s.add(`${e.source}:${e.sourceHandle}`);
      if (e.targetHandle) s.add(`${e.target}:${e.targetHandle}`);
    });
    const prev = connectedRef.current;
    if (prev.size === s.size && [...s].every((k) => prev.has(k))) return prev;
    connectedRef.current = s;
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

  const persistence = usePersistence({
    serialize,
    enabled: Boolean(initial.projectId && initial.id),
    nested,
    onSaved: (announce) => {
      if (announce) showToast('Saved');
    },
  });

  const restoreSnapshot = useCallback(
    (s: HistorySnapshot) => {
      setNodes(s.nodes);
      setEdges(s.edges);
      setVariables(s.variables);
      setTypes(s.types);
      clearSelection();
    },
    [setNodes, setEdges, clearSelection],
  );
  const history = useHistory({ restore: restoreSnapshot });

  // Coalesce history commits so DetailsPanel typing lands as one entry; flushed
  // before undo/redo so a quick Ctrl+Z never skips the freshest state.
  const pendingCommit = useRef<{ key: string; snap: HistorySnapshot } | null>(null);
  const commitTimer = useRef<number | null>(null);
  const flushHistory = useCallback(() => {
    if (commitTimer.current) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    if (pendingCommit.current) {
      history.commit(pendingCommit.current.key, pendingCommit.current.snap);
      pendingCommit.current = null;
    }
  }, [history]);

  // The single state-watch seam: every mutation of the graph state flows
  // through here — dirty tracking + debounced autosave (usePersistence) and
  // history commits. Mid-drag ticks don't schedule; a subgraph-nav tick seeds
  // the new view's history baseline but never counts as an edit. Structural
  // changes (node/edge count) commit immediately so each add/delete/paste is
  // its own undo step; in-place edits (typing) coalesce on the debounce.
  const histSeeded = useRef(false);
  const prevShape = useRef({ n: 0, e: 0 });
  useEffect(() => {
    const navTick = skipNextChange.current;
    skipNextChange.current = false;
    const settled = !dragging.current;
    if (!navTick) persistence.noteChange(settled);
    const structural = prevShape.current.n !== nodes.length || prevShape.current.e !== edges.length;
    prevShape.current = { n: nodes.length, e: edges.length };
    if (!settled) return;
    const snap: HistorySnapshot = { nodes, edges, variables, types };
    const key = stableStringify(serialize());
    if (!histSeeded.current) {
      histSeeded.current = true;
      history.commit(key, snap); // view baseline: the floor undo returns to
      return;
    }
    if (navTick) return;
    if (structural) {
      flushHistory(); // seal whatever preceded this as its own step
      history.commit(key, snap);
      return;
    }
    pendingCommit.current = { key, snap };
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(flushHistory, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, variables, types, exportPath]);

  // Bind subgraph-nav side effects now that history/persistence exist: history
  // is per-view; entering is a view swap (not an edit), exiting folds sub-edits
  // into the root state where the next state-watch tick autosaves them.
  onNavigateRef.current = (direction) => {
    if (direction === 'enter') skipNextChange.current = true;
    else persistence.clearNestedEdited();
    history.reset();
    histSeeded.current = false;
    pendingCommit.current = null;
    setSel(null);
    window.requestAnimationFrame(() => fitView({ duration: 300 }));
  };

  // Live sync: when this workflow's diagram.json changes on disk, fetch it and
  // compare canonically — our own write is ignored (echo), a clean editor
  // reloads, a dirty editor gets an explicit conflict choice.
  useEffect(() => {
    if (!import.meta.hot) return;
    const handler = async (data: { projectId: string; workflowId: string }) => {
      if (data.projectId !== initial.projectId || data.workflowId !== initial.id) return;
      try {
        const disk = await loadWorkflow(initial.projectId!, initial.id!);
        if (persistence.isEcho(disk)) return;
      } catch {
        // unreadable/deleted on disk — fall through to the explicit paths below
      }
      if (persistence.dirty || persistence.saving) setConflict(true);
      else onExternalReload();
    };
    import.meta.hot.on('studio:changed', handler);
    return () => {
      import.meta.hot?.off('studio:changed', handler);
    };
  }, [initial.projectId, initial.id, persistence, onExternalReload]);

  // Compile the graph to its runnable workflow .js (exec wires → order, data
  // wires → bindings). Writes ONLY the studio's core copy — nothing outside the
  // studio root changes until Publish. Only from the root.
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  const compileCore = useCallback(async (): Promise<string | null> => {
    if (nested) return null;
    const diagram = serialize();
    if (!diagram.projectId || !diagram.id) return null;
    const { code, diagnostics: diags } = compileChecked(diagram);
    setDiagnostics(diags);
    const errors = diags.filter((d) => d.severity === 'error').length;
    if (errors) {
      showToast(`Compile blocked: ${errors} error${errors > 1 ? 's' : ''} — see diagnostics`);
      return null;
    }
    // Persist the diagram first so the saved graph matches the output.
    await persistence.saveNow();
    return compileWorkflow(diagram.projectId, diagram.id, code);
  }, [nested, serialize, persistence, showToast]);

  const compileOnly = useCallback(async () => {
    try {
      const corePath = await compileCore();
      if (corePath) showToast(`Compiled → ${corePath}`);
    } catch (err) {
      showToast(`Compile failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [compileCore, showToast]);

  // Node badge map: worst severity per node, for the canvas overlay.
  const nodeDiagMap = useMemo(() => {
    const m = new Map<string, NodeSeverity>();
    for (const d of diagnostics) {
      for (const id of d.nodeIds) {
        if (d.severity === 'error' || !m.has(id)) m.set(id, d.severity);
      }
    }
    return m;
  }, [diagnostics]);

  const focusDiagnostic = useCallback(
    (d: Diagnostic) => {
      const id = d.nodeIds.find((nid) => nodesRef.current.some((n) => n.id === nid));
      if (!id) return; // not in this view (e.g. inside a collapsed function)
      // Drive the selection through React Flow so onSelectionChange (the single
      // selection source) opens the panel and keeps everything consistent.
      setNodes((nds) => nds.map((n) => (n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n)));
      fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.2 });
    },
    [setNodes, fitView],
  );

  // Publish = save + compile + promote to the export target, so the published
  // file can never be stale. The server confines the target to the project dir.
  const publish = useCallback(async () => {
    if (nested) return;
    const target = exportPath.trim();
    if (!target) {
      showToast('Set an export path first (e.g. .claude/workflows/my-workflow.js)');
      return;
    }
    if (!window.confirm(`Publish the compiled workflow to ${target}?`)) return;
    const diagram = serialize();
    if (!diagram.projectId || !diagram.id) return;
    try {
      const core = await compileCore();
      if (!core) return; // compile errors block publish (toast already shown)
      const written = await publishWorkflow(diagram.projectId, diagram.id, target);
      showToast(`Published → ${written}`);
    } catch (err) {
      showToast(`Publish failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [nested, exportPath, serialize, compileCore, showToast]);

  // Track drag state for the state-watch effect (save on settle, not per pixel).
  // Dragging a comment frame translates its member nodes with it. Stable: reads
  // the graph through nodesRef so React Flow keeps one handler identity.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position') dragging.current = c.dragging === true;
      }
      onNodesChange(changes);
      const shifts = commentDragShifts(nodesRef.current, changes, commentPos.current);
      if (shifts.length) setNodes((nds) => applyShifts(nds, shifts));
    },
    [onNodesChange, setNodes],
  );

  const isValid = useCallback((c: Connection | Edge) => canConnect(c, diagramNodesOf(nodesRef.current)), []);

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
        return kept.concat(
          buildEdge(
            {
              source: c.source as string,
              sourceHandle: c.sourceHandle as string,
              target: c.target as string,
              targetHandle: c.targetHandle as string,
            },
            role,
            dataType,
          ),
        );
      });
    },
    [setEdges],
  );

  const onConnect = useCallback((c: Connection) => addConnection(c, diagramNodesOf(nodesRef.current)), [addConnection]);

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
      const fromNode = diagramNodesOf(nodesRef.current).find((n) => n.id === conn.fromHandle!.nodeId);
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
    [screenToFlowPosition],
  );

  // The finder list (catalog + Get/Set per variable), narrowed to compatible
  // items when opened by a drag off a pin. Logic lives in palette-logic.ts.
  const paletteAll = useMemo(() => paletteCatalog(variables), [variables]);
  const paletteItems = useMemo(
    () => filterCompatible(paletteAll, variables, palette?.origin),
    [paletteAll, variables, palette],
  );

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
        node.data = { ...probeFor(action, variables).data };
        node.label = (action.type === 'getVar' ? 'Get ' : 'Set ') + v.name;
      }
      const spawned = node;
      setNodes((nds) => nds.concat(toRFNode(spawned)));
      if (palette.origin) {
        const pinId = firstCompatPin(spawned, palette.origin);
        if (pinId) {
          const o = palette.origin;
          const c: Connection = o.from === 'source'
            ? { source: o.node, sourceHandle: o.pin, target: spawned.id, targetHandle: pinId }
            : { source: spawned.id, sourceHandle: pinId, target: o.node, targetHandle: o.pin };
          addConnection(c, [...diagramNodesOf(nodesRef.current), spawned]);
        }
      }
      setSel({ kind: 'node', id: spawned.id });
      setPalette(null);
    },
    [palette, paletteAll, variables, setNodes, setSel, addConnection],
  );

  // Toolbar Add drops the node at the viewport centre (with a small stagger so
  // repeated adds don't stack), not at a fixed corner offset.
  const addNode = useCallback(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap?.getBoundingClientRect();
    const centre = r
      ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      : { x: 80, y: 80 };
    const stagger = (nodesRef.current.length % 5) * 24;
    const node = makeNode(addKind, { x: centre.x + stagger, y: centre.y + stagger });
    setNodes((nds) => nds.concat(toRFNode(node)));
    setSel({ kind: 'node', id: node.id });
  }, [addKind, setNodes, setSel, screenToFlowPosition]);

  // Delete everything selected on the canvas (multi-select aware): edges,
  // nodes + their incident edges, comment frames (clearing membership). Falls
  // back to the panel focus; variables/structs delete from their panel only.
  const deleteSelected = useCallback(() => {
    const nodeIds = new Set([...rfSelection.nodes, ...rfSelection.comments]);
    const edgeIds = new Set(rfSelection.edges);
    if (!nodeIds.size && !edgeIds.size && sel) {
      if (sel.kind === 'node' || sel.kind === 'comment') nodeIds.add(sel.id);
      else if (sel.kind === 'edge') edgeIds.add(sel.id);
    }
    if (!nodeIds.size && !edgeIds.size) return;
    const kept = removeElements(nodesRef.current, edges, nodeIds, edgeIds);
    setNodes(kept.nodes);
    setEdges(kept.edges);
    clearSelection();
  }, [rfSelection, sel, edges, setNodes, setEdges, clearSelection]);

  // In-app clipboard: copy the selected nodes + their internal wires; paste
  // clones them (fresh ids, offset, selected). Duplicate = copy + paste.
  // Selection is read from the live nodes array (`n.selected`), not rfSelection
  // state — a fast click→Ctrl+C would otherwise race the selection listener.
  const copyableIds = useCallback(() => {
    const ids = new Set(rfSelection.nodes);
    for (const n of nodesRef.current) if (n.selected && !isComment(n)) ids.add(n.id);
    if (!ids.size && sel?.kind === 'node') ids.add(sel.id);
    return [...ids];
  }, [rfSelection.nodes, sel]);
  const copySel = useCallback(() => {
    const payload = copySelection(nodesRef.current, edges, copyableIds());
    if (payload) {
      clipboard.current = payload;
      showToast(`Copied ${payload.nodes.length} node${payload.nodes.length > 1 ? 's' : ''}`);
    }
  }, [edges, copyableIds, showToast]);
  const paste = useCallback(() => {
    if (!clipboard.current) return;
    const { nodes: cloned, edges: clonedEdges } = clonePayload(clipboard.current, { x: 48, y: 48 });
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)).concat(cloned));
    setEdges((eds) => eds.concat(clonedEdges));
  }, [setNodes, setEdges]);
  const duplicateSel = useCallback(() => {
    const payload = copySelection(nodesRef.current, edges, copyableIds());
    if (!payload) return;
    clipboard.current = payload;
    paste();
  }, [edges, copyableIds, paste]);

  // Flush the pending (debounced) commit first so a quick Ctrl+Z after an edit
  // undoes that edit, not the one before it.
  const undoAction = useCallback(() => {
    flushHistory();
    history.undo();
  }, [flushHistory, history]);
  const redoAction = useCallback(() => {
    flushHistory();
    history.redo();
  }, [flushHistory, history]);

  // Editor keyboard shortcuts. React Flow's native Backspace delete is disabled
  // (deleteKeyCode={null}) so deletion has exactly one path: deleteSelected.
  useEffect(() => {
    const isEditable = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoAction();
      } else if (mod && e.key.toLowerCase() === 'c') {
        copySel();
      } else if (mod && e.key.toLowerCase() === 'v') {
        paste();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSel();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoAction, redoAction, deleteSelected, copySel, paste, duplicateSel]);

  const autoArrange = useCallback(() => {
    setNodes((nds) => layout(nds, edges));
    window.requestAnimationFrame(() => fitView({ duration: 300 }));
  }, [edges, setNodes, fitView]);

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
  }, [nodes, selectedIds, setNodes]);

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
    setRfSelection({ nodes: [res.fn.id], comments: [], edges: [] });
  }, [nodes, edges, selectedIds, setNodes, setEdges]);

  // Apply an arbitrary update to the selected node's DiagramNode, then prune
  // edges whose pins no longer exist (kind change, variadic count lowered,
  // function I/O pin removed) so no dangling wires survive.
  const mutateSelected = useCallback(
    (fn: (node: DiagramNode) => DiagramNode) => {
      if (!selectedNodeId) return;
      const cur = nodesRef.current.find((n) => n.id === selectedNodeId && !isComment(n));
      if (!cur) return;
      const next = fn(nodeOf(cur.data));
      setNodes((nds) =>
        nds.map((n) => (n.id === selectedNodeId && !isComment(n) ? { ...n, type: next.kind, data: { node: next } as WfNodeData } : n)),
      );
      setEdges((eds) => pruneDanglingEdges(selectedNodeId, next, eds));
    },
    [selectedNodeId, setNodes, setEdges],
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
      onSave: () => void persistence.saveNow(true),
    }),
    [types, connected, patchSelected, patchData, patchPinDefault, patchVariable, deleteVariable, patchStruct, deleteStruct, patchEdge, patchComment, persistence],
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
        <button className="btn" onClick={undoAction} disabled={!history.canUndo} title="Undo (Ctrl+Z)">
          ↩ Undo
        </button>
        <button className="btn" onClick={redoAction} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z / Ctrl+Y)">
          ↪ Redo
        </button>
        <button
          className="btn btn--danger"
          onClick={deleteSelected}
          disabled={!hasCanvasSelection}
          title="Delete selection (Del / Backspace)"
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
        <label className="export-field" title="Publish target, relative to the project dir (must stay inside it)">
          <span className="export-field__label">Publish →</span>
          <input
            className="input export-field__input"
            type="text"
            value={exportPath}
            placeholder={`.claude/workflows/${initial.workflow.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow'}.js`}
            onChange={(e) => setExportPath(e.target.value)}
            disabled={nested}
          />
        </label>
        <button
          className="btn"
          onClick={() => void compileOnly()}
          disabled={nested}
          title="Compile to the studio's internal copy — writes nothing outside the studio root"
        >
          Compile
        </button>
        <button
          className="btn"
          onClick={() => void publish()}
          disabled={nested}
          title="Save, compile, and write the result to the publish path (confined to the project dir)"
        >
          Publish ↑
        </button>
        <button className="btn btn--accent" onClick={() => void persistence.saveNow(true)} disabled={nested}>
          Save
        </button>
        {persistence.lastError ? (
          <button
            className="save-status save-status--error"
            onClick={() => void persistence.saveNow()}
            title={`${persistence.lastError} — click to retry`}
          >
            ⚠ Save failed — retry
          </button>
        ) : (
          <span
            className={`save-status${persistence.dirty || persistence.saving ? ' save-status--dirty' : ''}`}
            title={persistence.saving ? 'Writing to disk…' : persistence.dirty ? 'Unsaved changes (autosaves shortly)' : 'All changes saved'}
          >
            {persistence.saving ? 'Saving…' : persistence.dirty ? '● Unsaved' : '✓ Saved'}
          </span>
        )}
      </header>

      <div className="canvas-wrap">
        <ConnectedContext.Provider value={connected}>
        <DiagnosticsContext.Provider value={nodeDiagMap}>
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
          deleteKeyCode={null}
          onNodeDoubleClick={(_, n) => enterFunction(n)}
          onSelectionChange={onSelectionChange}
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
        </DiagnosticsContext.Provider>
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

        {!nested && nodes.filter((n) => !isComment(n)).length <= 1 ? (
          <div className="canvas-hint">
            Right-click the canvas to add a node · drag off a pin to spawn a compatible one, auto-wired
          </div>
        ) : null}

        {diagnostics.length ? (
          <div className="diag-panel">
            <div className="diag-panel__head">
              <span>Compile diagnostics</span>
              <button className="icon-btn" title="Dismiss" onClick={() => setDiagnostics([])}>
                ✕
              </button>
            </div>
            <div className="diag-panel__list">
              {diagnostics.map((d, i) => (
                <button key={i} className={`diag-item diag-item--${d.severity}`} onClick={() => focusDiagnostic(d)}>
                  <span className="diag-item__sev">{d.severity === 'error' ? '⛔' : '⚠'}</span>
                  <span className="diag-item__msg">{d.message}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {conflict ? (
          <div className="conflict-bar">
            <span className="conflict-bar__msg">
              This workflow changed on disk while you have unsaved edits.
            </span>
            <button
              className="btn"
              onClick={() => {
                setConflict(false);
                onExternalReload(); // discard editor state, reload from disk
              }}
            >
              Reload (discard my edits)
            </button>
            <button
              className="btn btn--accent"
              onClick={() => {
                setConflict(false);
                void persistence.saveNow(); // our state overwrites the disk
              }}
            >
              Keep mine
            </button>
          </div>
        ) : null}

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

  // Live sync (echo detection, conflict handling) lives in Canvas, which owns
  // the dirty state; it calls onExternalReload to remount from disk.
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
        onExternalReload={() => setReloadNonce((n) => n + 1)}
        onBack={() => setView('launcher')}
        onSwitch={(wf) => setActiveWf(wf)}
      />
    </ReactFlowProvider>
  );
}
