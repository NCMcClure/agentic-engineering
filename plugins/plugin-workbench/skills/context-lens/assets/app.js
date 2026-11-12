// Context Lens page. Reads /api/sessions and /api/session and draws the lens.
// Every string from a transcript is set as text, never parsed as HTML: a
// transcript holds whatever its session read, markup included.
"use strict";

const state = {
  sessions: [],
  focus: "agentic-engineering",
  file: null,
  session: null,
  lens: "plugins",
  vis: new Set(["model", "person", "silent", "error"]),
  follow: false,
  open: new Set(),
  timer: null,
};

const fmt = new Intl.NumberFormat("en-US");
const num = (n) => fmt.format(Math.round(n ?? 0));
const CONVERSATION = new Set(["prompt", "notification", "assistant", "tool-result"]);
const PALETTE = ["#2b59c3", "#2e7d4f", "#a35a00", "#7b3fb3", "#00838f", "#b3261e", "#5d6b00", "#ad1457"];
const VIS_HELP = {
  model: "In the model's context.",
  person: "Shown to the person only. The model never sees it.",
  silent: "Ran and produced nothing.",
  error: "Failed. Shown to the person as an error.",
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};

const colorOf = (name) => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

const ago = (ms) => {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const shortPath = (p) => (p ? p.split("/").filter(Boolean).slice(-2).join("/") : "");
const oneLine = (text, n = 200) => {
  const flat = String(text ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
const sourceName = (ev) => {
  if (ev.source.origin === "repo copy") return `${ev.source.plugin} (.agents copy)`;
  if (ev.source.plugin) return ev.source.plugin;
  if (ev.kind === "hook") return "unattributed";
  return ev.source.origin ? `${ev.source.origin} file` : "";
};
const inLens = (ev) => (state.lens === "everything" ? true : ev.source.focus || (ev.kind === "hook" && !ev.source.plugin));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
  return res.json();
}

// ---- the session list -----------------------------------------------------

async function loadSessions() {
  const data = await getJson("/api/sessions");
  state.sessions = data.sessions;
  state.focus = data.focus ?? state.focus;
  drawSessions();
}

function drawSessions() {
  const box = document.getElementById("sessions");
  const query = document.getElementById("filter").value.trim().toLowerCase();
  const rows = [];
  for (const s of state.sessions) {
    const hay = `${s.title ?? ""} ${s.cwd ?? ""} ${s.id}`.toLowerCase();
    if (query && !hay.includes(query)) continue;
    rows.push(el("button", { class: `session${s.file === state.file ? " active" : ""}`, role: "listitem", onclick: () => select(s.file) },
      el("span", { class: "t", text: s.title || s.id }),
      el("span", { class: "m", text: `${shortPath(s.cwd) || s.project} · ${ago(s.mtimeMs)} · ${num(s.size / 1024)} KB` })));
    for (const sub of s.subagents ?? []) {
      rows.push(el("button", { class: `session sub${sub.file === state.file ? " active" : ""}`, role: "listitem", onclick: () => select(sub.file) },
        el("span", { class: "t", text: `↳ ${sub.agentType ?? "subagent"}: ${sub.description ?? sub.id}` }),
        el("span", { class: "m", text: `${ago(sub.mtimeMs)} · ${num(sub.size / 1024)} KB` })));
    }
  }
  box.replaceChildren(...(rows.length ? rows : [el("p", { class: "empty", style: "padding: 16px", text: "No transcripts match." })]));
}

async function select(file, { keepScroll = false } = {}) {
  state.file = file;
  history.replaceState(null, "", `#file=${encodeURIComponent(file)}`);
  drawSessions();
  const main = document.getElementById("main");
  if (!keepScroll) main.replaceChildren(el("p", { class: "empty", text: "Reading the transcript…" }));
  try {
    const y = window.scrollY;
    const atBottom = window.innerHeight + y >= document.body.scrollHeight - 40;
    state.session = await getJson(`/api/session?file=${encodeURIComponent(file)}`);
    draw();
    if (keepScroll) window.scrollTo(0, atBottom ? document.body.scrollHeight : y);
  } catch (error) {
    main.replaceChildren(el("p", { class: "empty", text: `Could not read it: ${error.message}` }));
  }
}

function setFollow(on) {
  state.follow = on;
  clearInterval(state.timer);
  if (!on) return;
  state.timer = setInterval(async () => {
    if (!state.file || !state.session) return;
    try {
      const { mtimeMs } = await getJson(`/api/stat?file=${encodeURIComponent(state.file)}`);
      if (mtimeMs !== state.session.mtimeMs) await select(state.file, { keepScroll: true });
    } catch { /* the next tick retries */ }
  }, 3000);
}

// ---- the page -------------------------------------------------------------

function draw() {
  const s = state.session;
  const peak = Math.max(0, ...s.requests.map((r) => r.contextTokens));
  const focusSeen = [...new Set(s.events.filter((e) => e.source.focus && e.source.plugin).map((e) => e.source.plugin))].sort();
  const main = document.getElementById("main");
  main.replaceChildren(
    el("section", { class: "head" },
      el("h2", { text: s.title || s.id || "Session" }),
      el("div", { class: "cwd", text: s.cwd ?? "" }),
      el("div", { class: "chips" },
        el("span", { class: "chip", text: `Claude Code ${s.version ?? "?"}` }),
        el("span", { class: "chip", text: `${num(s.requests.length)} API requests` }),
        el("span", { class: "chip", text: `peak ${num(peak)} tokens` }),
        el("span", { class: "chip", text: `${s.compactions.length} compaction${s.compactions.length === 1 ? "" : "s"}` }),
        el("span", { class: "chip", text: `${s.turns.length} turns` }),
        s.badLines ? el("span", { class: "chip warn", text: `${s.badLines} unreadable lines` }) : null,
        el("label", { class: "chip", style: "cursor: pointer" },
          el("input", { type: "checkbox", checked: state.follow, onchange: (e) => setFollow(e.target.checked) }), "Follow live"))),
    chart(s, peak),
    footprint(s, focusSeen),
    toolbar(),
    ...s.segments.flatMap((seg) => [segmentView(s, seg), compactionView(s, s.compactions.find((c) => c.fromSegment === seg.index))]).filter(Boolean),
  );
}

function chart(s, peak) {
  const card = el("section", { class: "card" }, el("h3", { text: "Context size per API request" }),
    el("p", { class: "note", text: "The API's own count: input plus cache reads plus cache writes, so this is the whole window each request carried. A red line is a compaction." }));
  if (!s.requests.length || !peak) return card.appendChild(el("p", { class: "muted", text: "No API usage recorded in this transcript." })) && card;
  const W = 1000, H = 180, top = 24, bottom = 20, left = 4;
  const bw = (W - left) / s.requests.length;
  const y = (v) => top + (H - top - bottom) * (1 - v / peak);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": `Context size across ${s.requests.length} requests, peak ${num(peak)} tokens` });
  for (const r of s.requests) {
    const x = left + r.index * bw;
    const bar = svg("rect", { x: x + bw * 0.12, y: y(r.contextTokens), width: Math.max(1, bw * 0.76), height: Math.max(1, H - bottom - y(r.contextTokens)), fill: r.segment % 2 ? "var(--bar)" : "var(--bar-focus)", opacity: r.segment % 2 ? 1 : 0.8 });
    bar.append(svg("title", {}, `request ${r.index + 1} · ${num(r.contextTokens)} tokens · turn ${r.turn} · ${new Date(r.at).toLocaleString()}`));
    g.append(bar);
  }
  for (const c of s.compactions) {
    const firstAfter = s.requests.find((r) => r.segment === c.fromSegment + 1);
    const x = left + (firstAfter ? firstAfter.index : s.requests.length) * bw;
    g.append(svg("line", { x1: x, x2: x, y1: top - 6, y2: H - bottom, stroke: "var(--mark)", "stroke-dasharray": "4 3", "stroke-width": 1.5 }));
    g.append(svg("text", { x: x + 4, y: top - 8 }, `compaction ${c.index + 1}`));
  }
  g.append(svg("line", { x1: left, x2: W, y1: top, y2: top, stroke: "var(--line)" }));
  g.append(svg("text", { x: W - 4, y: top - 8, "text-anchor": "end" }, `peak ${num(peak)} tokens`));
  g.append(svg("text", { x: left, y: H - 4 }, "request 1"));
  g.append(svg("text", { x: W - 4, y: H - 4, "text-anchor": "end" }, `request ${s.requests.length}`));
  card.append(g);
  return card;
}

function footprint(s, focusSeen) {
  const rows = new Map();
  const row = (name) => {
    if (!rows.has(name)) rows.set(name, { name, start: 0, later: 0, hooks: 0, after: 0, person: 0, silent: 0, error: 0 });
    return rows.get(name);
  };
  const afterSegments = s.segments.filter((seg) => seg.index > 0).length;
  for (const ev of s.events) {
    if (!ev.source.focus) continue;
    const r = row(sourceName(ev));
    if (ev.visibility === "person") r.person += 1;
    else if (ev.visibility === "silent") r.silent += 1;
    else if (ev.visibility === "error") r.error += 1;
    else if (ev.phase === "start" && ev.segment === 0) r.start += ev.tokens;
    else if (ev.phase === "start") r.after += ev.tokens;
    else if (ev.kind === "hook") r.hooks += ev.tokens;
    else r.later += ev.tokens;
  }
  const turns = Math.max(1, s.turns.length);
  const list = [...rows.values()].sort((a, b) => b.start - a.start || b.after - a.after || b.hooks - a.hooks);
  const total = list.reduce((t, r) => t + r.start, 0);
  const first = s.segments[0]?.baselineTokens;
  const opening = first
    ? `The session's first request carried ${num(first)} tokens in all, of which about ${num(total)} came from these plugins and the repo's .agents copies.`
    : "This transcript opens at a compaction, so the session's own start is not in it.";
  const card = el("section", { class: "card" }, el("h3", { text: `What the ${state.focus} plugins put in context` }),
    el("p", { class: "note", text: `Estimates (characters / 4). ${opening}${focusSeen.length ? "" : " Nothing from them in this transcript."} "Added later" is standing context that arrived mid-segment, such as tools a server registered late.` }));
  if (!list.length) return card;
  const cell = (n) => (n ? `~${num(n)}` : "");
  card.append(el("div", { class: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {}, el("th", { text: "Source" }), el("th", { class: "n", text: "At session start" }), el("th", { class: "n", text: "Added later" }), el("th", { class: "n", text: "Hooks per turn" }),
      el("th", { class: "n", text: "After each compaction" }), el("th", { class: "n", text: "Person only" }), el("th", { class: "n", text: "Silent runs" }), el("th", { class: "n", text: "Errors" }))),
    el("tbody", {}, ...list.map((r) => el("tr", {},
      el("td", {}, el("span", { class: "dot", style: `background:${colorOf(r.name)}` }), " ", r.name),
      el("td", { class: "n", text: cell(r.start) }),
      el("td", { class: "n", text: cell(r.later) }),
      el("td", { class: "n", text: cell(r.hooks / turns) }),
      el("td", { class: "n", text: afterSegments ? (r.after ? `~${num(r.after / afterSegments)}` : "none") : "n/a" }),
      el("td", { class: "n", text: r.person || "" }),
      el("td", { class: "n", text: r.silent || "" }),
      el("td", { class: "n", text: r.error || "" })))))));
  return card;
}

