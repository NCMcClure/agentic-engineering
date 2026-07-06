import { useEffect, useRef, useState } from 'react';
import type { Project, WorkflowSummary } from './types';

/** Compact toolbar control: shows the current Project / Workflow and, on click,
 *  a menu to jump to another workflow in the same project or return to the
 *  launcher. Workflow switching is in-place; the editor reloads the graph. */
export function ProjectSwitcher({
  project,
  workflows,
  currentWorkflowId,
  onBack,
  onSwitch,
}: {
  project: Project;
  workflows: WorkflowSummary[];
  currentWorkflowId: string | null;
  onBack: () => void;
  onSwitch: (wf: WorkflowSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = workflows.find((w) => w.id === currentWorkflowId);

  return (
    <div className="switcher" ref={ref}>
      <button className="switcher__btn" onClick={() => setOpen((o) => !o)} title="Switch workflow">
        <span className="switcher__project">{project.name}</span>
        <span className="switcher__sep">/</span>
        <span className="switcher__workflow">{current?.name ?? '…'}</span>
        <span className="switcher__caret">▾</span>
      </button>
      {open ? (
        <div className="switcher__menu">
          <button
            className="switcher__menu-item switcher__menu-item--back"
            onClick={() => {
              setOpen(false);
              onBack();
            }}
          >
            ← Projects
          </button>
          <div className="switcher__menu-label">{project.name}</div>
          {workflows.map((wf) => (
            <button
              key={wf.id}
              className={`switcher__menu-item${wf.id === currentWorkflowId ? ' switcher__menu-item--active' : ''}`}
              onClick={() => {
                setOpen(false);
                if (wf.id !== currentWorkflowId) onSwitch(wf);
              }}
            >
              {wf.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
