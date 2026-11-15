// The board's disk: where it is, how it is read, and how a change is written.
//
// Every worktree of a repo shares one board, in the main working tree's
// kanban folder (`paths.kanban` of .agents/agent-works.json, .agents/kanban
// unless it says otherwise); outside a repository the folder hangs from the
// project root. Cards are working state, so the folder is untracked unless
// the repo opts in: the first write adds it to the common git dir's
// info/exclude, which changes no tracked file and covers every worktree. A
// repo that sets `kanban.tracked`, or whose board already has committed files,
// is left alone.
//
// Every write goes through one lock, a file in the board's folder, so two
// writers never mint the same id and never interleave a change.
//
// Plan issues are read from the base branch, origin's copy first, with one
// ls-tree and one cat-file --batch: the merged truth, never a working tree, so
// a child's in-flight status flip cannot leak onto the board.
//
// The loop's other pieces of disk live here too: the push grants a claim
// writes to a branch's git config (and done or abandon takes back), what git
// knows about each card's work, and the calls that keep cards in step with a
// tracker's issues.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BoardError, boardConfig, lint, serializeConfig } from "../lib/board.mjs";
import { defaultBranch } from "../lib/brief.mjs";
import { nextId, parseCard, serializeCard } from "../lib/cards.mjs";
import {
  AwError, Finding, atomicWrite, currentBranch, exclusiveCreate, git, gitDir, mainRoot, posix, projectRoot, readText, realPath, rel, repoRoot,
} from "../lib/common.mjs";
import { DEFAULTS, OLD_BOARD, boardDir as configuredDir, configPath, loadConfig } from "../lib/config.mjs";
import { PLAN_PATHS, SHADOW_FILE, isPlanSource, planCards, shadowEmpty, shadowFile } from "../lib/plan.mjs";
import * as forge from "../lib/provider.mjs";
import {
  GITHUB_PROJECT_QUERY, cardFromIssue, decide, epicOfIssue, githubHad, githubIssue, githubIssuesQuery, githubLabels, githubParent, githubProject,
  gitlabBoard, gitlabFields, gitlabIssue, isEpicUrl, isLocalOnly, issueOfForge, linked, milestoneTitle, parentKeys, planOf, pulled, remoteHash,
  remoteKey, sprintOfIssue,
} from "../lib/sync.mjs";

/** The board's own settings, beside the cards. */
export const CONFIG_FILE = "board.json";
/** The lock every writer of a board folder takes. Held for milliseconds. */
export const LOCK_FILE = ".aw-kanban.lock";
const CARD_FILE = /^\d+-.*\.md$/;
const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
/** Block this thread for `ms`. */
export const sleepSync = (ms) => { Atomics.wait(SLEEPER, 0, 0, ms); };
/** Now in UTC with milliseconds, as cards are stamped: a sync compares these as text. */
export const stamp = () => new Date().toISOString();

// ---- where the board is -------------------------------------------------

function commonDirOf(root) {
  const g = gitDir(root);
  if (g === null) return null;
  const common = readText(path.join(g, "commondir"));
  return common ? realPath(path.resolve(g, common.trim())) : g;
}

/**
 * Where `cwd` stands: `{ cwd, toplevel, main, commonDir, branch, git, cfg, dir, isOld }`. `toplevel` is the work
 * tree `cwd` is in and `main` the main one (both the project root outside a repository, where `git` is false and
 * `commonDir` null); `cfg` is the repo's config as `loadConfig` gives it; `dir` is the board's folder and `isOld`
 * says it is the folder the board had before `paths.kanban`. Starts no process.
 */
export function locate(cwd) {
  const toplevel = repoRoot(cwd);
  const main = (toplevel && mainRoot(cwd)) ?? projectRoot(cwd);
  const cfg = loadConfig(cwd);
  const dir = configuredDir(cfg, main);
  return {
    cwd, toplevel: toplevel ?? main, main, commonDir: toplevel ? commonDirOf(toplevel) : null, branch: currentBranch(cwd), git: toplevel !== null, cfg, dir,
    isOld: dir === path.join(main, OLD_BOARD) && configPath(cfg, main, "kanban") !== dir,
  };
}

/** The board's folder for a place `locate` found. */
export const boardDir = (loc) => loc.dir;

// ---- reading ------------------------------------------------------------

/**
 * The board in a folder as the pure functions take it: `board.json`'s config, the `cards`, `errors` for the files
 * that look like cards and are none (`[{ file, message }]`), `exists`, and `dir`. Any `*.md` with a frontmatter
 * block and an id is a card; a file without frontmatter that is not named like one (a README) is passed over.
 */
export function readBoard(dir) {
  const errors = [];
  let json = {};
  let names = [];
  let exists = true;
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !SHADOW_FILE.test(f)).sort(); } catch { exists = false; }
  try { json = JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILE), "utf8")); } catch (e) {
    if (e.code !== "ENOENT" && e.code !== "ENOTDIR") errors.push({ file: CONFIG_FILE, message: `not valid JSON, so the defaults apply: ${e.message}`, said: true });
  }
  const cards = [];
  for (const file of names) {
    let text;
    try { text = fs.readFileSync(path.join(dir, file), "utf8"); } catch { continue; }
    try { cards.push(parseCard(text, file)); } catch (e) {
      if (CARD_FILE.test(file) || text.replace(/^\uFEFF/, "").startsWith("---")) errors.push({ file, message: e.message });
    }
  }
  return { ...boardConfig(json), cards, errors, exists, dir };
}

