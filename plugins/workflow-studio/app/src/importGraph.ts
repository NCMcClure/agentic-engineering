// Read a workflow .js back into a graph. The honest boundary: this does NOT
// reverse-parse arbitrary JS into typed pins. If codegen's `@workflow-graph`
// sidecar is present, the graph is recovered losslessly from it. Otherwise
// (a hand-written script) we return a scaffold for the agent to rebuild by hand
// — exactly the v1 "you read the script and translate" workflow.

import { compile } from './codegen';
import { SCHEMA_VERSION, type Diagram, type DiagramNode } from './types';

const FENCE = /\/\* @workflow-graph:v[23]\n([\s\S]*?)\n\*\//;

export interface ImportResult {
  diagram: Diagram;
  /** true when recovered from the sidecar (round-trip exact). */
  lossless: boolean;
  /** true when the fence is present but the JS body looks edited away from it,
   *  so trusting the fence may drop hand-edits — the agent should reconcile. */
  stale: boolean;
}

export function importJs(src: string, source = ''): ImportResult {
  const m = src.match(FENCE);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]) as Diagram;
      const ver = (parsed as { schemaVersion?: number }).schemaVersion;
      if (ver === 2 || ver === SCHEMA_VERSION) {
        return { diagram: parsed, lossless: true, stale: fenceLooksStale(src, parsed) };
      }
    } catch {
      // malformed fence — fall through to the scaffold
    }
  }
  return { diagram: scaffold(src, source), lossless: false, stale: false };
}

const stripFence = (src: string) => src.replace(FENCE, '').trim();

/** Exact drift check: recompile the recovered graph and compare its body to the
 *  file's body. If they differ, someone hand-edited the .js away from the fence,
 *  so trusting the fence would drop those edits — the agent should reconcile. */
function fenceLooksStale(src: string, diagram: Diagram): boolean {
  return stripFence(src) !== stripFence(compile(diagram));
}

/** A minimal placeholder graph: Start → a log explaining the situation → End.
 *  The agent reads the real .js and rebuilds; from then on the fence keeps it
 *  lossless. */
function scaffold(src: string, source: string): Diagram {
  const name = src.match(/name:\s*['"]([^'"]+)['"]/)?.[1] ?? 'imported';
  const node = (id: string, kind: string, label: string, x: number, note?: string): DiagramNode => ({
    id,
    kind,
    label,
    position: { x, y: 80 },
    ...(note ? { note } : {}),
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    workflow: name,
    source,
    nodes: [
      node('start', 'start', 'Start', 0),
      node('imported', 'log', 'Imported — rebuild this graph', 240, 'no @workflow-graph sidecar found'),
      node('end', 'end', 'Return', 520),
    ],
    edges: [
      { id: 'e1', source: { node: 'start', pin: 'exec-out' }, target: { node: 'imported', pin: 'exec-in' }, role: 'exec' },
      { id: 'e2', source: { node: 'imported', pin: 'exec-out' }, target: { node: 'end', pin: 'exec-in' }, role: 'exec' },
    ],
    groups: [],
    variables: [],
    types: [],
  };
}
