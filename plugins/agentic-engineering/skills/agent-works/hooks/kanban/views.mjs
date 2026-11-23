// The pane's trees, built with plain element calls: each constructor from
// $.ui.resolve(e) takes its props with `children` among them, so nothing here
// needs compiling. Pure: the board and the pane's own state in, a tree out,
// every press handed to the `act` callbacks actions.mjs makes.
//
// Six views. The board: a toolbar (new, scope, epics, sprints, the selected
// card's moves, how a card starts, the gates filter, settings), then the lanes.
// Where the surface draws a Client and the pane is wide enough for every lane
// (fits in layout.mjs), the lanes stand side by side in board.client.mjs, the
// surface module this file names, with cards to drag between them; everywhere
// else they stack, every move a button. A card: its fields to edit, its moves,
// Start, and for a gate the evidence that settles it. A new card. The epics
// with their progress. The sprints: plan, start, close. The settings: how a
// card starts, syncing with the tracker, where the board lives.
//
// A surface without a text field or a picker (Input, Select) gets the buttons
// and a line naming the /kanban command that does the rest.
import { ARCHIVED, KINDS, PRIORITIES, SUGGESTED, activeSprint, held, isEpic, isFinished, isGate, progressBar, ready, summary } from "../../lib/board.mjs";
import { fits } from "./layout.mjs";
import { emptyLine, gateCount, lanesOf, openEpics, plannedFor, progressOf, scopeKind, scopeLine, sprintCount, strayCount } from "./model.mjs";

const BODY_CHARS = 4000;
// What a Client's props may hold, serialized; past it the host draws nothing there.
const PROPS_CAP = 100000;

const splitList = (text) => String(text).split(",").map((part) => part.trim()).filter(Boolean);
const bold = { weight: "semibold" };

/** Where sync with the tracker stands, in a few words. */
export function syncLine(board, sync) {
  if (!board.remote?.enabled) return "sync off";
  if (sync.status === "running") return "syncing…";
  if (sync.status === "error") return `sync failed: ${sync.message}`;
  return sync.message ? `synced: ${sync.message}` : "sync on";
}

/**
 * The whole pane: a message, or the view the person is on. `client` says the
 * surface draws a Client here, with a pointer to drag with.
 */
export function pane(E, model, act, { columns = 40, client = false } = {}) {
  const { Box, Text } = E;
  if (model.error && !model.board) {
    return Box({ flexDirection: "column", children: [Text({ color: "error", children: `The board could not be read: ${model.error}` }), Text({ dimColor: true, children: "aw board list says the same from a shell." })] });
  }
  if (!model.board) return Text({ dimColor: true, children: "Reading the kanban board…" });
  const { board, view } = model;
  if (view.kind === "settings") return settingsView(E, model, act);
  if (view.kind === "epics") return epicsView(E, model, act);
  if (view.kind === "sprints") return sprintsView(E, model, act);
  if (view.kind === "new") return newView(E, model, act);
  const card = view.kind === "card" ? board.cards.find((c) => c.id === view.id) : null;
  if (card) return cardView(E, model, card, act, columns);
  return boardView(E, model, act, { columns, client });
}

// ---- the board -----------------------------------------------------------

/** Why no task is ready, from what holds the first column's cards. */
function nothingReady(board) {
  const h = held(board);
  const count = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : null);
  const parts = [
    count(h.waiting, "card waiting on others", "cards waiting on others"), count(h.blocked, "blocked card", "blocked cards"),
    count(h.needs, "card needing a person", "cards needing a person"), count(h.gates, "gate (settled, not started)", "gates (settled, not started)"),
  ].filter(Boolean);
  if (!parts.length) return "Nothing ready.";
  return `Nothing ready: the first column holds ${parts.join(", ")}.`;
}

/** The line under the lanes: what is ready or why nothing is, the gates owed, the suggestions waiting. */
export function footLine(board) {
  const s = summary(board);
  return [s.ready ? `Ready: ${s.ready}.` : nothingReady(board), `Gates owed: ${s.owed}.`, s.suggested ? `Suggested: ${s.suggested}.` : ""].filter(Boolean).join(" ");
}

