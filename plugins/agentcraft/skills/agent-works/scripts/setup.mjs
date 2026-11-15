#!/usr/bin/env node
// aw setup: set a repository up for agent work, or adopt one that already has agent files.
//
//   aw setup --plan  [options]      print what would be created, changed and left alone; writes nothing
//   aw setup --apply [options]      do it
//
// What --apply writes: .agents/agent-works.json (its presence turns the guard
// on), .agents/README.md (the generated contracts page, version-stamped), a
// root AGENTS.md if there is none, the memory tree with its status memory, the
// decisions folder with its index, the glossary, lines in .gitignore, and the
// CLAUDE.md twins. It never overwrites a file that is there (the generated
// .agents/README.md excepted), and it never moves a file by itself: agent
// material found under the user docs (DOCS_AGENT_FILE) is reported with the
// `git mv` commands to run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AwError, PLUGIN_ROOT, atomicWrite, emit, fail, ioOf, lineCount, parseArgs, pluginVersion, pluginsBlock, posix, projectName, readText, rel,
  repoRoot, runMain, splitLines, template, today, withPluginsBlock,
} from "../lib/common.mjs";
import { CONFIG, OLD_BOARD, budget, configPath, findConfig, loadConfig } from "../lib/config.mjs";
import * as decisions from "./decisions.mjs";
import * as memory from "./memory.mjs";
import * as twins from "./twins.mjs";

export { setUpRoot } from "./twins.mjs";

