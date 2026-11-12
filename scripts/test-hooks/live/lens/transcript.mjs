// A Claude Code session transcript (~/.claude/projects/<slug>/<id>.jsonl)
// read back into what entered the model's context, when, and from where.
//
// What is true and what is estimated:
//   - The text is the transcript's own. An attachment carries `rendered`, the
//     exact copy the model received; a hook run carries its stdout, which is
//     where a systemMessage (shown to the person, never the model) is kept.
//   - Context size per API request is the API's own usage: input plus cache
//     reads plus cache writes.
//   - Tokens per item are estimates, characters over four.
//
// Segments split at compaction boundaries: everything before one is gone from
// the context after it, so the compaction check compares what each segment
// carried at its start.
//
// Import-safe and pure: the caller reads the file and loads the sources.
import { attributeHook, emptySources, hookCandidates, inFocus, serverPlugin, splitListing, toolPlugin } from "./sources.mjs";

export const estimateTokens = (text) => Math.ceil(String(text ?? "").length / 4);

export function parseJsonl(text) {
  const entries = [];
  let bad = 0;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { bad += 1; }
  }
  return { entries, bad };
}

/** Standing context: what a segment carries from its start, as opposed to what a turn adds. */
const STANDING = new Set(["system-prompt", "tool-definitions", "instructions", "skills", "agents", "tools-deferred", "mcp-instructions", "reattach", "summary", "harness"]);

const blocksText = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => {
    if (typeof c === "string") return c;
    if (c?.type === "text") return c.text ?? "";
    if (c?.type === "tool_use") return `${c.name}(${JSON.stringify(c.input ?? {})})`;
    if (c?.type === "tool_result") return blocksText(c.content);
    return typeof c?.content === "string" ? c.content : "";
  }).join("\n");
};

const renderedText = (rendered) => {
  if (typeof rendered === "string") return rendered;
  if (!Array.isArray(rendered)) return null;
  return rendered.map((r) => (typeof r === "string" ? r : blocksText(r?.content ?? r?.text ?? ""))).join("\n");
};

