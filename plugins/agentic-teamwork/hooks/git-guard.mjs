#!/usr/bin/env node
// PreToolUse on a shell command: the repo's git rules, enforced before the
// command runs. Denies a force push, `--no-verify`, staged credentials and
// staged junk; in a repo on the team conventions, also a commit or a push to a
// protected branch. Asks before any push, unless the person granted that
// branch's own push ahead of time. With `requireTestsPass` on, runs the repo's
// tests before a commit and denies on failure.
//
// The command is read the way a shell reads it (shell-words.mjs), bash and
// PowerShell alike: a quoted string is one word, so a commit message that
// mentions `git push` is never a push, and `bash -c "..."` or
// `powershell -Command "..."` is judged by what it runs. Every commit and push
// in the command gets its own decision and the strongest wins: deny, then ask,
// then allow.
//
// The repo is resolved per command: a `cd <path>` before it or a `git -C
// <path>` names it, otherwise it is the work tree of the payload's cwd. Each
// repo is judged by its own mode and its own settings (lib/config.mjs). A repo
// in mode none, or a path that is no repo, gets no decision at all.
//
// The grant is `git config branch.<b>.agentic-engineering-push "<who> <when>: <what>"`.
// It allows a push only when the whole command is plain `cd`s and pushes, and
// every push sends the current branch, nothing else, to one configured remote
// from a branch that is not protected and carries a non-empty grant.
//
// Escape hatch, on the record in the transcript: `TEAMWORK_ALLOW=1` set in the
// command itself (the name is the repo's `escapeHatch`).
//
// It also notes each test command it sees, so the stop gate can tell "no tests
// ran" from "tests ran".
//
// Contract: read stdin once, catch everything, exit 0. The only output is one
// decision object on stdout, and a command that trips nothing prints nothing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPayload, repoRoot } from "./critical-context.mjs";
import { ENV_EXAMPLE, MANIFEST, SECRET_PATTERNS, anyOf, loadConfig, modeFor } from "./lib/config.mjs";
import { TEST_COMMAND, lanesIn, recordTestRun, runTests } from "./lib/gate.mjs";
import { assignments, baseName, commandWords, gitCommand, splitCommand, textOf, trackCwd, unwrap } from "./shell-words.mjs";

const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_LISTED = 20;

// ---- reading the command -------------------------------------------------

// Programs that run the command after them, and the arguments they take.
const RUNNERS = new Set(["sudo", "doas", "command", "exec", "builtin", "nice", "timeout", "xargs", "winpty"]);
const beforeCommand = (word) => word.startsWith("-") || /^\d+[smhd]?$/.test(word) || RUNNERS.has(baseName(word));

/** The git call a command's words make, when git is the command itself or sits behind a runner. */
function callIn(words) {
  const call = gitCommand(words);
  return call && words.slice(0, call.at).every(beforeCommand) ? call : null;
}

/** The git calls of one segment: its own, or the one a wrapper runs after `--`. */
function gitCalls(segment) {
  const words = commandWords(segment);
  const direct = callIn(words);
  if (direct) return [direct];
  if (!words.includes("--")) return [];
  return unwrap(words, { names: [baseName(words[0])] }).segments.map((inner) => callIn(commandWords(inner))).filter(Boolean);
}

// Options of `git commit` whose value is the next word, so a message is never read as flags.
const COMMIT_VALUE_OPTIONS = new Set(["--message", "--file", "--author", "--date", "--reuse-message", "--reedit-message", "--fixup", "--squash", "--template", "--cleanup", "--pathspec-from-file", "--trailer"]);

