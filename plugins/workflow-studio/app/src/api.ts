import type { Diagram, Project, WorkflowSummary } from './types';

async function request<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(endpoint, init);
  if (!res.ok) throw new Error(`${endpoint} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const get = <T>(endpoint: string): Promise<T> => request<T>(endpoint);

const post = <T>(endpoint: string, body: unknown): Promise<T> =>
  request<T>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ── Projects ────────────────────────────────────────────────────────────

export const listProjects = (): Promise<Project[]> =>
  get<{ projects: Project[] }>('/api/projects').then((r) => r.projects);

export const createProject = (name: string, description?: string): Promise<Project> =>
  post<{ project: Project }>('/api/projects/create', { name, description }).then((r) => r.project);

export const renameProject = (id: string, name: string): Promise<Project> =>
  post<{ project: Project }>('/api/projects/rename', { id, name }).then((r) => r.project);

export const deleteProject = (id: string): Promise<void> =>
  post<{ ok: boolean }>('/api/projects/delete', { id }).then(() => undefined);

// ── Workflows ───────────────────────────────────────────────────────────

export const listWorkflows = (projectId: string): Promise<WorkflowSummary[]> =>
  get<{ workflows: WorkflowSummary[] }>(`/api/workflows?project=${encodeURIComponent(projectId)}`).then(
    (r) => r.workflows,
  );

export const createWorkflow = (projectId: string, name: string): Promise<WorkflowSummary> =>
  post<{ workflow: WorkflowSummary }>('/api/workflows/create', { projectId, name }).then((r) => r.workflow);

export const loadWorkflow = (projectId: string, workflowId: string): Promise<Diagram> =>
  get<{ diagram: Diagram }>(
    `/api/workflows/load?project=${encodeURIComponent(projectId)}&workflow=${encodeURIComponent(workflowId)}`,
  ).then((r) => r.diagram);

/** Persist the full diagram to its workflow folder; returns the written path. */
export const saveWorkflow = (projectId: string, workflowId: string, diagram: Diagram): Promise<string> =>
  post<{ path: string }>('/api/workflows/save', { projectId, workflowId, diagram }).then((r) => r.path);

export const renameWorkflow = (projectId: string, workflowId: string, name: string): Promise<void> =>
  post<{ ok: boolean }>('/api/workflows/rename', { projectId, workflowId, name }).then(() => undefined);

export const deleteWorkflow = (projectId: string, workflowId: string): Promise<void> =>
  post<{ ok: boolean }>('/api/workflows/delete', { projectId, workflowId }).then(() => undefined);

/** Compile result: the studio core copy is always written; exportPath only when set. */
export interface CompileResult {
  corePath: string;
  exportPath?: string;
}

/** Write the compiled workflow to the studio core copy AND, if `exportPath` is
 *  set, to that target. */
export const compileAndExport = (
  projectId: string,
  workflowId: string,
  exportPath: string,
  code: string,
): Promise<CompileResult> =>
  post<{ corePath: string; exportPath?: string }>('/api/compile', { projectId, workflowId, exportPath, code });
