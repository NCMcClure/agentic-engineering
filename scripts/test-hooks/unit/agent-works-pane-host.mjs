// The kanban pane driven the way Claude Code drives a mod: register(on) with a
// stand-in for the engine's `$`, against a real folder. `$` is the mod's only
// way out (it has no Node of its own), so it is the system boundary: its fs
// and process nouns are this machine's own, every change runs the real board
// CLI, and the pane reads what the CLI left on the disk. What is stood in for
// is the host itself: the tool and command registries, the pane, the clock,
// the question a person is asked, the command or prompt a Start hands over,
// and the surface a Client region runs its module on.
//
// The stand-in refuses what the real host refuses, since one that accepts more
// lets a broken press ship: a prompt beginning with "/", a command name it
// does not know, a Button child that is not a string or Text, a Select with no
// options or two alike, a Client on a surface that draws none, a Client whose
// module is not a file beside the view or whose props are not plain data
// under 100000 characters, and a surface module that sets its state on three
// renders in a row. It has no `fs.write` at all: a pane that wrote a file
// would fail here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, tempRepo, write } from "./helpers.mjs";

export const PLUGIN = path.join(REPO, "plugins", "agent-works");
export const KANBAN = path.join(PLUGIN, "hooks", "kanban");
export const AW = path.join(PLUGIN, "scripts", "aw.mjs");
const MOD = pathToFileURL(path.join(KANBAN, "register.mjs")).href;
const PROPS_CAP = 100000;
/** The skill a Start runs, as the person would type it. */
export const DISPATCH = "agent-works:dispatch";