/** The row of controls above the lanes: what the keys and the drag do, as buttons. */
function toolbar(E, model, act) {
  const { Box, Text, Button } = E;
  const { board, scope, gatesOnly, sync } = model;
  const card = board.cards.find((c) => c.id === model.selected && c.status !== ARCHIVED);
  const isQueue = board.startMode === "queue";
  const first = board.columns[0]?.id ?? "backlog";
  const gates = gateCount(board);
  const buttons = [
    Button({ key: "new", hotkey: "n", onPress: () => act.view({ kind: "new", status: first }), children: "+ New" }),
    Button({ key: "scope", hotkey: "v", onPress: () => act.cycleScope(), children: `Scope: ${scopeKind(scope)}` }),
    Button({ key: "epics", hotkey: "e", onPress: () => act.view({ kind: "epics" }), children: `Epics ${openEpics(board).length}` }),
    Button({ key: "sprints", hotkey: "p", onPress: () => act.view({ kind: "sprints" }), children: "Sprints" }),
  ];
  if (card) {
    buttons.push(
      Button({ key: "open", hotkey: "o", onPress: () => act.open(card.id), children: "Open" }),
      Button({ key: "left", onPress: () => act.shift(card.id, -1), children: "‹" }),
      Button({ key: "right", onPress: () => act.shift(card.id, 1), children: "›" }),
      Button({ key: "start", hotkey: "s", variant: "primary", onPress: () => act.start(card.id), children: "Start" }),
    );
  }
  buttons.push(
    Button({ key: "mode", hotkey: "m", onPress: () => act.startMode(isQueue ? "new-session" : "queue"), children: isQueue ? "Starts: queue here" : "Starts: new session" }),
    Button({ key: "gates", hotkey: "g", onPress: () => act.toggleGates(), children: gatesOnly ? `Showing: gates (${gates})` : `Showing: all · gates ${gates}` }),
    Button({ key: "settings", onPress: () => act.view({ kind: "settings" }), children: "Settings" }),
  );
  return Box({
    flexDirection: "column",
    children: [
      Text({ ...bold, color: "claude", wrap: "truncate-end", children: scopeLine(board, scope) }),
      Box({ flexDirection: "row", gap: 1, flexWrap: "wrap", children: buttons }),
      Text({ dimColor: true, wrap: "truncate-end", children: `${card ? `${card.id} ${card.title} · ` : ""}${syncLine(board, sync)}` }),
    ],
  });
}

function boardView(E, model, act, { columns, client }) {
  const { Box, Text } = E;
  const { board, scope, gatesOnly } = model;
  const lanes = lanesOf(board, { scope, gatesOnly, queue: model.queue });
  const stray = strayCount(board);
  const parts = [toolbar(E, model, act)];
  if (stray) parts.push(Text({ color: "warning", children: `${stray} card(s) name a column this board lacks; shown in the first.` }));
  if (board.isOldFolder) parts.push(Text({ dimColor: true, children: "These cards are still in .agents/board; Settings says more." }));
  const props = { columns, selected: model.selected ?? null, lanes, empty: emptyLine(board, scope, gatesOnly) };
  if (client && E.Client && fits(columns, lanes.length) && JSON.stringify(props).length <= PROPS_CAP) {
    parts.push(E.Client({ key: "board", module: "./board.client.mjs", props, width: columns }));
  } else parts.push(listBoard(E, lanes, act, props.empty));
  if (model.notice) parts.push(Text({ ...(model.notice.ok ? { dimColor: true } : { color: "error" }), children: model.notice.text }));
  parts.push(Text({ dimColor: true, children: footLine(board) }));
  return Box({ flexDirection: "column", gap: 1, children: parts });
}

