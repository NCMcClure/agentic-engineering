// What a press, a key, a drop or a /kanban subcommand does. Each change to the
// board is one run of the board CLI (commands.mjs names which), then the board
// is read again from the disk and the pane drawn from it: the pane holds no
// copy it could write back, so a refusal by the CLI leaves the card where it
// was and the reason is shown.
//
// Start hands a card to the plugin's dispatch skill, run in this session as if
// the person typed it: the skill checks the card against what is in flight,
// writes the brief and starts the work. With the board's start mode on queue
// the skill is asked to work the card in this session instead of a session of
// its own. Either way the host runs one command at a time, once the session is
// idle, and a card asked for and not yet begun is marked queued. A host that
// cannot run a skill for a mod gets the one command to type instead.
//
// `host` is the engine as register.mjs spells it; `state` is the pane's own:
// the view, the selection, the scope and the gates filter, the queue, where
// sync stands, and the last answer drawn under the board.
import { SUGGESTED, activeSprint, isEpic, isFinished, isGate } from "../../lib/board.mjs";
import { BOARD } from "./commands.mjs";
import { SYNC_MS, answer, readBoard, runBoard, signatureOf } from "./host.mjs";
import { closePreview, lanesOf, nextScope, notStarting, placeAt, plannedFor, scopeOf } from "./model.mjs";

export const DISPATCH = "agent-works:dispatch";
const BOARD_VIEW = { kind: "board" };

/** The pane's state at load: nothing read, the board view, no choice made. */
export function newState() {
  return {
    board: null, error: null, signature: null, view: BOARD_VIEW, selected: null, scope: null, gatesOnly: false, queue: [], draft: "", notice: null,
    sync: { status: "idle", message: "" }, paneUp: false, timer: null, ticks: 0, syncedAt: 0, pending: Promise.resolve(false),
    // The surfaces a Client failed on: the stacked lanes stand in there until a reload.
    faulted: new Set(),
    chain: Promise.resolve(false),
  };
}