function inspectCommit(args) {
  let noVerify = false;
  let all = false;
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i];
    if (word === "--") break;
    if (word === "--no-verify") noVerify = true;
    else if (word === "--all") all = true;
    else if (COMMIT_VALUE_OPTIONS.has(word)) i += 1;
    else if (/^-[A-Za-z]/.test(word)) {
      for (let k = 1; k < word.length; k += 1) {
        const flag = word[k];
        // -m, -F, -C, -c and -t take a value: the rest of the word, or the next one.
        if ("mFCct".includes(flag)) { if (k === word.length - 1) i += 1; break; }
        // -S and -u take theirs in the same word.
        if ("Su".includes(flag)) break;
        if (flag === "n") noVerify = true;
        if (flag === "a") all = true;
      }
    }
  }
  return { noVerify, all };
}

function inspectPush(args, branch, protectedBranches) {
  let force = false;
  let noVerify = false;
  const plain = [];
  for (const word of args) {
    if (/^--force(-with-lease(=.*)?|-if-includes)?$/.test(word)) force = true;
    else if (word === "--no-verify") noVerify = true;
    else if (word.startsWith("--")) continue;
    else if (/^-[A-Za-z]+$/.test(word)) { if (word.includes("f")) force = true; }
    else plain.push(word);
  }
  // The first plain word is the remote; the rest are refspecs.
  const specs = plain.slice(1);
  if (specs.some((spec) => spec.startsWith("+"))) force = true;
  let target = null;
  for (const spec of specs) {
    const to = spec.split(":").pop().replace(/^\+/, "").replace(/^refs\/heads\//, "");
    if (protectedBranches.includes(to)) target = to;
    else if ((spec === "HEAD" || spec === "@") && protectedBranches.includes(branch)) target = branch;
  }
  // A bare `git push`, or a remote with no refspec, sends the current branch.
  if (!specs.length && protectedBranches.includes(branch)) target = branch;
  return { force, noVerify, target };
}

// ---- the repo a command runs in ------------------------------------------

/**
 * One directory's repo: its root, branch, mode and settings, with git bound
 * to the root (`git`) and to the directory itself (`here`), or null where
 * there is nothing to judge. A path that does not exist or is not a work tree
 * is no reason to deny a command.
 */
const repoStates = new Map();
function repoState(dir) {
  if (repoStates.has(dir)) return repoStates.get(dir);
  let state = null;
  try {
    const run = (cwd) => (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: MAX_BUFFER });
    const root = run(dir)("rev-parse", "--show-toplevel").trim();
    const git = run(root);
    // A repo with no commit yet has an unborn branch: rev-parse cannot name
    // it, symbolic-ref can. On a detached HEAD symbolic-ref -q prints nothing.
    let unborn = false;
    try { git("rev-parse", "--verify", "-q", "HEAD"); } catch { unborn = true; }
    let branch = "";
    try { branch = git("symbolic-ref", "--short", "-q", "HEAD").trim(); } catch { /* detached */ }
    state = { root, git, here: run(dir), branch, unborn, mode: modeFor(root), config: loadConfig(root) };
  } catch { /* missing directory, or not a work tree */ }
  repoStates.set(dir, state);
  return state;
}

const names = (out) => out.split("\0").filter(Boolean);
const configValue = (git, key) => { try { return git("config", "--get", key).trim() || null; } catch { return null; } };

/** What the forge calls a change request, for a refusal that points at one. */
function requestNoun({ git, config }) {
  const url = config.provider === "auto" ? configValue(git, `remote.${config.remote}.url`) ?? "" : config.provider;
  return /gitlab/i.test(url) ? "merge request" : /github/i.test(url) ? "pull request" : "pull or merge request";
}

/** Staged files, deletions left out: removing a file from the repo is never the problem. */
function stagedFiles(git) {
  try { return names(git("diff", "--cached", "--name-only", "--diff-filter=d", "-z")); } catch { return []; }
}

/**
 * The files this command will stage before it commits: what each `git add` in
 * it names, and for `commit -a` every modified tracked file. The index does
 * not hold them yet, so the work tree is what gets judged.
 */