/** The new config's text. A board that is to be committed says so, or the board's first write would exclude its folder. */
function configText(twinsMode, kanban) {
  const text = template("config.json", { twins: twinsMode });
  if (kanban === "ignored") return text;
  const doc = JSON.parse(text);
  doc.kanban = { ...doc.kanban, tracked: true };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const USAGE = `usage: aw setup --plan|--apply [options]

Set a repository up for agent work, or adopt one that already has agent files.

  --plan                            print what would be created, changed and left alone; write nothing
  --apply                           do it
  --twins link|generated|committed|off
                                    the CLAUDE.md twins: a tracked symlink to AGENTS.md (the default; the one-line
                                    file on Windows), git-ignored one-line files healed at session start, tracked
                                    one-line files, or none
  --kanban tracked|ignored          the board is committed with the repository, or local (default: tracked)
  --move-board                      move an old .agents/board to .agents/kanban
  --install-launcher [DIR]          put an \`aw\` launcher into a folder on your PATH (see below)
  --json                            one JSON document: { root, fresh, found, twins, steps, next, applied }

What --apply writes: .agents/agent-works.json (its presence turns the guard on), .agents/README.md (the generated
contracts page, version-stamped), a root AGENTS.md if there is none, the memory tree with its status memory, the
decisions folder with its index, the glossary, lines in .gitignore, and the CLAUDE.md twins. It never overwrites a
file that is there (the generated .agents/README.md excepted), and it never moves a file by itself: agent material
found under the user docs (DOCS_AGENT_FILE) is reported with the \`git mv\` commands to run.

The launcher: Claude Code puts an enabled plugin's bin/ on the PATH of its Bash tool, so \`aw\` works there as it is.
It is not on the PATH of the PowerShell tool, of hooks, or of your own terminal: --install-launcher writes \`aw\` and
\`aw.cmd\` into DIR (default ~/.local/bin), which find the installed plugin each time they run.`;

const ALLOW_RULE = "Bash(aw:*)";
const TWIN_CHOICES = ["link", "generated", "committed", "off"];
const BOARD_CHOICES = ["tracked", "ignored"];

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/** What the repository at `root` already has: the facts the plan is made from. */
export function detect(root, cfg) {
  const docs = configPath(cfg, root, "userDocs");
  const firstOf = (candidates, test) => {
    const hit = candidates.find(test);
    return hit === undefined ? null : rel(hit, root);
  };
  return {
    git: repoRoot(root) === root,
    config: Boolean(cfg._path) && path.dirname(path.dirname(cfg._path)) === root,
    agents: isFile(path.join(root, "AGENTS.md")),
    claudeOwn: twins.stateOf(path.join(root, "CLAUDE.md")) === "other",
    memory: isDir(configPath(cfg, root, "memory")),
    decisions: isDir(configPath(cfg, root, "decisions")),
    glossary: isFile(configPath(cfg, root, "glossary")),
    oldBoard: isFile(path.join(root, OLD_BOARD, "board.json")),
    kanban: isDir(configPath(cfg, root, "kanban")),
    docsAdr: firstOf(["adr", "adrs", "decisions"].map((n) => path.join(docs, n)), isDir),
    docsGlossary: firstOf([path.join(docs, "CONTEXT.md"), path.join(root, "CONTEXT.md")], isFile),
    plan: isDir(path.join(root, ".plan")),
    perceptualLoop: isDir(path.join(root, ".perceptual-loop")),
  };
}

function gitignoreHas(root, line) {
  return splitLines(readText(path.join(root, ".gitignore"), "") ?? "").some((l) => l.trim() === line);
}

/**
 * The steps as data: `{ root, fresh, found, twins, steps: [{ do, path, why, … }], next }`. `do` is create, append,
 * regenerate, section, move, twins, keep or report. `opts`: `{ twins, kanban, moveBoard }`.
 */
export function plan(root, opts = {}) {
  const cfg = loadConfig(root);
  const found = detect(root, cfg);
  const twinsMode = opts.twins || (found.config ? twins.modeOf(cfg) : "link");
  const steps = [];
  const R = (p) => rel(p, root);
  const add = (act, where, why, more = {}) => steps.push({ do: act, path: where, why, ...more });

  if (found.config) add("keep", CONFIG, "the config is there; edit it by hand or with the guard skill");
  else add("create", CONFIG, "the config: its presence turns the guard on", { text: configText(twinsMode, opts.kanban) });

  const contract = path.join(root, ".agents", "README.md");
  const name = projectName(root, cfg); // the project's, not a work tree folder's
  const text = template("agents-readme.md", { version: pluginVersion(), project: name });
  const have = readText(contract);
  if (have === null) add("create", R(contract), "the generated contracts page: which fact lives where", { text });
  else if (have !== text && have.includes("agent-works contract v")) add("regenerate", R(contract), "generated by another version of the plugin", { text });
  else if (have !== text) add("report", R(contract), "exists and was not generated by agent-works: merge it into AGENTS.md or delete it, then run setup again");
  else add("keep", R(contract), "up to date");

  if (found.agents) {
    const haveRoot = readText(path.join(root, "AGENTS.md"), "") ?? "";
    const n = lineCount(haveRoot);
    const limit = budget(cfg, "rootAgentsLines");
    add("keep", "AGENTS.md", `yours (${n} lines${n > limit ? `, over the budget of ${limit}: aw doctor says what to move` : ""})`);
    const wantRoot = withPluginsBlock(haveRoot, pluginsBlock(cfg));
    if (wantRoot !== haveRoot) {
      add("section", "AGENTS.md", "its § Agent plugins: which plugins this project works with and when to open each skill "
        + "(only that marked section is written)", { text: wantRoot });
    }
  } else {
    add("create", "AGENTS.md", "the root orientation file, to fill in", { text: template("agents-root.md", { project: name, plugins: pluginsBlock(cfg) }) });
  }

  const memoryDir = configPath(cfg, root, "memory");
  if (found.memory) {
    add("keep", R(memoryDir), "the memory tree is there and stays as it is, hand-written indexes included; `aw memory lint` checks it");
  } else {
    add("create", R(path.join(memoryDir, "INDEX.md")), "the memory tree", { text: template("memory-index.md") });
    add("create", R(path.join(memoryDir, "project", "INDEX.md")), "the folder of the status memory",
      { text: `# project/\n${memory.GENERATED}\n\nThe living status of the project and its plan.\n` });
    add("create", R(path.join(memoryDir, "project", `${today()}-project-status.md`)), "the one status memory", {
      text: template("status.md", {
        slug: "project-status", date: today(), title: "Project status", description: "Goal, current focus and known issues: read at the start of every task",
      }),
    });
  }

  const decisionsDir = configPath(cfg, root, "decisions");
  if (found.decisions) add("keep", R(decisionsDir), "decision records are there");
  else if (found.docsAdr) {
    add("report", found.docsAdr, "DOCS_AGENT_FILE: decision records under the user docs. Move them yourself:",
      { commands: [`git mv ${found.docsAdr} ${R(decisionsDir)}`, "aw decisions index", "aw links"] });
  } else {
    add("create", R(path.join(decisionsDir, "README.md")), "the decisions folder and its generated index", { text: decisions.buildIndex([]) });
  }

  const glossary = configPath(cfg, root, "glossary");
  if (found.glossary) add("keep", R(glossary), "the glossary is there");
  else if (found.docsGlossary) {
    add("report", found.docsGlossary, "DOCS_AGENT_FILE: a glossary outside .agents/. Move it yourself:",
      { commands: [`git mv ${found.docsGlossary} ${R(glossary)}`, "aw links"] });
  } else {
    add("create", R(glossary), "the glossary", { text: template("glossary.md") });
  }

  const newBoard = configPath(cfg, root, "kanban");
  if (found.oldBoard && !found.kanban) {
    if (opts.moveBoard) add("move", OLD_BOARD, `KANBAN_OLD_FOLDER: the board moves to ${R(newBoard)}`, { to: R(newBoard) });
    else {
      add("report", OLD_BOARD, "KANBAN_OLD_FOLDER: the board is in its old folder (it keeps working). Move it with --move-board, or yourself:",
        { commands: [`git mv ${OLD_BOARD} ${R(newBoard)}`] });
    }
  }
  if (found.plan) add("report", ".plan", "a but-first-planning workspace in its old place: its 4.0 skills move it to .agents/plan");
  if (found.perceptualLoop) {
    add("report", ".perceptual-loop", "perceptual-loop is in use: its locks are now `aw lock` (declare the applications under \"resources\" in the config)");
  }

  if (twins.MODES.includes(twinsMode) && found.claudeOwn) {
    add("report", "CLAUDE.md", `has content of its own: move it into AGENTS.md and ${twins.formOf(twinsMode) === "link" ? "delete it" : "leave the one line `@AGENTS.md`"}, `
      + "then `aw twins` (until then no twin is written over it)");
  }
  if (twinsMode === "generated") {
    if (!gitignoreHas(root, "CLAUDE.md")) add("append", ".gitignore", "the CLAUDE.md twins are generated", { text: template("gitignore-twins") });
    add("twins", "CLAUDE.md", "a CLAUDE.md that imports its sibling beside every AGENTS.md (aw twins)");
  } else if (twinsMode === "committed") {
    add("twins", "CLAUDE.md", "a CLAUDE.md that imports its sibling beside every AGENTS.md, committed with them");
  } else if (twinsMode === "link") {
    add("twins", "CLAUDE.md", "a CLAUDE.md that is a symlink to its sibling beside every AGENTS.md, committed with them (aw twins)");
  }
  if (opts.kanban === "ignored" && !gitignoreHas(root, `${R(newBoard)}/`)) {
    add("append", ".gitignore", "a local board", { text: template("gitignore-kanban").replace(".agents/kanban/", () => `${R(newBoard)}/`) });
  }

  return {
    root: posix(root), fresh: !(found.agents || found.memory || found.config), found, twins: twinsMode, steps,
    next: [
      "aw doctor --baseline    (the first report, and the numbers later runs compare against)",
      `to let agents run aw without a prompt, add "${ALLOW_RULE}" to permissions.allow in your Claude Code settings (yours to decide: it is not written for you)`,
    ],
  };
}

/** Do the steps of a plan. Gives one line per thing done; never writes over a file that is there. */
export function apply(root, doc) {
  const done = [];
  for (const s of doc.steps) {
    const file = path.join(root, s.path);
    if (s.do === "create") {
      if (fs.existsSync(file)) continue; // never over a file that is there
      atomicWrite(file, s.text);
      done.push(`created ${s.path}`);
    } else if (s.do === "regenerate") {
      atomicWrite(file, s.text);
      done.push(`regenerated ${s.path}`);
    } else if (s.do === "section") {
      atomicWrite(file, s.text);
      done.push(`wrote the plugins section of ${s.path}`);
    } else if (s.do === "append") {
      const have = readText(file, "") ?? "";
      atomicWrite(file, have + (!have || have.endsWith("\n") ? "" : "\n") + (have ? "\n" : "") + s.text);
      done.push(`added to ${s.path}`);
    } else if (s.do === "move") {
      const to = path.join(root, s.to);
      if (!fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(file, to);
        done.push(`moved ${s.path} to ${s.to}`);
      }
    }
  }
  const cfg = loadConfig(root);
  if (!doc.found.memory) {
    // Only for the tree this run created (its indexes carry the generated marker). The indexes of an existing tree
    // may be written by hand and say more than the memories' descriptions: they stay (MEM_INDEX_HANDWRITTEN), and
    // `aw memory index --adopt` is a step the reader takes knowingly.
    try {
      done.push(...memory.writeIndexes(root, cfg).map((c) => `wrote ${c}`));
    } catch { /* the tree is there; `aw memory lint` says what its indexes lack */ }
  }
  if (doc.steps.some((s) => s.do === "twins")) {
    try {
      const res = twins.heal(root, cfg);
      if (res.written.length) done.push(`wrote ${res.written.length} CLAUDE.md twin${res.written.length === 1 ? "" : "s"}`);
      done.push(...res.findings.map((f) => `! ${f.path}: ${f.message}`));
    } catch { /* `aw twins` says what is in the way */ }
  }
  return done;
}

const homeOf = (env) => (process.platform === "win32" ? env.USERPROFILE : env.HOME) || os.homedir();

/** The launcher's code: finds the plugin's `scripts/aw.mjs` on each run, so an update needs no reinstall. */
function launcherCode(baked) {
  return `#!/usr/bin/env node
// aw: launcher of the agent-works command line (written by \`aw setup --install-launcher\`).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const cache = path.join(os.homedir(), ".claude", "plugins", "cache");
let found = [process.env.AGENT_WORKS_CLI, ${JSON.stringify(baked)}].find((p) => p && isFile(p));
if (!found) {
  // The newest installed copy: one folder per marketplace, then per version.
  const copies = list(cache).flatMap((market) => list(path.join(cache, market, "agent-works"))
    .map((version) => path.join(cache, market, "agent-works", version, "scripts", "aw.mjs"))).filter(isFile);
  found = copies.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
if (!found) {
  process.stderr.write("aw: agent-works is not installed (no scripts/aw.mjs under ~/.claude/plugins/cache)\\n");
  process.exitCode = 1;
} else {
  import(pathToFileURL(found).href).then(({ cli }) => cli());
}
`;
}

const LAUNCHER_CMD = `@echo off
rem aw: launcher of the agent-works command line (written by \`aw setup --install-launcher\`).
where node >nul 2>nul
if errorlevel 1 (
  echo aw: no Node.js on the PATH ^(agent-works needs Node 22 or newer^) 1>&2
  exit /b 127
)
node "%~dp0aw" %*
exit /b %ERRORLEVEL%
`;

/**
 * Write `aw` and `aw.cmd` into a PATH folder (default ~/.local/bin). They look the plugin up on each run. Gives the
 * paths written, and a note when the folder is not on the PATH. `baked` is a path tried before the plugin cache.
 */
export function installLauncher(target, { env = process.env, baked = null } = {}) {
  const home = homeOf(env);
  const given = target ? (target === "~" || /^~[\\/]/.test(target) ? path.join(home, target.slice(1)) : target) : path.join(home, ".local", "bin");
  const dir = path.resolve(given);
  const here = posix(path.join(PLUGIN_ROOT, "scripts", "aw.mjs"));
  // A plugin loaded from a folder (development): the cache has no copy to find.
  const own = baked ?? (here.includes("/plugins/cache/") ? "" : here);
  const out = [];
  for (const [name, text] of [["aw", launcherCode(own)], ["aw.cmd", LAUNCHER_CMD.replace(/\n/g, "\r\n")]]) {
    const file = path.join(dir, name);
    atomicWrite(file, text);
    if (name === "aw") {
      try { fs.chmodSync(file, 0o755); } catch { /* a file system without modes */ }
    }
    out.push(posix(file));
  }
  const fold = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const onPath = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean).some((p) => fold(p) === fold(dir));
  if (!onPath) out.push(`note: ${posix(dir)} is not on your PATH yet`);
  return out;
}

