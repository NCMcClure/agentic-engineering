// The live lane's pure half: a fixture's lens reports read into the numbers
// the baseline keeps, the checks run over them, and the before/after table.
// Reads only what the lens already computed (its events, requests, and
// compaction rows); it never reads a transcript itself.
import fs from "node:fs";
import path from "node:path";

const CHECKS = path.join(import.meta.dirname, "checks");
/** A rule file a repo carries its own copy of, as opposed to one a hook delivers. */
const isRule = (e) => e.kind === "instructions" && /^\.(agents|claude)\/rules\//.test(String(e.label));
/** Standing context the model saw from a focus plugin: what the lens calls the start, minus anything only the person saw. */
const standing = (e, segment) => e.segment === segment && e.phase === "start" && e.source?.focus && e.visibility === "model";

/** Keys sorted, so a baseline diff and the table do not move with transcript order. */
const sorted = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));

function byPlugin(events, keep) {
  const out = new Map();
  for (const e of events) if (keep(e)) out.set(e.source.plugin, (out.get(e.source.plugin) ?? 0) + e.tokens);
  return sorted(out);
}
const sum = (events, keep) => events.filter(keep).reduce((n, e) => n + e.tokens, 0);
const firstRequest = (report, segment = 0) => report.requests.find((r) => r.segment === segment)?.contextTokens ?? null;

/** Each plugin's skill listing at the start: its tokens, and how many names lost their description to the budget. */
function listing(events) {
  const out = new Map();
  for (const e of events) {
    if (e.kind !== "skills" || e.segment !== 0 || !e.source?.focus) continue;
    const bare = Number(/(\d+) without a description/.exec(e.detail ?? "")?.[1] ?? 0);
    out.set(e.source.plugin, { tokens: e.tokens, skills: e.names?.length ?? 0, bare });
  }
  return sorted(out);
}

/** How each focus plugin's hooks on one event ended up: seen by the model, by the person only, by nobody, or failed. */
function hookOutcomes(events, event) {
  const out = new Map();
  for (const e of events) {
    if (e.kind !== "hook" || e.event !== event || !e.source?.focus) continue;
    const row = out.get(e.source.plugin) ?? { model: 0, person: 0, silent: 0, error: 0 };
    row[e.visibility] = (row[e.visibility] ?? 0) + 1;
    out.set(e.source.plugin, row);
  }
  return sorted(out);
}

/** What one subagent's first request carried from the focus plugins. */
function measureSubagent(report) {
  const start = (e) => standing(e, 0);
  return {
    firstRequestTokens: firstRequest(report),
    focus: byPlugin(report.events, start),
    rulesTokens: sum(report.events, (e) => start(e) && isRule(e)),
    subagentStart: byPlugin(report.events, (e) => start(e) && e.kind === "hook" && e.event === "SubagentStart"),
  };
}

/** One fixture's numbers: { main, subagents: [{ agentType, report }] } from the lens. */
export function measureFixture({ main, subagents = [] }) {
  const compaction = main.compactions[0] ?? null;
  const after = compaction ? compaction.fromSegment + 1 : null;
  return {
    firstRequestTokens: firstRequest(main),
    start: byPlugin(main.events, (e) => standing(e, 0)),
    afterCompaction: compaction ? byPlugin(main.events, (e) => standing(e, after)) : null,
    rulesTokens: sum(main.events, (e) => standing(e, 0) && isRule(e)),
    sessionStart: byPlugin(main.events, (e) => standing(e, 0) && e.kind === "hook" && e.event === "SessionStart"),
    skills: listing(main.events),
    stop: hookOutcomes(main.events, "Stop"),
    compaction: Object.fromEntries((compaction?.rows ?? []).map((r) => [r.label, r.status])),
    subagents: sorted(subagents.map((s) => [s.agentType ?? "unknown", measureSubagent(s.report)])),
  };
}

/**
 * The extension point: every .mjs file in checks/ default-exports
 * { name, check({ run, baseline }) => string[] }, one failure per string.
 * `run.fixtures[kind]` carries `measure` (measureFixture's numbers) and the
 * raw lens reports (`main`, `subagents`) for checks that need more. A failure
 * string names what is wrong and never a size or a time, so the baseline can
 * list the ones it expects by their exact text.
 */
export async function loadChecks(dir = CHECKS) {
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".mjs")).sort();
  const checks = [];
  for (const name of files) checks.push({ ...(await import(path.join(dir, name))).default, file: name });
  return checks;
}

export function runChecks(checks, run, baseline) {
  return checks.map((c) => {
    try { return { file: c.file, name: c.name, failures: c.check({ run, baseline }) ?? [] }; } catch (error) { return { file: c.file, name: c.name, failures: [`${c.name} threw: ${error.message}`] }; }
  });
}

/**
 * The ratchet. A failure the baseline lists is expected: the lane stays green
 * and says so. One it does not list is new, and fails the lane. One it lists
 * that no longer happens is fixed, and the next --write-baseline drops it.
 */
export function ratchet(results, expected = {}) {
  return results.map((r) => {
    const known = new Set(expected[r.file] ?? []);
    const now = new Set(r.failures);
    return { ...r, fresh: r.failures.filter((f) => !known.has(f)), expected: r.failures.filter((f) => known.has(f)), fixed: [...known].filter((f) => !now.has(f)) };
  });
}

const total = (map) => (map ? Object.values(map).reduce((a, b) => a + b, 0) : null);
const fmt = (n) => (n === null || n === undefined ? "-" : n.toLocaleString("en-US"));
const delta = (a, b) => (a === null || a === undefined || b === null || b === undefined ? "" : `${b - a >= 0 ? "+" : ""}${(b - a).toLocaleString("en-US")}`);

/** The rows a fixture contributes: [measure, value] for each number worth comparing. */
function rowsOf(m) {
  const rows = [
    ["first request", m.firstRequestTokens],
    ["focus at start", total(m.start)],
    ["focus after compaction", total(m.afterCompaction)],
    ["hook context at start", total(m.sessionStart)],
    ["repo rule copies at start", m.rulesTokens],
  ];
  for (const [plugin, n] of Object.entries(m.start)) rows.push([`  ${plugin} at start`, n]);
  for (const [type, s] of Object.entries(m.subagents)) rows.push([`subagent ${type}`, total(s.focus)]);
  return rows;
}

/** The before/after table, tokens throughout: the API's count for requests, the lens's estimate for the rest. */
export function compareTable(baseline, now) {
  const lines = [];
  if (!baseline) lines.push("no baseline: showing this run only (npm run test:live -- --write-baseline records one)");
  const head = ["fixture", "measure", "baseline", "now", "change"];
  const body = [];
  for (const [kind, m] of Object.entries(now)) {
    const before = baseline?.fixtures?.[kind] ? new Map(rowsOf(baseline.fixtures[kind])) : new Map();
    for (const [label, value] of rowsOf(m)) body.push([kind, label, fmt(before.get(label)), fmt(value), delta(before.get(label), value)]);
  }
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const row = (r) => r.map((c, i) => (i >= 2 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ");
  lines.push(row(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(row));
  return lines.join("\n");
}
