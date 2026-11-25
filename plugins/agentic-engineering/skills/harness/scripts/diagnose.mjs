// What went wrong in one session, read from the lens's own reading of it.
//
// The lens (transcript.mjs) says what entered the model's window, when, and
// from where. This raises findings from that: each names what happened, where,
// and the change in the plugin that fixes it. A finding is a fact of the
// transcript measured against a number in thresholds.mjs, never a guess about
// what the model made of it.
//
// Levels:
//   critical  the model went without something it was meant to have, or was stopped
//   warning   it cost more than it should, or reached the wrong reader
//   info      what limits this reading
//
// Import-safe and pure: `diagnose` takes the session the lens built (and, for
// the subagent check, the sessions of its subagents) and reads no file.
import { CRITICAL_TOTAL, DUP_LINE_CHARS, HOOK_OUTPUT_CAP, HOOK_OUTPUT_NEAR, QUIET_AGENTS, REPEAT_TURNS } from "./thresholds.mjs";

export const LEVELS = ["critical", "warning", "info"];

/** Every finding this can raise, and its level. The route's table lists the same. */
export const CODES = {
  HOOK_OVER_CAP: "critical",
  COMPACT_LOST: "critical",
  SKILL_REFUSED: "critical",
  HOOK_NEAR_CAP: "warning",
  HOOK_FAILED: "warning",
  HOOK_PERSON_ONLY: "warning",
  HOOK_REPEATS: "warning",
  DUP_TEXT: "warning",
  CRITICAL_TOTAL_OVER: "warning",
  COMPACT_ONLY_RESUME: "warning",
  ROUTE_NOT_REREAD: "warning",
  LISTING_BARE: "warning",
  SKILL_REINVOKED: "warning",
  SUBAGENT_CONTEXT: "warning",
  RESUME_REPEAT: "info",
  UNATTRIBUTED: "info",
  TRANSCRIPT_PARTIAL: "info",
};

const num = (n) => Number(n ?? 0).toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const one = (text, n = 140) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
const ownerOf = (ev) => ev.source?.area ?? ev.source?.plugin ?? null;
const time = (at) => (at ? Date.parse(at) : NaN);
/** Segments and compactions are counted from one wherever a person reads them. */
const seg = (index) => `segment ${index + 1}`;

/** Groups rows by a key, in order of first appearance. */
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// ---- hooks ------------------------------------------------------------------

function hookSize(session, add) {
  const said = session.events.filter((e) => e.kind === "hook" && e.visibility === "model" && e.text);
  for (const [, runs] of groupBy(said, (e) => `${e.event}\0${ownerOf(e) ?? ""}\0${e.command ?? e.hookName}`)) {
    const largest = runs.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const chars = largest.text.length;
    if (chars < HOOK_OUTPUT_NEAR) continue;
    const over = chars > HOOK_OUTPUT_CAP;
    const times = runs.filter((e) => (over ? e.text.length > HOOK_OUTPUT_CAP : e.text.length >= HOOK_OUTPUT_NEAR));
    add({
      code: over ? "HOOK_OVER_CAP" : "HOOK_NEAR_CAP",
      owner: ownerOf(largest),
      segment: largest.segment,
      events: times.map((e) => e.id),
      what: over
        ? `Its ${largest.hookName} hook printed ${num(chars)} characters${times.length > 1 ? ` (and went over on ${plural(times.length, "run")})` : ""}. Past ${num(HOOK_OUTPUT_CAP)} the host gives the model a preview and a file path in place of the text, so the rest was not in the window.`
        : `Its ${largest.hookName} hook printed ${num(chars)} characters, within ${num(HOOK_OUTPUT_CAP - chars)} of the ${num(HOOK_OUTPUT_CAP)} at which the host cuts a hook's output to a preview.`,
      fix: over
        ? `Cut the output under ${num(HOOK_OUTPUT_CAP)} characters: keep the rules the agent must follow unasked, and move reference text to a file a route reads. Two hooks on the same event each get their own ${num(HOOK_OUTPUT_CAP)}.`
        : "Leave room for the state it prints to grow (a longer branch name, one more card): cap what it lists, or split the standing rules and the state into two hook commands.",
    });
  }
}

/** The line of a failure that says what failed: the error itself, not the stack or the host's preamble around it. */
const errorLine = (text) => /^.*\b\w*Error\b: .+$/m.exec(String(text ?? ""))?.[0].trim() ?? text;

