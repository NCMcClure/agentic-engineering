// A plan written in Claude Code's plan mode says what to build but not who
// builds each part, so the session that gets it approved builds everything
// itself, in order, on its own model. These rules make the plan carry an
// `## Orchestration` table (the units, what each runs as, what it waits on,
// the files it changes, and the model it runs on), refuse ExitPlanMode without
// one, and then hold the approved session to it: an Agent call that names a
// unit runs on the plan's model and after the units it waits on, and a stop
// with nothing started is asked about once.
//
// This is the host's plan mode, a plan file the session writes before it may
// change anything. It is not the spec and plan tree the but-first-planning
// area keeps in a repo: nothing here reads or writes that.
//
// The state an approval leaves is `{ v, planFile, at, units, waves }`. The
// events after it are one line each, appended by the hooks: `start` and
// `returned` for a unit, `agent` for a background agent launched for one, and
// `asked` once a stop was held.
//
// Pure: no I/O. `now` is a millisecond time; state and event times are ISO.
import { MODEL_FLOORS, MODEL_TIERS, MODEL_USES, orList } from "./cards.mjs";
import { meet } from "./conflicts.mjs";

/** What a unit runs as: a child session in its own worktree, an Agent call, or the planning session itself. */
export const RUNS = ["session", "subagent", "here"];
/** The models a unit may name: every tier down to the one no subagent runs below. */
export const UNIT_MODELS = MODEL_TIERS.slice(0, MODEL_TIERS.indexOf(MODEL_FLOORS.subagent) + 1);
/** How long an approved plan stays in force with nothing happening. */
export const STALE_MS = 3 * 24 * 60 * 60 * 1000;
/** The longest the briefing's line about a plan gets. */
export const PLAN_LINE_CHARS = 280;
const HEADING = "## Orchestration";
const HEADER = "| Unit | What | Runs as | After | Files | Model | Why this model |";
const OPT_OUT = /^\s*Orchestration:\s*none\b[\s,:;.-]*(.*)$/i;
const UNIT_ID = /^U\d+$/;
// Each field's column is found by the first word of its header; `why` first, since "Why this model" names a model too.
const COLUMNS = ["why", "unit", "what", "runs", "after", "files", "model"];
const REQUIRED = ["unit", "runs", "after", "files", "model"];
const MODELS = orList(UNIT_MODELS);
const rank = (model) => MODEL_TIERS.indexOf(model);