function toolbar() {
  const lensButton = (lens, label) => el("button", { "aria-pressed": String(state.lens === lens), onclick: () => { state.lens = lens; draw(); } }, label);
  return el("div", { class: "toolbar" },
    el("div", { class: "seg", role: "group", "aria-label": "Lens" }, lensButton("plugins", `${state.focus} plugins`), lensButton("everything", "Everything")),
    ...["model", "person", "silent", "error"].map((v) => el("label", { class: `vis vis-${v}`, title: VIS_HELP[v] },
      el("input", { type: "checkbox", checked: state.vis.has(v), onchange: (e) => { e.target.checked ? state.vis.add(v) : state.vis.delete(v); draw(); } }), v)));
}

function segmentView(s, seg) {
  const events = s.events.filter((e) => e.segment === seg.index && inLens(e) && state.vis.has(e.visibility));
  const started = seg.startedBy === "compact" ? `after compaction ${seg.index} (${seg.trigger ?? "?"})` : seg.startedBy;
  const box = el("section", { class: "segment" },
    el("h3", { text: `Segment ${seg.index + 1} · ${started}` }),
    el("div", { class: "sub", text: `first request ${seg.baselineTokens === null ? "not recorded" : `${num(seg.baselineTokens)} tokens (API)`} · ${seg.turns} turn${seg.turns === 1 ? "" : "s"}` }));
  const phases = [...new Set(events.map((e) => e.phase))].sort((a, b) => (a === "start" ? -1 : b === "start" ? 1 : a - b));
  if (!phases.length) box.append(el("p", { class: "muted", text: "Nothing in this lens for this segment." }));
  const many = phases.length > 40;
  for (const phase of phases) {
    const rows = events.filter((e) => e.phase === phase);
    const tokens = rows.filter((e) => e.visibility === "model").reduce((t, e) => t + e.tokens, 0);
    const turn = phase === "start" ? null : s.turns[phase - 1];
    const key = `${seg.index}:${phase}`;
    const title = phase === "start"
      ? [el("span", { text: seg.index === 0 ? "Session start" : "Start after compaction" })]
      : [el("span", { text: `Turn ${phase}` }), turn?.origin && turn.origin !== "human" ? el("span", { class: "muted", text: ` · ${turn.origin}` }) : null, el("span", { class: "muted", text: ` · ${oneLine(turn?.preview, 90)}` })];
    const details = el("details", { class: "phase", open: state.lens === "plugins" || phase === "start" || !many || state.open.has(key) },
      el("summary", {}, ...title, el("span", { class: "muted", text: ` · ${rows.length} item${rows.length === 1 ? "" : "s"}${tokens ? ` · ~${num(tokens)} tokens` : ""}` })));
    // Rows are built on first open, so a long session stays quick to draw.
    const fill = () => { if (details.dataset.filled) return; details.dataset.filled = "1"; for (const ev of rows) details.append(rowView(ev)); };
    details.addEventListener("toggle", () => { if (details.open) { state.open.add(key); fill(); } else state.open.delete(key); });
    if (details.open) fill();
    box.append(details);
  }
  return box;
}

