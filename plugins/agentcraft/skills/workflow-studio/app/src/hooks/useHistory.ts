// Undo/redo as snapshot history over the current view's state. Snapshots hold
// the React state arrays by reference (they're immutable-by-convention), keyed
// by a canonical string for dedup — so a drag that lands back where it started
// costs no entry. History is per-view: Canvas resets it when entering/exiting a
// collapsed function.

import { useCallback, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { StructDef, Variable } from '../types';

const HISTORY_CAP = 100;

export interface HistorySnapshot {
  nodes: Node[];
  edges: Edge[];
  variables: Variable[];
  types: StructDef[];
}

interface HistEntry extends HistorySnapshot {
  key: string;
}

export interface History {
  /** push the current state if it differs from the entry at the cursor */
  commit: (key: string, snapshot: HistorySnapshot) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** drop everything (view change); the next commit seeds the new baseline */
  reset: () => void;
}

export function useHistory({ restore }: { restore: (s: HistorySnapshot) => void }): History {
  const entries = useRef<HistEntry[]>([]);
  const cursor = useRef(-1);
  // Render-facing mirror of can-undo/redo (refs don't trigger re-renders).
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const commit = useCallback((key: string, snapshot: HistorySnapshot) => {
    if (cursor.current >= 0 && entries.current[cursor.current].key === key) return;
    entries.current = entries.current.slice(0, cursor.current + 1);
    entries.current.push({ ...snapshot, key });
    if (entries.current.length > HISTORY_CAP) entries.current.shift();
    cursor.current = entries.current.length - 1;
    bump();
  }, []);

  const undo = useCallback(() => {
    if (cursor.current <= 0) return;
    cursor.current -= 1;
    restore(entries.current[cursor.current]);
    bump();
  }, [restore]);

  const redo = useCallback(() => {
    if (cursor.current >= entries.current.length - 1) return;
    cursor.current += 1;
    restore(entries.current[cursor.current]);
    bump();
  }, [restore]);

  const reset = useCallback(() => {
    entries.current = [];
    cursor.current = -1;
    bump();
  }, []);

  return {
    commit,
    undo,
    redo,
    canUndo: cursor.current > 0,
    canRedo: cursor.current >= 0 && cursor.current < entries.current.length - 1,
    reset,
  };
}
