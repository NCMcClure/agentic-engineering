// Autosave + dirty tracking + external-change (watcher) reconciliation.
//
// The model: every mutation marks the editor dirty and schedules a debounced
// save; the canonical string (stableStringify of the serialized diagram) is the
// single source of truth for "does the editor differ from disk". The same
// string answers "is this watcher event an echo of our own write?" — robust
// against chokidar duplicates and slow disks, unlike a time window.

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveWorkflow } from '../api';
import { stableStringify } from '../codegen';
import type { Diagram } from '../types';

const SAVE_DEBOUNCE_MS = 800;

export interface Persistence {
  /** editor state differs from the last successful save (incl. nested edits) */
  dirty: boolean;
  saving: boolean;
  /** last save failure, cleared by the next success */
  lastError: string | null;
  /** save immediately (flushes the debounce); resolves when done */
  saveNow: (announce?: boolean) => Promise<void>;
  /** true when a freshly-fetched disk diagram is byte-equal to our last write */
  isEcho: (diskDiagram: Diagram) => boolean;
  /** editor state-watch wiring: report a mutation (settled=false mid-drag) */
  noteChange: (settled: boolean) => void;
  /** exiting a nested view folds its edits into the root state */
  clearNestedEdited: () => void;
}

export function usePersistence({
  serialize,
  enabled,
  nested,
  onSaved,
}: {
  /** serialize the CURRENT VIEW; only trusted as the root diagram when !nested */
  serialize: () => Diagram;
  /** false disables disk writes entirely (e.g. missing ids) */
  enabled: boolean;
  /** inside a collapsed function: pause saves + canonical tracking, but keep
   *  counting edits so `dirty` and the unload guard stay honest */
  nested: boolean;
  onSaved?: (announce: boolean) => void;
}): Persistence {
  const [dirtyRoot, setDirtyRoot] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [nestedEdited, setNestedEdited] = useState(false);

  // The canonical string of the last successful save (or the mount baseline).
  const lastSaved = useRef<string | null>(null);
  const serializeRef = useRef(serialize);
  serializeRef.current = serialize;
  const timer = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const nestedRef = useRef(nested);
  nestedRef.current = nested;

  const saveNow = useCallback(
    async (announce = false) => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (!enabledRef.current || nestedRef.current) return;
      const diagram = serializeRef.current();
      if (!diagram.projectId || !diagram.id) return;
      const canonical = stableStringify(diagram);
      if (canonical === lastSaved.current) {
        setDirtyRoot(false);
        return;
      }
      setSaving(true);
      try {
        await saveWorkflow(diagram.projectId, diagram.id, diagram);
        lastSaved.current = canonical;
        setDirtyRoot(false);
        setLastError(null);
        onSaved?.(announce);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [onSaved],
  );

  /** Called by the editor's state-watch effect on every mutation. Skips work
   *  mid-drag (the caller passes `settled: false` per pixel). */
  const noteChange = useCallback(
    (settled: boolean) => {
      if (nestedRef.current) {
        setNestedEdited(true);
        return;
      }
      const canonical = stableStringify(serializeRef.current());
      if (lastSaved.current === null) {
        // First run after mount: the loaded state is the clean baseline.
        lastSaved.current = canonical;
        return;
      }
      if (canonical === lastSaved.current) {
        setDirtyRoot(false);
        return;
      }
      setDirtyRoot(true);
      if (!settled) return;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void saveNow(), SAVE_DEBOUNCE_MS);
    },
    [saveNow],
  );

  /** Exiting the nested view folds sub-edits into the root state, where the
   *  next noteChange picks them up. */
  const clearNestedEdited = useCallback(() => setNestedEdited(false), []);

  const isEcho = useCallback(
    (diskDiagram: Diagram) => stableStringify(diskDiagram) === lastSaved.current,
    [],
  );

  const dirty = dirtyRoot || nestedEdited;

  // Warn before closing the tab with unsaved or in-flight work.
  useEffect(() => {
    if (!dirty && !saving) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, saving]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return { dirty, saving, lastError, saveNow, isEcho, noteChange, clearNestedEdited };
}