function rowView(ev) {
  const what = ev.kind === "hook" ? ev.hookName ?? ev.event : ev.kind;
  const name = sourceName(ev);
  const pv = ev.kind === "hook" ? oneLine(ev.text || ev.detail || "") : oneLine(`${ev.label}${ev.detail ? ` · ${ev.detail}` : ""}${CONVERSATION.has(ev.kind) ? ` · ${ev.text}` : ""}`);
  const wrap = el("div", {});
  const row = el("div", { class: "row", role: "button", tabindex: "0", "aria-expanded": "false" },
    el("span", { class: "what", title: what, text: what }),
    el("span", { class: "src", title: name }, name ? el("span", { class: "dot", style: `background:${colorOf(name)}` }) : null, name ? ` ${name}` : el("span", { class: "muted", text: "Claude Code" })),
    el("span", { class: `badge vis-${ev.visibility}`, title: VIS_HELP[ev.visibility], text: ev.visibility }),
    el("span", { class: "tok", text: ev.visibility === "model" && ev.tokens ? `~${num(ev.tokens)}` : "" }),
    el("span", { class: "pv", text: pv }));
  const toggle = () => {
    const open = wrap.querySelector(".full");
    if (open) { open.remove(); row.setAttribute("aria-expanded", "false"); state.open.delete(`ev:${ev.id}`); return; }
    wrap.append(fullView(ev));
    row.setAttribute("aria-expanded", "true");
    state.open.add(`ev:${ev.id}`);
  };
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  wrap.append(row);
  if (state.open.has(`ev:${ev.id}`)) wrap.append(fullView(ev));
  return wrap;
}