/** The text's lines with every fenced block blanked, so a quoted example never counts. */
function unfenced(md) {
  let fence = null;
  return String(md ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.trim().slice(m[1].length).trim()) fence = null;
      return "";
    }
    if (m) { fence = m[1]; return ""; }
    return line;
  });
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const clean = (v) => String(v ?? "").trim().replace(/^`+|`+$/g, "").trim();
const one = (v) => { const c = clean(v); return c === "-" ? "" : c; };
const many = (v) => String(v ?? "").split(",").map(one).filter(Boolean);
const andList = (ids) => (ids.length < 2 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`);

function columnsOf(header) {
  const at = {};
  for (const key of COLUMNS) {
    const i = header.findIndex((h, j) => h.toLowerCase().startsWith(key) && !Object.values(at).includes(j));
    if (i !== -1) at[key] = i;
  }
  return at;
}

/**
 * The plan's orchestration: `{ none, units, approval, findings }`. `none` is
 * the opt-out's reason, `units` the table's rows, `approval` whether an
 * `Approval:` line follows the table, and `findings` one sentence per broken
 * rule, each saying what to write. The section is the last one outside a code
 * fence; with a section, the opt-out line does not count.
 */
export function parseOrchestration(md) {
  const lines = unfenced(md);
  const findings = [];
  const start = lines.map((l) => l.trim()).lastIndexOf(HEADING);
  if (start === -1) {
    const opt = lines.map((l) => OPT_OUT.exec(l)).find(Boolean);
    if (!opt) {
      findings.push(`The plan has no \`${HEADING}\` section: end it with the section's table, or with one line \`Orchestration: none, <why>\` when it is one unit of work.`);
      return { none: null, units: [], approval: false, findings };
    }
    const why = opt[1].trim();
    if (!why) findings.push("The opt-out line gives no reason: write `Orchestration: none, <why>`, saying why the plan is one unit of work.");
    return { none: why || null, units: [], approval: false, findings };
  }
  // The section runs to the next heading of its own level or above.
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s*#{1,2}\s/.test(l));
  const body = end === -1 ? rest : rest.slice(0, end);
  const first = body.findIndex((l) => /^\s*\|/.test(l));
  let last = first;
  while (last !== -1 && /^\s*\|/.test(body[last + 1] ?? "")) last++;
  const rows = first === -1 ? [] : body.slice(first, last + 1).map(cells);
  const approval = first !== -1 && body.slice(last + 1).some((l) => /^\s*Approval:/.test(l));
  const at = rows.length ? columnsOf(rows[0]) : {};
  const missing = REQUIRED.filter((k) => at[k] === undefined);
  if (rows.length && missing.length) {
    findings.push(`The table has no ${andList(missing.map((k) => `\`${k[0].toUpperCase()}${k.slice(1)}\``))} column: use the header \`${HEADER}\`.`);
  }
  const data = rows.slice(1).filter((r) => !r.every((c) => /^:?-+:?$/.test(c) || c === ""));
  const units = data.map((r) => ({
    id: one(r[at.unit]), what: one(r[at.what]), runs: one(r[at.runs]).toLowerCase(), after: many(r[at.after]),
    files: many(r[at.files]), model: one(r[at.model]).toLowerCase() || null, why: one(r[at.why]),
  }));
  if (!units.length) {
    findings.push(`The \`${HEADING}\` section has no rows: add a row per unit under the header, or replace the section with \`Orchestration: none, <why>\`.`);
    return { none: null, units, approval, findings };
  }
  if (missing.length) return { none: null, units, approval, findings };

  const seen = new Set();
  const all = new Set(units.map((x) => x.id));
  const floor = MODEL_FLOORS.session;
  units.forEach((u, i) => {
    const name = u.id || `Row ${i + 1}`;
    if (!UNIT_ID.test(u.id)) findings.push(`${name} is not a unit id: name each unit \`U<number>\`, as in U1, U2.`);
    else if (seen.has(u.id)) findings.push(`${u.id} is listed twice: give each unit its own \`U<number>\`.`);
    seen.add(u.id);
    if (!RUNS.includes(u.runs)) findings.push(`${name} runs as "${u.runs}": write ${orList(RUNS)}.`);
    if (u.runs === "session" || u.runs === "subagent") {
      if (!u.model) findings.push(`${name} names no model: write ${MODELS}.`);
      else if (!UNIT_MODELS.includes(u.model)) findings.push(`${name}'s model is "${u.model}": write ${MODELS}.`);
      else if (u.runs === "session" && rank(u.model) > rank(floor)) findings.push(`${name} is a session on ${u.model}, and a session never runs below ${floor}: write ${floor}, or make it a subagent.`);
      if (!u.files.length) findings.push(`${name} names no files: list the paths it changes, comma separated.`);
    }
    const above = new Set(units.slice(0, i).map((x) => x.id));
    for (const dep of u.after) {
      if (!all.has(dep)) findings.push(`${name} waits on ${dep}, which is no unit: name units from the table in After, or write \`-\`.`);
      else if (!above.has(dep)) findings.push(`${name} waits on ${dep}, which is listed below it: move ${dep} above ${name}, since a unit waits only on units above it.`);
    }
  });
  // Units of one wave start together. Sessions have a worktree each; anything else shares this one.
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const wave of wavesOf(units)) {
    const shared = wave.map((id) => byId.get(id)).filter((u) => u.runs !== "session" && u.files.length);
    for (let a = 0; a < shared.length; a++) {
      for (let b = a + 1; b < shared.length; b++) {
        const point = shared[a].files.flatMap((x) => shared[b].files.map((y) => meet(x, y))).find(Boolean);
        if (point) findings.push(`${shared[a].id} and ${shared[b].id} start together and both change ${point} in one work tree: make one wait on the other in After, or give the file to one of them.`);
      }
    }
  }
  if (units.some((u) => u.runs === "session") && !approval) {
    findings.push("The plan has session units and no `Approval:` line: add one under the table saying approving the plan approves starting each session unit, which pushes its branch and opens its pull or merge request without asking.");
  }
  return { none: null, units, approval, findings };
}

/** The parallel waves, `[[id, ...], ...]`: each unit one layer past the deepest unit it waits on. An unknown id or a cycle is ignored. */
export function wavesOf(units) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const depth = new Map();
  const walk = (id, trail) => {
    if (depth.has(id)) return depth.get(id);
    if (trail.has(id)) return -1;
    trail.add(id);
    const deps = (byId.get(id)?.after ?? []).filter((d) => byId.has(d) && d !== id);
    const d = 1 + Math.max(-1, ...deps.map((x) => walk(x, trail)));
    trail.delete(id);
    depth.set(id, d);
    return d;
  };
  const waves = [];
  for (const u of units) {
    const d = walk(u.id, new Set());
    (waves[d] ??= []).push(u.id);
  }
  return waves.filter(Boolean);
}