// ---- writing ------------------------------------------------------------

/**
 * Run `fn` as the one writer of a board folder, and give the lock back however `fn` ends. A lock a dead writer left
 * (older than ten seconds) is taken over; one still held after five seconds of trying is refused.
 */
export function withBoardLock(dir, fn) {
  const file = path.join(dir, LOCK_FILE);
  let held = false;
  for (let attempt = 0; attempt < 200 && !held; attempt++) {
    held = exclusiveCreate(file, String(process.pid));
    if (held) break;
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > 10_000) {
        fs.rmSync(file, { force: true });
        continue;
      }
    } catch { /* gone again: try at once */ }
    sleepSync(25);
  }
  if (!held) throw new AwError(`the kanban folder is locked by another writer (${LOCK_FILE})`);
  try {
    return fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Before a write: the folder exists, and unless the board is tracked, the repo's info/exclude names it. A board is
 * tracked when the config says `kanban.tracked`, or when git already holds files of its folder.
 */
export function ensureBoard(loc) {
  fs.mkdirSync(loc.dir, { recursive: true });
  if (!loc.git || !loc.commonDir || loc.cfg?.kanban?.tracked === true) return;
  const inside = path.relative(loc.main, loc.dir);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return;
  const line = `${posix(inside)}/`;
  const exclude = path.join(loc.commonDir, "info", "exclude");
  const text = readText(exclude) ?? "";
  if (text.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === `/${line}`)) return;
  const [listed, files] = git(["ls-files", "--", loc.dir], loc.main);
  if (listed !== 0 || files.trim()) return;
  if (git(["check-ignore", "-q", loc.dir], loc.main)[0] === 0) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.appendFileSync(exclude, `${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
}

/** A temp file in the same folder, then a rename over the target, so a reader never sees half a file. */
export const writeAtomic = atomicWrite;

/**
 * Write a change from the pure functions: each card to its own file (a card keeps the file it was read from), the
 * config to `board.json`, and each name in `remove` taken away. Returns the paths written.
 */
export function writeChange(dir, { cards = [], config, remove = [] } = {}) {
  const written = [];
  for (const card of cards) {
    if (card.source === "plan") throw new Error("a plan card reached a card write");
    const target = path.join(dir, path.basename(card.file));
    atomicWrite(target, serializeCard(card));
    written.push(target);
  }
  for (const name of remove) fs.rmSync(path.join(dir, path.basename(name)), { force: true });
  if (config) {
    atomicWrite(path.join(dir, CONFIG_FILE), serializeConfig(config));
    written.push(path.join(dir, CONFIG_FILE));
  }
  return written;
}

// ---- plan issues --------------------------------------------------------

const gitOut = (cwd, args, opts = {}) => execFileSync("git", ["-C", cwd, ...args], { stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts });
const hasRef = (loc, ref) => loc.git && git(["rev-parse", "--verify", "--quiet", ref], loc.toplevel)[0] === 0;

// The names the base branch may have, likeliest first: `default_branch` in the main checkout's
// .agents/manifest.json alone when it says one, else the config's `guard.defaultBranch.names`, else main.
function baseNames(loc) {
  try {
    const branch = JSON.parse(fs.readFileSync(path.join(loc.main, ".agents", "manifest.json"), "utf8")).default_branch;
    if (typeof branch === "string" && branch.trim()) return [branch.trim()];
  } catch { /* no manifest, or not JSON: the config's names */ }
  const names = loc.cfg?.guard?.defaultBranch?.names;
  const known = (Array.isArray(names) ? names : []).filter((n) => typeof n === "string" && n);
  return known.length ? known : ["main"];
}

/**
 * The base branch: `default_branch` in the main checkout's .agents/manifest.json, else the first of the config's
 * `guard.defaultBranch.names` this repo has, else main.
 */
export function planBase(loc) {
  const names = baseNames(loc);
  return names.find((n) => hasRef(loc, `refs/remotes/origin/${n}`) || hasRef(loc, `refs/heads/${n}`)) ?? names[0];
}

/**
 * The plan's issue files and dispatch plans on `origin/<base>`, else the local `<base>`: `{ ref, sources: [{ path,
 * text }] }`, with `ref` null when neither exists (or outside a repository). A ref that exists but carries no plan
 * is an empty plan, not a reason to fall back.
 */
export function readPlan(loc) {
  if (!loc.git) return { ref: null, sources: [] };
  for (const [ref, name] of baseNames(loc).flatMap((base) => [[`refs/remotes/origin/${base}`, `origin/${base}`], [`refs/heads/${base}`, base]])) {
    let listed;
    try { listed = gitOut(loc.toplevel, ["ls-tree", "-r", "-z", "--full-tree", ref, "--", ...PLAN_PATHS], { encoding: "utf8" }); } catch { continue; }
    const blobs = listed.split("\0").map((entry) => /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(entry)).filter((m) => m && isPlanSource(m[2]));
    if (!blobs.length) return { ref: name, sources: [] };
    const out = gitOut(loc.toplevel, ["cat-file", "--batch"], { input: `${blobs.map((m) => m[1]).join("\n")}\n` });
    // Each object comes back as "<oid> <type> <size>\n<size bytes>\n", in the order asked.
    const sources = [];
    let at = 0;
    for (const [, , file] of blobs) {
      const eol = out.indexOf(10, at);
      const size = Number(/ (\d+)$/.exec(out.subarray(at, eol).toString("utf8"))?.[1]);
      if (!Number.isFinite(size)) break;
      sources.push({ path: file, text: out.subarray(eol + 1, eol + 1 + size).toString("utf8") });
      at = eol + 1 + size + 1;
    }
    return { ref: name, sources };
  }
  return { ref: null, sources: [] };
}

/** The shadow files beside the cards, parsed and keyed by coordinates. */
export function readShadows(dir) {
  const shadows = {};
  const errors = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => SHADOW_FILE.test(f)).sort(); } catch { /* no board yet */ }
  for (const file of names) {
    try { shadows[SHADOW_FILE.exec(file)[1]] = parseCard(fs.readFileSync(path.join(dir, file), "utf8"), file); } catch (e) { errors.push({ file, message: e.message, said: true }); }
  }
  return { shadows, errors };
}

/** The board with the plan's issues on it: loose cards, then plan cards, `planRef` naming where they were read, and the `shadows`. */
export function readFullBoard(loc, plan = readPlan(loc)) {
  const board = readBoard(loc.dir);
  const { shadows, errors: shadowErrors } = readShadows(loc.dir);
  const { cards, errors } = planCards(plan.sources, { shadows, columns: board.columns });
  return {
    ...board, cards: [...board.cards, ...cards], planRef: plan.ref, shadows,
    errors: [...board.errors, ...shadowErrors, ...errors.map((e) => ({ ...e, path: e.file, said: true }))],
  };
}

/** Write a plan card's shadow, or remove it once it holds nothing. The caller holds the board lock. */
export function writeShadow(loc, shadow) {
  ensureBoard(loc);
  const file = path.join(loc.dir, shadowFile(shadow.plan));
  if (shadowEmpty(shadow)) fs.rmSync(file, { force: true });
  else atomicWrite(file, serializeCard(shadow));
  return file;
}

/**
 * Run the plan's own funnel in a card's worktree: `plan-status.mjs set <coords> <status>` with that worktree as
 * cwd, so the child's next commit carries the flip. The worktree must belong to this repo. Returns the funnel's
 * answer; its warnings go to `stderr`.
 */
export function runFunnel(loc, worktree, coords, status, stderr = process.stderr) {
  const wt = locate(worktree);
  if (!wt.git || wt.commonDir !== loc.commonDir) throw new BoardError("refused", `${coords} names worktree ${worktree}, which is not a worktree of this repo`);
  const script = path.join(wt.toplevel, ".agents", "plan", "plan", "plan-status.mjs");
  if (!fs.existsSync(script)) throw new BoardError("refused", `${wt.toplevel} has no .agents/plan/plan/plan-status.mjs to run`);
  const r = spawnSync(process.execPath, [script, "set", coords, status], { cwd: wt.toplevel, encoding: "utf8", windowsHide: true });
  if (r.stderr) stderr.write(r.stderr);
  if (r.status !== 0) throw new BoardError("refused", `plan-status.mjs set ${coords} ${status} failed in ${wt.toplevel} (exit ${r.status ?? r.signal})`);
  return r.stdout.trim();
}

// ---- push grants --------------------------------------------------------

const GRANT = "agentic-engineering-push";

/** Take back the push approval a claim gave the branch. Nothing set is fine. */
export function dropGrant(loc, branch) {
  if (branch && loc.git) git(["config", "--unset", `branch.${branch}.${GRANT}`], loc.toplevel);
}

/** Give a branch the push approval its card carries: what `claim` writes, and a push guard reads. */
export function writeGrant(loc, branch, text) {
  if (git(["config", `branch.${branch}.${GRANT}`, text], loc.toplevel)[0] !== 0) throw new BoardError("refused", `git could not record the push grant for ${branch}`);
}

/** Every push approval in the repo's git config, `[{ branch, text }]`. None is an empty list. */
export function readGrants(loc) {
  if (!loc.git) return [];
  const [code, out] = git(["config", "--get-regexp", `^branch\\..*\\.${GRANT}$`], loc.toplevel);
  if (code !== 0) return [];
  return out.split("\n").map((line) => new RegExp(`^branch\\.(.+)\\.${GRANT}(?: (.*))?$`).exec(line)).filter(Boolean)
    .map(([, branch, text]) => ({ branch, text: text ?? "" }));
}

// ---- lint ---------------------------------------------------------------

// A board the repo means to share (`kanban.tracked`) with nothing of it committed yet. A board that is not meant to
// be shared needs no finding: the next write puts its folder in info/exclude.
function untracked(loc) {
  if (!loc.git || loc.cfg?.kanban?.tracked !== true) return false;
  const [listed, files] = git(["ls-files", "--", loc.dir], loc.main);
  return listed === 0 && !files.trim();
}

const days = (cfg, key) => {
  const value = Number(cfg?.kanban?.[key] ?? DEFAULTS.kanban[key]);
  return Number.isFinite(value) ? value : DEFAULTS.kanban[key];
};

/**
 * What lint and the doctor report about the board at `cwd`, as findings. Never throws; an absent board has none.
 * `cli` is the command a message tells the person to type.
 */
export function findings(cwd, { now = Date.now(), cli = "aw board", loc = null, board = null } = {}) {
  const out = [];
  try {
    loc ??= locate(cwd);
    if (!fs.existsSync(loc.dir)) return out;
    const where = rel(loc.dir, loc.main);
    if (loc.isOld) {
      out.push(new Finding("KANBAN_OLD_FOLDER", "warning", where, 0,
        `the cards are still in ${OLD_BOARD}; move the folder to ${rel(configPath(loc.cfg, loc.main, "kanban"), loc.main)} (aw setup does it)`));
    }
    board ??= readFullBoard(loc);
    const found = lint(board, now, { staleDays: days(loc.cfg, "staleStartDays"), owedDays: days(loc.cfg, "gateOwedDays"), grants: readGrants(loc) });
    const pathOf = new Map((board.errors ?? []).filter((e) => e.path).map((e) => [e.file, e.path]));
    for (const f of found) {
      const file = f.file ? pathOf.get(f.file) ?? (/[\\/]/.test(f.file) ? f.file : `${where}/${f.file}`) : where;
      out.push(new Finding(f.code, f.level, file, 0, f.message.replaceAll("{cli}", cli)));
    }
    if (untracked(loc)) {
      out.push(new Finding("KANBAN_UNTRACKED", "warning", where, 0,
        "the config says the board is tracked (kanban.tracked) and git holds none of it: commit the folder, or drop the setting to keep the board on this machine"));
    }
  } catch { /* a board nobody can read has nothing to say here */ }
  return out;
}

// ---- evidence for a sweep -----------------------------------------------

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What git on this machine knows about each card's work. Local only, so fetch first. `{ base, cards }`: `base` is
 * the ref read (origin's copy first), and per card, in order, its `branch` (the card's, else the default a grant
 * would give it: `name`, `guessed`, `local`, `remote`, `ahead` of the base, `lastAt`), the `merge` that brought it
 * into the base (`sha`, `via`: a merge commit whose second parent is the branch tip, whose subject names the
 * branch, or a commit that names the card's pull or merge request), base commits that name the card (`mentions`) or
 * changed its files since it was filed (`touched`), and its `worktree` (`path`, `exists`, `branch`, `dirty`). One
 * ref listing and one log of the base for every card; a branch that exists adds a count, a card with files a log,
 * a worktree a status.
 */
export function cardFacts(loc, cards) {
  const run = (args, cwd = loc.toplevel) => {
    const [code, out] = loc.git ? git(args, cwd) : [1, ""];
    return code === 0 ? out : null;
  };
  const base = planBase(loc);
  const baseRef = hasRef(loc, `refs/remotes/origin/${base}`) ? `origin/${base}` : base;
  const refs = new Map();
  for (const row of (run(["for-each-ref", "--format=%(refname)%09%(objectname)%09%(committerdate:iso-strict)", "refs/heads", "refs/remotes/origin"]) ?? "").split("\n")) {
    const [ref, sha, at] = row.split("\t");
    if (ref) refs.set(ref, { sha, at });
  }
  const filed = cards.map((c) => Date.parse(c.created ?? "")).filter(Number.isFinite);
  const since = filed.length ? new Date(Math.min(...filed) - 24 * 60 * 60 * 1000).toISOString() : null;
  const log = (run(["log", baseRef, "-n", "5000", ...(since ? [`--since=${since}`] : []), "--format=%H%x1f%P%x1f%s%x1f%b%x1e"]) ?? "")
    .split("\x1e").map((e) => e.replace(/^\n/, "")).filter(Boolean)
    .map((e) => {
      const [sha, parents, subject, body = ""] = e.split("\x1f");
      return { sha, parents: parents.split(" ").filter(Boolean), subject, body };
    });
  const short = (e) => `${e.sha.slice(0, 10)} ${e.subject}`;

  const out = cards.map((card) => {
    const name = card.branch ?? defaultBranch(card);
    const local = refs.get(`refs/heads/${name}`);
    const remote = refs.get(`refs/remotes/origin/${name}`);
    const tip = (remote ?? local)?.sha;
    const ahead = tip ? Number(run(["rev-list", "--count", `${baseRef}..${tip}`])?.trim()) : null;
    const merges = log.filter((e) => e.parents.length > 1);
    const subject = new RegExp(`^Merge (?:branch '${escape(name)}'|pull request #\\d+ from \\S*[:/]${escape(name)}$)`);
    // A merge request is named in the merge commit's body; a pull request in its subject, or in a squash's `(#n)`.
    const mr = card.mr !== undefined
      ? (e) => new RegExp(`See merge request \\S*!${card.mr}\\b`).test(e.body) || new RegExp(`^Merge pull request #${card.mr}\\b|\\(#${card.mr}\\)$`).test(e.subject)
      : null;
    const byTip = tip ? merges.find((e) => e.parents.slice(1).includes(tip)) : null;
    const bySubject = merges.find((e) => subject.test(e.subject));
    const byNumber = mr ? log.find(mr) : null;
    const found = byTip ? { e: byTip, via: `merge of ${name} at its tip` }
      : bySubject ? { e: bySubject, via: bySubject.subject }
        : byNumber ? { e: byNumber, via: `the commit that names !${card.mr}` } : null;
    const id = new RegExp(`(^|[^\\w-])${escape(card.id)}([^\\w-]|$)`);
    const mentions = log.filter((e) => e.parents.length < 2 && (id.test(e.subject) || id.test(e.body))).slice(0, 5).map(short);
    const touched = card.files?.length
      ? (run(["log", baseRef, "-n", "5", ...(card.created ? [`--since=${card.created}`] : []), "--format=%h %s", "--", ...card.files]) ?? "").split("\n").filter(Boolean)
      : [];
    let worktree = null;
    if (card.worktree) {
      const exists = fs.existsSync(card.worktree);
      const status = exists ? (run(["status", "--porcelain=v1", "-b"], card.worktree) ?? "").split("\n").filter(Boolean) : [];
      const head = /^## (?:No commits yet on )?([^.\s]+)/.exec(status[0] ?? "")?.[1];
      worktree = { path: card.worktree, exists, branch: head && head !== "HEAD" ? head : null, dirty: Math.max(0, status.length - 1) };
    }
    return {
      branch: { name, guessed: !card.branch, local: Boolean(local), remote: Boolean(remote), ahead: Number.isInteger(ahead) ? ahead : null, lastAt: (remote ?? local)?.at ?? null },
      merge: found ? { sha: found.e.sha, via: found.via } : null,
      mentions, touched, worktree,
    };
  });
  return { base: baseRef, cards: out };
}