function fullView(ev) {
  const meta = [
    ["seen by", VIS_HELP[ev.visibility]],
    ["kind", ev.kind],
    ev.hookName ? ["hook", ev.hookName] : null,
    ev.source.plugin ? ["plugin", `${ev.source.plugin}${ev.source.version ? ` ${ev.source.version}` : ""}`] : null,
    ev.source.candidates?.length > 1 || (!ev.source.plugin && ev.source.candidates?.length) ? ["could be", ev.source.candidates.join(", ")] : null,
    ev.source.origin ? ["origin", ev.source.origin] : null,
    ev.detail ? ["note", ev.detail] : null,
    ev.command ? ["command", ev.command] : null,
    ev.durationMs ? ["took", `${num(ev.durationMs)} ms`] : null,
    ev.confirmed ? ["checked", "found in the rendered context"] : null,
    ev.file ? ["file", ev.file] : null,
    ev.at ? ["at", new Date(ev.at).toLocaleString()] : null,
    ev.visibility === "model" ? ["size", `~${num(ev.tokens)} tokens, ${num((ev.text ?? "").length)} characters`] : null,
  ].filter(Boolean);
  const text = ev.text ?? "";
  return el("div", { class: "full" },
    el("div", { class: "meta" }, ...meta.map(([k, v]) => el("span", {}, el("b", { text: `${k}: ` }), v))),
    el("pre", { text: text ? (text.length > 200_000 ? `${text.slice(0, 200_000)}\n… (${num(text.length - 200_000)} more characters)` : text) : "(no text)" }));
}

