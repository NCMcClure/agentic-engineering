// The render guard's rules, for a project that has a perceptual config.
// hooks/guard.mjs reads the payload and imports this only when a config exists.
//
//   budget    a command matching config.budget.match that renders more than
//             config.budget.free shots needs PL_RUN="verify: ..." or "full: ..."
//             in its text; allowed large runs are appended to runs/budget.log
//   baseline  `pl.mjs baseline update` needs --source and a selection
//
// The command is read through hooks/shell-words.mjs, the way a shell reads it:
// a quoted string, a here-document and a here-string never pass for a command,
// and the line inside `bash -c "..."` or `powershell -Command "..."` is read as
// the commands it runs. A command behind the agent-works lock wrapper
// (`aw lock run <resource> ... -- <command>`, `aw lease ... -- <command>`,
// nested or not) is judged as the command it runs, so a wrapped render is still
// counted and the wrapper is never what gets refused.
//
// A coordination aid, not a security boundary: the rules read command text. A
// render command quoted as an argument of some other program still matches,
// shots that do not exist yet are not counted, and a render hidden in a script
// or in $(...) is not seen.
import fs from "node:fs";
import path from "node:path";
import { assignments, baseName, commandWords, expand, psAssignment, splitCommand, textOf, unwrap } from "../../hooks/shell-words.mjs";
import { allShots, loadConfig, loadGroups, matchGlobs, runsDir } from "./project.mjs";

/** Commands that only read or move about: their arguments may quote anything. */
export const READERS = new Set(["git", "gh", "glab", "grep", "rg", "cat", "echo", "printf", "ls", "sed", "head", "tail",
  "find", "wc", "awk", "less", "more", "cd", "pushd", "popd", "which", "command", "type", "diff", "jq", "findstr", "dir",
  "get-content", "gc", "select-string", "sls", "write-output", "write-host", "set-location", "get-childitem", "test-path"]);

const AW_NAMES = ["aw", "aw.cmd", "aw.mjs", "aw.js", "aw.py"];
const plain = (args) => args.filter((w) => w !== "--json");
/** The agent-works wrappers that run a command: `aw lock run <resource> ... --` and `aw lease <resource> ... --`. */
export const LOCK_WRAPPER = Object.freeze({
  names: AW_NAMES,
  wraps: (args) => plain(args).slice(0, 2).join(" ") === "lock run" || plain(args)[0] === "lease",
});

// a flag that means nothing is rendered and no application starts, in either shell's spelling
const NOTHING_RENDERED = /^--?(?:dry-?run|list|skip-?render|help|whatif)$/i;
// flags of pl.mjs iterate whose value is never a shot name
const VALUE_FLAGS = ["source", "run", "edge-tolerance", "repeat", "out", "dir"];

export const QUOTED_NOTE = "(A coordination aid, not a security boundary: the rule reads the command text. "
  + "If this was only text quoted inside another command, a message or a note, put that text in a file and pass the file.)";

// ---- command text ---------------------------------------------------------------------

const isReader = (words) => READERS.has(baseName(words[0] ?? ""));
const NOTHING = Object.freeze({ commands: [], inner: [] });
const MAX_NESTING = 20; // wrappers inside shell lines inside wrappers read before the rest is left alone
// what may stand in front of a script that is the real program: `node aw.mjs`, `uv run --no-project aw.py`
const RUNNERS = /^(?:node|python3?|py|uv|run|npx|bunx?)$/;
/** Whether the program these words start is the agent-works CLI, directly or through an interpreter. */
function isAw(words) {
  const program = words.find((w) => !w.startsWith("-") && !RUNNERS.test(baseName(w)));
  return program !== undefined && AW_NAMES.includes(baseName(program));
}

