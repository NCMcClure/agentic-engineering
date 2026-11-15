// The kanban pane and the board's model tools: the hooks module hooks.json
// lists under `modules`, loaded as it is, with nothing to build.
//
// /kanban opens a pane beside the chat: the board's lanes, narrowed to a scope
// (the active sprint, the backlog, an epic, or all) and to the gates when that
// filter is on, with views for one card, a new card, the epics, the sprints and
// the settings (views.mjs). /kanban add, epic, sprint and sync change the board
// from the prompt.
//
// The pane never writes a card or board.json. Every change, from a press, a
// drop, a subcommand or a tool, is one run of the board CLI, which takes the
// board's lock (commands.mjs lists the runs, actions.mjs makes them). The
// board is read back through the CLI too.
//
// Closed, the pane costs nothing: no timer runs and nothing is read. Open, it
// looks at the board folder's listing every 3 seconds and reads the board only
// when a file there changed, plus a full read now and then for plan issues,
// which live on the base branch. The six tools are deferred, so an idle
// session carries their names and no more.
//
// Every call on the engine is spelled in this file: the other files of the mod
// take the `host` built here in `$`'s place. The pane's state lives in this
// module, so a reload loses the view and the selection and nothing else: the
// board is on the disk.
import { actionsOf, newState } from "./actions.mjs";
import { BOARD } from "./commands.mjs";
import { MIN_LANE } from "./layout.mjs";
import { plannedFor, scopeOf } from "./model.mjs";
import { TOOLS, runTool } from "./tools.mjs";
import { pane } from "./views.mjs";

const PANE = "kanban";
const TITLE = "Kanban";
const COMMAND = "kanban";
const POLL_MS = 3000;
/** Every this many polls the board is read whatever the folder's listing says. */
const FULL_EVERY = 10;
const SYNC_SECONDS = 120;
/** How long a view change's redraw takes to land on the surface, generously. */
const REFOCUS_MS = 150;
const USAGE = "/kanban opens the board. /kanban add <title> | epic <title> | sprint new <title> | sprint start [<id>] | sprint close [<id>] | sync on | sync off | sync now";

// The surfaces that draw a Client: the board side by side, with a pointer and keys of its own.
const CLIENT_SURFACES = new Set(["terminal", "desktop"]);

const state = newState();
let syncSeconds = SYNC_SECONDS;

/** The engine as the mod's other files reach it. */
function hostOf($) {
  return {
    root: $.plugin.root,
    cwd: () => $.session.cwd(),
    run: (argv, init) => $.process.run(argv, init),
    exists: (path) => $.fs.exists(path),
    list: (path) => $.fs.list(path),
    toast: (text) => { $.ui.toast(text); },
    ask: (question, options) => $.ui.ask(question, options),
    command: (run) => $.command.run(run),
    submit: (text) => $.prompt.submit({ text, asUser: true }),
    redraw: () => { if (state.paneUp) $.ui.invalidate("ui.render"); },
    refocus: () => {
      if (!state.paneUp) return;
      $.clock.after(REFOCUS_MS, () => { $.ui.open({ id: PANE, title: TITLE, focus: true }).catch(() => undefined); });
    },
  };
}

const act = ($) => actionsOf(hostOf($), state);

function startPolling($) {
  const every = { fullEvery: FULL_EVERY, syncEvery: Math.max(1, Math.round((syncSeconds * 1000) / POLL_MS)) };
  state.timer ??= $.clock.every(POLL_MS, () => act($).tick(every).catch(() => undefined));
}

function stopPolling() {
  state.timer?.cancel();
  state.timer = null;
}

/** `/kanban` could not show its pane: said in a toast and in the command's answer, never silently. */
function notOpened($, why) {
  const text = `The kanban pane could not be opened: ${why}. The cards are still there: aw board list.`;
  $.ui.toast(text);
  return { text };
}