function compactionView(s, c) {
  if (!c) return null;
  const card = el("section", { class: "card compaction" },
    el("h3", { text: `Compaction ${c.index + 1} · ${c.trigger ?? "?"} · ${num(c.preTokens)} → ${num(c.postTokens)} tokens` }),
    el("p", { class: "note", text: c.beforeRecorded === false
      ? "This transcript opens at this compaction (it continues an earlier file), so there is no record of what came before it. The rows show what the next segment carried."
      : `What the ${state.focus} plugins had in context before it, against what the next segment carried. "Lost" is standing context a request went out without. A per-turn hook speaks only when its trigger recurs, so one that has not spoken again is "not since"; "no request yet" and "no turn yet" mean the session has not got that far.` }));
  if (!c.rows.length) return card.appendChild(el("p", { class: "muted", text: "Nothing from these plugins on either side." })) && card;
  card.append(el("table", {},
    el("thead", {}, el("tr", {}, el("th", { text: "Status" }), el("th", { text: "Context" }), el("th", { class: "n", text: "Before" }), el("th", { class: "n", text: "After" }))),
    el("tbody", {}, ...c.rows.map((r) => el("tr", {},
      el("td", {}, el("span", { class: `status ${["kept", "lost", "new"].includes(r.status) ? r.status : "wait"}`, text: r.status })),
      el("td", { text: `${r.label}${r.perTurn ? " (per turn)" : ""}` }),
      el("td", { class: "n", text: r.tokensBefore ? `~${num(r.tokensBefore)}` : "" }),
      el("td", { class: "n", text: r.tokensAfter ? `~${num(r.tokensAfter)}` : "" }))))));
  return card;
}

// ---- start ----------------------------------------------------------------

document.getElementById("filter").addEventListener("input", drawSessions);
loadSessions().then(() => {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("file");
  if (fromHash) select(fromHash);
}).catch((error) => {
  document.getElementById("main").replaceChildren(el("p", { class: "empty", text: `Could not list sessions: ${error.message}` }));
});