/** What a planning session is told: the section's format and every rule the parser holds it to. */
export function instructions() {
  const weakest = UNIT_MODELS.at(-1);
  const uses = [...UNIT_MODELS].reverse().map((m) => `\`${m}\`${MODEL_USES[m] ? ` ${MODEL_USES[m]}` : ""}`).join(", ");
  return [
    "A plan that does not say who builds each part is built by one session, in order, on its own model. So the plan file ends with this section; ExitPlanMode is refused without it:",
    "",
    HEADING,
    "",
    HEADER,
    "|---|---|---|---|---|---|---|",
    `| U1 | <one line> | subagent | - | <paths, comma separated> | ${weakest} | <reason> |`,
    "",
    "- Runs as: `session` (a child session, own worktree and pull or merge request), `subagent` (an Agent call), or `here` (this session itself).",
    "- After: units it waits on, each listed above it, or `-`. Units waiting on nothing unfinished start together, so two share a file only if both are sessions.",
    "- Files: what it changes; a `here` unit may write `-`.",
    `- Model: ${uses}. A session never runs below \`${MODEL_FLOORS.session}\`, no unit above your own model; a \`here\` unit writes \`-\`.`,
    "- With a `session` unit, add a line under the table starting `Approval:`: approving the plan approves starting each session unit, which pushes its branch and opens its pull or merge request unasked.",
    "",
    "A one-unit plan writes one line instead: `Orchestration: none, <why>`.",
  ].join("\n");
}

/** The one-sentence reminder, once the format has been given. */
export function pointer() {
  return `The plan file ends with its \`${HEADING}\` table (Unit, What, Runs as, After, Files, Model, Why this model) or the one line \`Orchestration: none, <why>\`, and ExitPlanMode is refused without one.`;
}

/** The deny reason for ExitPlanMode: what is wrong, then the format. */
export function refusal(findings) {
  return [
    "The plan's orchestration is not ready, so it is not shown for approval yet. Fix these in the plan file, then call ExitPlanMode again:",
    ...findings.map((f) => `- ${f}`),
    "",
    instructions(),
  ].join("\n");
}

/** The state an approval leaves, as plan.json holds it. */
export function stateOf(parsed, { planFile, at }) {
  const units = parsed.units.map(({ id, what, runs, after, files, model, why }) => ({ id, what, runs, after, files, model, why }));
  return { v: 1, planFile, at, units, waves: wavesOf(units) };
}

const label = (u) => (u.runs === "here" ? `${u.id} (here)` : `${u.id} (${u.runs}, ${u.model})`);

/** What the session is told once the plan is approved. `cli` is the board command, as the session should run it. */
export function handoff(state, { cli }) {
  const byId = new Map(state.units.map((u) => [u.id, u]));
  const out = [
    "The plan is approved, and its orchestration is how this session builds it. Follow it:",
    ...state.waves.map((w, i) => `- Wave ${i + 1}: ${w.map((id) => label(byId.get(id))).join(", ")}`),
    "A wave's units start together, in one message.",
  ];
  if (state.units.some((u) => u.runs === "subagent")) {
    out.push("A subagent unit is an Agent call whose `description` starts with the unit id (for example `U2 ...`) and whose `model` is the plan's. A call on another model, or before its After units have returned, is refused.");
  }
  if (state.units.some((u) => u.runs === "session")) {
    out.push(
      `Session units go on the board first: \`${cli} epic "<plan title>"\`, then per unit \`${cli} add "<what>" --epic <id> --files <files> --after <card ids> --model <the plan's model> --from-file <its done criteria from the plan, under "## Done when">\`.`,
      `The plan's approval is the person's yes: record it with \`${cli} grant <ids> --by "<their name>, plan approved ${state.at}"\`, then start each through /agentcraft:agent-works dispatch.`,
      "A session unit that waits on a subagent or here unit is filed once those finish.",
    );
  }
  if (state.units.some((u) => u.runs === "here")) out.push("Here units are this session's own work.");
  return out.join("\n");
}

const known = (state, events) => {
  const ids = new Set(state.units.map((u) => u.id));
  return (events ?? []).filter((e) => e && ids.has(e.unit));
};

/** Which units have started and which have returned, each once, in the order first seen. */
export function progress(state, events) {
  const evs = known(state, events);
  const ids = (t) => [...new Set(evs.filter((e) => e.t === t).map((e) => e.unit))];
  return { started: ids("start"), returned: ids("returned") };
}

/** The unit an Agent call names: the id its description starts with, else its prompt's first line. Null when it names none of the plan's. */
export function unitOf(state, input) {
  const from = (text) => /^\s*(U\d+)\b/.exec(String(text ?? ""))?.[1];
  const id = from(input?.description) ?? from(String(input?.prompt ?? "").split("\n")[0]);
  return id && state?.units?.some((u) => u.id === id) ? id : null;
}