function hookFailed(session, add) {
  const failed = session.events.filter((e) => e.kind === "hook" && e.visibility === "error");
  for (const [, runs] of groupBy(failed, (e) => `${e.event}\0${ownerOf(e) ?? ""}`)) {
    const [first] = runs;
    const moved = /Cannot find module|ENOENT|no such file/i.test(first.text);
    add({
      code: "HOOK_FAILED",
      owner: ownerOf(first),
      segment: first.segment,
      turn: first.phase === "start" ? null : first.phase,
      events: runs.map((e) => e.id),
      what: `Its ${first.event} hook failed ${plural(runs.length, "time")}: ${one(errorLine(first.text), 200).replace(/[.\s]+$/, "") || "no message recorded"}. A hook that fails says nothing to the model.`,
      fix: moved
        ? "The file it runs is gone: an update replaces the plugin's root, and a session started before it still runs the old path. Start a new session; if it fails there too, the hook map names a file the plugin no longer ships."
        : "Run the hook's command by hand with the event's payload on stdin and read what it prints to stderr.",
    });
  }
}

function hookPersonOnly(session, add) {
  const spoke = session.events.filter((e) => e.kind === "hook" && (e.visibility === "model" || e.visibility === "person") && ownerOf(e));
  for (const [, runs] of groupBy(spoke, (e) => `${e.event}\0${ownerOf(e)}`)) {
    if (runs.some((e) => e.visibility === "model")) continue;
    const [first] = runs;
    add({
      code: "HOOK_PERSON_ONLY",
      owner: ownerOf(first),
      segment: first.segment,
      turn: first.phase === "start" ? null : first.phase,
      events: runs.map((e) => e.id),
      what: `Every ${first.event} output from it (${plural(runs.length, "run")}) was a systemMessage: the person saw "${one(first.text, 80)}" and the model never did.`,
      fix: `If the agent has to act on it, return it where the model reads it: additionalContext, or on Stop a "block" decision with the reason. If it is only for the person, nothing to change.`,
    });
  }
}

function hookRepeats(session, add) {
  const perTurn = session.events.filter((e) => e.kind === "hook" && e.visibility === "model" && e.text && e.phase !== "start");
  for (const [, runs] of groupBy(perTurn, (e) => `${e.event}\0${ownerOf(e) ?? ""}\0${e.text}`)) {
    const turns = new Set(runs.map((e) => e.phase));
    if (turns.size < REPEAT_TURNS) continue;
    const [first] = runs;
    add({
      code: "HOOK_REPEATS",
      owner: ownerOf(first),
      segment: first.segment,
      turn: first.phase,
      events: runs.map((e) => e.id),
      what: `Its ${first.hookName} hook put the same ~${num(first.tokens)} tokens in the window on ${plural(turns.size, "turn")}, ~${num(first.tokens * runs.length)} in all: "${one(first.text, 80)}"`,
      fix: "Say it once. A rule belongs in a critical line at the start; a nudge should fire only when what it reports has changed since it last spoke.",
    });
  }
}

// ---- standing context ---------------------------------------------------------

const lineKey = (line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\s+/g, " ").trim();
const channel = (ev) => (ev.kind === "hook" ? `${ev.event} hook of ${ownerOf(ev) ?? "no plugin the lens knows"}` : ev.label);

function dupText(session, add) {
  const seen = new Set();
  for (const segment of session.segments) {
    const start = session.events.filter((e) => e.segment === segment.index && e.phase === "start" && e.visibility === "model" && (e.kind === "hook" || e.kind === "instructions") && e.text);
    const where = new Map(); // a long line to the events that carry it
    for (const ev of start) {
      for (const key of new Set(ev.text.split("\n").map(lineKey).filter((l) => l.length >= DUP_LINE_CHARS))) {
        if (!where.has(key)) where.set(key, []);
        where.get(key).push(ev);
      }
    }
    const pairs = new Map();
    for (const [line, events] of where) {
      for (let i = 0; i < events.length; i += 1) {
        for (let j = i + 1; j < events.length; j += 1) {
          const [a, b] = [events[i], events[j]];
          // The same channel twice is a resume, which has a finding of its own.
          if (channel(a) === channel(b)) continue;
          const key = [channel(a), channel(b)].sort().join("\0");
          if (!pairs.has(key)) pairs.set(key, { a, b, lines: [] });
          pairs.get(key).lines.push(line);
        }
      }
    }
    for (const [key, { a, b, lines }] of pairs) {
      if (seen.has(key)) continue;
      seen.add(key);
      const chars = lines.reduce((n, l) => n + l.length, 0);
      add({
        code: "DUP_TEXT",
        owner: ownerOf(a) ?? ownerOf(b),
        segment: segment.index,
        events: [a.id, b.id],
        what: `${plural(lines.length, "line")} (${num(chars)} characters) reached the model twice at the start, from the ${channel(a)} and from ${b.kind === "hook" ? "the " : ""}${channel(b)}: "${one(lines[0], 80)}"`,
        fix: "Keep one copy. A rule a hook prints does not also belong in a rule file the repo imports, and two hooks should not both print it.",
      });
    }
  }
}

