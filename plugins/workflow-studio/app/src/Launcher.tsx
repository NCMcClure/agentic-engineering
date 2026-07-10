import { useCallback, useEffect, useState } from 'react';
import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  listWorkflows,
  createWorkflow,
  renameWorkflow,
  deleteWorkflow,
} from './api';
import type { Project, WorkflowSummary } from './types';

type EditTarget = { kind: 'project' | 'workflow'; id: string; value: string };
type CreateTarget = { kind: 'project' | 'workflow'; value: string };

/** Inline name field used for both rename-in-place and create-new rows.
 *  Enter commits, Escape cancels, blur commits (matching editor conventions). */
function NameInput({
  value,
  placeholder,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      className="input launcher__name-input"
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit();
        else if (e.key === 'Escape') onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** The studio home screen: browse/create projects (left) and the selected
 *  project's workflows (right). Opening a workflow hands control to the editor. */
export function Launcher({
  onOpen,
}: {
  onOpen: (project: Project, wf: WorkflowSummary, workflows: WorkflowSummary[]) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [creating, setCreating] = useState<CreateTarget | null>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const refreshProjects = useCallback(async () => {
    try {
      const ps = await listProjects();
      setProjects(ps);
      setSelectedId((cur) => cur ?? ps[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshWorkflows = useCallback(async (pid: string) => {
    try {
      setWorkflows(await listWorkflows(pid));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (selectedId) void refreshWorkflows(selectedId);
    else setWorkflows([]);
  }, [selectedId, refreshWorkflows]);

  // Every mutation reports failure into the error banner instead of vanishing
  // into an unhandled rejection.
  const guarded = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const commitCreate = () =>
    guarded(async () => {
      const c = creating;
      setCreating(null);
      const name = c?.value.trim();
      if (!c || !name) return;
      if (c.kind === 'project') {
        const p = await createProject(name);
        await refreshProjects();
        setSelectedId(p.id);
      } else {
        if (!selected) return;
        const wf = await createWorkflow(selected.id, name);
        await refreshWorkflows(selected.id);
        onOpen(selected, wf, await listWorkflows(selected.id));
      }
    });

  const commitRename = () =>
    guarded(async () => {
      const e = editing;
      setEditing(null);
      const name = e?.value.trim();
      if (!e || !name) return;
      if (e.kind === 'project') {
        const p = projects.find((x) => x.id === e.id);
        if (!p || p.name === name) return;
        await renameProject(e.id, name);
        await refreshProjects();
      } else {
        if (!selected) return;
        const wf = workflows.find((x) => x.id === e.id);
        if (!wf || wf.name === name) return;
        await renameWorkflow(selected.id, e.id, name);
        await refreshWorkflows(selected.id);
      }
    });

  const onDeleteProject = (p: Project) =>
    guarded(async () => {
      if (!window.confirm(`Delete project "${p.name}" and all its workflows? This cannot be undone.`)) return;
      await deleteProject(p.id);
      setSelectedId(null);
      await refreshProjects();
    });

  const onDeleteWorkflow = (wf: WorkflowSummary) =>
    guarded(async () => {
      if (!selected) return;
      if (!window.confirm(`Delete workflow "${wf.name}"? This cannot be undone.`)) return;
      await deleteWorkflow(selected.id, wf.id);
      await refreshWorkflows(selected.id);
    });

  const openWorkflow = (wf: WorkflowSummary) => {
    if (selected) onOpen(selected, wf, workflows);
  };

  const rowKey = (activate: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };

  return (
    <div className="launcher">
      <header className="launcher__header">
        <h1 className="launcher__brand">Workflow Studio</h1>
      </header>

      {error ? (
        <div className="launcher__error" role="alert">
          {error}
          <button className="launcher__icon-btn" title="Dismiss" aria-label="Dismiss error" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      ) : null}

      <div className="launcher__body">
        {/* Projects */}
        <section className="launcher__col">
          <div className="launcher__col-head">
            <h2>Projects</h2>
            <button className="btn" onClick={() => setCreating({ kind: 'project', value: '' })}>
              + New
            </button>
          </div>
          <ul className="launcher__list">
            {creating?.kind === 'project' ? (
              <li className="launcher__item">
                <NameInput
                  value={creating.value}
                  placeholder="New project name"
                  onChange={(v) => setCreating({ kind: 'project', value: v })}
                  onCommit={() => void commitCreate()}
                  onCancel={() => setCreating(null)}
                />
              </li>
            ) : null}
            {projects.length === 0 && !creating ? <li className="launcher__empty">No projects yet.</li> : null}
            {projects.map((p) => (
              <li
                key={p.id}
                className={`launcher__item${p.id === selectedId ? ' launcher__item--active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`Select project ${p.name}`}
                onClick={() => setSelectedId(p.id)}
                onKeyDown={rowKey(() => setSelectedId(p.id))}
              >
                <div className="launcher__item-main">
                  {editing?.kind === 'project' && editing.id === p.id ? (
                    <NameInput
                      value={editing.value}
                      placeholder="Project name"
                      onChange={(v) => setEditing({ ...editing, value: v })}
                      onCommit={() => void commitRename()}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <span className="launcher__item-name">{p.name}</span>
                  )}
                  {p.description ? <span className="launcher__item-sub">{p.description}</span> : null}
                </div>
                <div className="launcher__item-actions">
                  <button
                    className="launcher__icon-btn"
                    title="Rename"
                    aria-label={`Rename project ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ kind: 'project', id: p.id, value: p.name });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="launcher__icon-btn launcher__icon-btn--danger"
                    title="Delete"
                    aria-label={`Delete project ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDeleteProject(p);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Workflows */}
        <section className="launcher__col">
          <div className="launcher__col-head">
            <h2>{selected ? `Workflows · ${selected.name}` : 'Workflows'}</h2>
            <button className="btn" onClick={() => setCreating({ kind: 'workflow', value: '' })} disabled={!selected}>
              + New
            </button>
          </div>
          <ul className="launcher__list">
            {creating?.kind === 'workflow' ? (
              <li className="launcher__item">
                <NameInput
                  value={creating.value}
                  placeholder="New workflow name"
                  onChange={(v) => setCreating({ kind: 'workflow', value: v })}
                  onCommit={() => void commitCreate()}
                  onCancel={() => setCreating(null)}
                />
              </li>
            ) : null}
            {!selected ? <li className="launcher__empty">Select a project.</li> : null}
            {selected && workflows.length === 0 && !creating ? <li className="launcher__empty">No workflows yet.</li> : null}
            {workflows.map((wf) => (
              <li
                key={wf.id}
                className="launcher__item"
                role="button"
                tabIndex={0}
                aria-label={`Open workflow ${wf.name}`}
                onDoubleClick={() => openWorkflow(wf)}
                onKeyDown={rowKey(() => openWorkflow(wf))}
              >
                <div className="launcher__item-main">
                  {editing?.kind === 'workflow' && editing.id === wf.id ? (
                    <NameInput
                      value={editing.value}
                      placeholder="Workflow name"
                      onChange={(v) => setEditing({ ...editing, value: v })}
                      onCommit={() => void commitRename()}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <span className="launcher__item-name">{wf.name}</span>
                  )}
                  {wf.exportPath ? <span className="launcher__item-sub">→ {wf.exportPath}</span> : null}
                </div>
                <div className="launcher__item-actions">
                  <button className="btn" onClick={() => openWorkflow(wf)}>
                    Open
                  </button>
                  <button
                    className="launcher__icon-btn"
                    title="Rename"
                    aria-label={`Rename workflow ${wf.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ kind: 'workflow', id: wf.id, value: wf.name });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="launcher__icon-btn launcher__icon-btn--danger"
                    title="Delete"
                    aria-label={`Delete workflow ${wf.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDeleteWorkflow(wf);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
