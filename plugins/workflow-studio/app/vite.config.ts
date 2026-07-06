import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import {
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Vite config is ESM here ("type":"module"), so __dirname must be reconstructed.
const here = dirname(fileURLToPath(import.meta.url));

/**
 * The studio backend. Projects and workflows are folders on disk under the
 * studio root; directory listing is the source of truth (no central index).
 *
 *   <studioRoot>/<project-id>/project.json
 *   <studioRoot>/<project-id>/workflows/<workflow-id>/diagram.json   (the graph)
 *   <studioRoot>/<project-id>/workflows/<workflow-id>/compiled.js    (core copy)
 *
 * The browser drives all CRUD through the /api/* endpoints below; a file watcher
 * pushes `studio:changed` over Vite's websocket so the open workflow live-syncs
 * with out-of-band edits (e.g. an agent rewriting diagram.json).
 */

const studioRoot = process.env.STUDIO_ROOT
  ? resolve(process.env.STUDIO_ROOT)
  : resolve(here, 'studio');

const ID_RE = /^[a-zA-Z0-9_-]+$/;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolveBody(body));
  });
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

/** Guard every client-supplied id before it touches a path (no traversal). */
function safeId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`invalid id: ${String(id)}`);
  return id;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

let idCounter = 0;
/** A filesystem-safe, reasonably-unique id derived from a human name. */
function genId(name: string): string {
  // Date.now is fine here (Node server, not a workflow script).
  const rand = (Date.now().toString(36) + (idCounter++).toString(36)).slice(-6);
  return `${slugify(name)}-${rand}`;
}

const nowIso = () => new Date().toISOString();

