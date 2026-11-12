// The lens as plain text, for an agent to read without a browser: each
// segment's start, each turn that the focus plugins spoke in, and what every
// compaction kept or lost.
const num = (n) => Number(n ?? 0).toLocaleString("en-US");
const pad = (s, n) => String(s).padEnd(n);
const one = (text, n = 90) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

const CONVERSATION = new Set(["prompt", "notification", "assistant", "tool-result"]);

/** In the default lens: anything from a focus plugin, and any hook no plugin claimed (it may be ours). */
export function inLens(ev, all = false) {
  if (all) return !CONVERSATION.has(ev.kind);
  return ev.source.focus || (ev.kind === "hook" && !ev.source.plugin);
}

const byPhase = (a, b) => (a === "start" ? -1 : b === "start" ? 1 : a - b);

export function renderReport(session, { all = false } = {}) {
  const lines = [];
  const peak = Math.max(0, ...session.requests.map((r) => r.contextTokens));
  lines.push(`Context Lens: ${session.title ?? session.id ?? "session"}`);
  lines.push(`${session.cwd ?? "?"} · Claude Code ${session.version ?? "?"} · ${session.requests.length} API requests · peak ${num(peak)} tokens · ${session.compactions.length} compaction(s)`);
  lines.push(all
    ? "Showing all context except the conversation itself."
    : `Showing the ${session.focus ?? "focus"} plugins, and any hook no plugin claimed. ~ is an estimate (characters / 4); request sizes are the API's own.`);

  for (const seg of session.segments) {
    lines.push("");
    lines.push(`Segment ${seg.index + 1} (${seg.startedBy}) · first request ${seg.baselineTokens === null ? "n/a" : `${num(seg.baselineTokens)} tokens`} · ${seg.turns} turn(s)`);
    const events = session.events.filter((e) => e.segment === seg.index && inLens(e, all));
    for (const phase of [...new Set(events.map((e) => e.phase))].sort(byPhase)) {
      lines.push(phase === "start" ? "  start" : `  turn ${phase} · ${one(session.turns[phase - 1]?.preview ?? "", 70)}`);
      for (const e of events.filter((x) => x.phase === phase)) {
        const what = e.kind === "hook" ? e.hookName ?? e.event : e.kind;
        const tokens = e.visibility === "model" ? `~${num(e.tokens)}` : "";
        const text = e.kind === "hook" ? one(e.text || e.detail || "") : one(`${e.label}${e.detail ? ` (${e.detail})` : ""}`);
        const who = e.source.plugin ?? (e.kind === "hook" ? "unattributed" : e.source.origin ? `${e.source.origin} file` : "Claude Code");
        lines.push(`    ${pad(what, 26)} ${pad(who, 18)} ${pad(e.visibility, 7)} ${pad(tokens, 8)} ${text}`);
      }
    }
    const compaction = session.compactions.find((c) => c.fromSegment === seg.index);
    if (compaction) {
      lines.push("");
      lines.push(`Compaction ${compaction.index + 1}: ${compaction.trigger ?? "?"}, ${num(compaction.preTokens)} -> ${num(compaction.postTokens)} tokens`);
      if (compaction.beforeRecorded === false) lines.push("    this transcript opens here, so nothing before it was recorded; showing what the next segment carried");
      if (!compaction.rows.length) lines.push("    nothing from the focus plugins on either side");
      for (const row of compaction.rows) {
        const sizes = row.status === "kept" ? `~${num(row.tokensBefore)} -> ~${num(row.tokensAfter)}` : row.status === "new" || row.status === "after only" ? `~${num(row.tokensAfter)}` : `~${num(row.tokensBefore)} before`;
        lines.push(`    ${pad(row.status, 12)} ${pad(row.label, 46)} ${sizes}${row.perTurn ? " (per turn)" : ""}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