// ---- a tracker's issues -------------------------------------------------
//
// Both forges go through lib/provider.mjs, so every call is the person's own
// `gh` or `glab` login, pinned to the origin remote. `opts` is `{ run, env }`:
// a test passes a runner that answers from memory.

const failed = (what, r) => new AwError(`${what}: ${r.hint || r.detail || r.error}`, 1);
const must = (what, r) => {
  if (!r.ok) throw failed(what, r);
  return r.value;
};
const list = (v) => (Array.isArray(v) ? v : []);
const GONE = ["not-installed", "not-authenticated", "network", "rate-limited", "unknown-provider"];

/**
 * GitHub: issues, and the repository's most recent project board when it has one (columns are its Status options);
 * otherwise a `status:<column>` label per card. A sprint is a milestone of its title (made when missing, due on
 * the sprint's end); an epic's cards are its sub-issues, or carry an `epic:<id>` label where the server has none.
 */
function connectGithub(provider, board, opts) {
  const [owner, name] = String(provider.slug ?? "").split("/");
  if (!owner || !name) throw new AwError("the origin remote names no GitHub repository", 1);
  const gql = (query, more = {}) => forge.graphql(provider, query, { owner, name, ...more }, opts);
  let project = null;
  let notice = null;
  const found = gql(GITHUB_PROJECT_QUERY);
  if (found.ok) project = githubProject(list(found.value?.repository?.projectsV2?.nodes)[0]);
  else if (GONE.includes(found.error)) throw failed("gh", found);
  else notice = "No access to project boards, so columns sync as labels. To use a project board: gh auth refresh -s project";

  const columns = project?.columns ?? board.columns;
  const ctx = { project, columns };
  const done = columns.find((c) => c.role === "done")?.id ?? null;
  const items = new Map();
  const nodes = new Map();
  const ensured = new Set();
  let hasSubIssues = true;
  let milestones = null;

  const seen = (issue) => {
    if (issue?.nodeId) nodes.set(issue.number, issue.nodeId);
    if (issue?.itemId) items.set(issue.number, issue.itemId);
    return issue;
  };
  const ensureLabels = (labels) => {
    for (const label of labels.filter((l) => !ensured.has(l))) {
      forge.ensureLabel(provider, label, {}, opts);
      ensured.add(label);
    }
  };
  // The sprint's milestone, made when the repository has none of its title, its due date kept to the sprint's
  // end (noon UTC, so no time zone moves the day).
  const ensureMilestone = (sprint) => {
    const title = milestoneTitle(sprint);
    const due = `${sprint.end}T12:00:00Z`;
    if (milestones === null) {
      milestones = new Map();
      for (const one of list(must("gh milestones", forge.api(provider, "GET", "{project}/milestones?state=all&per_page=100", opts)))) {
        if (typeof one?.title === "string" && typeof one.number === "number") milestones.set(one.title, { number: one.number, due: String(one.due_on ?? "").slice(0, 10) });
      }
    }
    const had = milestones.get(title);
    if (had === undefined) {
      const body = { title, ...(sprint.end ? { due_on: due } : {}), ...(sprint.goal ? { description: sprint.goal } : {}) };
      const made = must(`gh milestone "${title}"`, forge.api(provider, "POST", "{project}/milestones", { ...opts, body }));
      milestones.set(title, { number: typeof made?.number === "number" ? made.number : 0, due: sprint.end });
    } else if (sprint.end && had.due !== sprint.end) {
      must(`gh milestone "${title}"`, forge.api(provider, "PATCH", `{project}/milestones/${had.number}`, { ...opts, body: { due_on: due } }));
      milestones.set(title, { ...had, due: sprint.end });
    }
    return title;
  };
  const nodeOf = (number) => {
    if (nodes.has(number)) return nodes.get(number);
    const data = must(`gh issue #${number}`, gql("query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { id } } }", { number }));
    const id = data?.repository?.issue?.id;
    if (typeof id !== "string") throw new AwError(`gh could not name issue #${number}`, 1);
    nodes.set(number, id);
    return id;
  };
  // Hangs the issue from its epic's issue, or takes it down; answers the parent it now has.
  const hang = (number, plan, had) => {
    const wanted = githubParent(plan, hasSubIssues);
    const was = had !== null && "number" in had ? had.number : null;
    if (wanted !== was && hasSubIssues) {
      const pair = (parent) => ({ issueId: nodeOf(parent), subIssueId: nodeOf(number) });
      if (wanted !== null) {
        must(`gh sub-issue #${number}`, forge.graphql(provider, "mutation($issueId: ID!, $subIssueId: ID!) { addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: true }) { issue { id } } }", pair(wanted), opts));
      } else {
        must(`gh sub-issue #${number}`, forge.graphql(provider, "mutation($issueId: ID!, $subIssueId: ID!) { removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) { issue { id } } }", pair(was), opts));
      }
    }
    return wanted === null ? (plan.epic === null ? null : { label: plan.epic.id }) : { number: wanted, isEpic: false };
  };
  // Puts the issue on the project board, in the card's column.
  const place = (card, number) => {
    if (!project) return;
    let item = items.get(number);
    if (item === undefined) {
      const added = forge.graphql(provider, "mutation($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }", { projectId: project.id, contentId: nodeOf(number) }, opts);
      item = added.ok ? added.value?.addProjectV2ItemById?.item?.id : undefined;
      if (typeof item !== "string") return;
      items.set(number, item);
    }
    const option = project.options.get(card.status);
    if (!option) return;
    must(`gh project item #${number}`, forge.graphql(provider,
      "mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }",
      { projectId: project.id, itemId: item, fieldId: project.fieldId, optionId: option }, opts));
  };
  const how = () => ({ hasProject: project !== null, hasSubIssues });

  return {
    name: "github",
    columns: project?.columns ?? null,
    notice,
    list() {
      // A server without sub-issues refuses the `parent` field: ask once without it, and say epics as labels.
      let r = gql(githubIssuesQuery(project !== null, hasSubIssues));
      if (!r.ok && hasSubIssues) {
        hasSubIssues = false;
        r = gql(githubIssuesQuery(project !== null, false));
      }
      return list(must("gh issues", r)?.repository?.issues?.nodes).map((node) => seen(githubIssue(node, ctx))).filter(Boolean);
    },
    create(card, plan) {
      const labels = githubLabels(card, plan, how());
      ensureLabels(labels);
      const milestone = plan.sprint === null ? undefined : ensureMilestone(plan.sprint);
      let made = must(`gh issue for card ${card.id}`, forge.createIssue(provider, { title: card.title, body: card.body ?? "", labels, milestone }, opts));
      place(card, made.number);
      if (card.status === done) made = must(`gh issue #${made.number}`, forge.updateIssue(provider, made.number, { state: "closed" }, opts));
      return issueOfForge(made, { status: card.status, parent: hang(made.number, plan, null) });
    },
    push(card, was, plan) {
      const wanted = githubLabels(card, plan, how());
      const had = githubHad(was, project !== null);
      const addLabels = wanted.filter((l) => !had.includes(l));
      ensureLabels(addLabels);
      const title = plan.sprint === null ? null : ensureMilestone(plan.sprint);
      const shouldBeOpen = card.status !== done;
      const now = must(`gh issue #${was.number}`, forge.updateIssue(provider, was.number, {
        title: card.title, body: card.body ?? "", addLabels, removeLabels: had.filter((l) => !wanted.includes(l)),
        ...(title === was.milestone ? {} : { milestone: title }),
        ...(shouldBeOpen === was.isOpen ? {} : { state: shouldBeOpen ? "open" : "closed" }),
      }, opts));
      place(card, was.number);
      return issueOfForge(now, { status: card.status, parent: hang(was.number, plan, was.parent) });
    },
  };
}