const MARKS = {
  create: "create    ", append: "add to    ", regenerate: "regenerate", move: "move      ", keep: "keep      ", report: "REPORT    ", twins: "twins     ",
  section: "section   ",
};

/** A plan as text; `applied` is what `apply` gave back, or null for a plan that was only printed. */
export function textOf(doc, applied) {
  const kind = doc.fresh ? "a fresh repository" : "a repository that has agent files";
  const lines = [`aw setup — ${doc.root} (${kind}; CLAUDE.md twins: ${doc.twins})`, ""];
  for (const s of doc.steps) {
    lines.push(`  ${MARKS[s.do]} ${s.path}${s.to ? ` -> ${s.to}` : ""}   ${s.why}`);
    for (const c of s.commands ?? []) lines.push(`               ${c}`);
  }
  lines.push("");
  if (applied === null) {
    lines.push("Nothing was written. `aw setup --apply` does the create / add / regenerate / section / move / twins steps; REPORT steps are yours.");
  } else {
    lines.push(...(applied.length ? applied : ["nothing to do: everything is in place"]));
  }
  lines.push("", "next:", ...doc.next.map((n) => `  ${n}`));
  return lines.join("\n");
}

/** `--install-launcher` takes its folder when one follows; the flag alone means the default folder. */
function takeLauncher(argv) {
  const rest = [];
  let launcher = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--install-launcher") {
      launcher = i + 1 < argv.length && !argv[i + 1].startsWith("-") ? argv[++i] : "";
    } else if (argv[i].startsWith("--install-launcher=")) {
      launcher = argv[i].slice("--install-launcher=".length);
    } else {
      rest.push(argv[i]);
    }
  }
  return [rest, launcher];
}