/** A repository with one commit, and where its board lives. `origin` names a tracker without reaching it. */
export function repo(t, { origin = null } = {}) {
  const r = tempRepo(t, "pane-");
  write(r.dir, "README.md", "fixture\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "fixture");
  if (origin) r.git("remote", "add", "origin", origin);
  const dir = fs.realpathSync.native(r.dir);
  return { ...r, dir, kanban: path.join(dir, ".agents", "kanban") };
}

/** The board CLI, run for real in `cwd`: `{ status, stdout, stderr }`. */
export function board(cwd, ...args) {
  const r = spawnSync(process.execPath, [AW, "board", ...args], { cwd, encoding: "utf8", env: { ...process.env, CLAUDECODE: "" } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The board as the CLI reads it: every card, and board.json's settings. */
export function boardOf(cwd) {
  const listed = JSON.parse(board(cwd, "list", "--all", "--json").stdout);
  const config = JSON.parse(board(cwd, "config", "--json").stdout);
  const card = (id) => listed.cards.find((c) => c.id === id);
  return { ...config, cards: listed.cards, dir: listed.dir, card };
}

export const cardFiles = (kanban) => (fs.existsSync(kanban) ? fs.readdirSync(kanban).filter((f) => /^\d+-.*\.md$/.test(f)).sort() : []);
export const cardText = (kanban, id) => fs.readFileSync(path.join(kanban, cardFiles(kanban).find((f) => f.startsWith(`${id}-`))), "utf8");

// Elements as each surface's table hands them out: a constructor from props to
// plain data, refusing the props the host refuses.
const element = (type, check = () => {}) => (props = {}) => {
  check(props);
  return { type, props };
};
const flat = (c) => (Array.isArray(c) ? c.flatMap(flat) : c === undefined || c === null || c === false ? [] : [c]);
const BUTTON = element("Button", (p) => {
  if (typeof p.key !== "string" || !p.key) throw new Error("Button takes a key");
  const odd = flat(p.children).find((c) => typeof c !== "string" && c.type !== "Text");
  if (odd) throw new Error(`Button ${p.key}: a ${odd.type} child is refused, only strings and Text`);
  if (typeof p.onPress !== "function") throw new Error(`Button ${p.key}: no onPress`);
});
const INPUT = element("Input", (p) => {
  if (typeof p.key !== "string" || typeof p.onSubmit !== "function") throw new Error("Input takes a key and an onSubmit");
  if (p.value !== undefined && typeof p.value !== "string") throw new Error(`Input ${p.key}: its value is a string`);
});
const SELECT = element("Select", (p) => {
  if (typeof p.key !== "string" || typeof p.onSelect !== "function") throw new Error("Select takes a key and an onSelect");
  const values = (p.options ?? []).map((o) => o.value);
  if (!values.length) throw new Error(`Select ${p.key}: at least one option`);
  if (values.some((v) => typeof v !== "string") || new Set(values).size !== values.length) throw new Error(`Select ${p.key}: option values are strings, each once`);
  if (p.value !== undefined && !values.includes(p.value)) throw new Error(`Select ${p.key}: its value "${p.value}" is none of its options`);
});
const LINK = element("Link", (p) => {
  if (!/^https?:\/\//.test(String(p.href))) throw new Error("Link takes an http(s) href");
});
/** Plain data under the cap, or the reason it is not. */
function plainData(value, what) {
  const text = JSON.stringify(value);
  let plain = text !== undefined;
  if (plain) { try { assert.deepStrictEqual(JSON.parse(text), value); } catch { plain = false; } }
  if (!plain) throw new Error(`${what} is not plain data: a function, an undefined, or a class instance does not cross`);
  if (text.length > PROPS_CAP) throw new Error(`${what} is ${text.length} characters serialized, past ${PROPS_CAP}`);
}
// The module is read off the source as a literal relative to the file that draws it: views.mjs, beside it.
const CLIENT = element("Client", (p) => {
  if (typeof p.key !== "string" || !p.key) throw new Error("Client takes a key");
  if (typeof p.module !== "string" || !/^\.\/[\w.-]+\.mjs$/.test(p.module) || !fs.existsSync(path.join(KANBAN, p.module))) {
    throw new Error(`Client ${p.key}: module ${JSON.stringify(p.module)} is not a .mjs file beside the view`);
  }
  plainData(p.props, `Client ${p.key} props`);
});
const SHARED = { Box: element("Box"), Text: element("Text"), Button: BUTTON, Link: LINK, Markdown: element("Markdown") };
const FIELDS = { Input: INPUT, Select: SELECT };
// What a surface module draws with: the terminal's table less Client.
const CLIENT_TABLE = { ...SHARED, ...FIELDS };
/** `bare` is a surface that draws neither a text field nor a picker, as an app may. */
export const TABLES = {
  terminal: { ...SHARED, ...FIELDS, Client: CLIENT }, desktop: { ...SHARED, ...FIELDS, Client: CLIENT }, vscode: { ...SHARED, ...FIELDS },
  mobile: { ...SHARED, ...FIELDS }, bare: SHARED,
};

export function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== "object") return undefined;
  visit(node);
  return walk(node.props?.children, visit);
}
/** One element as a surface draws it: its strings end to end. */
export const line = (node) => (typeof node === "string" ? node : Array.isArray(node) ? node.map(line).join("") : node?.props ? line(node.props.children ?? node.props.label ?? node.props.text ?? "") : "");
/** Every line a tree draws: each Text, Button and Markdown outside another's, in order. */
export function lines(tree) {
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return undefined;
    if (node.type === "Text" || node.type === "Button" || node.type === "Markdown") return out.push(line(node));
    if (node.type === "Input" || node.type === "Select") return out.push(`${node.props.label ?? ""}: ${node.props.value ?? ""}`);
    return visit(node.props?.children);
  };
  visit(tree);
  return out;
}
export const words = (tree) => lines(tree).join("\n");
export function find(tree, key, type = "Button") {
  let found = null;
  walk(tree, (n) => { if (n.type === type && n.props.key === key) found = n; });
  return found;
}
export function need(tree, key, type = "Button") {
  const found = find(tree, key, type);
  assert.ok(found, `no ${type} "${key}" in:\n${words(tree)}`);
  return found;
}
export const keys = (tree, type = "Button") => {
  const out = [];
  walk(tree, (n) => { if (n.type === type) out.push(n.props.key); });
  return out;
};

let loaded = 0;

/**
 * A Client's surface module run as a surface runs it: its default export
 * called with the props and a surface carrying the local state, the region's
 * size, the listeners, and `post`, which reaches the hooks module's ui.message
 * hook. setState redraws once after the event that set it; a module that sets
 * state on three renders in a row with no input between is unmounted, as the
 * host does, and so is one that throws.
 */
async function runClient(node, surface, deliver) {
  const { default: draw } = await import(pathToFileURL(path.join(KANBAN, node.props.module)).href);
  assert.equal(typeof draw, "function", `${node.props.module} has a default export that draws`);
  const inst = { props: node.props.props, state: undefined, dirty: false, streak: 0, tree: null, listeners: {}, posts: [], pending: [], gone: null, columns: node.props.width ?? 0 };
  const face = {
    elements: CLIENT_TABLE,
    get state() { return inst.state; },
    setState(next) { inst.state = next; inst.dirty = true; },
    get columns() { return inst.columns; },
    get rows() { return 0; },
    every() { throw new Error("the board keeps no timer"); },
    onPointer(fn) { inst.listeners.pointer = fn; return () => { inst.listeners.pointer = undefined; }; },
    onKey(fn) { inst.listeners.key = fn; return () => { inst.listeners.key = undefined; }; },
    post(data) { plainData(data, "a post"); inst.pending.push(data); },
  };
  const render = () => {
    if (inst.gone) throw new Error(`the Client was unmounted: ${inst.gone}`);
    inst.dirty = false;
    try { inst.tree = draw(inst.props, face); } catch (e) { inst.gone = e.message; throw e; }
    inst.streak = inst.dirty ? inst.streak + 1 : 0;
    if (inst.streak >= 3) {
      inst.gone = "a render loop: setState on three renders in a row with no input between";
      throw new Error(inst.gone);
    }
    if (inst.dirty) render();
  };
  const input = async (kind, event) => {
    inst.streak = 0;
    const fn = inst.listeners[kind];
    assert.ok(fn, `the board set no ${kind} listener`);
    fn(event);
    for (const data of inst.pending.splice(0)) {
      inst.posts.push(data);
      await deliver(data, surface, node.props);
    }
    if (inst.dirty) render();
  };
  render();
  return {
    get tree() { return inst.tree; },
    get state() { return inst.state; },
    get posts() { return inst.posts; },
    get props() { return inst.props; },
    pointer: (event) => input("pointer", event),
    key: (event) => input("key", typeof event === "string" ? { key: event } : event),
    /** The pointer pressed at one cell and released at another, through every cell between on a straight line. */
    async drag(from, to) {
      await input("pointer", { type: "down", ...from, button: "left" });
      const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      for (let i = 1; i <= steps; i++) {
        await input("pointer", { type: "move", x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps), button: "left" });
      }
      await input("pointer", { type: "up", ...to, button: "left" });
    },
    /** New props from the pane drawn again, the instance and its state kept, as the host keeps them under one key. */
    update(tree) {
      let next = null;
      walk(tree, (n) => { if (n.type === "Client" && n.props.key === node.props.key) next = n; });
      assert.ok(next, `the pane drew no Client "${node.props.key}" again:\n${words(tree)}`);
      inst.props = next.props.props;
      inst.columns = next.props.width ?? inst.columns;
      render();
    },
  };
}

/**
 * register(on) in a fresh copy of the module, with a `$` that records what the
 * host was asked. `refuseCommands` is a host that will not run a skill's
 * command for a mod, `noCommands` one with no such call at all, `busy` one in
 * the middle of a turn, which runs a command only once `idle()` is called; `answers` are
 * what the person picks, in order, each time they are asked; `run(argv)` may
 * answer a process in the real one's place (a tracker's CLI, say) by returning
 * a result; `skills` are the skills the host lists beside the plugin's own.
 */
export async function mount(cwd, { refuseCommands = false, noCommands = false, busy = false, answers = [], run = null, options = {}, skills = [], panes = [], unplaced = false, noPane = false } = {}) {
  const { register, ...rest } = await import(`${MOD}?case=${++loaded}`);
  assert.deepEqual(Object.keys(rest), [], "the hooks module exports register and nothing else");
  const hooks = [];
  register((event, matcher, hook) => {
    if (typeof matcher === "function") [matcher, hook] = [{}, matcher];
    const entry = { event, matcher, hook, rescue: null };
    hooks.push(entry);
    return { catch(handler) { entry.rescue = handler; } };
  }, options);
  const seen = { tools: [], commands: [], commandRuns: [], submits: [], toasts: [], opens: [], timers: [], afters: [], runs: [], asks: [], invalidations: 0, lists: 0 };
  const session = { cwd };
  const waiting = [];
  const known = () => [...seen.commands.map((x) => x.name), DISPATCH, ...skills];
  const $ = {
    plugin: { name: "agent-works", root: PLUGIN },
    session: { cwd: async () => session.cwd },
    fs: {
      exists: async (p) => fs.existsSync(p),
      list: async (p) => {
        seen.lists++;
        return fs.readdirSync(p, { withFileTypes: true }).map((d) => {
          const st = fs.lstatSync(path.join(p, d.name));
          return { name: d.name, kind: d.isFile() ? "file" : d.isDirectory() ? "dir" : "other", size: d.isFile() ? st.size : 0, mtimeMs: d.isFile() ? st.mtimeMs : 0 };
        });
      },
    },
    process: {
      run: async (argv, init = {}) => {
        seen.runs.push(argv);
        const faked = run?.(argv, init);
        if (faked) return { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false, ...faked };
        const [cmd, ...args] = argv;
        // CLAUDECODE is this test run's own, when an agent runs it: a card's source is said by the pane, never guessed.
        const r = spawnSync(cmd === "node" ? process.execPath : cmd, args, { cwd: init.cwd ?? session.cwd, input: init.stdin ?? "", encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, CLAUDECODE: "" } });
        if (r.error) throw r.error;
        return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, isStdoutTruncated: false, isStderrTruncated: false };
      },
    },
    tool: { register: async (t) => { seen.tools.push(t); return { tool: `mcp__agent-works__${t.name}` }; } },
    command: {
      register: async (c) => { seen.commands.push(c); return { command: c.name }; },
      list: async () => known().map((name) => ({ name, source: seen.commands.some((c) => c.name === name) ? "builtin" : "plugin" })),
      ...(noCommands ? {} : {
        run: async (c) => {
          if (refuseCommands) throw new Error(`command.run: ${c.command} is not run for a plugin here (host check)`);
          if (!known().includes(c.command)) throw new Error(`command.run: no command "${c.command}" (host check)`);
          if (busy) await new Promise((go) => { waiting.push(go); });
          seen.commandRuns.push(c);
          return {};
        },
      }),
    },
    prompt: {
      submit: async (p) => {
        if (p.text.startsWith("/")) throw new Error("prompt.submit: a text beginning with / would run a command as the person (host check)");
        seen.submits.push(p);
        return {};
      },
    },
    clock: {
      every: (ms, fn) => {
        const timer = { ms, fn, cancelled: false, cancel() { timer.cancelled = true; } };
        seen.timers.push(timer);
        return timer;
      },
      after: (ms, fn) => {
        const timer = { ms, fn, cancelled: false, cancel() { timer.cancelled = true; } };
        seen.afters.push(timer);
        return timer;
      },
    },
    ui: {
      open: async (p) => {
        if (noPane) throw new Error("no pane host");
        seen.opens.push(p);
        return { isPlaced: !unplaced };
      },
      panes: async () => panes,
      toast: (text) => { seen.toasts.push(text); },
      ask: async (question, options) => {
        seen.asks.push({ question, options });
        if (!answers.length) throw new Error("ui.ask: dismissed");
        return answers.shift();
      },
      invalidate: () => { seen.invalidations++; },
      resolve: (e) => TABLES[e.surface],
    },
  };
  const emit = async (event, e) => {
    const h = hooks.find((x) => x.event === event && Object.entries(x.matcher).every(([k, v]) => e[k] === v));
    return h ? h.hook($, e, async () => ({})) : undefined;
  };
  const message = (data, surface, props) => emit("ui.message", { surface, component: "Pane", requestId: "kanban", element: props.key, module: `hooks/kanban/${props.module.slice(2)}`, data });
  await emit("session.start", { cwd, surface: "terminal", isInteractive: true });
  const draw = (surface = "terminal", bodyColumns = 100, placement = "dock") => emit("ui.render", { component: "Pane", requestId: "kanban", surface, props: { bodyColumns, placement } });
  /** Every start a press left running has reached the host, and its answer is in. */
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((done) => setImmediate(done)); };
  return {
    seen, session, draw, hooks, settle,
    /** The turn under way ends: the commands asked for meanwhile run, in order. */
    idle: async () => {
      for (const go of waiting.splice(0)) go();
      await settle();
    },
    events: () => hooks.map((h) => h.event),
    tool: (name, input) => emit("tool.call", { tool: `mcp__agent-works__${name}`, tool_use_id: `call-${name}`, ...input }),
    command: (args = "") => emit("command.run", { command: "kanban", args, origin: { kind: "composer" } }),
    close: () => emit("ui.close", { id: "kanban", origin: { kind: "person" } }),
    tick: () => Promise.all(seen.timers.filter((t) => !t.cancelled).map((t) => t.fn())),
    /** Press a button of a drawn tree, and wait for what it started. */
    press: async (tree, key, surface = "terminal") => {
      await need(tree, key).props.onPress({ surface });
      await settle();
    },
    /** Submit a text field of a drawn tree. */
    type: async (tree, key, text, surface = "terminal") => {
      await need(tree, key, "Input").props.onSubmit(text, { surface });
      await settle();
    },
    /** Pick an option of a drawn picker; the option must be one it offers. */
    pick: async (tree, key, value, surface = "terminal") => {
      const select = need(tree, key, "Select");
      assert.ok(select.props.options.some((o) => o.value === value), `Select ${key} offers no "${value}": ${select.props.options.map((o) => o.value).join(", ")}`);
      await select.props.onSelect(value, { surface });
      await settle();
    },
    /** A post from a Client the pane drew, as the host delivers it. */
    post: async (data, surface = "terminal") => {
      await message(data, surface, { key: "board", module: "./board.client.mjs" });
      await settle();
    },
    /** The Client the pane drew, failed on a surface. */
    fault: (surface = "terminal") => emit("ui.fault", { surface, component: "Pane", requestId: "kanban", element: "board", module: "hooks/kanban/board.client.mjs" }),
    /** The Client in a drawn pane, its module running. */
    client: async (tree, surface = "terminal") => {
      let node = null;
      walk(tree, (n) => { if (n.type === "Client") node = n; });
      assert.ok(node, `the pane drew no Client:\n${words(tree)}`);
      return runClient(node, surface, async (data, s, props) => { await message(data, s, props); await settle(); });
    },
  };
}