/**
 * GitLab: issues, and the project's first issue board when it has lists (each list is a label; Open and Closed
 * bracket them); otherwise a `status:<column>` label per card. A sprint is a milestone of its title (made when
 * missing, due on the sprint's end). Where the project's group has epics, an epic card is a group epic and its
 * cards' issues belong to it; elsewhere they carry an `epic:<id>` label.
 */
function connectGitlab(provider, board, opts) {
  const call = (method, apiPath, fields) => forge.api(provider, method, apiPath, { ...opts, ...(fields ? { fields } : {}) });
  const boards = call("GET", "{project}/boards");
  if (!boards.ok && GONE.includes(boards.error)) throw failed("glab", boards);
  const remote = gitlabBoard(boards.ok ? boards.value : null);

  // Epics live on the group (and need a tier that has them): a project in a user namespace, or a group that
  // answers no epics, keeps epics as labels.
  const project = call("GET", "{project}");
  const namespace = project.ok ? project.value?.namespace ?? {} : {};
  let group = null;
  if (namespace.kind === "group" && typeof namespace.id === "number") {
    const probe = call("GET", `groups/${namespace.id}/epics?per_page=1`);
    if (probe.ok && Array.isArray(probe.value)) group = `groups/${namespace.id}`;
  }

  const columns = remote?.columns ?? board.columns;
  const ctx = { board: remote, columns, hasEpics: group !== null };
  const done = columns.find((c) => c.role === "done")?.id ?? null;
  // A group epic's iid to its global id, which is what an issue names.
  const epicIds = new Map();
  let milestones = null;
  const seen = (raw, what) => {
    const issue = gitlabIssue(raw, ctx);
    if (issue?.isEpic && issue.globalId !== null) epicIds.set(issue.number, issue.globalId);
    if (issue?.parent && "number" in issue.parent && issue.epicId !== null) epicIds.set(issue.parent.number, issue.epicId);
    if (!issue && what) throw new AwError(`glab answered no issue for ${what}`, 1);
    return issue;
  };
  const ensureMilestone = (sprint) => {
    const title = milestoneTitle(sprint);
    if (milestones === null) {
      milestones = new Map();
      for (const one of list(must("glab milestones", call("GET", "{project}/milestones?per_page=100&include_ancestors=true")))) {
        if (typeof one?.title === "string" && typeof one.id === "number") milestones.set(one.title, { id: one.id, due: String(one.due_date ?? "") });
      }
    }
    const had = milestones.get(title);
    if (had !== undefined) {
      if (sprint.end && had.due !== sprint.end) {
        call("PUT", `{project}/milestones/${had.id}`, { due_date: sprint.end });
        milestones.set(title, { ...had, due: sprint.end });
      }
      return had.id;
    }
    const made = must(`glab milestone "${title}"`, call("POST", "{project}/milestones", { title, ...(sprint.end ? { due_date: sprint.end } : {}), ...(sprint.goal ? { description: sprint.goal } : {}) }));
    if (typeof made?.id !== "number") throw new AwError(`glab made no milestone for sprint ${sprint.id}`, 1);
    milestones.set(title, { id: made.id, due: sprint.end });
    return made.id;
  };
  // The group epic the card's issue belongs to, when its epic is one; null leaves it to a label.
  const epicOf = (plan) => (group !== null && plan.epic?.remote?.isEpic ? epicIds.get(plan.epic.remote.number) ?? null : null);
  const fieldsOf = (card, plan, was) => gitlabFields(card, plan, was, {
    board: remote, epicId: epicOf(plan), milestoneId: plan.sprint === null ? null : ensureMilestone(plan.sprint),
  });
  const plain = (card) => ({ title: card.title, description: card.body ?? "", labels: (card.labels ?? []).join(",") });

  return {
    name: "gitlab",
    columns: remote?.columns ?? null,
    notice: null,
    list() {
      const issues = list(must("glab issues", call("GET", "{project}/issues?per_page=100&order_by=updated_at&sort=desc")));
      const epics = group === null ? [] : list(must("glab epics", call("GET", `${group}/epics?per_page=100&order_by=updated_at&sort=desc`)));
      return [...issues, ...epics].map((raw) => seen(raw)).filter(Boolean);
    },
    create(card, plan) {
      const epic = group !== null && card.kind === "epic";
      const where = epic ? `${group}/epics` : "{project}/issues";
      const made = seen(must(`glab issue for card ${card.id}`, call("POST", where, epic ? plain(card) : fieldsOf(card, plan))), card.title);
      if (card.status !== done) return made;
      return seen(must(`glab issue ${made.number}`, call("PUT", `${where}/${made.number}`, { state_event: "close" })), card.title);
    },
    push(card, was, plan) {
      const shouldBeOpen = card.status !== done;
      const state = shouldBeOpen === was.isOpen ? {} : { state_event: shouldBeOpen ? "reopen" : "close" };
      if (group !== null && was.isEpic) return seen(must(`glab epic ${was.number}`, call("PUT", `${group}/epics/${was.number}`, { ...plain(card), ...state })), card.title);
      return seen(must(`glab issue ${was.number}`, call("PUT", `{project}/issues/${was.number}`, { ...fieldsOf(card, plan, was), ...state })), card.title);
    },
  };
}