function criticalTotal(session, add) {
  for (const segment of session.segments) {
    const start = session.events.filter((e) => e.segment === segment.index && e.phase === "start" && e.kind === "hook" && e.visibility === "model" && e.blocks?.length);
    // A resume prints the blocks again, so an owner counts once, at its largest.
    const owners = new Map();
    for (const ev of start) for (const b of ev.blocks) owners.set(b.owner, Math.max(owners.get(b.owner) ?? 0, b.chars ?? b.tokens * 4));
    const total = [...owners.values()].reduce((n, c) => n + c, 0);
    if (total <= CRITICAL_TOTAL) continue;
    const largest = [...owners].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([owner, chars]) => `${owner} ${num(chars)}`).join(", ");
    add({
      code: "CRITICAL_TOTAL_OVER",
      owner: null,
      segment: segment.index,
      events: start.map((e) => e.id),
      what: `The critical lines of ${plural(owners.size, "owner")} came to ${num(total)} characters at the start of ${seg(segment.index)}, over the ${num(CRITICAL_TOTAL)} they are held to. The largest: ${largest}.`,
      fix: "Every request carries them. Keep a line only where the agent must act without being asked and would otherwise not know to; what a route already says belongs in the route.",
    });
    return; // one finding: a later segment repeats the same lines
  }
}

function listingBare(session, add) {
  const listed = session.events.filter((e) => e.kind === "skills" && e.source?.focus && e.entries?.length);
  // The first listing of each plugin: a compaction sends the same one again.
  const first = new Map();
  for (const ev of listed) {
    const key = ev.source.plugin;
    if (!first.has(key)) first.set(key, { segment: ev.segment, events: [] });
    if (first.get(key).segment === ev.segment) first.get(key).events.push(ev);
  }
  for (const [plugin, { segment, events }] of first) {
    const entries = events.flatMap((e) => e.entries);
    const bare = entries.filter((e) => e.bare);
    if (!bare.length) continue;
    const names = bare.map((e) => e.name.split(":").pop());
    add({
      code: "LISTING_BARE",
      owner: plugin,
      segment,
      events: events.map((e) => e.id),
      what: `${num(bare.length)} of ${plural(entries.length, "skill")} from ${plugin} ${bare.length === 1 ? "was" : "were"} listed by name only: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}. The model saw no description, so nothing in the listing said when to reach for ${bare.length === 1 ? "it" : "them"}.`,
      fix: "The host drops descriptions at a 200k window and when the listing is over its budget. Make each name carry its job, and name what the listing no longer says (a route, the moment to call) in a critical line.",
    });
  }
}

// ---- compactions ----------------------------------------------------------------

/** Standing context that is not a hook's, by the lens's kind: what a person would call it. */
const STANDING = { skills: "skill listing", agents: "agent listing", "tool-definitions": "tool definitions", "tools-deferred": "deferred tool names", "mcp-instructions": "MCP instructions" };