function pendingFiles(state, adds, all) {
  const found = new Set();
  const list = (git, modes, specs) => {
    try { for (const file of names(git("ls-files", "--full-name", "-z", ...modes, "--", ...specs))) found.add(file); } catch { /* a pathspec git cannot read */ }
  };
  for (const add of adds) {
    const repo = repoState(add.dir);
    if (repo?.root !== state.root) continue;
    const end = add.args.indexOf("--");
    const options = end < 0 ? add.args : add.args.slice(0, end);
    const flags = options.filter((word) => word.startsWith("-"));
    const specs = [...options.filter((word) => !word.startsWith("-")), ...(end < 0 ? [] : add.args.slice(end + 1))];
    const has = (letter, long) => flags.some((flag) => flag === long || (/^-[A-Za-z]+$/.test(flag) && flag.includes(letter)));
    const update = has("u", "--update");
    // Interactive adds stage what the person picks, and a dry run stages nothing.
    if (has("p", "--patch") || has("i", "--interactive") || has("n", "--dry-run")) continue;
    if (!specs.length && !update && !has("A", "--all")) continue;
    const modes = update ? ["--modified"] : ["--modified", "--others", ...(has("f", "--force") ? [] : ["--exclude-standard"])];
    // A pathspec is read from the folder the add runs in; with none, the whole tree is meant.
    list(specs.length ? repo.here : repo.git, modes, specs);
  }
  if (all) list(state.git, ["--modified"], []);
  return [...found].filter((file) => fs.existsSync(path.join(state.root, file)));
}

/** The first `max` bytes of a file as text, or "" when it cannot be read. */
function head(file, max) {
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size));
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
  } catch { return ""; } finally { if (fd !== null) fs.closeSync(fd); }
}

/** Where credentials show up in the change, as `file:line`. Never the value. */
function secretHits({ git, root, config }, staged, pending) {
  const found = anyOf([...SECRET_PATTERNS, ...config.secretPatternsExtra]);
  const max = config.scan.maxFileBytes;
  const hits = [];
  const scan = (label, text) => text.split("\n").forEach((line, i) => { if (found(line)) hits.push(`${label}:${i + 1}`); });
  // A staged file whose work tree copy has not moved on reads the same from disk, without a git call per file.
  let moved = new Set();
  try { moved = new Set(names(git("diff", "--name-only", "-z"))); } catch { /* treat every file as unmoved */ }
  for (const file of staged) {
    let text = moved.has(file) ? null : head(path.join(root, file), max);
    if (!text) { try { text = git("show", `:${file}`).slice(0, max); } catch { text = ""; } }
    scan(`${file} (staged)`, text);
  }
  const inIndex = new Set(staged);
  for (const file of pending) if (!inIndex.has(file) || moved.has(file)) scan(file, head(path.join(root, file), max));
  return hits;
}

// ---- the push grant ------------------------------------------------------

