// The repo's own settings, .agents/agent-works.json: where it is, what it
// holds when a key is left out, and how the rest of the plugin reads it.
//
// A hook loads this on every tool call, so it stays small and never throws at
// its caller: a file that does not parse comes back as the defaults with the
// reason under `_error`.
import fs from "node:fs";
import path from "node:path";
import { ancestors, readText, startDir } from "./common.mjs";

/** The config file, relative to the folder that holds `.agents`. */
export const CONFIG = ".agents/agent-works.json";
/** The `version` a config written today carries. */
export const CONFIG_VERSION = 1;
/** Where the board lived before `paths.kanban`; still read while the new folder does not exist. */
export const OLD_BOARD = ".agents/board";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function deepFreeze(value) {
  if (value !== null && typeof value === "object") Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/** Every key of the config with the value it has when the file leaves it out. Frozen: `defaults()` gives a copy to change. */
export const DEFAULTS = deepFreeze({
  version: CONFIG_VERSION,
  paths: {
    memory: ".agents/memory",
    kanban: ".agents/kanban",
    briefs: ".agents/briefs",
    decisions: ".agents/decisions",
    glossary: ".agents/CONTEXT.md",
    contracts: ".agents/contracts",
    plan: ".agents/plan",
    userDocs: "docs",
  },
  tasks: { home: "kanban" },
  claude: { twins: "generated" },
  // The plugins the root AGENTS.md introduces.
  plugins: ["agent-works", "codebase-optimizer", "perceptual-loop"],
  budgets: {
    rootAgentsLines: 200,
    hubLines: 40,
    contractLines: 120,
    statusLines: 120,
    memoryFileLines: 400,
    memoryFolderFiles: 12,
    indexHookChars: 160,
    decisionLines: 150,
    glossaryRowChars: 300,
    briefLines: 120,
    roundBriefLines: 80,
    noteChars: 200,
  },
  links: { roots: [], files: [], planned: [], notChecked: [] },
  // Names of Markdown files that say "a brief or a hand-over for agents": outside paths.briefs they are BRIEF_STRAY.
  briefs: { stray: ["*brief*.md", "agent-*.md", "handoff*.md", "handover*.md"] },
  dup: { shingleWords: 12, minWords: 14, ignore: [] },
  kanban: {
    staleStartDays: 7, // a card in progress that nobody touched for this long: KANBAN_STALE_START
    gateOwedDays: 3, // a gate owed for this long: GATE_OWED_OLD
    tracked: false, // true: the board folder is committed and shared through git; false: it is kept out of git
    // What two cards may both touch when run side by side: `shared` paths always hold the second card, `merge`
    // paths only warn, `rederived` paths are regenerated ([path] or [{ path, command }]) and never count.
    conflicts: { shared: [], merge: [], rederived: [] },
  },
  guard: {
    agentVar: "AW_AGENT",
    agentVarAliases: ["PL_AGENT"],
    ownerFiles: [],
    ownerFilesEdit: "ask",
    generated: [],
    staging: { blanket: "deny", unseen: "deny" },
    locks: "warn", // a command that starts a resource outside its lock: warn, deny (or enforce), ask, off
    defaultBranch: { names: ["main", "master"], commit: "warn", forcePush: "ask" },
    rules: [],
    log: true,
  },
  resources: {},
  lockOrder: [],
  runs: [],
  counters: {},
  // Findings the project decided are fine as they are: [{ code, path, why }].
  accept: [],
  coordination: {
    lockStaleMinutes: 45, // a lock not refreshed for this long, with none of its processes running, is taken over
    agentStaleMinutes: 120, // an agent entry without a process id is dropped after this long without a beat
    holdMinutes: 120, // how long a held lease lasts unless it says otherwise
    claimHours: 72, // how long a claim on a counter lasts
    learningChars: 6000, // the size cap of one shared learning
    logBytes: 262144, // a notes log is rotated beyond this
  },
});

/** A copy of `DEFAULTS` that may be changed. */
export function defaults() {
  return structuredClone(DEFAULTS);
}

/** The nearest `.agents/agent-works.json` at or above `start` (default: the working directory), or null. */
export function findConfig(start) {
  for (const dir of ancestors(startDir(start))) {
    const file = path.join(dir, ".agents", "agent-works.json");
    try { if (fs.statSync(file).isFile()) return file; } catch { /* not here: look one folder up */ }
  }
  return null;
}

/** `over` laid on `base`, object by object: a key of `over` wins, and two objects under one key are merged the same way. */
export function merge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (key === "__proto__") continue;
    out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

/** Keys a layout move wants in the config and could not write there itself. */
export const ADDITIONS = ".agents/retired/agent-works/config-additions.json";

/**
 * The project's config with the defaults under it. Never throws. Extra keys: `_path` (the file, when one was found),
 * `_root` (the folder holding `.agents`) and `_error` (the file is not a JSON object: the defaults come back with it).
 */
export function loadConfig(start) {
  const cfg = defaults();
  const file = findConfig(start);
  if (file === null) return cfg;
  cfg._path = file;
  cfg._root = path.dirname(path.dirname(file));
  let doc;
  try {
    doc = JSON.parse(readText(file) ?? "");
  } catch (e) {
    cfg._error = `${CONFIG} is not valid JSON: ${e.message}`;
    return cfg;
  }
  if (!isObject(doc)) {
    cfg._error = `${CONFIG} must hold a JSON object`;
    return cfg;
  }
  // What a layout move could not write into the file itself waits beside it
  // until someone merges it. It counts from the first session, under whatever
  // the file says, so nothing the repo relied on loosens in between.
  let held = null;
  try { held = JSON.parse(readText(path.join(cfg._root, ADDITIONS)) ?? "null"); } catch { /* unreadable: the file alone decides */ }
  const base = isObject(held) ? merge(cfg, held) : cfg;
  return { ...merge(base, doc), _path: cfg._path, _root: cfg._root };
}

/** The `paths.<key>` entry of the config as a path under `root` (itself, when it is absolute). */
export function configPath(cfg, root, key) {
  const value = cfg?.paths?.[key] || DEFAULTS.paths[key];
  return path.isAbsolute(value) ? value : path.join(root, value);
}

/** The board's folder (`paths.kanban`). The old `.agents/board` is used while the new folder does not exist. */
export function boardDir(cfg, root) {
  const dir = configPath(cfg, root, "kanban");
  const old = path.join(root, OLD_BOARD);
  if (fs.existsSync(dir)) return dir;
  try { return fs.statSync(path.join(old, "board.json")).isFile() ? old : dir; } catch { return dir; }
}

/** The `budgets.<key>` entry of the config as a whole number; the default when it is not one. */
export function budget(cfg, key) {
  const value = cfg?.budgets?.[key] ?? DEFAULTS.budgets[key];
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) return Number(value);
  return DEFAULTS.budgets[key];
}
