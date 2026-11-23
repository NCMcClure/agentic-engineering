// Selection with React Flow as the single source for canvas elements: the
// onSelectionChange handler here is referentially stable and bails out when
// nothing changed (RF's SelectionListener re-fires on handler identity, so an
// unstable always-setting handler loops the render). `sel` is the details-
// panel focus — derived from the canvas selection when exactly one item is
// selected, panel-driven for variables/structs.

import { useCallback, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { isComment } from '../graph/document';
import type { Selection } from '../DetailsPanel';

export interface RfSelection {
  nodes: string[]; // non-comment node ids (Group/Collapse operate on these)
  comments: string[];
  edges: string[];
}

const EMPTY: RfSelection = { nodes: [], comments: [], edges: [] };

export function useSelection() {
  const [sel, setSel] = useState<{ kind: Selection['kind']; id: string } | null>(null);
  const [rfSelection, setRfSelection] = useState<RfSelection>(EMPTY);

  const onSelectionChange = useCallback(({ nodes: selNodes, edges: selEdges }: { nodes: Node[]; edges: Edge[] }) => {
    const comments = selNodes.filter(isComment).map((n) => n.id);
    const plain = selNodes.filter((n) => !isComment(n)).map((n) => n.id);
    const edgeIds = selEdges.map((e) => e.id);
    setRfSelection((cur) =>
      cur.nodes.join('\n') === plain.join('\n') &&
      cur.comments.join('\n') === comments.join('\n') &&
      cur.edges.join('\n') === edgeIds.join('\n')
        ? cur
        : { nodes: plain, comments, edges: edgeIds },
    );
    const total = plain.length + comments.length + edgeIds.length;
    if (total === 1) {
      const next = plain.length
        ? { kind: 'node' as const, id: plain[0] }
        : comments.length
          ? { kind: 'comment' as const, id: comments[0] }
          : { kind: 'edge' as const, id: edgeIds[0] };
      setSel((cur) => (cur && cur.kind === next.kind && cur.id === next.id ? cur : next));
    } else {
      // multi or none: close the panel, but never clobber a panel-driven
      // variable/struct selection (those aren't canvas elements)
      setSel((cur) => (cur === null || cur.kind === 'variable' || cur.kind === 'struct' ? cur : null));
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSel(null);
    setRfSelection(EMPTY);
  }, []);

  const hasCanvasSelection =
    rfSelection.nodes.length > 0 ||
    rfSelection.comments.length > 0 ||
    rfSelection.edges.length > 0 ||
    (sel !== null && (sel.kind === 'node' || sel.kind === 'comment' || sel.kind === 'edge'));

  return { sel, setSel, rfSelection, setRfSelection, onSelectionChange, clearSelection, hasCanvasSelection };
}