/**
 * The commands one segment of a command line really runs, as word lists without
 * their `VAR=value` prefixes: the segment itself, or what the lock wrapper runs.
 * A reader, a bare assignment, and any other use of `aw` run nothing that renders.
 * @param {readonly string[]} segment  One segment's words, as `splitCommand` gives them.
 * @returns {{commands: string[][], inner: string[][]}}  `inner` keeps the wrapped segments' leading words, for `assignments`.
 */
export function commandsOf(segment, depth = 0) {
  const words = commandWords(segment);
  if (!words.length || psAssignment(words) || isReader(words)) return NOTHING;
  const { wrappers, segments } = unwrap(words, LOCK_WRAPPER);
  // any other `aw` command (a note, a status, a lock taken or given back) renders nothing
  if (!wrappers.length) return isAw(words) ? NOTHING : { commands: [words], inner: [] };
  // what the wrapper runs may itself be a shell line or another wrapper: read it the same way
  const inner = expand(segments);
  if (depth >= MAX_NESTING) return { commands: [], inner };
  const read = inner.map((s) => commandsOf(s, depth + 1));
  return { commands: read.flatMap((r) => r.commands), inner: [...inner, ...read.flatMap((r) => r.inner)] };
}

const matches = (patterns, text) => (Array.isArray(patterns) ? patterns : []).some((p) => {
  try { return new RegExp(p).test(text); } catch { return false; } // a broken pattern in the config must block nothing
});

/** `--name V`, `--name=V`, or PowerShell's `-Name V` (case ignored); "" when the flag is absent. */
export function flagValue(words, name) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.startsWith("-")) continue;
    const low = w.toLowerCase().replace(/^-+/, "");
    if (low === name && i + 1 < words.length) return words[i + 1];
    if (low.startsWith(name + "=")) return w.slice(w.indexOf("=") + 1);
  }
  return "";
}

export const hasFlag = (words, ...names) => words.some((w) => w.startsWith("-") && names.includes(w.toLowerCase().replace(/^-+/, "").split("=")[0]));

// ---- the rules -------------------------------------------------------------------------