const stripReminders = (text) => String(text).replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "");
export const preview = (text, n = 160) => {
  const flat = stripReminders(text).replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

function parseStdout(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return {};
  try {
    const out = JSON.parse(raw);
    if (!out || typeof out !== "object") return { plain: raw };
    const specific = out.hookSpecificOutput ?? {};
    return {
      additionalContext: specific.additionalContext ?? out.additionalContext ?? out.additional_context,
      systemMessage: out.systemMessage,
      decision: out.decision ?? specific.permissionDecision,
      reason: out.reason ?? specific.permissionDecisionReason,
    };
  } catch {
    return { plain: raw };
  }
}

const HOME = /^\/(?:Users|home)\/[^/]+\//;

/** Instruction files: the user's own and the repo's, .agents/ files included. */
function instructionSource(file, cwd) {
  const p = String(file ?? "");
  const inRepo = cwd && p.startsWith(`${cwd}/`);
  // One label per file whichever checkout loaded it, so a session that moves
  // into a worktree is not read as having lost its rules.
  const agents = p.lastIndexOf("/.agents/");
  const worktree = /\/\.claude\/worktrees\/[^/]+\/(.+)$/.exec(p);
  const label = agents !== -1 ? p.slice(agents + 1) : inRepo ? p.slice(cwd.length + 1) : worktree ? worktree[1] : HOME.test(p) ? p.replace(HOME, "~/") : p;
  if (/^\/(?:Users|home)\/[^/]+\/\.claude\//.test(p) && !worktree) return { label, source: { plugin: null, origin: "user" } };
  return { label, source: { plugin: null, origin: "repo" } };
}

export function buildSession(entries, { sources = emptySources() } = {}) {
  const first = entries.find((e) => e.cwd) ?? {};
  const cwd = first.cwd ?? null;
  const session = {
    id: entries.find((e) => e.sessionId)?.sessionId ?? null,
    cwd,
    version: entries.find((e) => e.version)?.version ?? null,
    title: null,
    startedAt: entries.find((e) => e.timestamp)?.timestamp ?? null,
    endedAt: null,
    focus: sources.focus,
    events: [],
    requests: [],
    segments: [],
    compactions: [],
    turns: [],
  };

  let segment = -1;
  let turn = 0;
  let seenAssistant = false;
  let shape = null;
  const assistants = new Map();
  const byRequest = new Map();
  const toolNames = new Map();
  // Per hook run (its toolUseID): which plugins spoke and what they said, so a
  // later summary or system-message entry is not counted twice.
  const runs = new Map();
  const run = (id) => { if (!runs.has(id)) runs.set(id, { spoke: new Set(), model: new Map(), person: new Map(), plugins: [] }); return runs.get(id); };

  const source = (src) => ({ ...src, focus: inFocus(sources, src.plugin, src.candidates ?? []) });
  const phaseFor = (kind, event) => {
    if (kind === "hook" && (event === "SessionStart" || event === "SubagentStart")) return "start";
    if (STANDING.has(kind) && !seenAssistant) return "start";
    return turn || "start";
  };
  const push = (entry, ev) => {
    const kind = ev.kind;
    const out = {
      id: session.events.length,
      at: entry?.timestamp ?? null,
      segment,
      phase: ev.phase ?? phaseFor(kind, ev.event),
      tokens: estimateTokens(ev.text),
      visibility: "model",
      ...ev,
      source: source(ev.source ?? { plugin: null }),
    };
    session.events.push(out);
    return out;
  };

  // The shape in force at the segment's start. A new shape before the first
  // request replaces it; one after is a change, shown in the turn it happened.
  let startShape = [];
  let shown = new Map();
  const emitShape = (entry, carried = false) => {
    if (!shape) return;
    const phase = carried || !seenAssistant ? "start" : turn || "start";
    const made = [];
    if (phase === "start") shown = new Map();
    // Mid-segment, only the parts that changed are news.
    const changed = (key, text) => { const same = phase !== "start" && shown.get(key) === text; shown.set(key, text); return !same; };
    const system = (shape.system ?? []).map((b) => b?.text ?? "").join("\n\n");
    if (changed("system", system)) made.push(push(entry, { kind: "system-prompt", label: "system prompt", phase, text: system, detail: `${(shape.system ?? []).length} blocks${phase === "start" ? "" : ", changed"}`, carried }));
    const groups = new Map();
    for (const tool of shape.tools ?? []) {
      const plugin = toolPlugin(sources, tool?.name);
      if (!groups.has(plugin)) groups.set(plugin, []);
      groups.get(plugin).push(tool);
    }
    for (const [plugin, tools] of groups) {
      const text = tools.map((t) => JSON.stringify(t)).join("\n");
      if (!changed(`tools:${plugin}`, text)) continue;
      made.push(push(entry, {
        kind: "tool-definitions",
        label: plugin ? `tools · ${plugin}` : "tools · built-in and connectors",
        phase,
        text,
        detail: `${tools.length} definition${tools.length === 1 ? "" : "s"}: ${tools.map((t) => t.name).slice(0, 8).join(", ")}${tools.length > 8 ? ", …" : ""}`,
        source: { plugin },
        carried,
      }));
    }
    if (phase === "start") {
      for (const ev of startShape) ev.superseded = true;
      startShape = made;
    }
  };

  const openSegment = (entry, startedBy, meta = {}) => {
    segment += 1;
    seenAssistant = false;
    startShape = [];
    shown = new Map();
    session.segments.push({ index: segment, startedBy, at: entry?.timestamp ?? null, baselineTokens: null, turns: 0, ...meta });
    // The system prompt and tool definitions do not change at a compaction,
    // so the transcript does not record them again; carry them across.
    if (segment > 0) emitShape(entry, true);
  };
  openSegment(entries[0], "startup");

  const hookRun = (entry, a) => {
    const event = a.hookEvent ?? String(a.hookName ?? "").split(":")[0];
    const attribution = attributeHook(sources, { event, command: a.command ?? "", text: a.stderr ?? "" });
    const parsed = parseStdout(a.stdout);
    const base = { kind: "hook", event, hookName: a.hookName ?? event, label: a.hookName ?? event, source: attribution, command: a.command ?? null, durationMs: a.durationMs ?? null };
    const record = run(a.toolUseID ?? `${event}:${entry.timestamp}`);
    record.plugins.push(attribution);
    const rendered = renderedText(entry.rendered);
    const modelText = parsed.additionalContext ?? (rendered !== null ? a.content || parsed.plain : null);
    let spoke = false;
    if (modelText) {
      const ev = push(entry, { ...base, visibility: "model", text: String(modelText) });
      record.model.set(String(modelText), ev);
      spoke = true;
    }
    if (parsed.systemMessage) {
      push(entry, { ...base, visibility: "person", text: String(parsed.systemMessage), detail: "systemMessage: shown to the person, not the model" });
      record.person.set(String(parsed.systemMessage), true);
      spoke = true;
    }
    if (parsed.decision && parsed.decision !== "allow" && parsed.decision !== "approve") {
      push(entry, { ...base, visibility: "model", text: String(parsed.reason ?? ""), detail: `decision: ${parsed.decision}` });
      spoke = true;
    }
    if (spoke) record.spoke.add(attribution.plugin);
    // A silent Stop run is listed by the stop summary, which also names the
    // hooks that left no run entry at all; anything else is listed here.
    else if (event !== "Stop") push(entry, { ...base, visibility: "silent", text: "" });
  };

  for (const entry of entries) {
    if (entry.timestamp) session.endedAt = entry.timestamp;
    if (entry.type === "custom-title" && entry.customTitle) session.title = entry.customTitle;
    else if (entry.type === "agent-name" && entry.agentName && !session.title) session.title = entry.agentName;
    else if (entry.type === "last-prompt" && entry.lastPrompt && !session.title) session.title = preview(entry.lastPrompt, 80);

    if (entry.type === "api-request-shape" && entry.shape && typeof entry.shape === "object") {
      shape = entry.shape;
      emitShape(entry);
      continue;
    }

    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      const meta = entry.compactMetadata ?? {};
      session.compactions.push({ index: session.compactions.length, at: entry.timestamp ?? null, trigger: meta.trigger ?? null, preTokens: meta.preTokens ?? null, postTokens: meta.postTokens ?? null, fromSegment: segment, rows: [] });
      openSegment(entry, "compact", { trigger: meta.trigger ?? null });
      continue;
    }

    if (entry.type === "system" && entry.subtype === "stop_hook_summary") {
      const record = run(entry.toolUseID ?? `Stop:${entry.timestamp}`);
      for (const info of entry.hookInfos ?? []) {
        if (!info?.command || info.command === "callback") continue;
        const attribution = attributeHook(sources, { event: "Stop", command: info.command });
        if (record.spoke.has(attribution.plugin)) continue;
        push(entry, { kind: "hook", event: "Stop", hookName: "Stop", label: "Stop", visibility: "silent", text: "", source: attribution, command: info.command, durationMs: info.durationMs ?? null });
      }
      continue;
    }

    if (entry.type === "attachment" && entry.attachment) {
      const a = entry.attachment;
      const rendered = renderedText(entry.rendered);

      if (a.type === "hook_success") { hookRun(entry, a); continue; }

      if (a.type === "hook_additional_context") {
        const event = a.hookEvent ?? String(a.hookName ?? "").split(":")[0];
        const record = runs.get(a.toolUseID);
        for (const text of Array.isArray(a.content) ? a.content : [a.content]) {
          if (!text) continue;
          const claimed = record?.model.get(String(text)) ?? [...runs.values()].map((r) => r.model.get(String(text))).find(Boolean);
          if (claimed) { claimed.confirmed = true; continue; }
          // No run entry claimed it: name the plugins whose hooks could have.
          const tool = String(a.hookName ?? "").split(":")[1] ?? "";
          const candidates = hookCandidates(sources, event, tool);
          push(entry, { kind: "hook", event, hookName: a.hookName ?? event, label: a.hookName ?? event, visibility: "model", text: String(text), confirmed: true, source: { plugin: null, candidates }, detail: candidates.length ? `no hook run recorded; could be ${candidates.join(", ")}, or a built-in hook` : "no hook run recorded" });
        }
        continue;
      }

      if (a.type === "hook_system_message") {
        const record = runs.get(a.toolUseID);
        if (record?.person.has(String(a.content))) continue;
        const only = record?.plugins.length === 1 ? record.plugins[0] : { plugin: null, candidates: [] };
        push(entry, { kind: "hook", event: a.hookEvent, hookName: a.hookName, label: a.hookName ?? a.hookEvent, visibility: "person", text: String(a.content ?? ""), source: only, detail: "systemMessage: shown to the person, not the model" });
        continue;
      }

      if (a.type === "hook_non_blocking_error" || a.type === "hook_blocking_error" || a.type === "hook_cancelled") {
        const blocking = a.blockingError ?? {};
        const text = String(a.stderr ?? blocking.blockingError ?? "");
        const attribution = attributeHook(sources, { event: a.hookEvent, command: a.command ?? blocking.command ?? "", text });
        const visibility = a.type === "hook_blocking_error" ? "model" : a.type === "hook_cancelled" ? "silent" : "error";
        push(entry, { kind: "hook", event: a.hookEvent, hookName: a.hookName, label: a.hookName ?? a.hookEvent, visibility, text, source: attribution, detail: a.type.replace(/^hook_/, "").replace(/_/g, " ") });
        continue;
      }

      if (a.type === "instructions" && Array.isArray(a.files)) {
        for (const file of a.files) {
          const { label, source: src } = instructionSource(file.path, cwd);
          push(entry, { kind: "instructions", label, text: String(file.content ?? ""), detail: String(file.type ?? ""), source: src, file: file.path });
        }
        continue;
      }

      if (a.type === "nested_memory") {
        const file = a.path ?? a.filename ?? a.content?.path ?? null;
        const { label, source: src } = instructionSource(file, cwd);
        push(entry, { kind: "instructions", label: label || "nested CLAUDE.md", text: rendered ?? blocksText(a.content), detail: "loaded on reading a file below it", source: src, file });
        continue;
      }

      if (a.type === "skill_listing" || a.type === "agent_listing_delta") {
        const text = a.type === "skill_listing" ? a.content : (a.addedLines ?? []).join("\n");
        const kind = a.type === "skill_listing" ? "skills" : "agents";
        const noun = kind === "skills" ? "skill" : "agent";
        for (const group of splitListing(text)) {
          push(entry, {
            kind,
            label: `${kind} · ${group.plugin ?? "not from a plugin"}`,
            text: group.text,
            detail: `${group.count} ${noun}${group.count === 1 ? "" : "s"}${group.bare ? `, ${group.bare} without a description` : ""}`,
            source: { plugin: group.plugin },
            names: group.names,
          });
        }
        continue;
      }

      if (a.type === "deferred_tools_delta") {
        const groups = new Map();
        for (const name of a.addedNames ?? []) {
          const plugin = toolPlugin(sources, name);
          if (!groups.has(plugin)) groups.set(plugin, []);
          groups.get(plugin).push(name);
        }
        for (const [plugin, names] of groups) {
          push(entry, { kind: "tools-deferred", label: `deferred tools · ${plugin ?? "built-in and connectors"}`, text: names.join("\n"), detail: `${names.length} name${names.length === 1 ? "" : "s"}, schemas load on ToolSearch`, source: { plugin }, names });
        }
        continue;
      }

      if (a.type === "mcp_instructions_delta") {
        for (const block of a.addedBlocks ?? []) {
          const server = /^##\s*(.+)$/m.exec(String(block))?.[1]?.trim() ?? "";
          const plugin = serverPlugin(sources, server);
          push(entry, { kind: "mcp-instructions", label: `MCP instructions · ${plugin ?? server}`, text: String(block), source: { plugin } });
        }
        continue;
      }

      if (a.type === "invoked_skills") {
        for (const skill of a.skills ?? []) {
          const plugin = String(skill.name ?? "").includes(":") ? skill.name.split(":")[0] : null;
          push(entry, { kind: "reattach", label: `skill · ${skill.name}`, text: String(skill.content ?? ""), detail: "invoked before the compaction, re-attached after it", source: { plugin } });
        }
        continue;
      }

      if (rendered !== null) {
        const kind = a.type === "file" || a.type === "compact_file_reference" ? "reattach" : "harness";
        const label = kind === "reattach" ? `file · ${String(a.filename ?? a.displayPath ?? "").split("/").pop()}` : a.type;
        push(entry, { kind, label, text: rendered, source: { plugin: null } });
      }
      continue;
    }

    if (entry.type === "user" && entry.message) {
      const content = entry.message.content;
      const results = Array.isArray(content) ? content.filter((c) => c?.type === "tool_result") : [];
      if (results.length) {
        for (const r of results) {
          const name = toolNames.get(r.tool_use_id) ?? "tool";
          push(entry, { kind: "tool-result", label: name, visibility: "model", text: blocksText(r.content), source: { plugin: toolPlugin(sources, name) } });
        }
        continue;
      }
      const text = blocksText(content);
      if (entry.isCompactSummary) {
        push(entry, { kind: "summary", label: "compaction summary", visibility: "model", text, phase: "start" });
        continue;
      }
      if (entry.isMeta) {
        push(entry, { kind: "harness", label: "meta message", visibility: "model", text });
        continue;
      }
      const origin = entry.origin?.kind ?? (entry.turnOrigin === "task_notification" ? "task-notification" : "human");
      turn += 1;
      session.segments[segment].turns += 1;
      session.turns.push({ index: turn, segment, origin, at: entry.timestamp ?? null, preview: preview(text) });
      push(entry, { kind: origin === "human" ? "prompt" : "notification", label: origin === "human" ? `prompt ${turn}` : origin, visibility: "model", text, phase: turn });
      continue;
    }

    if (entry.type === "assistant" && entry.message) {
      const message = entry.message;
      const usage = message.usage;
      const key = entry.requestId ?? message.id;
      const contextTokens = usage ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0;
      // A message replayed into the transcript after a compaction carries no usage of its own.
      if (contextTokens > 0 && key) {
        if (!byRequest.has(key)) {
          const req = { index: byRequest.size, at: entry.timestamp ?? null, segment, turn, contextTokens, outputTokens: usage.output_tokens ?? 0, model: message.model ?? null };
          byRequest.set(key, req);
          session.requests.push(req);
          if (session.segments[segment].baselineTokens === null) session.segments[segment].baselineTokens = contextTokens;
        } else {
          byRequest.get(key).outputTokens = Math.max(byRequest.get(key).outputTokens, usage.output_tokens ?? 0);
        }
        // Only a real request ends the segment's start; a replayed message does not.
        seenAssistant = true;
      }
      for (const block of Array.isArray(message.content) ? message.content : []) if (block?.type === "tool_use") toolNames.set(block.id, block.name);
      const text = blocksText((Array.isArray(message.content) ? message.content : []).filter((c) => c?.type !== "thinking"));
      const id = message.id ?? key;
      const known = assistants.get(id);
      if (known) {
        known.text = known.text ? `${known.text}\n${text}` : text;
        known.tokens = estimateTokens(known.text);
      } else if (text) {
        assistants.set(id, push(entry, { kind: "assistant", label: "assistant", visibility: "model", text }));
      }
    }
  }

  session.events = session.events.filter((e) => !e.superseded);
  session.events.forEach((e, i) => { e.id = i; });
  for (const c of session.compactions) {
    // A transcript can open at a compaction (it continues an earlier file),
    // and then the segment before it has no recorded start to compare against.
    c.beforeRecorded = session.events.some((e) => e.segment === c.fromSegment && e.phase === "start" && !e.carried);
    c.rows = compactionRows(session, c.fromSegment, c.fromSegment + 1, c.beforeRecorded);
  }
  return session;
}

/** A channel is one plugin's kind of context: its SessionStart hook, its skills, one rule file. */
export function channelOf(ev) {
  if (ev.kind === "hook") return `${ev.event} · ${ev.source.plugin ?? "unattributed"}`;
  if (ev.kind === "instructions") return `instructions · ${ev.label}`;
  if (ev.kind === "reattach") return ev.label;
  return `${ev.kind} · ${ev.source.plugin ?? "other"}`;
}

/**
 * What the focus plugins had in context in one segment against the next: the
 * standing context at the start, and each hook that spoke to the model at any
 * point. A per-turn hook the next segment has had no turn to fire yet is
 * "no turn yet", not lost.
 */
export function compactionRows(session, before, after, beforeRecorded = true) {
  const collect = (seg) => {
    const map = new Map();
    for (const ev of session.events) {
      if (ev.segment !== seg || !ev.source.focus || ev.visibility === "person" || ev.visibility === "silent" || ev.visibility === "error") continue;
      if (ev.phase !== "start" && ev.kind !== "hook") continue;
      const label = channelOf(ev);
      const row = map.get(label) ?? { label, tokens: 0, perTurn: ev.phase !== "start" };
      row.tokens += ev.tokens;
      if (ev.phase === "start") row.perTurn = false;
      map.set(label, row);
    }
    return map;
  };
  const a = collect(before);
  const b = collect(after);
  const turnsAfter = session.segments[after]?.turns ?? 0;
  const requested = session.segments[after]?.baselineTokens !== null && session.segments[after]?.baselineTokens !== undefined;
  // Missing after the compaction means lost only for standing context, and
  // only once a request has gone out without it. A per-turn hook speaks when
  // its trigger recurs, which the transcript cannot promise, so it is "not since".
  const missing = (x) => (x.perTurn ? (turnsAfter === 0 ? "no turn yet" : "not since") : requested ? "lost" : "no request yet");
  const rows = [];
  for (const label of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(label);
    const y = b.get(label);
    const status = !beforeRecorded ? "after only" : x && y ? "kept" : y ? "new" : missing(x);
    rows.push({ label, status, tokensBefore: x?.tokens ?? 0, tokensAfter: y?.tokens ?? 0, perTurn: Boolean((x ?? y).perTurn) });
  }
  const order = { lost: 0, "no request yet": 1, "no turn yet": 2, "not since": 3, new: 4, kept: 5, "after only": 6 };
  return rows.sort((p, q) => order[p.status] - order[q.status] || p.label.localeCompare(q.label));
}