async function openPane($) {
  await act($).read(true);
  Object.assign(state, { view: { kind: "board" }, notice: null });
  // Room for every lane side by side, a Suggested lane included.
  const columns = ((state.board?.columns.length || 4) + 1) * MIN_LANE;
  let opened;
  try { opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, columns }); } catch (e) {
    return notOpened($, e?.message ?? String(e));
  }
  if (opened && opened.isPlaced === false) return notOpened($, "this surface has no place for a pane");
  state.paneUp = true;
  state.syncedAt = state.ticks;
  startPolling($);
  $.ui.invalidate("ui.render");
  if (state.error) return { text: `Kanban opened, but the board could not be read: ${state.error}` };
  const board = state.board;
  const count = board.cards.filter((c) => c.status !== "archived").length;
  const where = board.isOldFolder ? `${board.dir} (the folder the board had first: it keeps working)` : board.dir;
  return { text: count === 0 && !board.exists ? `Kanban opened: no board in ${where} yet; the first card creates it.` : `Kanban opened: ${count} cards in ${where}` };
}

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/s, "$2").trim();

/** `/kanban <subcommand>`: the change it asks for, made through the same actions a press makes. */
async function subcommand($, args) {
  const a = act($);
  const [verb, rest = ""] = [/^\S+/.exec(args)[0], args.replace(/^\S+\s*/, "")];
  const said = (r, fallback) => ({ text: r?.text || fallback });
  // A subcommand works on the board as it is, and plans a new card into the scope the pane shows.
  if (!(await a.current())) return { text: `The board could not be read: ${state.error}` };
  if (verb === "add" && rest) {
    return said(await a.change(BOARD.add({ title: unquote(rest), ...plannedFor(state.board, scopeOf(state.board, state.scope)) }), { quiet: true }));
  }
  if (verb === "epic" && rest) return said(await a.change(BOARD.epic({ title: unquote(rest) }), { quiet: true }));
  if (verb === "sprint") {
    const [action, what = ""] = [/^\S*/.exec(rest)[0], rest.replace(/^\S+\s*/, "").trim()];
    if (action === "new" && what) return said(await a.change(BOARD.sprintNew({ title: unquote(what) }), { quiet: true }));
    if (action === "start") return said(await a.sprintStart(what || undefined));
    if (action === "close") return said(await a.sprintClose(what || undefined, { confirm: false }), state.notice?.text ?? "No sprint was closed.");
    return { text: "Usage: /kanban sprint new <title> | start [<id>] | close [<id>]" };
  }
  if (verb === "sync" && ["on", "off", "now"].includes(rest.trim())) {
    if (rest.trim() === "now") await a.syncNow();
    else await a.remote(rest.trim() === "on");
    const on = state.board?.remote?.enabled === true;
    if (state.sync.status === "error") return { text: `Sync failed: ${state.sync.message}` };
    return { text: `Remote sync is ${on ? "on" : "off"}.${on && state.sync.message ? ` ${state.sync.message}` : ""}` };
  }
  return { text: USAGE };
}

/** One post of the board's surface module: plain data from code, checked before it is acted on. */
async function onPost($, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const a = act($);
  const id = typeof data.id === "string" ? data.id : "";
  const by = data.by === -1 ? -1 : 1;
  const index = Number.isInteger(data.index) && data.index >= 0 ? data.index : undefined;
  const board = state.board;
  if (!board) return;
  const known = id !== "" && board.cards.some((c) => c.id === id);
  if (data.type === "scope") return a.cycleScope();
  if (data.type === "filter") return a.toggleGates();
  if (data.type === "epics" || data.type === "sprints") return a.view({ kind: data.type });
  if (data.type === "new") {
    const first = board.columns[0]?.id ?? "backlog";
    return a.view({ kind: "new", status: board.columns.some((c) => c.id === data.to) ? data.to : first });
  }
  if (data.type === "select") return a.select(known ? id : null);
  if (!known) return;
  if (data.type === "open") return a.open(id);
  if (data.type === "move" && typeof data.to === "string") return a.drop(id, data.to, index);
  if (data.type === "shift") return a.shift(id, by);
  if (data.type === "nudge") return a.nudge(id, index === undefined ? { by } : { index });
  if (data.type === "start") return a.start(id);
  if (data.type === "accept") return a.accept(id);
  if (data.type === "archive") return a.archive(id);
}

