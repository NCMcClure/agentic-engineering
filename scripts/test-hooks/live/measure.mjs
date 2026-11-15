// The live lane's pure half: a fixture's lens reports read into the numbers
// the baseline keeps, the checks run over them, and the before/after table.
// The token numbers read only what the lens already computed (its events,
// requests, and compaction rows); which skill a session opened is not in a
// lens report, so the skills part reads transcript entries through reach.mjs.
import fs from "node:fs";
import path from "node:path";
import { calls, listing as listed, offered, reached } from "./reach.mjs";
import { labelOf } from "./triggers.mjs";

const CHECKS = path.join(import.meta.dirname, "checks");
/** A rule file a repo carries its own copy of, as opposed to one a hook delivers. */
const isRule = (e) => e.kind === "instructions" && /^\.(agents|claude)\/rules\//.test(String(e.label));
/** Standing context the model saw from a focus plugin: what the lens calls the start, minus anything only the person saw. */
const standing = (e, segment) => e.segment === segment && e.phase === "start" && e.source?.focus && e.visibility === "model";

/** Keys sorted, so a baseline diff and the table do not move with transcript order. */
const sorted = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));

/**
 * Who a piece of context is from: the area where the lens knows one, else the
 * plugin. Once the plugins are areas of one plugin, the plugin's name is the
 * same for everything, and an area carries the name its plugin had, so a row
 * reads the same against a baseline from either side.
 */
const ownerOf = (e) => e.source.area ?? e.source.plugin;

/**
 * Tokens per owner. One hook may print a block of critical lines for each of
 * several areas (the lens's `blocks`): each block counts for the area its
 * heading names, and the rest of the hook's text for the hook's own owner.
 */
function byPlugin(events, keep) {
  const out = new Map();
  const add = (owner, tokens) => out.set(owner, (out.get(owner) ?? 0) + tokens);
  for (const e of events) {
    if (!keep(e)) continue;
    const blocks = e.blocks ?? [];
    for (const b of blocks) add(b.owner, b.tokens);
    add(ownerOf(e), e.tokens - blocks.reduce((n, b) => n + b.tokens, 0));
  }
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
    out.set(ownerOf(e), { tokens: e.tokens, skills: e.names?.length ?? 0, bare });
  }
  return sorted(out);
}