/** The board without a surface module: every lane a list, every move a button. */
function listBoard(E, lanes, act, empty) {
  const { Box, Text, Button } = E;
  const row = (card) => {
    const label = [`${card.id} ${card.title}`];
    if (card.mark) label.push(" ", Text({ ...bold, children: card.mark }));
    if (card.meta) label.push(" ", Text({ dimColor: true, children: card.meta }));
    return Box({
      flexDirection: "row", gap: 1,
      children: [
        Button({ key: `left-${card.id}`, plain: true, onPress: () => act.shift(card.id, -1), children: "‹" }),
        Button({ key: `right-${card.id}`, plain: true, onPress: () => act.shift(card.id, 1), children: "›" }),
        Button({ key: `card-${card.id}`, plain: true, onPress: () => act.open(card.id), children: label }),
        ...(card.mark === "ready" ? [Button({ key: `start-${card.id}`, plain: true, onPress: () => act.start(card.id), children: "Start" })] : []),
      ],
    });
  };
  const sections = lanes.map((lane) => Box({
    flexDirection: "column",
    children: [Text({ ...bold, children: [`${lane.title} `, Text({ dimColor: true, children: String(lane.cards.length) })] }), ...lane.cards.map(row)],
  }));
  if (!lanes.some((lane) => lane.cards.length)) sections.push(Text({ dimColor: true, children: empty }));
  return Box({ flexDirection: "column", gap: 1, children: sections });
}

// ---- a new card ----------------------------------------------------------

function backRow(E, act) {
  return E.Box({ flexDirection: "row", children: [E.Button({ key: "back", hotkey: "b", onPress: () => act.back(), children: "‹ Kanban" })] });
}

function newView(E, model, act) {
  const { Box, Text, Input, Select } = E;
  const { board, scope, view } = model;
  const planned = plannedFor(board, scope);
  const into = [planned.sprint ? `sprint ${activeSprint(board).id}` : "", planned.epic ? `epic ${planned.epic}` : ""].filter(Boolean).join(", ");
  const parts = [Text({ ...bold, children: "New card" })];
  if (into) parts.push(Text({ dimColor: true, children: `Goes into ${into}: the scope the board shows.` }));
  if (Select) {
    parts.push(Select({ key: "new-status", label: "Column", value: view.status, options: board.columns.map((c) => ({ value: c.id, label: c.title })), onSelect: (value) => act.view({ kind: "new", status: value }) }));
  }
  parts.push(Input
    ? Input({ key: "new-title", label: "Title", autoFocus: true, submitLabel: "add", onSubmit: (title) => act.add(title, view.status) })
    : Text({ dimColor: true, children: "Add a card with /kanban add <title>." }));
  parts.push(backRow(E, act));
  return Box({ flexDirection: "column", gap: 1, paddingX: 1, children: parts });
}

// ---- one card ------------------------------------------------------------

/** A body without the empty `## Evidence` heading an unsettled gate carries for its settle to fill. */
function withoutEmptyEvidence(body) {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => /^## Evidence\s*$/.test(l));
  if (at === -1) return body;
  let end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  if (end === -1) end = lines.length;
  if (lines.slice(at + 1, end).some((l) => l.trim())) return body;
  lines.splice(at, end - at);
  return lines.join("\n").trim();
}

