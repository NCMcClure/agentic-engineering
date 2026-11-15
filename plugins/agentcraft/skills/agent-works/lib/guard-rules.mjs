// The agent guard's rules: given a tool call, the repo's config and the facts
// about the checkout, what is decided. Nothing here reads a file, starts a
// process or looks at the environment: `hooks/guard.mjs` gathers the facts and
// hands them in, so every rule is tested by calling it.
//
//   staging-blanket        git add -A / -u / . / :/ and git commit -a
//   staging-owner-files    a git add / stage / commit whose pathspecs reach one of guard.ownerFiles: the file,
//                          a folder above it, a glob, after cd or git -C; and a pathspec the guard cannot read
//   owner-file-edit        Edit / Write of one of guard.ownerFiles
//   generated-file         Edit / Write of a path matching guard.generated
//   default-branch-commit  git commit while on one of guard.defaultBranch.names (the branch of the checkout the
//                          commit runs in: after `cd`, `pushd`, `git -C`; an unresolved folder gives no finding)
//   force-push             git push --force / -f / +refspec
//   resource-lock          a command matching resources.<name>.match that neither runs inside
//                          `aw lock run <name> ... -- <command>` nor is run by the agent holding the lock
//   run-budget             a command matching runs[].match that names more than `free` items needs its reason
//   <id>                   the project's own guard.rules
//
// The resource and run rules read the commands that can start something: not
// the readers, and not the commands that only handle files (`git add <script>`,
// `cp`, `mv`, `rm`), unless the entry says "matchFileCommands". The project's
// rules also read what a command sets in its environment (`X=v cmd`,
// `env X=v cmd`, `export X=v`, `$env:X = "v"`).
//
// Patterns are JavaScript regular expressions. A `match` and an `unless` are
// searched as written, so case counts; `guard.generated` ignores case. A
// pattern that does not compile matches nothing and is named in `skipped`.
//
// A coordination aid, not a security boundary: the rules read the command
// text and the caller names itself.
//
// The facts (every one optional):
//   cwd, root      where the tool runs, and the top of its work tree
//   branch         the branch checked out at `cwd` ("" when there is none)
//   branchAt(dir)  the branch checked out in another folder, or null
//   agent          the session's own agent name, when the command names none
//   lockHolders(agent, names) -> { holders: {resource: agent}, mine: Set }
//   items(dir) -> the entries of a run's itemsDir, or null
//   groups(file) -> a run's groupsFile as an object, or null
//   resolve(path) -> the path with its links resolved (an edited file's)
import { fnmatch } from "./common.mjs";
import {
  LEADERS, assignments, baseName, expand, gitCommand, psAssignment, shellWords, splitLead, textOf, unwrap,
} from "../hooks/shell-words.mjs";