const isGlob = (s) => /[*?[]/.test(s);

/** [count, how it was asked] for the shots a render names, or [null, ""] when the text does not say. */
export function countShots(words, root, config) {
  const have = allShots(root, config);
  const group = flagValue(words, "group"), match = flagValue(words, "match"), listed = flagValue(words, "shots");
  const values = new Set([group, match, listed, ...VALUE_FLAGS.map((f) => flagValue(words, f))].filter(Boolean));
  let picked, how;
  if (group) {
    const groups = loadGroups(root);
    if (!Object.hasOwn(groups, group) || !Array.isArray(groups[group])) return [null, ""];
    picked = matchGlobs(have, groups[group]);
    how = `--group ${group}`;
  } else if (hasFlag(words, "all")) {
    picked = [...have];
    how = "--all";
  } else {
    const known = new Set(have);
    const names = [...(listed ? [listed] : []), ...words.filter((w) => !w.startsWith("-") && !values.has(w))].flatMap((w) => w.split(",")).filter(Boolean);
    picked = names.flatMap((n) => (known.has(n) ? [n] : isGlob(n) ? matchGlobs(have, [n]) : []));
    how = "named";
    if (!picked.length) {
      if (!match) return [null, ""];
      picked = [...have]; // --match alone: a glob over every shot
      how = "";
    }
  }
  if (match) { picked = matchGlobs(picked, [match]); how = `${how} --match ${match}`.trim(); }
  return [new Set(picked).size, how];
}

/** What a `pl.mjs baseline update` command is missing, or null when it is targeted (or is not one). */
export function baselineUpdateProblem(words) {
  const at = words.findIndex((w) => baseName(w) === "pl.mjs");
  if (at === -1 || words[at + 1] !== "baseline" || words[at + 2] !== "update") return null;
  const rest = words.slice(at + 3);
  const takesValue = new Set(["--source", "--run", "--dir", "--match", "--note"]);
  const positional = rest.filter((w, i) => !w.startsWith("-") && (i === 0 || !takesValue.has(rest[i - 1])));
  const missing = [];
  if (!hasFlag(rest, "source")) missing.push("--source <one candidate>");
  if (!positional.length && !hasFlag(rest, "group", "shots", "all-shots-of-run")) {
    missing.push("a selection (shot names, --shots a,b, --group NAME, or --all-shots-of-run said explicitly)");
  }
  return missing.length ? missing : null;
}

function budgetMessage(n, how, free, reason) {
  const said = reason ? ` (PL_RUN is "${reason}": it must start with "verify:" or "full:" and say why)` : "";
  return `perceptual-loop budget: this command renders ${n} shots (${how}); more than ${free} needs its reason in the command${said}.\n`
    + "Run the smallest set that answers the question:\n"
    + `  - every iteration: 1-${free} shots that show the thing you changed, by name\n`
    + "  - once, when the change already works: one group (--group smoke, or a topical one)\n"
    + "  - once, when the work is finished: the full suite\n"
    + "See what a selection means without rendering: add --dry-run to the same command.\n"
    + "A larger run states its reason where the owner sees it:\n"
    + '  bash:        PL_RUN="verify: <what already works, what this run checks>" <command>\n'
    + '  PowerShell:  $env:PL_RUN = "verify: <...>"; <command>\n'
    + '  whole suite: PL_RUN="full: <what is finished>"\n' + QUOTED_NOTE;
}

function baselineMessage(missing) {
  return "perceptual-loop: `pl.mjs baseline update` is always targeted, so it never rewrites what it was not asked about. "
    + `Missing: ${missing.join("; ")}.\n`
    + "  pl.mjs baseline update --source <candidate> --run <run> <shot> <shot>     the shots you changed and looked at\n"
    + "  pl.mjs baseline update --source <candidate> --run <run> --group <name>    a group, after its gate was read\n"
    + "Update from a run whose pictures you opened; `pl.mjs baseline check` first says what moved.\n" + QUOTED_NOTE;
}

/** The reason to deny this shell command in the project at `root`, or null to let it run. */
export function decide(command, root, { log = true } = {}) {
  const config = loadConfig(root);
  const budget = config.budget && typeof config.budget === "object" ? config.budget : {};
  const free = Number.isFinite(Number(budget.free)) ? Number(budget.free) : 3;
  const segments = splitCommand(command).map((segment) => segment.words);
  const read = segments.map(commandsOf);
  // PL_RUN counts where a shell reads it, in front of the command or of the one a wrapper runs, never inside what a reader quotes
  const reason = (assignments([...segments, ...read.flatMap((r) => r.inner)]).get("PL_RUN") ?? "").trim();
  const reasonOk = /^(verify|full):\s*\S/.test(reason);

  const large = []; // allowed large runs, logged only when nothing denies the command
  for (const words of read.flatMap((r) => r.commands)) {
    const missing = baselineUpdateProblem(words);
    if (missing) return baselineMessage(missing);
    if (words.some((w) => NOTHING_RENDERED.test(w))) continue;
    const text = textOf(words);
    if (!matches(budget.match, text)) continue;
    const [n, how] = countShots(words, root, config);
    if (n !== null && n > free) {
      if (!reasonOk) return budgetMessage(n, how, free, reason);
      large.push([n, text]);
    } else if (n === null && reasonOk) large.push(["?", text]);
  }

  if (large.length && log) {
    try {
      const file = path.join(runsDir(root), "budget.log");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const when = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const cut = reason.indexOf(":");
      const kind = reason.slice(0, cut), why = reason.slice(cut + 1).split(/\s+/).filter(Boolean).join(" ");
      fs.appendFileSync(file, large.map(([n, text]) => [when, kind, String(n), why, text.split(/\s+/).join(" ").slice(0, 160)].join("\t") + "\n").join(""));
    } catch { /* a log that cannot be written must not block the run */ }
  }
  return null;
}