const projectDir = (pid: string) => join(studioRoot, safeId(pid));
const projectMeta = (pid: string) => join(projectDir(pid), 'project.json');
const workflowsDir = (pid: string) => join(projectDir(pid), 'workflows');
const workflowDir = (pid: string, wid: string) => join(workflowsDir(pid), safeId(wid));
const diagramPath = (pid: string, wid: string) => join(workflowDir(pid, wid), 'diagram.json');
const compiledPath = (pid: string, wid: string) => join(workflowDir(pid, wid), 'compiled.js');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
function writeJson(path: string, obj: unknown): void {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

function listProjects(): ProjectMeta[] {
  if (!existsSync(studioRoot)) return [];
  const out: ProjectMeta[] = [];
  for (const entry of readdirSync(studioRoot)) {
    const meta = join(studioRoot, entry, 'project.json');
    if (!existsSync(meta)) continue;
    try {
      out.push(readJson<ProjectMeta>(meta));
    } catch {
      /* skip unreadable project */
    }
  }
  return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function listWorkflows(pid: string): Array<{ id: string; name: string; exportPath: string; updatedAt?: string }> {
  const dir = workflowsDir(pid);
  if (!existsSync(dir)) return [];
  const out: Array<{ id: string; name: string; exportPath: string; updatedAt?: string }> = [];
  for (const entry of readdirSync(dir)) {
    const dpath = join(dir, entry, 'diagram.json');
    if (!existsSync(dpath)) continue;
    try {
      const d = readJson<{ workflow?: string; exportPath?: string }>(dpath);
      out.push({
        id: entry,
        name: d.workflow || entry,
        exportPath: d.exportPath || '',
        updatedAt: statSync(dpath).mtime.toISOString(),
      });
    } catch {
      /* skip unreadable workflow */
    }
  }
  return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function touchProject(pid: string): void {
  try {
    const meta = readJson<ProjectMeta>(projectMeta(pid));
    meta.updatedAt = nowIso();
    writeJson(projectMeta(pid), meta);
  } catch {
    /* project meta missing — ignore */
  }
}

/** Create a project folder + metadata; returns the metadata. */
function createProject(name: string, description?: string): ProjectMeta {
  const id = genId(name);
  mkdirSync(workflowsDir(id), { recursive: true });
  const meta: ProjectMeta = { id, name, description, createdAt: nowIso(), updatedAt: nowIso() };
  writeJson(projectMeta(id), meta);
  return meta;
}

/** Create a blank workflow in a project; returns its summary. */
function createWorkflow(pid: string, name: string): { id: string; name: string; exportPath: string } {
  safeId(pid);
  const id = genId(name);
  mkdirSync(workflowDir(pid, id), { recursive: true });
  const diagram = {
    schemaVersion: 3,
    id,
    projectId: pid,
    workflow: name,
    source: `${slugify(name)}.js`,
    exportPath: '',
    nodes: [{ id: 'start', kind: 'start', label: 'Start', position: { x: 0, y: 0 } }],
    edges: [],
    groups: [],
    variables: [],
    types: [],
  };
  writeJson(diagramPath(pid, id), diagram);
  touchProject(pid);
  return { id, name, exportPath: '' };
}

/** Seed a Sample project from the in-repo src/diagram.json on first run. */
function ensureSeed(): void {
  if (listProjects().length > 0) return;
  const seedSrc = resolve(here, 'src/diagram.json');
  if (!existsSync(seedSrc)) {
    createProject('My Project');
    return;
  }
  const project = createProject('Sample');
  try {
    const seed = readJson<{ workflow?: string; source?: string }>(seedSrc);
    const name = seed.workflow || 'sample-workflow';
    const wid = genId(name);
    mkdirSync(workflowDir(project.id, wid), { recursive: true });
    const diagram = {
      ...seed,
      id: wid,
      projectId: project.id,
      workflow: name,
      exportPath: seed.source || '',
    };
    writeJson(diagramPath(project.id, wid), diagram);
  } catch {
    /* seed unreadable — leave the empty Sample project */
  }
}

function studioPlugin(): Plugin {
  return {
    name: 'studio-backend',
    configureServer(server: ViteDevServer) {
      ensureSeed();

      // Live-sync: when any diagram.json under the studio changes on disk,
      // tell the client which workflow so it can refresh if it's the open one.
      const notify = (file: string) => {
        const rel = file.replace(/\\/g, '/');
        const root = studioRoot.replace(/\\/g, '/');
        if (!rel.startsWith(root) || !rel.endsWith('/diagram.json')) return;
        const parts = rel.slice(root.length).split('/').filter(Boolean);
        // [<project-id>, 'workflows', <workflow-id>, 'diagram.json']
        if (parts.length === 4 && parts[1] === 'workflows') {
          server.ws.send({ type: 'custom', event: 'studio:changed', data: { projectId: parts[0], workflowId: parts[2] } });
        }
      };
      server.watcher.add(studioRoot);
      server.watcher.on('change', notify);
      server.watcher.on('add', notify);
      server.watcher.on('unlink', notify);

      // Single /api handler so route matching is explicit (not prefix-greedy).
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/')) return next();
        const [path, query = ''] = url.split('?');
        const params = new URLSearchParams(query);

        const handle = async () => {
          try {
            if (req.method === 'GET' && path === '/api/projects') {
              return sendJson(res, 200, { ok: true, projects: listProjects() });
            }
            if (req.method === 'GET' && path === '/api/workflows') {
              const pid = safeId(params.get('project'));
              return sendJson(res, 200, { ok: true, workflows: listWorkflows(pid) });
            }
            if (req.method === 'GET' && path === '/api/workflows/load') {
              const pid = safeId(params.get('project'));
              const wid = safeId(params.get('workflow'));
              const diagram = readJson(diagramPath(pid, wid));
              return sendJson(res, 200, { ok: true, diagram });
            }

            if (req.method !== 'POST') {
              res.statusCode = 405;
              return res.end('Method Not Allowed');
            }

            const body = JSON.parse((await readBody(req)) || '{}');

            switch (path) {
              case '/api/projects/create': {
                if (typeof body.name !== 'string' || !body.name.trim()) throw new Error('name required');
                return sendJson(res, 200, { ok: true, project: createProject(body.name.trim(), body.description) });
              }
              case '/api/projects/rename': {
                const pid = safeId(body.id);
                if (typeof body.name !== 'string' || !body.name.trim()) throw new Error('name required');
                const meta = readJson<ProjectMeta>(projectMeta(pid));
                meta.name = body.name.trim();
                meta.updatedAt = nowIso();
                writeJson(projectMeta(pid), meta);
                return sendJson(res, 200, { ok: true, project: meta });
              }
              case '/api/projects/delete': {
                const pid = safeId(body.id);
                rmSync(projectDir(pid), { recursive: true, force: true });
                return sendJson(res, 200, { ok: true });
              }
              case '/api/workflows/create': {
                const pid = safeId(body.projectId);
                if (typeof body.name !== 'string' || !body.name.trim()) throw new Error('name required');
                return sendJson(res, 200, { ok: true, workflow: createWorkflow(pid, body.name.trim()) });
              }
              case '/api/workflows/save': {
                const pid = safeId(body.projectId);
                const wid = safeId(body.workflowId);
                if (typeof body.diagram !== 'object' || body.diagram === null) throw new Error('diagram required');
                if (!existsSync(workflowDir(pid, wid))) throw new Error('workflow not found');
                writeJson(diagramPath(pid, wid), { ...body.diagram, id: wid, projectId: pid });
                touchProject(pid);
                return sendJson(res, 200, { ok: true, path: diagramPath(pid, wid) });
              }
              case '/api/workflows/rename': {
                const pid = safeId(body.projectId);
                const wid = safeId(body.workflowId);
                if (typeof body.name !== 'string' || !body.name.trim()) throw new Error('name required');
                const d = readJson<Record<string, unknown>>(diagramPath(pid, wid));
                d.workflow = body.name.trim();
                writeJson(diagramPath(pid, wid), d);
                touchProject(pid);
                return sendJson(res, 200, { ok: true });
              }
              case '/api/workflows/delete': {
                const pid = safeId(body.projectId);
                const wid = safeId(body.workflowId);
                rmSync(workflowDir(pid, wid), { recursive: true, force: true });
                touchProject(pid);
                return sendJson(res, 200, { ok: true });
              }
              case '/api/compile': {
                const pid = safeId(body.projectId);
                const wid = safeId(body.workflowId);
                if (typeof body.code !== 'string') throw new Error('code required');
                const corePath = compiledPath(pid, wid);
                mkdirSync(workflowDir(pid, wid), { recursive: true });
                writeFileSync(corePath, body.code, 'utf8');
                let exportPath: string | undefined;
                if (typeof body.exportPath === 'string' && body.exportPath.trim()) {
                  const p = body.exportPath.trim();
                  exportPath = isAbsolute(p) ? p : resolve(here, p);
                  mkdirSync(dirname(exportPath), { recursive: true });
                  writeFileSync(exportPath, body.code, 'utf8');
                }
                return sendJson(res, 200, { ok: true, corePath, exportPath });
              }
              default:
                res.statusCode = 404;
                return res.end('Not Found');
            }
          } catch (err) {
            return sendJson(res, 400, { ok: false, error: String(err) });
          }
        };
        void handle();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), studioPlugin()],
  server: { port: 5173 },
});