/** How each focus plugin's hooks on one event ended up: seen by the model, by the person only, by nobody, or failed. */
function hookOutcomes(events, event) {
  const out = new Map();
  for (const e of events) {
    if (e.kind !== "hook" || e.event !== event || !e.source?.focus) continue;
    const row = out.get(ownerOf(e)) ?? { model: 0, person: 0, silent: 0, error: 0 };
    row[e.visibility] = (row[e.visibility] ?? 0) + 1;
    out.set(ownerOf(e), row);
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
 * { name, part?, check({ run, baseline }) => string[] }, one failure per
 * string. `run.fixtures[kind]` carries `measure` (measureFixture's numbers)
 * and the raw lens reports (`main`, `subagents`) for checks that need more;
 * `run.skills` carries `windows` (name to context size), `listing` (name to
 * each plugin's share of the skill listing, reach.mjs listingSizes),
 * `triggers` (measureTriggers), `compaction` (reach.mjs acrossCompaction,
 * with the skill's label), `unlocked` (a line for each skill session that was
 * offered a tool outside its own), and `partial` when --only left fixtures
 * out. A failure string names what is wrong and never a size or a time, so
 * the baseline can list the ones it expects by their exact text. `part` is
 * the half of the baseline a check reads, "fixtures" unless it says "skills":
 * its expected failures are recorded when that half is.
 */
export async function loadChecks(dir = CHECKS) {
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".mjs")).sort();
  const checks = [];
  for (const name of files) checks.push({ ...(await import(path.join(dir, name))).default, file: name });
  return checks;
}

export function runChecks(checks, run, baseline) {
  return checks.map((c) => {
    const head = { file: c.file, name: c.name, part: c.part ?? "fixtures" };
    try { return { ...head, failures: c.check({ run, baseline }) ?? [] }; } catch (error) { return { ...head, failures: [`${c.name} threw: ${error.message}`] }; }
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

/**
 * Why a session stopped, from its result payload: "ended" on its own,
 * "max-turns" or "budget" when a cap cut it off, "error" for anything else,
 * a session with no result included.
 */
export function stopOf(result) {
  if (result?.subtype === "success" && !result.is_error) return "ended";
  if (result?.subtype === "error_max_turns") return "max-turns";
  if (result?.subtype === "error_max_budget_usd") return "budget";
  return "error";
}

/** A session reached its skill, by the Skill tool or by reading it. */
export const isReached = (outcome) => outcome === "skill" || outcome === "read";
/** A session gave an answer to the routing question: it reached the skill, or it ended on its own without it. */
export const isMeasured = (outcome) => isReached(outcome) || outcome === "miss";

const tail = (file, n = 2) => String(file ?? "").split("/").slice(-n).join("/");
/** One tool call as the audit trail prints it. */
function describe(call) {
  const what = call.name === "Skill" ? call.input.skill : call.name === "Read" ? tail(call.input.file_path) : call.input.pattern;
  return `${call.name}${what ? ` ${what}` : ""}${call.ok ? "" : " (failed)"}`;
}

/**
 * One trigger session read into its cell. `outcome` is how it reached its
 * skill ("skill" or "read"); "miss" when it ended on its own without it; else
 * the reason it stopped, which means not measured: a session cut off or
 * errored before it reached anything says nothing about routing. `calls` is
 * what it did, for auditing a cell that is not a reach, and `offered` the
 * tools it was given.
 */
export function measureCell(row, entries, stop) {
  if (!entries) return { outcome: stop === "ended" ? "error" : stop, listing: null, calls: [], offered: [] };
  return {
    outcome: reached(entries, row) ?? (stop === "ended" ? "miss" : stop),
    listing: listed(entries, row),
    calls: calls(entries).map(describe),
    offered: offered(entries),
  };
}

const at = (c) => `${c.row.skill} at ${c.window}, pass ${c.pass}`;

/**
 * A line for each trigger session that did not reach its skill: whether it
 * missed or was not measured, and the tool calls it made. `cells` is the
 * lane's list of { row, window, pass, cell }.
 */
export function auditLines(cells) {
  return cells.filter((c) => !isReached(c.cell.outcome))
    .map((c) => `${at(c)}: ${isMeasured(c.cell.outcome) ? "miss" : `not measured (${c.cell.outcome})`}; ${c.cell.calls.join(", ") || "no tool call"}`);
}

/**
 * A line for each trigger session that was offered a tool outside `allowed`.
 * A session whose transcript recorded no tool list cannot be shown to have
 * been locked, so it gets a line too; one with no transcript at all is a
 * session not measured, which the check reports on its own.
 */
export function unlockedLines(cells, allowed) {
  const lines = [];
  for (const c of cells) {
    if (c.cell.listing === null) continue;
    const extra = c.cell.offered.filter((name) => !allowed.includes(name));
    if (extra.length) lines.push(`${at(c)}: offered ${extra.join(", ")}`);
    else if (!c.cell.offered.length) lines.push(`${at(c)}: recorded no tool list, so nothing shows what it was offered`);
  }
  return lines;
}

/**
 * The prompts to run again before the check may call them a regression:
 * reached in every baseline pass at that window, and missed by every session
 * of this run so far. One miss is one sample; three in a row is a finding.
 */
export function suspects(cells, baselineTriggers) {
  const groups = new Map();
  for (const c of cells) {
    const key = `${c.row.skill}@${c.window}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out = [];
  for (const group of groups.values()) {
    const { row, window } = group[0];
    const was = baselineTriggers?.[row.skill]?.reached?.[window] ?? [];
    if (was.length && was.every(isReached) && group.every((c) => c.cell.outcome === "miss")) out.push({ row, window });
  }
  return out;
}

/**
 * The prompts that stopped reaching their skill: reached in every baseline
 * pass at a window, and in no session of this run there, the reruns to
 * confirm a miss included. A window with a session that was not measured is
 * not one: it says nothing about routing. Each is
 * `{ name, window, skill, was, now }`, the last two the baseline's passes and
 * this run's sessions. The trigger check fails them, and a recording refuses
 * to write over them.
 */
export function regressions(triggers, windows, baselineTriggers) {
  const out = [];
  for (const [name, t] of Object.entries(triggers ?? {})) {
    for (const window of windows) {
      const outcomes = [...(t.reached?.[window] ?? []), ...(t.confirm?.[window] ?? [])];
      const was = baselineTriggers?.[name]?.reached?.[window] ?? [];
      if (!outcomes.length || !outcomes.every(isMeasured)) continue;
      if (was.length && was.every(isReached) && !outcomes.some(isReached)) out.push({ name, window, skill: t.skill, was: was.length, now: outcomes.length });
    }
  }
  return out;
}

/**
 * Why a run may not record the skills part of the baseline: one reason per
 * string, none when it may. A baseline is what later runs are held to, so it
 * is written only from a run that measured every session, ran the skill
 * session, kept every session to its tools, and lost no prompt (regressions,
 * above). The last hides the most: written over a prompt that stopped
 * reaching its skill, the baseline holds the misses, and the check that
 * failed can never fail that prompt again.
 */
export function skillsRefusal({ lost, compaction, unlocked, regressed }) {
  const reasons = [];
  if (lost) reasons.push(`${lost} trigger session${lost === 1 ? " was" : "s were"} not measured`);
  if (!compaction) reasons.push("the skill session did not run");
  if (unlocked) reasons.push(`${unlocked} session${unlocked === 1 ? " was" : "s were"} offered more than their tools`);
  if (regressed.length) {
    const one = regressed.length === 1;
    reasons.push(`${regressed.length} prompt${one ? "" : "s"} stopped reaching ${one ? "its" : "their"} skill (${regressed.map((r) => `${r.name} at ${r.window}`).join(", ")}), and a baseline written over ${one ? "it" : "them"} could never fail ${one ? "it" : "them"} again: find the cause, or change ${one ? "that cell" : "those cells"} of baseline.json by hand in the same change and say why beside the prompt (scripts/test-hooks/README.md, the live lane)`);
  }
  return reasons;
}

/**
 * The trigger check's numbers: per prompt, the skill it is for (its label,
 * triggers.mjs labelOf), whether the prompt names it, whether only a person
 * can start it today, and per context window what the listing held and each
 * pass's outcome (measureCell). `cellsOf(skill, window)` is that prompt's
 * cells in pass order; a window with none stays empty, which the check fails.
 * Cells marked `confirm` are the reruns of a suspect (suspects, above): they
 * go under `confirm`, apart from the passes, so `reached` and the totals read
 * from it stay one sample per prompt and pass.
 */
export function measureTriggers(rows, windows, cellsOf) {
  return sorted(rows.map((row) => {
    const cells = Object.fromEntries(windows.map((window) => [window, cellsOf(row.skill, window)]));
    const confirm = Object.fromEntries(windows.map((w) => [w, cells[w].filter((c) => c.confirm).map((c) => c.outcome)]).filter(([, outcomes]) => outcomes.length));
    return [row.skill, {
      skill: labelOf(row),
      fixture: row.fixture,
      named: row.named,
      person: Boolean(row.person),
      listing: Object.fromEntries(windows.map((w) => [w, cells[w].find((c) => c.listing)?.listing ?? null])),
      reached: Object.fromEntries(windows.map((w) => [w, cells[w].filter((c) => !c.confirm).map((c) => c.outcome)])),
      ...(Object.keys(confirm).length ? { confirm } : {}),
    }];
  }));
}

/**
 * The baseline at `file`, or null when there is none: the first recording
 * ever has nothing to compare against. A file that is there and does not
 * parse throws. Read as "none", it would pass every check that compares with
 * a baseline and let a recording be written over it unopposed.
 */
export function readBaseline(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${file} cannot be read (${error.message}): a baseline that cannot be read is not a missing one`);
  }
  try { return JSON.parse(text); } catch (error) {
    throw new Error(`${file} does not parse (${error.message}): a baseline that cannot be read is not a missing one; fix the file, or restore it from git`);
  }
}

/**
 * The baseline with the named parts replaced by this run and the rest kept.
 * The top-level stamp describes `fixtures`; `skills` carries its own, so it
 * can be recorded on a later day without restamping the fixtures.
 */
export function baselineRecord(previous, parts, stamp, now) {
  const record = { ...(previous ?? {}) };
  if (parts.includes("fixtures")) Object.assign(record, { ...stamp, costUsd: now.fixturesCostUsd, fixtures: now.fixtures });
  delete record.skills;
  const skills = parts.includes("skills") ? { ...stamp, ...now.skills } : previous?.skills;
  return skills ? { ...record, skills } : record;
}

/** One prompt's passes at one window, as a table cell. */
function cellText(outcomes, none = "-") {
  if (!outcomes?.length) return none;
  const lost = outcomes.filter((o) => !isMeasured(o));
  if (outcomes.length === 1) return lost.length ? `not measured (${outcomes[0]})` : outcomes[0];
  const reads = outcomes.filter((o) => o === "read").length;
  return `${outcomes.filter(isReached).length} of ${outcomes.length - lost.length}${reads ? ` (${reads} by read)` : ""}${lost.length ? `, ${lost.length} not measured` : ""}`;
}

/** Sessions that reached their skill, of those measured, across the prompts `keep` picks: at one window, or at all of them. */
function count(triggers, keep, window = null) {
  const outcomes = Object.values(triggers ?? {}).filter(keep).flatMap((t) => (window ? t.reached[window] ?? [] : Object.values(t.reached).flat()));
  const lost = outcomes.filter((o) => !isMeasured(o)).length;
  return `${outcomes.filter(isReached).length} of ${outcomes.length - lost}${window ? " sessions" : ""}${lost ? `, ${lost} not measured` : ""}`;
}
const KEPT_BY = { reattached: "skill re-attached", restored: "file restored", read: "read again" };
const across = (c) => (!c ? "not run" : c.kept ? `kept (${KEPT_BY[c.after]})` : "lost");

/**
 * The trigger and compaction results beside the baseline's: one line per
 * prompt and window, the totals per window, the totals apart for the prompts
 * that name their skill and those that do not, and for the skills a session
 * can call and those only a person can start, each plugin's share of the
 * skill listing per window, and the compaction result. `windows` maps a
 * window's name to the context size its sessions had, and `listing` a
 * window's name to reach.mjs listingSizes of one of its sessions.
 */
export function skillsTable(baseline, now) {
  const lines = [];
  if (!baseline) lines.push("no baseline for the skills part (npm run test:live -- --write-baseline=skills records one)");
  const head = ["prompt for", "fixture", "names it", "window", "listing", "baseline", "now"];
  const body = [];
  for (const [name, t] of Object.entries(now.triggers)) {
    const before = baseline?.triggers?.[name]?.reached ?? {};
    for (const window of Object.keys(now.windows)) body.push([t.skill, t.fixture, t.named ? "yes" : "no", window, t.listing[window] ?? "-", cellText(before[window]), `${cellText(t.reached[window], "no session")}${t.confirm?.[window] ? `, rerun ${cellText(t.confirm[window])}` : ""}`]);
  }
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const row = (r) => r.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  lines.push(row(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(row));
  const against = (keep, window) => `${count(now.triggers, keep, window)}${baseline ? ` (baseline ${count(baseline.triggers, keep, window).replace(" sessions", "")})` : ""}`;
  for (const [window, size] of Object.entries(now.windows)) lines.push(`reached at ${window} (${fmt(size)} tokens): ${against(() => true, window)}`);
  lines.push(`prompts that name their skill: ${against((t) => t.named)}`, `prompts that do not: ${against((t) => !t.named)}`);
  // A skill only a person can start is refused when a session calls it, so those rows are read apart from the ones a session can call.
  lines.push(`skills a session can call: ${against((t) => !t.person)}`, `skills only a person can start: ${against((t) => t.person)}`);
  // An area is its plugin's one entry once a plugin's skills are routes, so the listing is read per plugin.
  const share = (s) => `${fmt(s.characters)}, ${s.described} of ${s.skills}`;
  for (const [window, plugins] of Object.entries(now.listing ?? {})) {
    if (!plugins) { lines.push(`listing at ${window}: not read`); continue; }
    for (const [plugin, s] of Object.entries(plugins)) {
      const was = baseline?.listing?.[window]?.[plugin];
      lines.push(`listing at ${window}: ${plugin} ${fmt(s.characters)} characters, ${s.described} of ${s.skills} described${baseline ? ` (baseline ${was ? share(was) : "not recorded"})` : ""}`);
    }
  }
  lines.push(`across the compaction: ${now.compaction?.skill ?? "the skill"} ${across(now.compaction)}${baseline ? `; baseline ${across(baseline.compaction)}` : ""}`);
  return lines.join("\n");
}