/** Everything the pane does, bound to one host and one state. */
export function actionsOf(host, state) {
  const redraw = () => host.redraw();
  // An answer is drawn under the board until the board next changes on the disk.
  const say = (r) => {
    state.notice = { ok: r.ok, text: r.text, at: state.signature };
    host.toast(r.text);
  };

  // ---- reading ----------------------------------------------------------

  /** Read the board when its folder changed, or whatever it says with `force`. True when what the pane draws changed. */
  async function refresh(force) {
    const hadError = state.error !== null;
    if (!force && state.board) {
      const now = await signatureOf(host, state.board.dir);
      if (now === state.signature) return false;
    }
    const board = await readBoard(host);
    state.signature = await signatureOf(host, board.dir);
    const changed = hadError || JSON.stringify(board) !== JSON.stringify(state.board);
    Object.assign(state, { board, error: null });
    return changed;
  }

  /** One read at a time: a poll and a press never interleave. */
  function read(force = false) {
    state.chain = state.chain.then(() => refresh(force)).catch((e) => {
      const message = e?.message ?? String(e);
      const changed = state.error !== message;
      state.error = message;
      return changed;
    });
    return state.chain;
  }

  /** After a change: read again whatever the folder's listing says, and draw. */
  async function reread() {
    await read(true);
    redraw();
  }

  /** The board as it stands now, or null when it cannot be read. */
  async function current() {
    await read(true);
    return state.error ? null : state.board;
  }

  /** One run of the board CLI that changes the board, then a fresh read. `{ ok, text }`. */
  async function change(args, { quiet = false, timeoutMs } = {}) {
    let r;
    try { r = answer(await runBoard(host, args, timeoutMs ? { timeoutMs } : undefined)); } catch (e) { r = { ok: false, text: `the board CLI could not be run: ${e?.message ?? e}` }; }
    await reread();
    if (!r.ok || !quiet) say(r);
    redraw();
    return r;
  }

  const scope = () => scopeOf(state.board, state.scope);
  const cardOf = (id) => state.board?.cards.find((c) => c.id === id) ?? null;

  // ---- views ------------------------------------------------------------

  /** Show another view. The redraw takes away the element that held the focus, so the pane asks for the keyboard back. */
  function view(next) {
    Object.assign(state, { view: next, notice: null, draft: "" });
    redraw();
    host.refocus();
  }

  function select(id) {
    if (state.selected === id) return;
    state.selected = id;
    redraw();
  }

  // ---- starting ---------------------------------------------------------

  /**
   * Ask this session to run one of the plugin's skills, as if the person typed it. The host runs it once the
   * session is idle, so nothing here waits for that: the card is marked queued until the command has begun, and
   * `state.pending` settles then.
   */
  function runSkill(command, args, id) {
    const typed = `/${command} ${args}`;
    state.queue = [...state.queue.filter((x) => x !== id), id];
    say({ ok: true, text: `Queued ${typed}: it runs in this session once it is idle.` });
    redraw();
    state.pending = Promise.resolve().then(() => host.command({ command, args })).then(() => true, (e) => {
      // No way to start a skill from here: the person types it.
      say({ ok: false, text: `This host did not run ${typed} for the pane (${e?.message ?? e}). Type it at the prompt to start the card.` });
      return false;
    }).then((ran) => {
      state.queue = state.queue.filter((x) => x !== id);
      redraw();
      return ran;
    });
  }

  /** Ask this session something in plain words, as the person's own prompt. */
  async function prompt(text, said) {
    try {
      await host.submit(text);
      say({ ok: true, text: said });
    } catch (e) {
      say({ ok: false, text: `The pane could not ask this session (${e?.message ?? e}).` });
    }
    redraw();
  }

  const aw = () => `node "${host.root}/scripts/aw.mjs" board`;

  /**
   * Start a card. A task goes to the dispatch skill; an epic is handed to this session to slice into cards; a
   * gate is handed to it to run and settle. A task that is not ready does not start, and the pane says why.
   */
  async function start(id) {
    const board = await current();
    const card = board?.cards.find((c) => c.id === id);
    if (!card) return;
    state.selected = id;
    if (isEpic(card)) {
      return prompt(
        `Break down epic ${card.id} "${card.title}" on the kanban board into cards, and do none of the work itself. Read it with \`${aw()} show ${card.id}\`, read the code it touches, then file each missing slice as a card that stands alone (what, why, where, done when), in the order it should be done: \`${aw()} add "<title>" --epic ${card.id} --details "<details>"\`. A slice is one session's work. Leave the epic card where it is and end with the list of cards you filed.`,
        `Asked this session to break down epic ${card.id}.`,
      );
    }
    if (isGate(card)) {
      if (isFinished(board, card)) return say({ ok: false, text: `Gate ${card.id} is already settled.` });
      return prompt(
        `Run the owed gate ${card.id} "${card.title}" from the kanban board. Read it with \`${aw()} show ${card.id}\`, run the check it names, and when it has run and passed settle it with its evidence: \`${aw()} settle ${card.id} --evidence "<the command and its result>"\`. If it fails or you cannot run it, leave the card where it is and say why.`,
        `Asked this session to run gate ${card.id}.`,
      );
    }
    const why = notStarting(board, card);
    if (why) {
      say({ ok: false, text: `${card.id} does not start: ${why}` });
      return redraw();
    }
    if (state.queue.includes(id)) return undefined;
    return runSkill(DISPATCH, board.startMode === "queue" ? `${id} --serial` : id, id);
  }

  // ---- moving -----------------------------------------------------------

  const lanes = () => lanesOf(state.board, { scope: scope(), gatesOnly: state.gatesOnly });

  /** Put a card in a column, or in suggested or archived, as a plain move: nothing starts. `slot` is a place in the drawn lane. */
  async function place(id, to, slot) {
    const card = cardOf(id);
    if (!card || card.status === to) return { ok: true, text: "" };
    const index = slot === undefined ? undefined : placeAt(state.board, lanes(), id, to, slot);
    const r = await change(BOARD.move({ id, to, index }));
    if (r.ok && to === "archived") Object.assign(state, { selected: null, view: BOARD_VIEW });
    redraw();
    return r;
  }

  /**
   * A card dropped on a lane, or shifted into it. Into the start column from a lane before it the drop asks for
   * the card to start and moves nothing: the dispatch moves it once its session has it. Anywhere else it is a move.
   */
  async function drop(id, to, slot) {
    const board = state.board;
    const card = cardOf(id);
    if (!board || !card) return undefined;
    if (card.status === to) return slot === undefined ? undefined : nudge(id, { index: slot });
    const order = [SUGGESTED, ...board.columns.map((c) => c.id)];
    const startId = board.columns.find((c) => c.role === "start")?.id;
    if (to === startId && order.indexOf(card.status) < order.indexOf(to) && !isEpic(card) && !isGate(card)) return start(id);
    return place(id, to, slot);
  }

  /** Move a card one lane left or right of the one it is in. */
  function shift(id, by) {
    const board = state.board;
    const card = cardOf(id);
    if (!board || !card || (card.status === SUGGESTED && by < 0)) return undefined;
    if (card.status === SUGGESTED) return accept(id);
    const ids = board.columns.map((c) => c.id);
    const to = ids[Math.max(0, Math.max(0, ids.indexOf(card.status)) + by)];
    return to === undefined || to === card.status ? undefined : drop(id, to);
  }

  /** Move a card within its own lane as drawn: one place up or down (`by`), or to a place (`index`). */
  async function nudge(id, { by, index }) {
    const card = cardOf(id);
    if (!state.board || !card) return undefined;
    const drawn = lanes().find((l) => l.cards.some((c) => c.id === id));
    if (!drawn) return undefined;
    const at = drawn.cards.findIndex((c) => c.id === id);
    const slot = Math.max(0, Math.min(drawn.cards.length - 1, index ?? at + by));
    if (slot === at) return undefined;
    const to = placeAt(state.board, [{ ...drawn, id: card.status }], id, card.status, slot);
    const end = state.board.cards.filter((c) => c.status === card.status && c.id !== id && c.source !== "plan").length;
    return change(BOARD.reorder({ id, index: to ?? end }), { quiet: true });
  }

  /** Accept a suggestion into the first column, and into the sprint or epic the board is scoped to. */
  async function accept(id) {
    const board = state.board;
    const card = cardOf(id);
    const first = board?.columns[0];
    if (!first || card?.status !== SUGGESTED) return undefined;
    const planned = plannedFor(board, scope());
    const plan = { sprint: card.sprint ? undefined : planned.sprint, epic: card.epic ? undefined : planned.epic };
    if (plan.sprint || plan.epic) {
      const filed = await change(BOARD.plan({ id, ...plan }), { quiet: true });
      if (!filed.ok) return filed;
    }
    return change(BOARD.move({ id, to: first.id }));
  }

  // ---- sync -------------------------------------------------------------

  /** One pass with the tracker, said in the settings and the toolbar. */
  async function syncNow() {
    if (state.sync.status === "running" || !state.board?.remote?.enabled) return;
    state.sync = { status: "running", message: "" };
    redraw();
    const r = await change(BOARD.remoteSync(), { quiet: true, timeoutMs: SYNC_MS });
    state.sync = r.ok ? { status: "idle", message: r.text.split("\n")[0] } : { status: "error", message: r.text.split("\n")[0] };
    state.syncedAt = state.ticks;
    redraw();
  }

  /**
   * Turn sync with the tracker on or off. Turning it on opens an issue for every card without one, so the person
   * is asked first, with that count.
   */
  async function remote(on) {
    if (!on) {
      state.sync = { status: "idle", message: "" };
      return change(BOARD.remoteOff());
    }
    let status;
    try {
      const r = await runBoard(host, BOARD.remoteStatus());
      if (r.code !== 0) return say(answer(r));
      status = JSON.parse(r.out);
    } catch (e) {
      return say({ ok: false, text: `Sync was not turned on: ${e?.message ?? e}` });
    }
    if (!status.provider) {
      say({ ok: false, text: "Sync was not turned on: the origin remote is neither GitHub nor GitLab." });
      return redraw();
    }
    const where = `${status.provider}${status.repo ? ` ${status.repo}` : ""}`;
    const yes = "Turn it on";
    let picked;
    try {
      picked = await host.ask(`Sync this board with ${where}? The first pass opens ${status.unlinked} issue(s), one for each card without one, and brings in the open issues that have no card.`, [yes, "Keep it off"]);
    } catch {
      picked = null;
    }
    if (picked !== yes) {
      say({ ok: true, text: "Sync stays off." });
      return redraw();
    }
    const turned = await change(BOARD.remoteOn(), { quiet: true });
    if (!turned.ok) return turned;
    return syncNow();
  }

  // ---- the poll ---------------------------------------------------------

  /** One tick of the open pane's timer: read when the folder changed, and sync when it is due. */
  async function tick({ fullEvery, syncEvery }) {
    if (!state.paneUp) return;
    state.ticks++;
    // Plan issues come from the base branch, which the folder's listing does not show: read in full now and then.
    if (await read(state.ticks % fullEvery === 0)) redraw();
    if (state.board?.remote?.enabled && state.sync.status !== "running" && state.ticks - state.syncedAt >= syncEvery) await syncNow();
  }

  return {
    read, reread, current, change, tick,
    view, select,
    open: (id) => { state.selected = id; view({ kind: "card", id }); },
    back: () => view(BOARD_VIEW),
    start, place, drop, shift, nudge, accept,
    archive: (id) => place(id, "archived"),
    add: async (title, status) => {
      if (!String(title ?? "").trim()) return undefined;
      const r = await change(BOARD.add({ title: title.trim(), status, ...plannedFor(state.board, scope()) }));
      if (r.ok) view(BOARD_VIEW);
      return r;
    },
    addEpic: async (title) => {
      if (!String(title ?? "").trim()) return undefined;
      const r = await change(BOARD.epic({ title: title.trim() }));
      const id = r.ok ? /^Added card (\S+)/.exec(r.text)?.[1] : null;
      if (id) {
        state.selected = id;
        Object.assign(state, { view: { kind: "card", id }, draft: "" });
        redraw();
        host.refocus();
      }
      return r;
    },
    patch: (id, patch) => change(BOARD.edit({ id, ...patch }), { quiet: true }),
    note: (id, text) => change(BOARD.note({ id, text }), { quiet: true }),
    draft: (text) => { state.draft = text; },
    settle: async (id, text = state.draft) => {
      if (!String(text ?? "").trim()) return say({ ok: false, text: "Write what showed the check holds, then Settle." }), redraw();
      const r = await change(BOARD.settle({ id, evidence: text.trim() }));
      if (r.ok) state.draft = "";
      return redraw();
    },
    cycleScope: () => {
      Object.assign(state, { scope: nextScope(state.board, scope()), selected: null });
      redraw();
    },
    showEpic: (id) => {
      Object.assign(state, { scope: id, selected: null });
      view(BOARD_VIEW);
    },
    toggleGates: () => {
      state.gatesOnly = !state.gatesOnly;
      redraw();
    },
    startMode: (mode) => change(BOARD.startMode({ mode }), { quiet: true }),
    sprintNew: async (title) => (String(title ?? "").trim() ? change(BOARD.sprintNew({ title: title.trim() })) : undefined),
    sprintStart: async (id) => {
      const r = await change(BOARD.sprintStart({ id }));
      if (r.ok) Object.assign(state, { scope: "sprint", selected: null });
      redraw();
      return r;
    },
    /** Close a sprint once the person has seen what closing it does. */
    sprintClose: async (id, { confirm = true } = {}) => {
      const board = await current();
      const wanted = id || (board && activeSprint(board)?.id);
      const preview = board && wanted ? closePreview(board, wanted) : null;
      if (!preview) return say({ ok: false, text: wanted ? `No open sprint "${wanted}".` : "No sprint is active: name the one to close." }), redraw();
      if (confirm) {
        const yes = "Close it";
        let picked;
        try { picked = await host.ask(`Close sprint ${wanted}? ${preview}`, [yes, "Keep it open"]); } catch { picked = null; }
        if (picked !== yes) return undefined;
      }
      const r = await change(BOARD.sprintClose({ id: wanted }));
      if (r.ok && state.scope === "sprint") state.scope = null;
      redraw();
      return r;
    },
    sprintEdit: (id, patch) => change(BOARD.sprintEdit({ id, ...patch }), { quiet: true }),
    remote, syncNow,
  };
}