/** Which tracker the origin remote is, with no call to it: the forge layer's provider (`kind` null when it is neither). */
export function detectRemote(loc, opts = {}) {
  return forge.detect(loc.main, opts);
}

const keyOf = (card) => (card.remote ? remoteKey(card.remote.number, isEpicUrl(card.remote.url)) : null);

/**
 * Where the board stands with its tracker, with no call to it: `{ enabled, provider, repo, linked, unlinked,
 * changed }`. `unlinked` counts the cards a first pass would open an issue for, `changed` the linked cards that
 * differ from what was last synced.
 */
export function remoteStatus(loc, board, opts = {}) {
  const provider = detectRemote(loc, opts);
  const open = board.cards.filter((c) => c.source !== "plan" && !isLocalOnly(c));
  return {
    enabled: board.remote?.enabled === true, provider: provider.kind, repo: provider.slug,
    linked: board.cards.filter((c) => c.remote).length,
    unlinked: open.filter((c) => !c.remote).length,
    changed: open.filter((c) => c.remote && remoteHash(c) !== c.remote.syncedHash).length,
  };
}

/**
 * One two-way pass between the cards and the tracker's issues. A card with no issue gets one; a linked card is
 * pushed when only it changed, pulled when only the issue did, and the newer side wins when both did; an open issue
 * with no card becomes one. Suggested and archived cards are never pushed. Epics go first, so a card can name its
 * epic's issue as its parent in the same pass; an issue other issues hang from comes in as an epic. A remote board's
 * columns become the board's. Gives `{ provider, pushed, pulled, created, skipped, columns, notices }`. With
 * `dryRun` nothing is created, pushed or written, and the counts say what would be.
 */