export const register = (on, options) => {
  const seconds = Number(options?.syncIntervalSeconds);
  if (Number.isFinite(seconds) && seconds >= 30) syncSeconds = seconds;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Open this repository's kanban board",
      argumentHint: "[add <title> | epic <title> | sprint new <title>|start [<id>]|close [<id>] | sync on|off|now]",
    });
    for (const [name, tool] of Object.entries(TOOLS)) {
      await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema, isDeferred: true });
    }
    // A reload keeps the pane up and drops this module's state: pick the poll back up.
    const panes = await $.ui.panes().catch(() => []);
    if (panes.some((p) => p.id === PANE)) {
      state.paneUp = true;
      startPolling($);
      act($).reread().catch(() => undefined);
    }
    return next(e);
  });

  on("command.run", { command: COMMAND }, async ($, e) => {
    const args = String(e.args ?? "").trim();
    if (args === "") return openPane($);
    return subcommand($, args);
  }).catch(() => ({ text: "/kanban failed. The cards are still there: aw board list." }));

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const board = state.board;
    const model = {
      board, error: state.error, view: state.view, selected: state.selected, scope: board ? scopeOf(board, state.scope) : "all", gatesOnly: state.gatesOnly,
      queue: state.queue, sync: state.sync, notice: state.notice && state.notice.at === state.signature ? state.notice : null, draft: state.draft, skills: [],
    };
    if (board && state.view.kind === "card") {
      const commands = await $.command.list().catch(() => []);
      model.skills = commands.filter((c) => c.source === "plugin" || c.source === "user").map((c) => c.name).sort();
    }
    const client = CLIENT_SURFACES.has(e.surface) && !state.faulted.has(e.surface);
    return pane($.ui.resolve(e), model, act($), { columns: e.props?.bodyColumns ?? 40, client });
  });

  on("ui.message", { requestId: PANE }, async ($, e, next) => {
    const heard = await next(e);
    await onPost($, e.data);
    return heard;
  });

  on("ui.fault", { requestId: PANE }, ($, e, next) => {
    state.faulted.add(e.surface);
    $.ui.toast("The board could not be drawn side by side here, so its lanes are stacked until the plugin reloads.");
    $.ui.invalidate("ui.render");
    return next(e);
  });

  on("ui.close", ($, e, next) => {
    if (e.id === PANE) {
      Object.assign(state, { paneUp: false, notice: null, draft: "" });
      stopPolling();
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  // The names are written out: the host reads each matcher off this source. A hook that fails still answers.
  on("tool.call", { tool: "mcp__agent-works__surface_task" }, ($, e) => answerTool($, "surface_task", e)).catch(toolFailed);
  on("tool.call", { tool: "mcp__agent-works__list_tasks" }, ($, e) => answerTool($, "list_tasks", e)).catch(toolFailed);
  on("tool.call", { tool: "mcp__agent-works__move_task" }, ($, e) => answerTool($, "move_task", e)).catch(toolFailed);
  on("tool.call", { tool: "mcp__agent-works__plan_task" }, ($, e) => answerTool($, "plan_task", e)).catch(toolFailed);
  on("tool.call", { tool: "mcp__agent-works__owe_gate" }, ($, e) => answerTool($, "owe_gate", e)).catch(toolFailed);
  on("tool.call", { tool: "mcp__agent-works__settle_gate" }, ($, e) => answerTool($, "settle_gate", e)).catch(toolFailed);
};

/** What a tool call is answered with when its hook failed. */
function toolFailed() {
  return { deny: "the board tool failed: aw board does the same from a shell" };
}

/** One tool call, then an open pane drawn from what the call left on the disk. */
async function answerTool($, name, e) {
  const out = await runTool(hostOf($), name, e);
  if (state.paneUp && name !== "list_tasks") act($).reread().catch(() => undefined);
  return out;
}
