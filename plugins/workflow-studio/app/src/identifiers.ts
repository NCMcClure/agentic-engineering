// Variable-name validity, shared by codegen (compile diagnostics) and the
// variable editor (inline feedback). Names are emitted verbatim as const/let
// declarations, so they must be real JS identifiers and must not shadow the
// workflow runtime's globals.

export const JS_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const JS_KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

/** Names the workflow runtime (or our emitted preamble) already binds. */
const RUNTIME_GLOBALS = new Set([
  'meta', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow',
  'gate', 'verify',
]);

/** null when fine; otherwise a human-readable reason the name can't be used. */
export function variableNameProblem(name: string): string | null {
  if (!JS_IDENT_RE.test(name)) return 'not a valid JS identifier';
  if (JS_KEYWORDS.has(name)) return 'a reserved JS keyword';
  if (RUNTIME_GLOBALS.has(name)) return `shadows the workflow runtime's \`${name}\``;
  return null;
}
