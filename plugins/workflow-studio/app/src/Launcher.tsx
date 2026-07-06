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

  // ── project actions ──────────────────────────────────────────────────
  const onNewProject = async () => {
    const name = window.prompt('New project name:')?.trim();
    if (!name) return;
    const p = await createProject(name);
    await refreshProjects();
    setSelectedId(p.id);
  };
  const onRenameProject = async (p: Project) => {
    const name = window.prompt('Rename project:', p.name)?.trim();
    if (!name || name === p.name) return;
    await renameProject(p.id, name);
    await refreshProjects();
  };
  const onDeleteProject = async (p: Project) => {
    if (!window.confirm(`Delete project "${p.name}" and all its workflows? This cannot be undone.`)) return;
    await deleteProject(p.id);
    setSelectedId(null);
    await refreshProjects();
  };

  // ── workflow actions ─────────────────────────────────────────────────
  const onNewWorkflow = async () => {
    if (!selected) return;
    const name = window.prompt('New workflow name:')?.trim();
    if (!name) return;
    const wf = await createWorkflow(selected.id, name);
    await refreshWorkflows(selected.id);
    onOpen(selected, wf, await listWorkflows(selected.id));
  };
  const onRenameWorkflow = async (wf: WorkflowSummary) => {
    if (!selected) return;
    const name = window.prompt('Rename workflow:', wf.name)?.trim();
    if (!name || name === wf.name) return;
    await renameWorkflow(selected.id, wf.id, name);
    await refreshWorkflows(selected.id);
  };
  const onDeleteWorkflow = async (wf: WorkflowSummary) => {
    if (!selected) return;
    if (!window.confirm(`Delete workflow "${wf.name}"? This cannot be undone.`)) return;
    await deleteWorkflow(selected.id, wf.id);
    await refreshWorkflows(selected.id);
  };
  const openWorkflow = async (wf: WorkflowSummary) => {
    if (!selected) return;
    onOpen(selected, wf, workflows);
  };

  return (
    <div className="launcher">
      <header className="launcher__header">
        <h1 className="launcher__brand">Workflow Studio</h1>
      </header>

      {error ? <div className="launcher__error">{error}</div> : null}

      <div className="launcher__body">
        {/* Projects */}
        <section className="launcher__col">
          <div className="launcher__col-head">
            <h2>Projects</h2>
            <button className="btn" onClick={() => void onNewProject()}>
              + New
            </button>
          </div>
          <ul className="launcher__list">
            {projects.length === 0 ? <li className="launcher__empty">No projects yet.</li> : null}
            {projects.map((p) => (
              <li
                key={p.id}
                className={`launcher__item${p.id === selectedId ? ' launcher__item--active' : ''}`}
                onClick={() => setSelectedId(p.id)}
              >
                <div className="launcher__item-main">
                  <span className="launcher__item-name">{p.name}</span>
                  {p.description ? <span className="launcher__item-sub">{p.description}</span> : null}
                </div>
                <div className="launcher__item-actions">
                  <button
                    className="launcher__icon-btn"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRenameProject(p);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="launcher__icon-btn launcher__icon-btn--danger"
                    title="Delete"
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
            <button className="btn" onClick={() => void onNewWorkflow()} disabled={!selected}>
              + New
            </button>
          </div>
          <ul className="launcher__list">
            {!selected ? <li className="launcher__empty">Select a project.</li> : null}
            {selected && workflows.length === 0 ? <li className="launcher__empty">No workflows yet.</li> : null}
            {workflows.map((wf) => (
              <li key={wf.id} className="launcher__item" onDoubleClick={() => void openWorkflow(wf)}>
                <div className="launcher__item-main">
                  <span className="launcher__item-name">{wf.name}</span>
                  {wf.exportPath ? <span className="launcher__item-sub">→ {wf.exportPath}</span> : null}
                </div>
                <div className="launcher__item-actions">
                  <button className="btn" onClick={() => void openWorkflow(wf)}>
                    Open
                  </button>
                  <button
                    className="launcher__icon-btn"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRenameWorkflow(wf);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="launcher__icon-btn launcher__icon-btn--danger"
                    title="Delete"
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