export function remoteSync(loc, { run, env = process.env, dryRun = false } = {}) {
  const opts = { run, env };
  let board = readBoard(loc.dir);
  if (!board.remote.enabled) throw new AwError("sync with a tracker is off for this board: {cli} remote on turns it on", 1);
  const target = detectRemote(loc, opts);
  if (!target.kind) throw new AwError("the origin remote is neither GitHub nor GitLab (or the repository has none)", 1);
  const provider = (target.kind === "github" ? connectGithub : connectGitlab)(target, board, opts);
  const notices = provider.notice ? [provider.notice] : [];
  const adopted = Boolean(provider.columns) && JSON.stringify(provider.columns) !== JSON.stringify(board.columns);
  if (adopted) board = { ...board, columns: provider.columns };

  const issues = new Map(provider.list().map((issue) => [remoteKey(issue.number, issue.isEpic), issue]));
  const writes = [];
  const byId = new Map(board.cards.map((c) => [c.id, c]));
  const write = (card) => {
    writes.push(card);
    byId.set(card.id, card);
  };
  const said = new Set();
  const sprintFor = (issue, fallback) => {
    const { sprint, unmatched } = sprintOfIssue(board, issue, fallback);
    if (unmatched !== null && !said.has(unmatched)) {
      said.add(unmatched);
      notices.push(`milestone "${unmatched}" matches no sprint on this board; left as it is.`);
    }
    return sprint;
  };
  let pushed = 0;
  let pulledCount = 0;

  const isEpicCard = (c) => c.kind === "epic";
  for (const card of [...board.cards.filter(isEpicCard), ...board.cards.filter((c) => !isEpicCard(c))]) {
    if (!card.remote) {
      if (isLocalOnly(card)) continue;
      if (!dryRun) write(linked(card, provider.name, provider.create(card, planOf(card, board, byId))));
      pushed++;
      continue;
    }
    const issue = issues.get(keyOf(card) ?? "");
    if (!issue || isLocalOnly(card)) continue;
    const theirs = pulled(card, provider.name, issue, {
      sprint: sprintFor(issue, card.sprint ?? ""),
      epic: isEpicCard(card) ? card.epic ?? "" : epicOfIssue([...byId.values()], issue, card.epic ?? ""),
    });
    const verdict = decide(card, issue, theirs);
    if (verdict === "touch") write(theirs);
    else if (verdict === "push") {
      if (!dryRun) write(linked(card, provider.name, provider.push(card, issue, planOf(card, board, byId))));
      pushed++;
    } else if (verdict === "pull") {
      write(theirs);
      pulledCount++;
    }
  }

  const known = new Set(board.cards.flatMap((c) => keyOf(c) ?? []));
  const parents = parentKeys([...issues.values()]);
  const fresh = [...issues].filter(([key, issue]) => !known.has(key) && issue.isOpen)
    .sort(([a], [b]) => Number(parents.has(b)) - Number(parents.has(a)));
  if (dryRun) return { provider: provider.name, pushed, pulled: pulledCount + fresh.length, created: fresh.length, skipped: 0, columns: adopted, notices, dryRun: true };

  // The calls are done; the cards are written in one hold of the lock, against the board as it stands now.
  let skipped = 0;
  const created = [];
  ensureBoard(loc);
  withBoardLock(loc.dir, () => {
    const now = readBoard(loc.dir);
    const current = new Map(now.cards.map((c) => [c.id, c]));
    const before = new Map(board.cards.map((c) => [c.id, c]));
    // A card someone changed while the calls ran keeps their change; the next pass settles it.
    const safe = writes.filter((c) => {
      const same = (current.get(c.id)?.updated ?? "") === (before.get(c.id)?.updated ?? "") && current.has(c.id);
      if (!same) skipped++;
      return same;
    });
    const all = [...now.cards.filter((c) => !safe.some((s) => s.id === c.id)), ...safe];
    for (const [key, issue] of fresh) {
      const status = issue.status ?? board.columns[0]?.id ?? "backlog";
      const parent = issue.isEpic || parents.has(key);
      const card = cardFromIssue(nextId(all), provider.name, issue, {
        status, order: all.filter((c) => c.status === status).length, kind: parent ? "epic" : "task",
        epic: parent ? "" : epicOfIssue(all, issue, ""), sprint: sprintFor(issue, ""),
      });
      all.push(card);
      safe.push(card);
      created.push(card.id);
    }
    writeChange(loc.dir, { cards: safe, ...(adopted ? { config: { ...now, columns: provider.columns } } : {}) });
  });
  return { provider: provider.name, pushed, pulled: pulledCount + created.length, created: created.length, skipped, columns: adopted, notices, dryRun: false };
}
