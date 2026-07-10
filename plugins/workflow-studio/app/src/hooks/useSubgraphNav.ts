// Navigation into/out of collapsed-function subgraphs. The parent view is
// snapshotted on a ref stack (enter/exit must not fight React state batching);
// breadcrumb mirrors it for the UI. Exiting writes the edited subgraph back
// into its function node.

import { useCallback, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { fromRFEdge, toRFEdge } from '../edges';
import { normalizeFunction } from '../collapse';
import { isComment, toRFNode } from '../graph/document';
import { nodeOf, type WfNodeData } from '../nodes/BaseNode';
import type { SubGraph } from '../types';

interface Frame {
  fnId: string;
  label: string;
  nodes: Node[];
  edges: Edge[];
}

export function useSubgraphNav({
  nodes,
  edges,
  setNodes,
  setEdges,
  diagramNodesOf,
  onNavigate,
}: {
  nodes: Node[];
  edges: Edge[];
  setNodes: (n: Node[]) => void;
  setEdges: (e: Edge[]) => void;
  diagramNodesOf: (nodes: Node[]) => import('../types').DiagramNode[];
  /** fired on every view change, BEFORE the state swap — reset history etc. */
  onNavigate: (direction: 'enter' | 'exit') => void;
}) {
  const stack = useRef<Frame[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const nested = breadcrumb.length > 0;

  const enter = useCallback(
    (n: Node) => {
      if (isComment(n)) return false;
      const fn = normalizeFunction(nodeOf(n.data));
      if (fn.kind !== 'function' || !fn.subgraph) return false;
      stack.current.push({ fnId: n.id, label: fn.label, nodes, edges });
      setBreadcrumb(stack.current.map((v) => v.label));
      onNavigate('enter');
      setNodes(fn.subgraph.nodes.map(toRFNode));
      setEdges(fn.subgraph.edges.map((e) => toRFEdge(e, fn.subgraph!.nodes)));
      return true;
    },
    [nodes, edges, setNodes, setEdges, onNavigate],
  );

  const exit = useCallback(() => {
    const frame = stack.current.pop();
    if (!frame) return false;
    const subNodes = diagramNodesOf(nodes);
    const subEdges = edges.map(fromRFEdge);
    const parentNodes = frame.nodes.map((n) => {
      if (n.id !== frame.fnId) return n;
      const fn = nodeOf(n.data);
      const sg = (fn.subgraph ?? { boundary: [] }) as SubGraph;
      return { ...n, data: { node: { ...fn, subgraph: { ...sg, nodes: subNodes, edges: subEdges } } } as WfNodeData };
    });
    setBreadcrumb(stack.current.map((v) => v.label));
    onNavigate('exit');
    setNodes(parentNodes);
    setEdges(frame.edges);
    return true;
  }, [nodes, edges, setNodes, setEdges, diagramNodesOf, onNavigate]);

  return { nested, breadcrumb, enter, exit };
}