// The one expansion a grant accepts, because the ship skill pushes the branch this way.
const CURRENT_BRANCH = '"$(git branch --show-current)"';
const CURRENT_BRANCH_WORD = "$(git branch --show-current)";
// Anything the shell would expand, redirect, group, or run in the background.
const SHELL_META = /[`$<>(){}]|(?<!&)&(?!&)/;

/**
 * Whether the command is nothing but plain `cd`s and `git [-C <dir>] push`es.
 * An allow approves the whole shell call, so a grant must never carry another
 * program, an environment prefix, a `-c` option, or an expansion with it.
 */
function plainPushCommand(command, segments) {
  if (SHELL_META.test(command.replaceAll(CURRENT_BRANCH, ""))) return false;
  return segments.every(({ words }) => {
    if (words[0] === "cd") return words.length === 2;
    const call = words[0] === "git" ? gitCommand(words) : null;
    if (!call || call.verb !== "push") return false;
    const before = words.length - call.args.length - 2;
    return before === 0 || (before === 2 && words[1] === "-C");
  });
}

/**
 * The grant text when this push sends only the current branch to one
 * configured remote and the person approved that branch ahead of time, else
 * null. `shellBranch` is what the shell substitutes for CURRENT_BRANCH.
 */
function grantFor(call, { git, branch, mode, config }, shellBranch) {
  if (!branch || (mode === "full" && config.protectedBranches.includes(branch))) return null;
  const words = call.args.map((word) => (word === CURRENT_BRANCH_WORD ? shellBranch ?? "" : word));
  if (words.some((word) => word.startsWith("-") && word !== "-u" && word !== "--set-upstream")) return null;
  const [remote, ...specs] = words.filter((word) => !word.startsWith("-"));
  if (!remote || !configValue(git, `remote.${remote}.url`)) return null;
  const own = new Set(["HEAD", branch, `HEAD:${branch}`, `${branch}:${branch}`]);
  if (!specs.every((spec) => own.has(spec))) return null;
  return configValue(git, `branch.${branch}.agentic-engineering-push`);
}

// ---- the decision --------------------------------------------------------

const deny = (reason) => ({ decision: "deny", reason });
const listed = (items) => `${items.slice(0, MAX_LISTED).join("\n")}${items.length > MAX_LISTED ? `\n(and ${items.length - MAX_LISTED} more)` : ""}`;

function judgeCommit(call, state, adds) {
  const { git, root, branch, unborn, mode, config } = state;
  const { rules } = config;
  const { noVerify, all } = inspectCommit(call.args);
  if (noVerify && rules.blockNoVerify) return deny("git commit --no-verify bypasses the checks this repo runs before every commit. Run it without the flag and fix whatever the checks report.");
  // The first commit of a repo has to land somewhere, and an unborn branch has nothing to protect.
  if (mode === "full" && rules.blockCommitOnProtected && !unborn && config.protectedBranches.includes(branch)) {
    const example = config.branchPrefixes[0] ? `${config.branchPrefixes[0]}<topic>` : "<type>/<topic>";
    return deny(`Committing to ${branch} is not allowed: it moves only through a ${requestNoun(state)}. Branch first (git switch -c ${example}), then /agentic-teamwork:ship.`);
  }
  const staged = stagedFiles(git);
  const pending = pendingFiles(state, adds, all);
  if (rules.blockJunk) {
    const isJunk = anyOf(config.junkPatterns);
    const junk = [...new Set([...staged, ...pending])].filter((file) => isJunk(file) && !ENV_EXAMPLE.test(file));
    if (junk.length) return deny(`These files must never be committed:\n${listed(junk)}\nLeave them out (git restore --staged <file>); .gitignore should have covered them.`);
  }
  if (rules.blockSecrets) {
    const hits = secretHits(state, staged, pending);
    if (hits.length) return deny(`Possible credentials in the change (file:line, never the value):\n${listed(hits)}\nA credential that reaches git is a credential you rotate. Remove it, then retry.`);
  }
  if (config.requireTestsPass) {
    const tests = runTests(config, root);
    if (tests && !tests.ok) return deny(`\`${tests.command}\` must pass before every commit in this repo (requireTestsPass in ${MANIFEST}). It fails now:\n${tests.output}\nFix it, then commit again.`);
  }
  return null;
}

function judgePush(call, state, plain, shellBranch) {
  const { branch, mode, config } = state;
  const { rules } = config;
  const { force, noVerify, target } = inspectPush(call.args, branch, mode === "full" ? config.protectedBranches : []);
  if (force && rules.blockForcePush) return deny(`Force pushing rewrites shared history and is not allowed in this repo. Only if the person asks for it by name: ${config.escapeHatch}=1 in the command lets it through, on the record. Never add that yourself.`);
  if (noVerify && rules.blockNoVerify) return deny("git push --no-verify bypasses the checks this repo runs. Run it without the flag.");
  if (target && rules.blockPushToProtected) return deny(`Pushing to ${target} is not allowed: it moves only through a reviewed ${requestNoun(state)}. Push your branch instead and open one with /agentic-teamwork:ship.`);
  const grant = plain ? grantFor(call, state, shellBranch) : null;
  if (grant) return { decision: "allow", reason: `Pushing ${branch} without asking: the person approved it ahead of time (branch.${branch}.agentic-engineering-push: "${grant}").` };
  if (!rules.askBeforePush) return null;
  return { decision: "ask", reason: `About to push from ${branch || "a detached HEAD"}. Pushing is the point where work leaves this machine, so confirm it is what you asked for.` };
}