function compactLost(session, add) {
  for (const c of session.compactions) {
    const after = c.fromSegment + 1;
    const lost = c.rows.filter((r) => r.status === "lost").map((r) => { const [kind, owner = null] = r.label.split(" · "); return { ...r, kind, owner }; });
    // What a hook said at the start: one finding per owner, with why it did not come back.
    for (const row of lost.filter((r) => !(r.kind in STANDING))) {
      const runs = session.events.filter((e) => e.segment === after && e.kind === "hook" && e.event === row.kind && ownerOf(e) === row.owner);
      const cause = runs.some((e) => e.visibility === "error") ? `Its ${row.kind} hook failed on the run after the compaction.`
        : runs.some((e) => e.visibility === "silent") ? `Its ${row.kind} hook ran after the compaction and printed nothing.`
        : `No ${row.kind} hook of its ran after the compaction: the hook's matcher leaves out \`compact\`.`;
      add({
        code: "COMPACT_LOST",
        owner: row.owner,
        segment: after,
        compaction: c.index,
        events: runs.map((e) => e.id),
        what: `Its ${row.kind} context (~${num(row.tokensBefore)} tokens) was in the window before compaction ${c.index + 1} and no request after it carried it. ${cause}`,
        fix: runs.length ? "Make the hook print the same context whatever started the session: read `source` from the payload only to add to it, never to skip."
          : "Add `compact` to the SessionStart matcher: \"startup|resume|clear|compact\". A compaction drops what the hook said at startup and runs only the hooks that match `compact`.",
      });
    }
    // What the host sends: one finding per kind, however many plugins and areas it was split by.
    for (const [kind, rows] of groupBy(lost.filter((r) => r.kind in STANDING), (r) => r.kind)) {
      const owners = rows.map((r) => r.owner).filter(Boolean);
      add({
        code: "COMPACT_LOST",
        owner: owners.length === 1 ? owners[0] : null,
        segment: after,
        compaction: c.index,
        events: [],
        what: `The ${STANDING[kind]} of ${owners.slice(0, 6).join(", ")}${owners.length > 6 ? `, and ${owners.length - 6} more` : ""} (~${num(rows.reduce((n, r) => n + r.tokensBefore, 0))} tokens) was in the window before compaction ${c.index + 1} and the transcript records no copy sent after it.`,
        fix: "The host sends this, not the plugin, so there is nothing to change in one. Check the session on the page: if the agent went on to call a skill it could no longer see listed, the transcript is from a host that drops the listing, and a critical line is the only text that names it.",
      });
    }
  }
}

function compactOnlyResume(session, add) {
  for (const segment of session.segments.filter((s) => s.startedBy === "compact")) {
    const requests = session.requests.filter((r) => r.segment === segment.index);
    if (!requests.length) continue;
    const said = session.events.filter((e) => e.segment === segment.index && e.kind === "hook" && e.event === "SessionStart" && e.visibility === "model" && ownerOf(e));
    for (const [owner, runs] of groupBy(said, ownerOf)) {
      if (runs.some((e) => e.hookName === "SessionStart:compact")) continue;
      const first = Math.min(...runs.map((e) => time(e.at)));
      const without = requests.filter((r) => time(r.at) < first).length;
      if (!without) continue;
      add({
        code: "COMPACT_ONLY_RESUME",
        owner,
        segment: segment.index,
        compaction: segment.index - 1,
        events: runs.map((e) => e.id),
        what: `After compaction ${segment.index}, its SessionStart context came back only on a later ${runs[0].hookName.split(":")[1] ?? "run"}: ${plural(without, "request")} went out without it first.`,
        fix: "Add `compact` to the SessionStart matcher: \"startup|resume|clear|compact\". The session only got its context back because it happened to be resumed.",
      });
    }
  }
}

const ROUTE_FILE = /\/skills\/([^/]+)\/routes\/([^/]+)\/ROUTE\.md$/;

function routeNotReread(session, add) {
  for (const c of session.compactions) {
    const after = session.segments[c.fromSegment + 1];
    if (!after || after.baselineTokens === null || after.baselineTokens === undefined) continue;
    const before = session.reads.filter((r) => r.segment === c.fromSegment && r.ok !== false && ROUTE_FILE.test(r.file));
    const last = before[before.length - 1];
    if (!last || session.reads.some((r) => r.segment === after.index && r.file === last.file)) continue;
    const [, area, route] = ROUTE_FILE.exec(last.file);
    add({
      code: "ROUTE_NOT_REREAD",
      owner: area,
      segment: after.index,
      compaction: c.index,
      events: [],
      what: `The ${route} route of ${area} was the last route read before compaction ${c.index + 1} (turn ${last.turn}) and was not read again after it. The host re-attaches a skill it loaded, never a file read by path, so the route's steps were gone.`,
      fix: "If that route's work was still under way, read its ROUTE.md again. The area's body is what comes back, so it has to say so: \"After a compaction, read your route's ROUTE.md again before going on.\"",
    });
  }
}

// ---- skills ----------------------------------------------------------------------