export const EDIT_TOOLS = Object.freeze(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const SHELL_TOOLS = Object.freeze(["Bash", "PowerShell"]);

// Commands that only read, print or move about: their arguments may quote anything.
const READERS = new Set(["gh", "grep", "egrep", "fgrep", "rg", "ag", "cat", "bat", "echo", "ls", "head", "tail",
  "printf", "wc", "awk", "less", "more", "type", "dir", "which", "where", "command", "file", "stat", "tree", "jq",
  "sort", "uniq", "cut", "diff", "cmp", "findstr", "get-content", "gc", "select-string", "sls", "write-output",
  "write-host", "get-childitem", "gci", "test-path", "get-item", "measure-object", "select-object", "cd", "chdir",
  "pushd", "popd", "set-location", "push-location", "pop-location", "sl", "true", "false", "sleep", "pwd", "date",
  "whoami", "tasklist", "ps", "get-process"]);
const GIT_READERS = new Set(["log", "show", "diff", "grep", "status", "ls-files", "ls-tree", "blame", "rev-parse",
  "rev-list", "describe", "shortlog", "cat-file", "name-rev", "whatchanged", "reflog", "for-each-ref", "merge-base",
  "diff-tree", "show-ref", "ls-remote", "check-ignore", "var", "help", "version", "config",
  // not readers, but their arguments are prose (a message) or handled by the staging rules
  "commit", "tag", "notes"]);
// Commands that only handle the files they name: naming a script is not running it. Asked by the resource and run
// rules alone; a project's own rules still read them.
const FILE_COMMANDS = new Set(["cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown", "ln", "tee", "sed",
  "copy-item", "cpi", "move-item", "mi", "remove-item", "ri", "rename-item", "rni", "new-item", "ni", "set-content",
  "add-content", "clear-content", "out-file", "del", "erase", "copy", "move", "ren", "rename", "rd", "md", "code",
  "vi", "vim", "nano", "notepad"]);
const GIT_STARTERS = new Set(["bisect", "rebase", "submodule", "filter-branch", "difftool", "mergetool"]); // these can run a command
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
// The programs `aw` is run as: the launcher on PATH, or the script behind it given to node.
const AW_NAMES = Object.freeze(["aw", "aw.cmd", "aw.mjs"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (typeof v === "string" || isObject(v) ? [v] : Array.isArray(v) ? v : []);
const unique = (values) => [...new Set(values)];

// ------------------------------------------------------------------------------------------------------- patterns

const compiled = new Map();
let skipped = null; // the patterns that did not compile, while one call is judged

function search(pattern, text, flags, where) {
  const key = `${flags}/${pattern}`;
  if (!compiled.has(key)) {
    let rx = null;
    try { rx = new RegExp(pattern, flags); } catch { /* a broken pattern in the config must not block anything */ }
    compiled.set(key, rx);
  }
  const rx = compiled.get(key);
  if (rx === null) {
    skipped?.add(`${where}: ${JSON.stringify(pattern)} is not a regular expression`);
    return false;
  }
  return rx.test(text);
}

/** A `match` as `[pattern, the pattern's own unless]` pairs: each entry is a regex or `{ pattern, unless }`. */
export function entries(match) {
  const out = [];
  for (const m of list(match)) {
    if (isObject(m)) {
      if (typeof m.pattern === "string") out.push([m.pattern, list(m.unless).filter((u) => typeof u === "string")]);
    } else if (typeof m === "string") {
      out.push([m, []]);
    }
  }
  return out;
}

/** Does one of the patterns (regexes; of an object entry, its `pattern`) match the text? */
export function matches(patterns, text, where = "pattern") {
  return entries(patterns).some(([p]) => search(p, text, "", where));
}

/**
 * A `match` against the readings of one command: one entry matches a reading, and neither that entry's own
 * `unless` nor the shared `unless` matches any of them.
 */
export function fires(match, unless, texts, where = "pattern") {
  const read = texts.filter(Boolean);
  if (!read.length || read.some((t) => matches(unless, t, where))) return false;
  return entries(match).some(([p, own]) => read.some((t) => search(p, t, "", where)) && !read.some((t) => matches(own, t, where)));
}

// ------------------------------------------------------------------------------------------- reading the command

/** True when the command only reads or prints, so its arguments may quote anything. */
export function isReader(words) {
  if (!words.length) return true;
  const first = baseName(words[0]);
  if (first.startsWith("#")) return true;
  if (first === "git") {
    const verb = gitCommand(words)?.verb ?? "";
    return !verb || GIT_READERS.has(verb);
  }
  if (first === "sed") return !words.slice(1).some((w) => /^(-i|--in-place|-[a-zA-Z]*i)/.test(w));
  if (first === "find") return !words.slice(1).some((w) => ["-exec", "-execdir", "-delete", "-ok"].includes(w));
  // The wrapped command of `aw lock run` / `aw lease` is unwrapped before this is asked.
  if (first === "node" && words.length > 1 && baseName(words[1]) === "aw.mjs") return true;
  return AW_NAMES.includes(first) || READERS.has(first);
}

/** True when the command only handles the files it names (`git add x`, `cp x y`, `rm x`): it starts none of them. */
export function handlesFiles(words) {
  if (!words.length) return false;
  const first = baseName(words[0]);
  if (first === "git") {
    const verb = gitCommand(words)?.verb ?? "";
    return !verb || !GIT_STARTERS.has(verb);
  }
  if (first === "find") return !words.slice(1).some((w) => ["-exec", "-execdir", "-ok"].includes(w));
  return FILE_COMMANDS.has(first);
}

const plain = (args) => args.filter((w) => w !== "--json");
const WRAPPER = Object.freeze({
  names: AW_NAMES,
  wraps: (args) => plain(args).slice(0, 2).join(" ") === "lock run" || plain(args)[0] === "lease",
});

/**
 * `aw lock run R ... -- command` and `aw lease R ... -- command` peeled off a command's words: the resources the
 * wrappers hold for it (the first plain word after `run`; a lease holds none) and the wrapped command's segments.
 */
export function unwrapLock(words) {
  const { wrappers, segments } = unwrap(words, WRAPPER);
  const held = new Set();
  for (const args of wrappers.map(plain)) {
    if (args[0] !== "lock") continue;
    const resource = args.slice(2).find((w) => !w.startsWith("-"));
    if (resource) held.add(resource);
  }
  return { held, segments, wrapped: wrappers.length > 0 };
}

/**
 * A command line as word lists, one per command: a line handed to another shell is replaced by its commands, and a
 * lock wrapper by the command it runs, so a rule about git reads `aw lock run gpu -- git add -A` as the add it is.
 */
function commands(command) {
  return expand(shellWords(command)).flatMap((segment) => {
    const { lead, words } = splitLead(segment);
    const { segments, wrapped } = unwrapLock(words);
    if (!wrapped) return [segment];
    const set = lead.filter((w) => ASSIGN.test(w));
    return expand(segments).map((inner) => [...set, ...inner]);
  });
}

/** The variables the guard reads itself (an agent's name, a run's reason): their values are prose, not commands. */
function ownVars(cfg) {
  const guard = cfg.guard || {};
  const names = new Set(["AW_AGENT", "AW_RUN", String(guard.agentVar || "AW_AGENT")]);
  for (const a of list(guard.agentVarAliases)) names.add(String(a));
  for (const r of list(cfg.runs)) if (isObject(r)) names.add(String(r.reasonVar || "AW_RUN"));
  return names;
}

/**
 * What a project rule reads of one command: the command alone, the command with what it sets in its environment,
 * and for PowerShell's `$env:X = "v"` the same as `X=v`. The guard's own variables are left out.
 */
function ruleTexts(lead, words, own) {
  let shown = lead.filter((w) => !(ASSIGN.test(w) && own.has(w.split("=", 1)[0])));
  if (!shown.some((w) => ASSIGN.test(w))) shown = []; // `env`, `time` or `&` alone say nothing
  const out = [textOf(words), textOf([...shown, ...words])];
  const ps = psAssignment(words);
  if (ps) out.push(textOf([...shown, `${ps.name}=${ps.value}`]));
  return out;
}

/**
 * A command line as the rules read it: `segments` (word lists, inner shell lines expanded), `assigned` (what it
 * sets in its environment), `agent` (the name it gives itself, else the session's), `units` (each command that is
 * no reader, with the locks a wrapper holds for it) and the readings the project's rules search.
 */
export function readCommand(command, cfg, facts = {}) {
  const segments = expand(shellWords(command));
  const assigned = assignments(segments);
  const guard = cfg.guard || {};
  let agent = null;
  for (const name of [guard.agentVar || "AW_AGENT", ...list(guard.agentVarAliases)]) {
    if (assigned.get(String(name))) {
      agent = assigned.get(String(name));
      break;
    }
  }
  agent ??= facts.agent ?? null;
  const own = ownVars(cfg);
  const units = [];
  const unitTexts = [];
  const segmentTexts = [];
  for (const segment of segments) {
    const { lead, words } = splitLead(segment);
    const mine = psAssignment(words);
    if (mine && own.has(mine.name)) continue; // `$env:AW_RUN = "verify: ..."`: a reason or a name, never a command
    segmentTexts.push(ruleTexts(lead, words, own));
    const { held, segments: inner } = unwrapLock(words);
    if (!words.length) unitTexts.push(ruleTexts(lead, [], own)); // `export X=v`: no reader, and a rule may be about X
    for (const sub of inner) {
      const { lead: subLead, words: w } = splitLead(sub);
      if (w.length && !isReader(w)) {
        units.push({ held, words: w });
        unitTexts.push(ruleTexts([...lead, ...subLead], w, own));
      }
      for (const [name, value] of assignments([sub])) if (!assigned.has(name)) assigned.set(name, value);
    }
  }
  return { segments, assigned, agent, units, unitTexts, segmentTexts };
}

// ------------------------------------------------------------------------------------ paths and the owner's files

const UNKNOWN_DIR = "/~";
const ABSOLUTE = /^([a-zA-Z]:)?\//;
const GLOB = /[*?[]/;

/** Forward slashes, Git Bash's /e/... as e:/..., and the home folder as a place outside the checkout. */
function slashes(p) {
  const s = p.replaceAll("\\", "/").replace(/^\/([a-zA-Z])\//, "$1:/");
  return s.startsWith("~") ? UNKNOWN_DIR + s.slice(1) : s;
}

/** Not a literal name: a variable, a substitution, a PowerShell splat. */
const opaque = (word) => /[$`]/.test(word) || /^@\w/.test(word);

/** `path` as seen from `dir`, with `.` and `..` resolved. Relative results are relative to the checkout's top. */
function joinPath(dir, p) {
  const to = slashes(p);
  const raw = ABSOLUTE.test(to) || !dir ? to : `${dir}/${to}`;
  const lead = ABSOLUTE.exec(raw)?.[0] ?? "";
  const out = [];
  for (const part of raw.slice(lead.length).split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") out.push(part);
    else if (out.length && out.at(-1) !== "..") out.pop();
    else if (!lead) out.push("..");
  }
  return lead + out.join("/");
}

const topOf = (root) => slashes(root || "").replace(/\/+$/, "").toLowerCase();

/**
 * What a path can be, relative to the top of a checkout. Inside this checkout: the one answer. Anywhere else
 * (another work tree, a folder the guard could not follow): every tail of it, so `<somewhere>/a/b` still counts
 * as `a/b`.
 */
function readings(p, root) {
  if (!ABSOLUTE.test(p) && !p.startsWith("..")) return [p];
  const low = p.toLowerCase();
  const r = topOf(root);
  if (r && (low === r || low.startsWith(`${r}/`))) return [p.slice(r.length + 1)];
  const parts = p.split("/");
  return parts.slice(1).map((_, i) => parts.slice(i + 1).join("/"));
}

function globRe(glob) {
  const source = (chars) => `^${glob.replace(chars, "\\$&").replace(/\*+/g, ".*").replaceAll("?", "[^/]")}$`;
  try {
    return new RegExp(source(/[.+^${}()|\\]/g), "i");
  } catch {
    return new RegExp(source(/[.+^${}()|\\[\]]/g), "i");
  }
}

/**
 * Does a pathspec (relative to the top) take an owner's file? As git matches: the name itself, a folder above it,
 * or a glob, whose `*` crosses folders. `whole` is for exclusions: the spec must cover all of an owner's folder,
 * where a path inside the folder is enough to take something of it.
 */
function covers(spec, owner, whole = false) {
  const folder = owner.endsWith("/");
  const o = (folder ? owner.slice(0, -1) : owner).toLowerCase();
  const s = spec.toLowerCase();
  if (!s) return true;
  const g = GLOB.exec(s);
  if (!g) return s === o || o.startsWith(`${s}/`) || (folder && !whole && s.startsWith(`${o}/`));
  const rx = globRe(s);
  const parts = o.split("/");
  if (parts.some((_, k) => rx.test(parts.slice(0, k + 1).join("/")))) return true;
  return folder && !whole && s.slice(0, g.index).startsWith(`${o}/`);
}

const COMMIT_VALUES = ["message", "file", "author", "date", "reuse-message", "reedit-message", "fixup", "squash",
  "template", "cleanup", "trailer", "pathspec-from-file"];

function readStaging(verb, args, dir, root) {
  const s = { verb, all: false, dry: false, specs: [], unseen: [], include: [], exclude: [] };
  const values = verb === "add" ? ["pathspec-from-file"] : COMMIT_VALUES;
  let rest = false;
  for (let i = 0; i < args.length;) {
    const t = args[i++];
    if (/^(\d?>|<)/.test(t)) break; // a redirection ends the arguments
    if (t === "-") continue;
    if (rest || !t.startsWith("-")) {
      s.specs.push(t);
      continue;
    }
    if (t === "--") {
      rest = true;
      continue;
    }
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const name = eq < 0 ? t.slice(2) : t.slice(2, eq);
      if (name === "all" || (verb === "add" && ["update", "no-ignore-removal"].includes(name))) s.all = true;
      else if (name === "dry-run") s.dry = true;
      else if (name === "pathspec-from-file") s.unseen.push(name);
      if (eq < 0 && values.includes(name)) i += 1;
      continue;
    }
    for (let k = 1; k < t.length; k += 1) {
      const ch = t[k];
      if (verb === "commit" && "mFCct".includes(ch)) { // takes a value
        if (k === t.length - 1) i += 1;
        break;
      }
      if (verb === "commit" && "uS".includes(ch)) break; // an optional value, attached
      if (verb === "add" ? "Au".includes(ch) : ch === "a") s.all = true;
      if (verb === "add" && ch === "n") s.dry = true;
    }
  }
  for (const spec of s.specs) {
    if (opaque(spec)) {
      s.unseen.push(spec);
      continue;
    }
    // Pathspec magic: ":/x" and ":(top)x" start at the top, ":!x", ":^x" and ":(exclude)x" take x out.
    let p = spec;
    let top = false;
    let exclude = false;
    const m = /^:\(([^)]*)\)(.*)$/.exec(spec);
    if (m) {
      const magic = m[1].split(",").map((w) => w.trim());
      top = magic.includes("top");
      exclude = magic.includes("exclude");
      p = m[2];
    } else if (spec.startsWith(":")) {
      let k = 1;
      for (; k < spec.length && "/!^".includes(spec[k]); k += 1) {
        if (spec[k] === "/") top = true;
        else exclude = true;
      }
      p = spec[k] === ":" ? spec.slice(k + 1) : spec.slice(k);
    }
    (exclude ? s.exclude : s.include).push(readings(joinPath(top ? "" : dir, p), root));
  }
  if (s.exclude.length && !s.include.length) s.include.push([""]); // exclusions alone: everything but them
  return s;
}

/** Where a command starts: relative to the checkout's top inside it (`""` at the top), else the absolute path. */
function startDir(cwd, root) {
  const here = cwd ? readings(joinPath("", cwd), root || "") : [""];
  return here.length === 1 ? here[0] : joinPath("", cwd || "");
}

/**
 * Every `git add` / `git stage` / `git commit` of a command, with its pathspecs resolved from where it runs
 * (`dir`: the folder it runs in, after every `cd`, `pushd` and `git -C` before it; `lead`: the words before `git`).
 */
export function stagings(command, cwd = null, root = null) {
  let dir = startDir(cwd, root || "");
  const found = [];
  for (const segment of commands(command)) {
    // "(cd a && git add b)": the brackets of a subshell are not part of a name.
    const { lead, words: own } = splitLead(segment, []);
    const words = [...lead, ...own];
    const first = words[0] ?? "";
    if (/^(cd|chdir|pushd|Set-Location|Push-Location|sl)$/i.test(first)) {
      const to = words.slice(1).find((w) => !w.startsWith("-"));
      dir = !to || opaque(to) ? UNKNOWN_DIR : joinPath(dir, to);
      continue;
    }
    if (/^(popd|Pop-Location)$/i.test(first)) {
      dir = UNKNOWN_DIR;
      continue;
    }
    if (/^(echo|printf|grep|rg|gh|Write-Host|Write-Output)$/i.test(first)) continue; // talking about git
    const call = gitCommand(words);
    if (!call) continue;
    let at = dir;
    for (const c of call.dirs) at = opaque(c) ? UNKNOWN_DIR : joinPath(at, c);
    const verb = ["add", "stage"].includes(call.verb) ? "add" : call.verb === "commit" ? "commit" : null;
    if (!verb) continue;
    const s = readStaging(verb, call.args, at, root || "");
    s.dir = at;
    s.lead = words.slice(0, call.at);
    if (s.lead.some((w) => /^xargs$/i.test(w))) s.unseen.push("xargs");
    found.push(s);
  }
  return found;
}

/** The owner's files a staging would take. */
function ownerFilesTaken(s, owners) {
  const hit = (specs, owner, whole) => specs.some((r) => r.some((spec) => covers(spec, owner, whole)));
  return owners.filter((o) => hit(s.include, o, false) && !hit(s.exclude, o, true));
}

/** `[the path relative to the checkout's top, true]`, or `[the path, false]` when it lies elsewhere. */
function relPath(file, root, cwd = null) {
  let p = slashes(file);
  if (!ABSOLUTE.test(p)) {
    const base = cwd ? readings(joinPath("", cwd), root) : [""];
    if (base.length !== 1) return [joinPath("", p), false];
    p = joinPath(base[0], p);
    return [p, !p.startsWith("..")];
  }
  p = joinPath("", p);
  const r = topOf(root);
  if (r && p.toLowerCase().startsWith(`${r}/`)) return [p.slice(r.length + 1), true];
  return [p, false];
}

/** The owner's file a path is, or lies in. */
function ownerFile(relative, inside, owners) {
  const low = relative.toLowerCase();
  for (const f of owners) {
    const o = f.toLowerCase();
    if (inside) {
      if (o.endsWith("/") ? `${low}/`.startsWith(o) : low === o) return f;
    } else { // another checkout: read by its tail
      const padded = `/${low}`;
      if (o.endsWith("/") ? `${padded}/`.includes(`/${o}`) : padded.endsWith(`/${o}`)) return f;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------- rules

function decision(kind, rule, message, notice = null) {
  return notice ? { kind, rule, message, notice } : { kind, rule, message };
}

/** A level a config gives a rule: "deny", "ask" or "warn"; null ("off", "allow", anything else) switches it off. */
function level(value, fallback) {
  const v = String(value ?? fallback).toLowerCase();
  return ["deny", "ask", "warn"].includes(v) ? v : null;
}

const ownersOf = (guard) => list(guard.ownerFiles).map((o) => String(o).replaceAll("\\", "/"));

const BY_PATH = "Stage the files you changed by their exact paths (`git add <file> <file>`), then `git commit -m …` "
  + "without -a and without paths above them.";

function stagingRules(command, cfg, facts) {
  const guard = cfg.guard || {};
  const staging = guard.staging || {};
  const owners = ownersOf(guard);
  const blanket = level(staging.blanket, "deny");
  const unseen = level(staging.unseen, "deny");
  const ownerList = owners.map((o) => `  ${o}`).join("\n");
  const leave = owners.length ? " Leave the owner's files as they are: do not revert, stash, move or delete them." : "";
  const out = [];
  for (const s of stagings(command, facts.cwd, facts.root)) {
    if (s.dry) continue;
    const what = s.verb === "add" ? "git add" : "git commit";
    const whole = s.all || s.specs.some((p) => /^(\.|\*|:\/)$/.test(p));
    if (whole && !s.include.length) s.include.push([""]);
    if (whole && blanket) {
      const mine = owners.length ? ` The owner's files (local, never committed):\n${ownerList}\n` : " ";
      out.push(decision(blanket, "staging-blanket",
        "Stage files by path. `git add -A` / `-u` / `git add .` / `git commit -a` take everything in the tree "
        + `with them: the owner's own files and whatever another agent left there.${mine}${BY_PATH}${leave}`));
      continue;
    }
    const taken = ownerFilesTaken(s, owners);
    if (taken.length) {
      out.push(decision("deny", "staging-owner-files",
        `\`${what} ${s.specs.join(" ")}\` would take the owner's own files with it:\n${taken.map((o) => `  ${o}`).join("\n")}\n`
        + "They are local to the owner's machine and never committed. A folder above them, a glob that reaches "
        + `them and the files themselves are all refused. ${BY_PATH}${leave}`));
      continue;
    }
    if (s.unseen.length && owners.length && unseen) {
      out.push(decision(unseen, "staging-owner-files",
        `The guard cannot see which files \`${what}\` takes here (${unique(s.unseen).join(", ")}: a variable, a `
        + "command substitution, xargs or --pathspec-from-file), and a list of changed files includes the owner's "
        + `own:\n${ownerList}\nWrite the paths out. ${BY_PATH}${leave}`));
    }
  }
  return out;
}

/**
 * The branch checked out where a command runs: `dir` as the staging reader resolved it. Null when that folder is
 * not known (a variable, `popd`, the home folder) or is no checkout: no finding rather than a false one.
 */
function branchIn(facts, dir, start) {
  if (dir === start) return facts.branch ?? null;
  if (dir.startsWith(UNKNOWN_DIR) || dir.startsWith("..")) return null;
  const at = ABSOLUTE.test(dir) ? dir : `${String(facts.root || "").replace(/[\\/]+$/, "")}/${dir}`;
  return facts.branchAt?.(at) ?? null;
}

/** force-push and default-branch-commit. */
function gitRules(command, cfg, facts) {
  const db = (cfg.guard || {}).defaultBranch || {};
  const names = (list(db.names).length ? list(db.names) : ["main", "master"]).map(String);
  const commit = level(db.commit, "warn");
  const force = level(db.forcePush, "ask");
  const out = [];
  for (const segment of commands(command)) {
    const words = splitLead(segment).words;
    if (!words.length || baseName(words[0]) !== "git") continue;
    const call = gitCommand(words);
    if (call.verb !== "push" || !force) continue;
    if (call.args.some((a) => a.startsWith("--force") || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || /^\+\S/.test(a))) {
      out.push(decision(force, "force-push",
        "A force push rewrites a pushed branch: others' work on it, and an open review, can be lost. Merge the "
        + "default branch in instead."));
    }
  }
  if (commit) {
    // Where each commit runs is what the staging reader already follows for pathspecs: cd, pushd, git -C.
    const start = startDir(facts.cwd, facts.root);
    for (const s of stagings(command, facts.cwd, facts.root)) {
      if (s.verb !== "commit" || s.dry) continue;
      if (s.lead.some((w) => !(LEADERS.includes(w) || ASSIGN.test(w)))) continue; // `grep -rn git commit .`: git is not the command
      const branch = branchIn(facts, s.dir, start);
      if (branch && names.includes(branch)) {
        out.push(decision(commit, "default-branch-commit",
          `This commits on \`${branch}\`. Work goes on a branch: create one, commit there, open a pull request, `
          + "merge when verified."));
      }
    }
  }
  return out;
}

/**
 * What a command that touches a held resource gets, `guard.locks`: "warn" (the default: a word to the agent, and
 * only when another agent holds the lock), "deny" (also written "enforce": the command needs the lock), "ask", or
 * "off".
 */
export function lockLevel(cfg) {
  const value = String((cfg.guard || {}).locks ?? "warn").toLowerCase();
  return level(value === "enforce" ? "deny" : value, "warn");
}

/** The resources a command would start without a wrapper holding their lock, in the order met. */
export function locksNeeded(units, cfg) {
  const resources = isObject(cfg.resources) ? cfg.resources : {};
  const needed = [];
  for (const { held, words } of units) {
    const text = textOf(words);
    const handler = handlesFiles(words);
    for (const [name, value] of Object.entries(resources)) {
      const spec = isObject(value) ? value : {};
      if (held.has(name) || needed.includes(name) || (handler && !spec.matchFileCommands)) continue;
      if (fires(spec.match, spec.unless, [text], `resources.${name}`)) needed.push(name);
    }
  }
  return needed;
}

function resourceRule(read, cfg, facts) {
  const kind = lockLevel(cfg);
  if (!kind) return [];
  const needed = locksNeeded(read.units, cfg);
  if (!needed.length) return [];
  const agent = read.agent;
  const { holders = {}, mine = new Set() } = facts.lockHolders?.(agent, needed) ?? {};
  const missing = needed.filter((n) => !mine.has(n));
  if (!missing.length) return [];
  const lockOrder = list(cfg.lockOrder);
  const inOrder = (names) => [...lockOrder.filter((n) => names.includes(n)), ...names.filter((n) => !lockOrder.includes(n))];
  if (kind === "warn") {
    const taken = inOrder(missing.filter((n) => holders[n]));
    if (!taken.length) return [];
    const state = taken.map((n) => `${n} (held by ${holders[n]})`).join(", ");
    return [decision("warn", "resource-lock",
      `This command starts ${taken.join(" and ")}, of which one runs at a time across agents and worktrees, and `
      + `another agent holds the lock: ${state}. Running beside it can break both runs.\n`
      + "Wait your turn instead (waits, runs the command, always releases):\n"
      + `  aw lock run ${taken[0]} --for "<what, how long>" -- <command>\n`
      + "`aw lock status` shows who holds what.")];
  }
  const order = inOrder(missing);
  const first = order[0];
  const agentVar = (cfg.guard || {}).agentVar || "AW_AGENT";
  const state = order.map((n) => `${n}: ${holders[n] ? `held by ${holders[n]}` : "free"}`).join(", ");
  const who = agent ? `"${agent}" does not hold the lock` : "it does not say which agent runs it";
  const both = order.length > 1 ? ` Needing several, take them in this order: ${order.join(", ")}.` : "";
  return [decision(kind, "resource-lock",
    `This command starts ${order.join(" and ")}, of which one runs at a time across agents and worktrees, and `
    + `${who} (${state}).\n`
    + "The normal way (waits its turn, runs the command, always releases):\n"
    + `  aw lock run ${first} --for "<what, how long>" -- <command>\n`
    + "Several commands under one hold:\n"
    + `  aw lock acquire ${first} --as <name> --for "<what>"\n`
    + `  ${agentVar}=<name> <command>          PowerShell: $env:${agentVar} = "<name>"; <command>\n`
    + `  aw lock release ${first} --as <name>     (also after a failure)\n`
    + `Hold a lock for the run only, never while thinking or editing.${both} \`aw lock status\` shows who holds what.`)];
}

/** `--name=v`, `-Name:v`, `--name` -> name, lower case; "" for a word that is no flag. */
function flagName(word) {
  if (!word.startsWith("-") || /^-\d/.test(word)) return "";
  return word.replace(/^-+/, "").split(/[=:]/, 1)[0].toLowerCase();
}

const flagInline = (word) => /^-+[^=:]+[=:](.*)$/s.exec(word)?.[1] ?? null;
const normFlags = (flags) => new Set(list(flags).map((f) => String(f).replace(/^-+/, "").toLowerCase()));
const flagOf = (value) => String(value || "").replace(/^-+/, "").toLowerCase();

/** What a run command asks for: `{ dry, all, count (null when the text does not say), total, how }`. */
export function countRun(words, run, facts = {}) {
  const spec = isObject(run.count) ? run.count : {};
  let start = 0;
  for (let k = 0; k < words.length; k += 1) {
    if (matches(run.match, textOf(words.slice(0, k + 1)), `runs[${run.id || "run"}]`)) { // the patterns alone: where the program's name ends
      start = k + 1;
      break;
    }
  }
  const args = [];
  for (const w of words.slice(start)) {
    if (/^(\d?>|>>?|<)/.test(w)) break;
    args.push(w);
  }
  const dry = normFlags(run.dryFlags ?? ["--dry-run", "--list"]);
  const allFlags = normFlags(spec.allFlags);
  const groupFlag = flagOf(spec.groupFlag);
  const matchFlag = flagOf(spec.matchFlag);
  const valueFlags = new Set([...normFlags(spec.valueFlags), groupFlag, matchFlag].filter(Boolean));
  const res = { dry: false, all: false, count: null, total: null, how: "" };
  const names = [];
  const groups = [];
  let narrow = null;
  for (let i = 0; i < args.length;) {
    const w = args[i++];
    const name = flagName(w);
    if (!name) {
      names.push(...w.split(",").filter(Boolean));
      continue;
    }
    let value = null;
    if (valueFlags.has(name)) {
      value = flagInline(w);
      if (value === null && i < args.length) value = args[i++];
    }
    if (dry.has(name)) res.dry = true;
    else if (allFlags.has(name)) res.all = true;
    else if (groupFlag && name === groupFlag && value) groups.push(...value.split(",").filter(Boolean));
    else if (matchFlag && name === matchFlag && value) narrow = value;
  }
  const items = spec.itemsDir ? facts.items?.(String(spec.itemsDir)) ?? null : null;
  res.total = items === null ? null : items.length;
  const narrowed = (picked) => (narrow ? picked.filter((p) => fnmatch(p, narrow)) : picked);
  if (res.all) {
    if (items !== null) res.count = narrowed(items).length;
    res.how = `all${items !== null && narrow ? `, narrowed by ${narrow}` : ""}`;
  } else if (groups.length) {
    const table = spec.groupsFile ? facts.groups?.(String(spec.groupsFile)) ?? null : null;
    if (isObject(table) && items !== null && groups.every((g) => Object.hasOwn(table, g))) {
      const picked = [];
      for (const g of groups) {
        const globs = (Array.isArray(table[g]) ? table[g] : [table[g]]).map(String);
        const yes = globs.filter((x) => !x.startsWith("!"));
        const no = globs.filter((x) => x.startsWith("!")).map((x) => x.slice(1));
        picked.push(...items.filter((n) => yes.some((x) => fnmatch(n, x)) && !no.some((x) => fnmatch(n, x))));
      }
      res.count = new Set([...narrowed(picked), ...names]).size;
    }
    res.how = `group ${groups.join(",")}`;
  } else {
    res.count = spec.names ?? true ? new Set(names).size : 0;
    res.how = "named";
  }
  return res;
}

const wholeNumber = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.trunc(Number(value)) : fallback);

function runRule(read, cfg, facts) {
  const out = [];
  for (const { words } of read.units) {
    const text = textOf(words);
    const handler = handlesFiles(words);
    for (const run of list(cfg.runs)) {
      if (!isObject(run) || (handler && !run.matchFileCommands)) continue;
      const rid = String(run.id || "run");
      if (!fires(run.match, run.unless, [text], `runs[${rid}]`)) continue;
      const ask = countRun(words, run, facts);
      if (ask.dry) continue;
      const free = wholeNumber(run.free, 3);
      const fullAt = wholeNumber(run.fullAt, 100);
      const n = ask.count;
      const total = ask.total;
      const unknown = n === null;
      const full = (ask.all && (unknown || !total || n >= 0.8 * total)) || (n !== null && n >= fullAt);
      if (!full && !unknown && n <= free) continue;
      const reasonVar = String(run.reasonVar || "AW_RUN");
      const given = read.assigned.get(reasonVar) ?? null; // read from the command's own text, so the reason is on record
      const m = /^\s*(full|verify)\s*:\s*(.*)$/is.exec(given ?? "");
      const kind = m ? m[1].toLowerCase() : "";
      const reason = m ? m[2].split(/\s+/).filter(Boolean).join(" ") : "";
      const what = unknown && !ask.all ? "a run whose size the command does not say"
        : unknown ? "everything"
          : `${n} item${n === 1 ? "" : "s"}${full && total ? `: everything (${total})` : ""}`;
      if (m && reason.length >= 12 && (kind === "full" || !full)) {
        out.push(decision("warn", "run-budget",
          `Run budget (${rid}): ${what} allowed for the stated reason. This is the exception, not the loop: the `
          + `next iteration runs ${free} or fewer.`,
          `Run budget (${rid}): ${what} let through — ${kind}: ${reason}`));
        continue;
      }
      const need = full
        ? "Everything at once is for ONE pass when the work is finished, never to look at one effect and never "
          + "between iterations. If this is that pass, say so in the command:\n"
          + `  bash:        ${reasonVar}="full: <what is finished and why everything must run>" <command>\n`
          + `  PowerShell:  $env:${reasonVar} = "full: <…>"; <command>`
        : `More than ${free} is not an iteration. If this is the check after the change already works on its own `
          + "items, say so in the command:\n"
          + `  bash:        ${reasonVar}="verify: <what already works and what this run checks>" <command>\n`
          + `  PowerShell:  $env:${reasonVar} = "verify: <…>"; <command>`;
      let bad = "";
      if (given !== null) {
        bad = `\nThe ${reasonVar} reason given ${!m ? 'must start with "verify:" or "full:".'
          : reason.length < 12 ? "is too short to be a reason." : `is "${kind}", and this run needs "full".`}`;
      }
      const extra = run.message ? `\n${run.message}` : "";
      out.push(decision("deny", "run-budget",
        `Run budget (${rid}): this command asks for ${what} (${ask.how || "unknown"}).${bad}\n`
        + `Run the smallest set that answers the question: 1-${free} items that show the thing you changed, by `
        + `name.${extra}\n${need}\n`
        + "The reason is logged for the owner. Do not add it to get past this message: narrow the run first."));
    }
  }
  return out;
}

/**
 * The project's own guard.rules. `unitTexts` / `segmentTexts`: the readings of every command that is no reader /
 * of every segment; `file`: the path of an edit, relative to the top.
 */
function dataRules(unitTexts, segmentTexts, cfg, facts, file = null) {
  const out = [];
  for (const rule of list((cfg.guard || {}).rules)) {
    if (!isObject(rule)) continue;
    const kind = level(rule.decision, "deny");
    if (!kind) continue;
    const branches = list((isObject(rule.when) ? rule.when : {}).branch);
    if (branches.length && !branches.includes(facts.branch ?? "")) continue;
    const scope = rule.scope || "segment";
    if ((scope === "file") !== (file !== null)) continue;
    let texts;
    if (scope === "file") {
      texts = [[file]];
    } else {
      texts = rule.skipReaders ?? true ? unitTexts : segmentTexts;
      // all segments together, once per reading (a segment without that reading gives its last)
      if (scope === "command") texts = [[0, 1, 2].map((k) => texts.map((r) => r[Math.min(k, r.length - 1)]).filter(Boolean).join("\n"))];
    }
    const id = String(rule.id || "project-rule");
    if (texts.some((t) => fires(rule.match, rule.unless, unique(t), `guard.rules[${id}]`))) {
      out.push(decision(kind, id, String(rule.message || "A project rule matched this call (guard.rules in .agents/agent-works.json).")));
    }
  }
  return out;
}

function fileRules(file, cfg, facts) {
  const guard = cfg.guard || {};
  const [relative, inside] = relPath(facts.resolve?.(file) ?? file, facts.root, facts.cwd);
  const out = [];
  for (const g of list(guard.generated)) {
    if (!isObject(g) || !g.match) continue;
    if (search(String(g.match), relative, "i", "guard.generated")) {
      out.push(decision("deny", "generated-file",
        `Do not edit ${file} by hand. ${g.how || "It is generated: change its source and run the generator."}`));
      break;
    }
  }
  const edit = level(guard.ownerFilesEdit, "ask");
  const owners = ownersOf(guard);
  if (edit && owners.length && ownerFile(relative, inside, owners)) {
    out.push(decision(edit, "owner-file-edit",
      `${file} is the owner's own file: agents leave it as it is and never commit it.`));
  }
  return [...out, ...dataRules([], [], cfg, facts, relative)];
}

const ORDER = { deny: 0, ask: 1, warn: 2 };

/**
 * Every decision the rules reach for one tool call, strongest first, and the config's patterns that were skipped
 * because they do not compile: `{ decisions: [{ kind, rule, message, notice? }], skipped: string[] }`.
 */
export function judge(tool, input, cfg, facts = {}) {
  const found = [];
  skipped = new Set();
  try {
    if (SHELL_TOOLS.includes(tool)) {
      const command = isObject(input) ? input.command : null;
      if (typeof command === "string" && command.trim()) {
        const read = readCommand(command, cfg, facts);
        found.push(
          ...stagingRules(command, cfg, facts),
          ...gitRules(command, cfg, facts),
          ...resourceRule(read, cfg, facts),
          ...runRule(read, cfg, facts),
          ...dataRules(read.unitTexts, read.segmentTexts, cfg, facts),
        );
      }
    } else if (EDIT_TOOLS.includes(tool)) {
      const file = isObject(input) ? input.file_path || input.notebook_path : null;
      if (typeof file === "string" && file) found.push(...fileRules(file, cfg, facts));
    }
    return { decisions: found.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]), skipped: [...skipped] };
  } finally {
    skipped = null;
  }
}

/** Every decision for one tool call, strongest first. */
export function decideAll(tool, input, cfg, facts = {}) {
  return judge(tool, input, cfg, facts).decisions;
}

/** The one decision that is answered: a refusal before a question before a warning. Null: the call goes ahead. */
export function decide(tool, input, cfg, facts = {}) {
  return decideAll(tool, input, cfg, facts)[0] ?? null;
}

/** The hook's answer for a decision: a deny or an ask as a permission decision, a warning as context for the model. */
export function answer(d) {
  if (d.kind === "warn") {
    const out = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: d.message } };
    if (d.notice) out.systemMessage = d.notice;
    return out;
  }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d.kind, permissionDecisionReason: d.message } };
}