function cardView(E, model, card, act, columns) {
  const { Box, Text, Button, Link, Markdown, Input, Select } = E;
  const { board } = model;
  const isPlan = card.source === "plan";
  const isSuggested = card.status === SUGGESTED;
  const epic = isEpic(card);
  const gate = isGate(card);
  const finished = isFinished(board, card);
  const isReady = ready(board).some((c) => c.id === card.id);
  const queued = model.queue.includes(card.id);

  const buttons = [Button({ key: "back", hotkey: "b", onPress: () => act.back(), children: "‹ Kanban" })];
  if (epic && !finished) {
    buttons.push(Button({ key: "start", variant: "primary", onPress: () => act.start(card.id), children: "Break down" }));
    buttons.push(Button({ key: "epic-cards", onPress: () => act.showEpic(card.id), children: "Show its cards" }));
  } else if (gate && !finished && !isSuggested) {
    buttons.push(Button({ key: "start", variant: "primary", onPress: () => act.start(card.id), children: "Run it" }));
  } else if (isReady) {
    buttons.push(Button({ key: "start", variant: "primary", onPress: () => act.start(card.id), children: queued ? "Queued" : "Start" }));
  }
  if (isSuggested) buttons.push(Button({ key: "accept", onPress: () => act.accept(card.id), children: "Accept" }));
  if (!isPlan && card.status !== ARCHIVED) buttons.push(Button({ key: "archive", onPress: () => act.archive(card.id), children: isSuggested ? "Dismiss" : "Archive" }));

  const title = [];
  if (gate) title.push(Text({ color: "warning", children: "gate " }));
  if (epic) title.push(Text({ color: "claude", children: "epic " }));
  title.push(card.title, " ", Text({ dimColor: true, children: `${card.id}${isPlan ? " · plan issue" : ""}${card.source === "claude" ? " · by Claude" : ""}` }));
  const owed = [card.ref ? `for ${card.ref}` : "", card.needs ? `needs ${card.needs}` : "", card.owner ? `owner ${card.owner}` : ""].filter(Boolean).join(" · ");
  const bound = [
    card.blocked ? "blocked" : "", card.session ? `session ${card.session}` : "", card.branch ? `branch ${card.branch}` : "", card.mr !== undefined ? `!${card.mr}` : "",
    card.after?.length ? `after ${card.after.join(", ")}` : "", card.files?.length ? `files ${card.files.join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  const parts = [Box({ flexDirection: "row", gap: 1, flexWrap: "wrap", children: buttons }), Text({ ...bold, children: title })];
  if (owed) parts.push(Text({ dimColor: true, children: owed }));
  if (bound) parts.push(Text({ dimColor: true, children: bound }));
  if (card.worktree) parts.push(Text({ dimColor: true, wrap: "truncate-start", children: `worktree ${card.worktree}` }));
  if (model.notice) parts.push(Text({ ...(model.notice.ok ? { dimColor: true } : { color: "error" }), children: model.notice.text }));

  const columnOptions = board.columns.map((c) => ({ value: c.id, label: c.title }));
  if (isPlan) {
    // A plan issue's fields are the plan's: here it is read, and moved where its own rules allow.
    parts.push(Text({ dimColor: true, children: `status ${card.status}${card.epic ? ` · epic ${card.epic}` : ""}${card.sprint ? ` · sprint ${card.sprint}` : ""}` }));
    if (Select && !finished) parts.push(Select({ key: "status", label: "Column", value: card.status, options: columnOptions, onSelect: (value) => act.place(card.id, value) }));
  } else {
    if (Input) parts.push(Input({ key: "title", label: "Title", value: card.title, submitLabel: "rename", onSubmit: (text) => { if (text.trim()) act.patch(card.id, { title: text.trim() }); } }));
    if (Select) {
      // A gate reaches the done column by its evidence, never by this picker.
      const done = new Set(board.columns.filter((c) => c.role === "done").map((c) => c.id));
      const lanes = gate && !finished ? columnOptions.filter((o) => !done.has(o.value)) : columnOptions;
      const options = isSuggested ? [{ value: SUGGESTED, label: "Suggested" }, ...lanes] : card.status === ARCHIVED ? [{ value: ARCHIVED, label: "Archived" }, ...lanes] : lanes;
      parts.push(Select({ key: "status", label: "Column", value: card.status, options, onSelect: (value) => act.place(card.id, value) }));
      const kinds = [...KINDS, ...(KINDS.includes(card.kind) ? [] : [card.kind])];
      parts.push(Select({ key: "kind", label: "Kind", value: card.kind, options: kinds.map((value) => ({ value })), onSelect: (value) => act.patch(card.id, { kind: value }) }));
      if (!epic) {
        const epics = openEpics(board).filter((e) => e.id !== card.id);
        const options = [
          { value: "none", label: "No epic" }, ...epics.map((e) => ({ value: e.id, label: `${e.id} ${e.title}` })),
          ...(card.epic && !epics.some((e) => e.id === card.epic) ? [{ value: card.epic, label: card.epic }] : []),
        ];
        parts.push(Select({ key: "epic", label: "Epic", value: card.epic || "none", options, onSelect: (value) => act.patch(card.id, { epic: value }) }));
      }
      const sprints = board.sprints.filter((s) => s.state !== "closed");
      const sprintOptions = [
        { value: "none", label: "No sprint (backlog)" }, ...sprints.map((s) => ({ value: s.id, label: `${s.id} ${s.title} (${s.state})` })),
        ...(card.sprint && !sprints.some((s) => s.id === card.sprint) ? [{ value: card.sprint, label: card.sprint }] : []),
      ];
      parts.push(Select({ key: "sprint", label: "Sprint", value: card.sprint || "none", options: sprintOptions, onSelect: (value) => act.patch(card.id, { sprint: value }) }));
    } else {
      parts.push(Text({ dimColor: true, children: `status ${card.status} · ${card.kind}${card.epic ? ` · epic ${card.epic}` : ""}${card.sprint ? ` · sprint ${card.sprint}` : ""}` }));
      const at = board.columns.findIndex((c) => c.id === card.status);
      const moves = [];
      if (at > 0) moves.push(Button({ key: "left", onPress: () => act.shift(card.id, -1), children: `← ${board.columns[at - 1].title}` }));
      if (at !== -1 && board.columns[at + 1]) moves.push(Button({ key: "right", onPress: () => act.shift(card.id, 1), children: `${board.columns[at + 1].title} →` }));
      if (moves.length) parts.push(Box({ flexDirection: "row", gap: 1, children: moves }));
    }
  }

  if (epic) {
    const children = board.cards.filter((c) => c.epic === card.id && c.status !== ARCHIVED && !isEpic(c));
    parts.push(Box({
      flexDirection: "column",
      children: [
        Text({ ...bold, children: ["Cards ", Text({ dimColor: true, children: progressBar(progressOf(board, card.id)) })] }),
        ...(children.length ? [] : [Text({ dimColor: true, children: "None yet: Break down asks this session to slice the epic into cards." })]),
        ...children.map((c) => Button({ key: `child-${c.id}`, plain: true, onPress: () => act.open(c.id), children: `${c.id} [${c.status}] ${c.title}` })),
      ],
    }));
  }

  if (!isPlan && Input) {
    parts.push(Input({ key: "owner", label: "Owner", value: card.owner ?? "", submitLabel: "save", onSubmit: (text) => act.patch(card.id, { owner: text.trim() }) }));
    if (gate) {
      parts.push(Input({ key: "ref", label: "Owed for", value: card.ref ?? "", placeholder: "pull request, issue or card", submitLabel: "save", onSubmit: (text) => act.patch(card.id, { ref: text.trim() }) }));
      parts.push(Input({ key: "needs", label: "Needs", value: card.needs ?? "", placeholder: "what running it needs", submitLabel: "save", onSubmit: (text) => act.patch(card.id, { needs: text.trim() }) }));
    }
  }
  if (!isPlan && Select) {
    parts.push(Select({ key: "priority", label: "Priority", value: card.priority, options: PRIORITIES.map((value) => ({ value })), onSelect: (value) => act.patch(card.id, { priority: PRIORITIES.includes(value) ? value : "normal" }) }));
  }
  if (!isPlan && Input) {
    parts.push(Input({ key: "labels", label: "Labels", value: (card.labels ?? []).join(", "), placeholder: "comma separated", submitLabel: "save", onSubmit: (text) => act.patch(card.id, { labels: splitList(text) }) }));
  }

  if (!isPlan) {
    const skills = card.skills ?? [];
    const addSkill = (text) => {
      const name = String(text).trim().replace(/^\//, "");
      if (name && !skills.includes(name)) act.patch(card.id, { skills: [...skills, name] });
    };
    const offered = (model.skills ?? []).filter((s) => !skills.includes(s));
    const nudges = [
      Text({ ...bold, children: "Skill nudges" }),
      Text({ dimColor: true, children: "Named in the brief of the session that takes this card." }),
      Box({ flexDirection: "row", gap: 1, flexWrap: "wrap", children: skills.map((s) => Button({ key: `skill-${s}`, plain: true, onPress: () => act.patch(card.id, { skills: skills.filter((x) => x !== s) }), children: `/${s} ✕` })) }),
    ];
    if (Select && offered.length) nudges.push(Select({ key: "skill-pick", label: "Add", value: "", options: [{ value: "", label: "Pick a skill…" }, ...offered.map((value) => ({ value, label: `/${value}` }))], onSelect: addSkill }));
    if (Input) nudges.push(Input({ key: "skill-type", label: "Or type one", placeholder: "plugin:skill", submitLabel: "add", onSubmit: addSkill }));
    parts.push(Box({ flexDirection: "column", children: nudges }));
  }

  if (gate && !finished && !isSuggested) {
    // A gate is settled with what showed the check holds, never moved to done.
    parts.push(Input
      ? Box({ flexDirection: "column", children: [
        Input({ key: "evidence", label: "Evidence", placeholder: "the command that ran and what it showed", value: model.draft ?? "", submitLabel: "settle", onInput: (text) => act.draft(text), onSubmit: (text) => act.settle(card.id, text) }),
        Box({ flexDirection: "row", children: [Button({ key: "settle", onPress: () => act.settle(card.id), children: "Settle" })] }),
      ] })
      : Text({ dimColor: true, children: `Settle it from a shell: aw board settle ${card.id} --evidence "<what showed it>"` }));
  }

  if (card.remote && Link) parts.push(Link({ href: card.remote.url, label: `Issue #${card.remote.number}` }));
  const body = withoutEmptyEvidence(String(card.body ?? "").trim());
  parts.push(Markdown({ text: body ? clipBody(body) : "_No details yet._" }));
  if (!isPlan && Input) parts.push(Input({ key: "note", label: "Add a note", submitLabel: "append", onSubmit: (text) => { if (text.trim()) act.note(card.id, text.trim()); } }));
  parts.push(Text({ dimColor: true, wrap: "truncate-start", children: isPlan ? String(card.file ?? "") : `${board.dir}/${card.file}` }));
  return Box({ flexDirection: "column", gap: 1, paddingX: 1, children: parts });
}

const clipBody = (body) => (body.length > BODY_CHARS ? `${body.slice(0, BODY_CHARS)}…` : body);

// ---- epics ---------------------------------------------------------------

/** The open epics with their progress: open one, show its cards on the board, or start a new one. */
function epicsView(E, model, act) {
  const { Box, Text, Button, Input } = E;
  const { board } = model;
  const epics = openEpics(board);
  const rows = epics.map((epic) => Box({
    key: `epic-${epic.id}`, flexDirection: "row", gap: 1, flexWrap: "wrap",
    children: [
      Text({ children: [`${progressBar(progressOf(board, epic.id))}  `, Text({ ...bold, children: epic.title }), " ", Text({ dimColor: true, children: epic.id })] }),
      Button({ key: `open-${epic.id}`, plain: true, onPress: () => act.open(epic.id), children: "Open" }),
      Button({ key: `show-${epic.id}`, plain: true, onPress: () => act.showEpic(epic.id), children: "Show cards" }),
    ],
  }));
  return Box({
    flexDirection: "column", gap: 1, paddingX: 1,
    children: [
      backRow(E, act),
      Text({ ...bold, children: "Epics" }),
      Text({ dimColor: true, children: "An epic holds a goal larger than one session. Its cards are worked one by one and counted toward it." }),
      ...(epics.length ? rows : [Text({ dimColor: true, children: "No open epics." })]),
      Input
        ? Input({ key: "new-epic", label: "New epic", placeholder: "the goal, as a title", submitLabel: "add", onSubmit: (title) => act.addEpic(title) })
        : Text({ dimColor: true, children: "Add one with /kanban epic <title>." }),
    ],
  });
}

// ---- sprints -------------------------------------------------------------

/** The sprints: plan one, start it, close it. Closing archives its done cards and rolls the rest on. */
function sprintsView(E, model, act) {
  const { Box, Text, Button, Input } = E;
  const { board } = model;
  const active = activeSprint(board);
  const open = board.sprints.filter((s) => s.state !== "closed");
  const closed = board.sprints.filter((s) => s.state === "closed").slice(-5).reverse();
  const rows = open.map((s) => {
    const head = [
      Text({ children: [
        Text({ ...bold, ...(s.state === "active" ? { color: "claude" } : {}), children: `${s.id} ${s.title}` }),
        Text({ dimColor: true, children: ` ${s.state} · ${sprintCount(board, s.id)} card(s)${s.end ? ` · ends ${s.end}` : ""}` }),
      ] }),
    ];
    if (s.state === "planned" && !active) head.push(Button({ key: `start-${s.id}`, plain: true, onPress: () => act.sprintStart(s.id), children: "Start" }));
    head.push(Button({ key: `close-${s.id}`, plain: true, onPress: () => act.sprintClose(s.id), children: "Close" }));
    const lines = [Box({ flexDirection: "row", gap: 1, flexWrap: "wrap", children: head })];
    if (s.goal) lines.push(Text({ dimColor: true, children: s.goal }));
    if (Input) {
      lines.push(Input({ key: `goal-${s.id}`, label: "Goal", value: s.goal, submitLabel: "save", onSubmit: (text) => act.sprintEdit(s.id, { goal: text.trim() }) }));
      lines.push(Input({ key: `end-${s.id}`, label: "Ends", value: s.end, placeholder: "YYYY-MM-DD", submitLabel: "save", onSubmit: (text) => act.sprintEdit(s.id, { end: text.trim() }) }));
    }
    return Box({ key: `sprint-${s.id}`, flexDirection: "column", children: lines });
  });
  return Box({
    flexDirection: "column", gap: 1, paddingX: 1,
    children: [
      backRow(E, act),
      Text({ ...bold, children: "Sprints" }),
      Text({ dimColor: true, children: "The board shows the active sprint. Closing it archives its done cards and moves the rest to the next planned sprint, or to the backlog." }),
      ...(open.length ? rows : [Text({ dimColor: true, children: "No sprint planned." })]),
      Input
        ? Input({ key: "new-sprint", label: "New sprint", placeholder: "its title", submitLabel: "plan", onSubmit: (title) => act.sprintNew(title) })
        : Text({ dimColor: true, children: "Plan one with /kanban sprint new <title>." }),
      ...(closed.length ? [Text({ ...bold, children: "Closed" })] : []),
      ...closed.map((s) => Text({ key: `closed-${s.id}`, dimColor: true, children: `${s.id} ${s.title}: ${s.closed?.done ?? 0} done, ${s.closed?.rolled ?? 0} rolled on${s.closed?.at ? `, ${s.closed.at.slice(0, 10)}` : ""}` })),
    ],
  });
}

// ---- settings ------------------------------------------------------------

function settingsView(E, model, act) {
  const { Box, Text, Button, Select } = E;
  const { board, sync } = model;
  const isOn = board.remote?.enabled === true;
  const isQueue = board.startMode === "queue";
  const parts = [backRow(E, act), Text({ ...bold, children: "Starting a card" })];
  parts.push(Select
    ? Select({
      key: "start-mode", label: "Start", value: board.startMode,
      options: [{ value: "new-session", label: "dispatches it to a session of its own" }, { value: "queue", label: "queues it for this session" }],
      onSelect: (value) => act.startMode(value === "queue" ? "queue" : "new-session"),
    })
    : Button({ key: "start-mode", onPress: () => act.startMode(isQueue ? "new-session" : "queue"), children: isQueue ? "Starts: queue here" : "Starts: new session" }));
  parts.push(
    Text({ ...bold, children: "Remote sync" }),
    Text({ dimColor: true, children: "Two-way with this repository's GitHub or GitLab issues, through your own gh or glab login. Suggested and archived cards stay local." }),
    Box({ flexDirection: "row", gap: 1, children: [
      Button({ key: "sync-toggle", onPress: () => act.remote(!isOn), children: isOn ? "Turn sync off" : "Turn sync on" }),
      ...(isOn ? [Button({ key: "sync-now", onPress: () => act.syncNow(), children: "Sync now" })] : []),
    ] }),
    Text({ dimColor: true, children: syncLine(board, sync) }),
    Text({ ...bold, children: "Folder" }),
    Text({ dimColor: true, wrap: "truncate-start", children: board.dir }),
  );
  if (board.isOldFolder) {
    parts.push(Text({ color: "warning", children: "These cards are still in .agents/board, the folder the board had first. It keeps working there; aw setup --move-board moves it to .agents/kanban." }));
  }
  return Box({ flexDirection: "column", gap: 1, paddingX: 1, children: parts });
}