function skillRefused(session, add) {
  const refused = session.skillCalls.filter((c) => c.ok === false);
  for (const [skill, calls] of groupBy(refused, (c) => c.skill)) {
    const [first] = calls;
    add({
      code: "SKILL_REFUSED",
      owner: skill.includes(":") ? skill.split(":")[0] : null,
      segment: first.segment,
      turn: first.turn,
      events: [],
      what: `The host refused ${plural(calls.length, "call")} on ${skill}${first.error ? `: "${one(first.error, 120).replace(/[.\s]+$/, "")}"` : ""}. A refused call comes back as an error, and for a skill only a person may start it tells the model to stop.`,
      fix: "If the skill is hidden with `disable-model-invocation` and something the plugin prints sends an agent to it, let a model call it: `user-invocable: false` keeps it out of the slash menu and still callable. If the name is wrong, fix the address that sent the agent there.",
    });
  }
}

function skillReinvoked(session, add) {
  const went = session.skillCalls.filter((c) => c.ok === true);
  for (const [, calls] of groupBy(went, (c) => `${c.segment}\0${c.skill}`)) {
    if (calls.length < 2) continue;
    const [first] = calls;
    add({
      code: "SKILL_REINVOKED",
      owner: first.skill.includes(":") ? first.skill.split(":").pop() : first.skill,
      segment: first.segment,
      turn: calls[1].turn,
      events: [],
      what: `${first.skill} was called ${plural(calls.length, "time")} in ${seg(first.segment)} (turns ${calls.map((c) => c.turn).join(", ")}). Each call appends the skill's whole body to the conversation again.`,
      fix: "A loaded skill stays in the window until a compaction. To take another route of an area already loaded, read that route's ROUTE.md; if the body tells the agent to call the skill again, change it to say read.",
    });
  }
}

// ---- subagents -------------------------------------------------------------------

function subagentContext(session, subagents, add) {
  const quiet = new Set(QUIET_AGENTS);
  const all = session.agentType ? [{ agentType: session.agentType, session }, ...subagents] : subagents;
  const told = new Map();
  for (const { agentType, session: sub } of all) {
    if (!quiet.has(agentType)) continue;
    for (const ev of sub.events) {
      if (ev.kind !== "hook" || ev.visibility !== "model" || !ev.text || !ownerOf(ev) || ev.source.plugin === "Claude Code") continue;
      if (ev.event !== "SubagentStart" && ev.event !== "SessionStart") continue;
      const key = `${agentType}\0${ownerOf(ev)}`;
      const row = told.get(key) ?? { agentType, owner: ownerOf(ev), runs: 0, tokens: 0, text: ev.text, own: sub === session ? [] : null };
      row.runs += 1;
      row.tokens = Math.max(row.tokens, ev.tokens);
      if (row.own) row.own.push(ev.id);
      told.set(key, row);
    }
  }
  for (const row of told.values()) {
    add({
      code: "SUBAGENT_CONTEXT",
      owner: row.owner,
      segment: null,
      events: row.own ?? [],
      what: `${plural(row.runs, `${row.agentType} subagent`)} started with ~${num(row.tokens)} tokens of its context: "${one(row.text, 80)}". ${row.agentType.endsWith("critic") ? "A blind critic must not be told what it judges." : "A read-only searcher has no use for the build rules."}`,
      fix: "Have the SubagentStart hook print nothing for that agent type: the payload's `agent_type` names it.",
    });
  }
}

// ---- what limits the reading ------------------------------------------------------

function resumeRepeat(session, add) {
  for (const segment of session.segments) {
    const said = session.events.filter((e) => e.segment === segment.index && e.kind === "hook" && e.event === "SessionStart" && e.visibility === "model" && e.text && ownerOf(e));
    for (const [owner, runs] of groupBy(said, ownerOf)) {
      const kinds = new Set(runs.map((e) => e.hookName));
      if (runs.length < 2 || kinds.size < 2) continue;
      add({
        code: "RESUME_REPEAT",
        owner,
        segment: segment.index,
        events: runs.map((e) => e.id),
        what: `Its SessionStart context entered ${seg(segment.index)} ${plural(runs.length, "time")} (${[...kinds].map((k) => k.split(":")[1] ?? k).join(", ")}), ~${num(runs.reduce((n, e) => n + e.tokens, 0))} tokens in all: a resume runs the hook again and the earlier copy stays in the window.`,
        fix: "This is the host's doing, and it is why a session start has to stay small. Nothing to change unless the context is large.",
      });
    }
  }
}