export async function main(argv, io) {
  io = ioOf(io);
  const [args, launcher] = takeLauncher(argv);
  const { values, positionals, help } = parseArgs(args, {
    plan: { type: "boolean" }, apply: { type: "boolean" }, twins: { type: "string" }, kanban: { type: "string" }, "move-board": { type: "boolean" },
    json: { type: "boolean" },
  });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  if (positionals.length) throw new AwError(`setup takes no '${positionals[0]}' (aw setup --help)`);
  if (values.twins !== undefined && !TWIN_CHOICES.includes(values.twins)) throw new AwError(`--twins is one of: ${TWIN_CHOICES.join(", ")}`);
  if (values.kanban !== undefined && !BOARD_CHOICES.includes(values.kanban)) throw new AwError(`--kanban is one of: ${BOARD_CHOICES.join(", ")}`);
  if (launcher !== null && !values.plan && !values.apply) {
    for (const line of installLauncher(launcher || null, { env: io.env })) emit(io, line);
    return 0;
  }
  if (Boolean(values.plan) === Boolean(values.apply)) return fail(io, "aw setup: say --plan (print what would happen) or --apply (do it)");
  const config = findConfig(io.cwd);
  const root = config !== null ? path.dirname(path.dirname(config)) : repoRoot(io.cwd) ?? fs.realpathSync.native(io.cwd);
  const doc = plan(root, { twins: values.twins, kanban: values.kanban ?? "tracked", moveBoard: values["move-board"] === true });
  let applied = values.apply ? apply(root, doc) : null;
  if (values.apply && launcher !== null) applied = [...applied, ...installLauncher(launcher || null, { env: io.env })];
  if (values.json) emit(io, { ...doc, steps: doc.steps.map(({ text, ...slim }) => slim), applied }, true);
  else emit(io, textOf(doc, applied));
  return 0;
}

runMain(import.meta.url, main);