/** The folder nearest `dir`, going up, that holds the repo-wide marker. No git call, so it is cheap on every command. */
function markedAbove(dir) {
  for (let at = path.resolve(dir), up = path.dirname(at); ; at = up, up = path.dirname(at)) {
    if (fs.existsSync(path.join(at, MANIFEST))) return at;
    if (up === at) return null;
  }
}

/** Record a test command for the stop gate: a lane's own command, the repo's `test.command`, or a known runner. */
function noteTestRun(payload, command, segments, shellCwd) {
  const marked = markedAbove(shellCwd);
  const config = marked ? loadConfig(marked) : null;
  // A lane's command can span segments (`cd server && npm test`), so lanes are looked for in the whole line.
  const lanes = lanesIn(command, { ...config?.lanes, ...(config?.test.command ? { [config.test.command]: config.test.command } : {}) });
  // A runner's name in a commit message is not a test run, so git's own segments are left out.
  const lines = segments.map(({ words }) => commandWords(words)).filter((words) => words.length && baseName(words[0]) !== "git").map(textOf);
  if (!lanes.length && !lines.some((line) => TEST_COMMAND.test(line))) return;
  if (modeFor(marked ?? repoRoot(payload)) === "none") return;
  recordTestRun(payload.session_id, command, lanes.filter((lane) => lane in (config?.lanes ?? {})));
}

// deny beats ask beats allow; a command that trips nothing has no decision.
const RANK = { allow: 1, ask: 2, deny: 3 };

function main() {
  const payload = readPayload();
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) return;
  const shellCwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  const segments = trackCwd(splitCommand(command), shellCwd, { home: os.homedir() });
  try { noteTestRun(payload, command, segments, shellCwd); } catch { /* a missed note is never a reason to stop a command */ }

  // Where the text no longer says which folder a command runs in, it is judged as the session's own.
  const calls = segments.flatMap((segment) => gitCalls(segment.words).map((call) => ({ ...call, dir: segment.cwd ?? shellCwd })));
  const judged = calls.filter((call) => call.verb === "commit" || call.verb === "push");
  if (!judged.length) return;
  const adds = calls.filter((call) => call.verb === "add");
  const set = assignments(segments.map((segment) => segment.words));
  const plain = plainPushCommand(command, segments);

  // Every call gets its own decision and the command takes the strongest, so
  // a granted push never carries an ungranted or a forbidden one with it.
  let verdict = null;
  let ungranted = false;
  for (const call of judged) {
    const state = repoState(call.dir);
    const governed = state && state.mode !== "none" && set.get(state.config.escapeHatch) !== "1";
    let decision = null;
    if (governed && call.verb === "commit") decision = judgeCommit(call, state, adds);
    // `-C` moves git and not the shell, so with one the shell's branch is not this repo's to read.
    if (governed && call.verb === "push") decision = judgePush(call, state, plain, call.dirs.length ? null : state.branch);
    if (call.verb === "push" && decision?.decision !== "allow") ungranted = true;
    if (decision && RANK[decision.decision] > (RANK[verdict?.decision] ?? 0)) verdict = decision;
  }
  if (!verdict) return;
  // An allow covers the whole shell call, so a push the guard has no say over
  // (a repo in mode none, a path that is no repo) must not ride along on it.
  if (verdict.decision === "allow" && ungranted) {
    verdict = { decision: "ask", reason: "This command also pushes somewhere no grant covers. Pushing is the point where work leaves this machine, so confirm it is what you asked for." };
  }
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason },
  }));
}

// process.exitCode, not process.exit: an exit while stdout drains can cut the
// decision short, and a host reads that as a crashed hook.
try { main(); } catch { /* fail open: a broken guard must never cost the person a command */ }
process.exitCode = 0;