function unattributed(session, add) {
  const loose = session.events.filter((e) => e.kind === "hook" && !e.source?.plugin && e.visibility !== "silent");
  if (!loose.length) return;
  const candidates = [...new Set(loose.flatMap((e) => e.source?.candidates ?? []))].sort();
  add({
    code: "UNATTRIBUTED",
    owner: null,
    segment: loose[0].segment,
    events: loose.map((e) => e.id),
    what: `${plural(loose.length, "hook output")} could not be tied to a plugin (${[...new Set(loose.map((e) => e.hookName ?? e.event))].slice(0, 4).join(", ")})${candidates.length ? `; the plugins whose hooks could have fired: ${candidates.slice(0, 6).join(", ")}${candidates.length > 6 ? `, and ${candidates.length - 6} more` : ""}` : ""}. Nothing above counts them against an owner.`,
    fix: "The lens knows a hook from the hooks.json of each plugin in the cache. A hook in settings.json, a built-in one, or a plugin loaded with --plugin-dir is not there.",
  });
}

function partial(session, add) {
  const limits = [];
  if (session.badLines) limits.push(`${plural(session.badLines, "line")} of the transcript could not be read`);
  if (session.compactions.some((c) => c.beforeRecorded === false)) limits.push("it opens at a compaction, so what the session started with is not in it");
  if (!session.requests.length) limits.push("it records no API request, so no size here is measured");
  if (!limits.length) return;
  add({
    code: "TRANSCRIPT_PARTIAL",
    owner: null,
    segment: null,
    events: [],
    what: `This transcript is partial: ${limits.join("; ")}.`,
    fix: "Read the findings as a floor. For the start, diagnose the session this one continues.",
  });
}

/**
 * The findings for one session, most serious first. `subagents` is
 * `[{ agentType, session }]` for the sessions it started, where the caller
 * has them; a session that is itself a subagent's carries `agentType`.
 */
export function diagnose(session, { subagents = [] } = {}) {
  const findings = [];
  const add = (f) => findings.push({ level: CODES[f.code], turn: null, compaction: null, ...f });
  hookSize(session, add);
  compactLost(session, add);
  skillRefused(session, add);
  hookFailed(session, add);
  hookPersonOnly(session, add);
  hookRepeats(session, add);
  dupText(session, add);
  criticalTotal(session, add);
  compactOnlyResume(session, add);
  routeNotReread(session, add);
  listingBare(session, add);
  skillReinvoked(session, add);
  subagentContext(session, subagents, add);
  resumeRepeat(session, add);
  unattributed(session, add);
  partial(session, add);
  // Stable within a level: the order the checks ran in is the order of the catalogue.
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => LEVELS.indexOf(a.f.level) - LEVELS.indexOf(b.f.level) || a.i - b.i)
    .map(({ f }) => f);
}

export const countLevels = (findings) => Object.fromEntries(LEVELS.map((level) => [level, findings.filter((f) => f.level === level).length]));

/** The header every form of the diagnosis shares. */
export function summary(session, findings) {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    version: session.version,
    file: session.file ?? null,
    requests: session.requests.length,
    peakTokens: Math.max(0, ...session.requests.map((r) => r.contextTokens)),
    compactions: session.compactions.length,
    counts: countLevels(findings),
    thresholds: { HOOK_OUTPUT_CAP, HOOK_OUTPUT_NEAR, CRITICAL_TOTAL, REPEAT_TURNS, DUP_LINE_CHARS },
  };
}

const where = (f) => [f.owner, f.turn ? `turn ${f.turn}` : f.segment !== null && f.segment !== undefined ? seg(f.segment) : null].filter(Boolean).join(" · ");

/** The diagnosis as plain text, for an agent to read without a browser. */
export function renderDiagnosis(session, findings) {
  const head = summary(session, findings);
  const { critical, warning, info } = head.counts;
  const lines = [
    `Context Doctor: ${session.title ?? session.id ?? "session"}`,
    `${session.cwd ?? "?"} · Claude Code ${session.version ?? "?"} · ${num(head.requests)} API requests · peak ${num(head.peakTokens)} tokens · ${head.compactions} compaction(s)`,
    findings.length
      ? `${critical} critical, ${plural(warning, "warning")}, ${plural(info, "note")}. ~ is an estimate (characters / 4); a count of characters is exact.`
      : "No findings: nothing in this transcript went over a cap, was lost at a compaction, was refused, or reached only the person.",
  ];
  for (const f of findings) {
    lines.push("");
    lines.push(`${f.level.padEnd(8)} ${f.code}${where(f) ? ` · ${where(f)}` : ""}`);
    lines.push(`  what  ${f.what}`);
    lines.push(`  fix   ${f.fix}`);
  }
  return `${lines.join("\n")}\n`;
}