/** The family a model alias or id belongs to, or null. */
export function familyOf(model) {
  return new RegExp(`(${MODEL_TIERS.join("|")})`).exec(String(model ?? "").toLowerCase())?.[1] ?? null;
}

/** An Agent call against the approved plan: null to let it pass, `{ deny }`, or `{ start }` with the unit it starts. */
export function agentGate(state, events, input) {
  if (!state) return null;
  const id = unitOf(state, input);
  if (!id) return null;
  const unit = state.units.find((u) => u.id === id);
  if (unit.runs !== "subagent") {
    return {
      deny: unit.runs === "session"
        ? `${id} runs as session in the approved plan, not as an Agent call: file it on the board and start it through /agentcraft:agent-works dispatch.`
        : `${id} runs as here in the approved plan: this session does it itself, with no Agent call.`,
    };
  }
  if (familyOf(input?.model) !== unit.model) {
    return { deny: `${id} runs on ${unit.model} in the approved plan: pass model: "${unit.model}" on this Agent call.` };
  }
  // Only a subagent is seen returning; a here or session unit it waits on is the session's to judge.
  const { returned } = progress(state, events);
  const watched = new Set(state.units.filter((u) => u.runs === "subagent").map((u) => u.id));
  const waiting = unit.after.filter((d) => watched.has(d) && !returned.includes(d));
  if (waiting.length) {
    const they = waiting.length > 1 ? "they have" : "it has";
    return { deny: `${id} waits on ${andList(waiting)} in the approved plan, and ${they} not returned: start ${id} once ${they}.` };
  }
  return { start: id };
}

/**
 * A child session's start against its card: null or `{ deny }`. `hold` is
 * what `holdOf` in board.mjs gives for the card (`{ why, ... }`, or null when
 * it is ready); only `waiting` holds a start here, since the rest are the
 * board's own to refuse.
 */
export function sessionGate(card, hold, input) {
  if (!card) return null;
  if (MODEL_TIERS.includes(card.model) && familyOf(input?.model) !== card.model) {
    return { deny: `Card ${card.id} is pinned to ${card.model}: start its session with model "${card.model}".` };
  }
  if (hold?.why === "waiting") {
    const on = hold.on ?? [];
    return { deny: `Card ${card.id} waits on ${andList(on)}, not finished yet: start its session once ${on.length > 1 ? "they are" : "it is"}.` };
  }
  return null;
}

/**
 * What of an approved plan is left: `{ units, started }`, or null when there
 * is no plan, every subagent unit has returned, or nothing has happened for
 * three days. A plan with no subagent unit stays in force until then, since
 * its sessions are not observed here. Session and here units never return, so
 * they are listed for information.
 */
export function remaining(state, events, { now }) {
  if (!state || !Array.isArray(state.units)) return null;
  const times = [state.at, ...known(state, events).map((e) => e.at)].map((t) => Date.parse(t)).filter(Number.isFinite);
  if (!times.length || now - Math.max(...times) > STALE_MS) return null;
  const { started, returned } = progress(state, events);
  const subagents = state.units.filter((u) => u.runs === "subagent");
  if (subagents.length && subagents.every((u) => returned.includes(u.id))) return null;
  return { units: state.units.filter((u) => !returned.includes(u.id)), started };
}

const waveText = (state) => state.waves.map((w, i) => `wave ${i + 1} is ${w.join(", ")}`).join("; ");

/** The text to hold a stop with once: the plan is in force, nothing started, nothing filed. Null otherwise. */
export function idleAsk(state, events, { cardsSince, now }) {
  const left = remaining(state, events, { now });
  if (!left || left.started.length || cardsSince > 0) return null;
  return `The approved plan's orchestration has not started: ${waveText(state)}. Start wave one as the plan laid out, its units together in one message, or tell the person why the plan changed.`;
}

/**
 * One briefing line while an approved plan is in force, at most `max`
 * characters: what is left, the next wave, and the plan file. Where the file's
 * path does not fit, the line goes out without it; null when no plan is in
 * force or not even that fits.
 */
export function planLine(state, events, { now, max = PLAN_LINE_CHARS }) {
  const left = remaining(state, events, { now });
  if (!left) return null;
  const ids = new Set(left.units.map((u) => u.id));
  const next = (state.waves ?? []).find((w) => w.some((id) => ids.has(id))) ?? [];
  const head = `An approved plan's orchestration is in force: ${left.units.length} of ${state.units.length} units left, next wave ${next.filter((id) => ids.has(id)).join(", ")}.`;
  const full = `${head} Plan: ${state.planFile}`;
  const limit = Math.min(max, PLAN_LINE_CHARS);
  return full.length <= limit ? full : head.length <= limit ? head : null;
}
