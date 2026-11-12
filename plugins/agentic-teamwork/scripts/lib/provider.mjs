// provider.mjs: one layer over the two forge CLIs, GitHub's `gh` and GitLab's `glab`.
//
// A caller asks for a change request (a pull request or a merge request) or an
// issue. This module knows which CLI says it and with which flags, and hands
// back the same plain object for both forges. GitHub goes through
// `gh <noun> <verb> --json <fields>`. GitLab goes through `glab api` (REST v4):
// the API's field names are the stable part of glab, its subcommand flags are not.
//
// Self-contained on purpose: Node stdlib only, so the file can be copied as is.
// It reads no token and opens no socket. Signing in is whatever the person
// already did with the CLI.
//
// The runner contract. Every process this module starts (gh, glab, git, ssh)
// goes through one synchronous function, injectable as `run` in the last
// argument of every export:
//
//   run(cmd, argv, { cwd, input, env }) -> { status, stdout, stderr, code? }
//
//   cmd, argv  the program and its arguments as an array. Never a shell string.
//   cwd        the directory to run in, or undefined.
//   input      text for stdin, or undefined. Titles are argv values; bodies and
//              comments go here (`--body-file -`, or a JSON body for the API).
//   env        the complete environment for the child, already built here.
//   status     the exit code, or null when the program never ran or was killed.
//   code       optional: the spawn error code, "ENOENT" when the program is
//              not on PATH, "ETIMEDOUT" when it ran out of time.
//
// The result contract. Nothing here throws for a failed call. Every operation
// returns one of:
//
//   { ok: true, value }
//   { ok: false, error, hint, detail, status }
//
// `error` is one of ERROR_KINDS, `hint` is one line a person can act on,
// `detail` is the CLI's own first lines, `status` is the HTTP status when the
// CLI reported one. `detect`, `parseRemote` and `cliPath` are the exceptions:
// they answer with nulls rather than a result, because "unknown" is an answer.
//
// Pinning. A provider from `detect` carries the host and the slug of the
// `origin` remote, and every call names them (`-R [HOST/]OWNER/REPO` and
// `--hostname` for gh, GITLAB_HOST and an encoded project path for glab), so a
// call means the same repository from any directory. No self-hosted host is
// assumed: with no host known, the CLI falls back to its own configuration.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** What differs between the forges that is not a CLI call: names, nouns, the CI file. */
export const FORGES = Object.freeze({
  github: Object.freeze({
    kind: "github", cli: "gh", host: "github.com", noun: "pull request", short: "PR",
    ciName: "GitHub Actions", ciFile: ".github/workflows/ci.yml",
    createCommand: "gh pr create", viewCommand: "gh pr view --web", install: "https://cli.github.com",
  }),
  gitlab: Object.freeze({
    kind: "gitlab", cli: "glab", host: "gitlab.com", noun: "merge request", short: "MR",
    ciName: "GitLab CI", ciFile: ".gitlab-ci.yml",
    createCommand: "glab mr create", viewCommand: "glab mr view --web", install: "https://gitlab.com/gitlab-org/cli#installation",
  }),
});

/** Every value `error` can take on a failed result. */
export const ERROR_KINDS = Object.freeze([
  "not-installed", "not-authenticated", "not-found", "rate-limited", "network",
  "forbidden", "exists", "refused", "unknown-provider", "invalid", "failed",
]);

const RUN_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 32 * 1024 * 1024;
// A hook does not inherit an interactive shell's PATH, so the usual install
// locations are searched after it. Appended, and only where they exist.
const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const IS_WINDOWS = process.platform === "win32";

const text = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const lower = (v) => text(v).toLowerCase();
const upper = (v) => text(v).toUpperCase();
const list = (v) => (Array.isArray(v) ? v : []);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
/** A body as both forges should compare it: LF line endings, no outer whitespace. */
const bodyText = (v) => text(v).replace(/\r\n/g, "\n").trim();
/** Names out of a list of strings or of objects carrying the name under `key`. */
const names = (v, key) => list(v).map((x) => (typeof x === "string" ? x : text(x?.[key]))).filter(Boolean);

const ok = (value) => ({ ok: true, value });
const fail = (error, hint, more = {}) => ({ ok: false, error, hint, detail: more.detail ?? "", status: more.status ?? null });

// ---------------------------------------------------------------------------
// Running things

/** The default runner: spawnSync with an argv array, no shell, a 60 second limit. */
export function defaultRun(cmd, argv, { cwd, input, env } = {}) {
  const r = spawnSync(cmd, argv, {
    cwd, input, env, encoding: "utf8", shell: false, windowsHide: true,
    timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_BUFFER, stdio: ["pipe", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.error?.code ?? null };
}

/** Calls the runner and squares its answer, so a runner that throws reads as a failed call. */
function invoke(run, cmd, argv, options) {
  try {
    const r = (run ?? defaultRun)(cmd, argv, options) ?? {};
    return { status: r.status ?? null, stdout: text(r.stdout), stderr: text(r.stderr), code: r.code ?? null };
  } catch (e) {
    return { status: null, stdout: "", stderr: text(e?.message), code: e?.code ?? null };
  }
}

const pathKey = (env) => (IS_WINDOWS ? Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "Path" : "PATH");

/** The directories a CLI is looked for in: PATH, then the usual install locations. */
function searchDirs(env) {
  const dirs = text(env[pathKey(env)]).split(path.delimiter).filter(Boolean);
  if (IS_WINDOWS) return dirs;
  return [...dirs, ...EXTRA_DIRS.filter((d) => !dirs.includes(d) && isDir(d))];
}

/** The environment a forge CLI runs in: no prompts, no color, the host pinned. */
function childEnv(provider, base = process.env) {
  const env = { ...base, NO_COLOR: "1" };
  const dirs = IS_WINDOWS ? [] : searchDirs(base);
  if (dirs.length) env.PATH = dirs.join(path.delimiter);
  if (provider.cli === "glab") {
    env.NO_PROMPT = "1";
    if (provider.host) env.GITLAB_HOST = provider.host;
  } else {
    env.GH_PROMPT_DISABLED = "1";
    env.GH_NO_UPDATE_NOTIFIER = "1";
  }
  return env;
}

/** The full path of `cmd` on PATH (PATHEXT on Windows), or null. Starts no process. */
export function cliPath(cmd, env = process.env) {
  const exts = IS_WINDOWS ? text(env.PATHEXT ?? env.Pathext ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of searchDirs(env)) {
    for (const ext of exts) {
      const file = path.join(dir, cmd + ext);
      try {
        if (!fs.statSync(file).isFile()) continue;
        if (!IS_WINDOWS) fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch { /* not here, or not executable: keep looking */ }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Failures

const UNREACHABLE = /no such host|i\/o timeout|dial tcp|connection refused|connection reset|TLS handshake timeout|context deadline exceeded|network is unreachable|could not resolve host|error connecting to|check your internet connection/i;
const SIGNED_OUT = /gh auth login|glab auth login|not logged in|not (?:been )?authenticated|authentication (?:required|failed)|bad credentials|unauthorized|no token/i;
const RATE_LIMITED = /rate limit|too many requests|abuse detection/i;
const EXISTS = /already exists|has already been taken/i;
const MISSING = /could not resolve to an?|not found|no (?:open )?(?:pull|merge) requests? (?:found|match)/i;
const REFUSED = /not mergeable|cannot be merged|merge conflict|head branch was modified|method not allowed/i;
const DENIED = /resource not accessible|insufficient|forbidden|permission/i;
const HTML = /<html|<!doctype html|<title>/i;

/** The HTTP status a CLI reported, from "(HTTP 404)", "HTTP 404:" or a "404 Not Found" message. */
function httpStatus(t) {
  const m = /\bHTTP (\d{3})\b/.exec(t) ?? /"message":\s*"(\d{3}) /.exec(t) ?? /^(?:gh|glab): (\d{3}) /m.exec(t);
  return m ? Number(m[1]) : null;
}

function errorKind(r, http, t, cli) {
  if (r.code === "ENOENT" || r.status === 127) return "not-installed";
  if (r.code === "ETIMEDOUT") return "network";
  if (http === 429 || RATE_LIMITED.test(t)) return "rate-limited";
  // A 403 with an HTML body came from a proxy or a gateway in front of the
  // forge, not from its API: it reads like a permissions problem and is not one.
  if ((http === 403 && HTML.test(t)) || [502, 503, 504].includes(http) || UNREACHABLE.test(t)) return "network";
  if (http === 401 || (cli === "gh" && r.status === 4) || SIGNED_OUT.test(t)) return "not-authenticated";
  if (EXISTS.test(t)) return "exists";
  if (http === 404 || MISSING.test(t)) return "not-found";
  if ([405, 409, 422].includes(http) || REFUSED.test(t)) return "refused";
  if (http === 403 || DENIED.test(t)) return "forbidden";
  return "failed";
}

function hintFor(kind, provider, cli, detail) {
  const forge = FORGES[provider?.kind];
  const host = provider?.host ?? forge?.host ?? "the forge";
  const repo = provider?.slug ? `${host}/${provider.slug}` : host;
  const login = `${cli} auth login${provider?.host ? ` --hostname ${provider.host}` : ""}`;
  switch (kind) {
    case "not-installed": return `${cli} is not installed or not on PATH. Install it (${forge?.install ?? "see its documentation"}), then run: ${login}`;
    case "not-authenticated": return `${cli} is not signed in to ${host}. Run: ${login}`;
    case "not-found": return `${repo} has nothing at that number or path, or this account cannot see it.`;
    case "rate-limited": return `${host} is rate limiting this account. Wait a minute, then retry.`;
    case "network": return `${cli} could not reach ${host}. Check the network or proxy, then retry.`;
    case "forbidden": return `The account ${cli} is signed in as is not allowed to do this on ${repo}.`;
    case "exists": return `${repo} already has one: ${detail.split("\n")[0]}`;
    case "refused": return `${host} refused: ${detail.split("\n")[0] || "the request cannot be done in the current state"}`;
    default: return `${cli} failed: ${detail.split("\n")[0] || "no message"}`;
  }
}

/** Turns a failed runner answer into `{ ok: false, error, hint, detail, status }`. */
export function classifyFailure(result, provider = null, cli = cliOf(provider)) {
  const r = { status: result?.status ?? null, stdout: text(result?.stdout), stderr: text(result?.stderr), code: result?.code ?? null };
  const all = `${r.stderr}\n${r.stdout}`;
  const http = httpStatus(all);
  const detail = (r.stderr.trim() || r.stdout.trim() || (r.code ? `${cli}: ${r.code}` : `exit ${r.status}`)).split(/\r?\n/).slice(0, 3).join("\n").slice(0, 400);
  const kind = errorKind(r, http, all, cli);
  return fail(kind, hintFor(kind, provider, cli, detail), { detail, status: http });
}

const invalid = (hint) => fail("invalid", hint);
const unknownProvider = () => fail("unknown-provider", 'This repository\'s forge is not known. Pass kind: "github" or "gitlab" to detect().');
const cliOf = (provider) => provider?.cli ?? FORGES[provider?.kind]?.cli ?? "the CLI";
const io = (opts = {}) => ({ run: opts.run, env: opts.env, cwd: opts.cwd });

/** Runs the provider's CLI; answers its stdout, or the classified failure. */
function exec(provider, argv, opts = {}, input) {
  const forge = FORGES[provider?.kind];
  if (!forge) return unknownProvider();
  const cli = cliOf(provider);
  const r = invoke(opts.run, cli, argv, { cwd: opts.cwd ?? provider.root ?? undefined, input, env: childEnv({ ...provider, cli }, opts.env) });
  return r.status === 0 ? ok(r.stdout) : classifyFailure(r, provider, cli);
}

function execJson(provider, argv, opts, input) {
  const r = exec(provider, argv, opts, input);
  if (!r.ok) return r;
  const out = r.value.trim();
  if (out === "") return ok(null);
  try {
    return ok(JSON.parse(out));
  } catch {
    return fail("failed", `${cliOf(provider)} answered something that is not JSON.`, { detail: out.slice(0, 200) });
  }
}

const numberOf = (n) => (/^[1-9]\d*$/.test(String(n)) ? String(n) : null);
const badNumber = (n, provider) => invalid(`${JSON.stringify(n ?? null)} is not ${provider?.kind === "gitlab" ? "an iid" : "a number"}: pass a positive integer.`);
/** A value that would read as a flag where the CLI expects a name. */
const flagLike = (v) => text(v).startsWith("-");

// ---------------------------------------------------------------------------
// Detection

/**
 * Splits a git remote URL into `{ host, slug, ssh }`, or null for a local path.
 * https, ssh:// and scp forms; credentials, the `.git` suffix and an ssh port are dropped.
 */
export function parseRemote(url) {
  const s = text(url).trim();
  let host, rest, ssh = false;
  const full = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)(?::(\d+))?\/(.+)$/i.exec(s);
  const scp = full ? null : /^(?:[^@/\\:]+@)?([^@/\\:]{2,}):(?!\/\/)(.+)$/.exec(s);
  if (full) {
    const scheme = full[1].toLowerCase();
    if (scheme === "file") return null;
    ssh = scheme.includes("ssh");
    // An https port is part of where the API lives; an ssh port is not.
    const port = /^https?$/.test(scheme) && full[3] && !["80", "443"].includes(full[3]) ? `:${full[3]}` : "";
    host = full[2].toLowerCase() + port;
    rest = full[4];
  } else if (scp) {
    ssh = true;
    host = scp[1].toLowerCase();
    rest = scp[2];
  } else return null;
  if (!/^[a-z0-9][a-z0-9._-]*(?::\d+)?$/.test(host)) return null;
  const slug = rest.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return { host, slug: /^[^/\s]+(?:\/[^/\s]+)+$/.test(slug) ? slug : null, ssh };
}

/** Which forge a host name says it is: the public hosts, their ssh fronts, or a name that carries the word. */
function kindOfHost(host) {
  const h = text(host).replace(/:\d+$/, "");
  if (h.endsWith(".ghe.com") || h.includes("github")) return "github";
  if (h.includes("gitlab")) return "gitlab";
  return null;
}

const bareHost = (v) => lower(v).replace(/^[a-z]+:\/\//, "").replace(/\/+$/, "");

/**
 * Names the forge behind `root`'s remote: `{ kind, cli, host, slug, noun, short, root }`.
 * Pass `kind` (and `host`, `slug`) for a host whose name says nothing. Unknown is nulls, never a throw.
 */
export function detect(root, { env = process.env, run, remote = "origin", kind, host, slug } = {}) {
  const found = { host: null, slug: null, ssh: false };
  if (!flagLike(remote)) {
    // `git remote get-url` answers the URL after insteadOf rewrites, which is the one git uses.
    const r = invoke(run, "git", ["remote", "get-url", remote], { cwd: root ?? undefined, env });
    if (r.status === 0) Object.assign(found, parseRemote(r.stdout.trim().split(/\r?\n/)[0]) ?? {});
  }
  // An alias often says which forge it is for ("github-work") even when nothing can resolve it.
  const named = kindOfHost(found.host);
  // An ssh host with no dot, or one that names no forge, may be an alias from the
  // person's ssh config. `ssh -G` prints what it resolves to without connecting.
  if (found.ssh && found.host && (!found.host.includes(".") || !named)) {
    const r = invoke(run, "ssh", ["-G", found.host], { cwd: root ?? undefined, env });
    const real = r.status === 0 ? /^hostname\s+(\S+)/im.exec(r.stdout)?.[1]?.toLowerCase() : null;
    if (real) found.host = real;
    // An alias nothing could resolve is not a host to pin calls to.
    else if (!found.host.includes(".")) found.host = null;
  }
  if (found.host && /(^|\.)github\.com$/.test(found.host)) found.host = "github.com";
  if (found.host && /(^|\.)gitlab\.com$/.test(found.host)) found.host = "gitlab.com";

  const fromEnv = found.host === null ? null
    : bareHost(env.GH_HOST) === found.host ? "github"
    : [bareHost(env.GITLAB_HOST), bareHost(env.GL_HOST)].includes(found.host) ? "gitlab"
    : null;
  const forge = FORGES[kind] ?? FORGES[kindOfHost(found.host) ?? named ?? fromEnv] ?? null;
  return {
    kind: forge?.kind ?? null,
    cli: forge?.cli ?? null,
    host: (host ? bareHost(host) : found.host) ?? null,
    slug: slug ?? found.slug ?? null,
    noun: forge?.noun ?? null,
    short: forge?.short ?? null,
    root: root ?? null,
  };
}

/** The checked-out branch of `root`; a detached HEAD is an `invalid` failure. */
export function currentBranch(root, { run, env = process.env } = {}) {
  const r = invoke(run, "git", ["branch", "--show-current"], { cwd: root ?? undefined, env });
  if (r.status !== 0) {
    const detail = (r.stderr.trim() || `exit ${r.status}`).split(/\r?\n/)[0];
    return r.code === "ENOENT" ? fail("not-installed", "git is not installed or not on PATH.") : fail("failed", `git could not name the current branch: ${detail}`, { detail });
  }
  const branch = r.stdout.trim();
  return branch ? ok(branch) : invalid("No branch is checked out (detached HEAD): name the source branch.");
}

// ---------------------------------------------------------------------------
// Readiness: two cheap checks, kept apart because different people fix them

/** Whether the provider's CLI is on PATH: `{ cli, path }`, or `not-installed` with the install line. Starts no process. */
export function checkCli(provider, { env = process.env } = {}) {
  const forge = FORGES[provider?.kind];
  if (!forge) return unknownProvider();
  const cli = cliOf(provider);
  const found = cliPath(cli, env);
  return found ? ok({ cli, path: found }) : fail("not-installed", hintFor("not-installed", provider, cli, ""));
}

/** Whether the CLI is signed in to the provider's host: `{ host, account }`, or why not. Asks `auth status`, which masks the token. */
export function authStatus(provider, opts = {}) {
  const r = exec(provider, ["auth", "status", ...(provider?.host ? ["--hostname", provider.host] : [])], opts);
  if (r.ok) {
    return ok({ host: provider.host ?? null, account: /Logged in to \S+ (?:account|as) (\S+)/.exec(r.value)?.[1] ?? null });
  }
  // `auth status` exits non-zero for one reason unless the failure says otherwise.
  if (["not-installed", "network", "rate-limited", "unknown-provider"].includes(r.error)) return r;
  return fail("not-authenticated", hintFor("not-authenticated", provider, cliOf(provider), r.detail), { detail: r.detail, status: r.status });
}

// ---------------------------------------------------------------------------
// The raw API, for what the operations below do not cover

/** `repos/OWNER/REPO` or `projects/<encoded path>`: what `{project}` stands for in an API path. */
function projectRef(provider) {
  if (provider.kind === "github") return `repos/${provider.slug ?? "{owner}/{repo}"}`;
  return `projects/${provider.projectId ?? (provider.slug ? encodeURIComponent(provider.slug) : ":id")}`;
}

const queryString = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

function rest(provider, method, apiPath, opts = {}, body, extra = {}) {
  if (!FORGES[provider?.kind]) return unknownProvider();
  const argv = ["api", "-X", upper(method), text(apiPath).replaceAll("{project}", projectRef(provider))];
  if (provider.kind === "github" && provider.host && provider.host !== FORGES.github.host) argv.push("--hostname", provider.host);
  for (const [k, v] of Object.entries(extra.fields ?? {})) argv.push("-f", `${k}=${v}`);
  if (body !== undefined) argv.push("-H", "Content-Type: application/json", "--input", "-");
  const input = body === undefined ? undefined : JSON.stringify(body);
  return extra.raw ? exec(provider, argv, opts, input) : execJson(provider, argv, opts, input);
}

/**
 * One REST call through `gh api` or `glab api`; `{project}` in the path is this repository.
 * `fields` become `-f key=value`, `body` is sent as JSON on stdin, `raw` answers text.
 */
export function api(provider, method, apiPath, { fields, body, raw = false, ...opts } = {}) {
  return rest(provider, method, apiPath, io(opts), body, { fields, raw });
}

/** Every page of a list endpoint as one array, up to `max` items. */
export function apiPaged(provider, apiPath, { perPage = 100, max = 1000, ...opts } = {}) {
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const r = rest(provider, "GET", `${apiPath}${apiPath.includes("?") ? "&" : "?"}per_page=${perPage}&page=${page}`, io(opts));
    if (!r.ok) return r;
    const batch = list(r.value);
    out.push(...batch);
    if (batch.length < perPage) break;
  }
  return ok(out.slice(0, max));
}

/** One GraphQL call; answers `data`. String variables go as `-f`, numbers and booleans as typed `-F`. */
export function graphql(provider, queryText, variables = {}, opts = {}) {
  if (!FORGES[provider?.kind]) return unknownProvider();
  const argv = ["api", "graphql"];
  if (provider.kind === "github" && provider.host && provider.host !== FORGES.github.host) argv.push("--hostname", provider.host);
  argv.push("-f", `query=${queryText}`);
  for (const [k, v] of Object.entries(variables)) argv.push(typeof v === "string" ? "-f" : "-F", `${k}=${v}`);
  const r = execJson(provider, argv, io(opts));
  if (!r.ok) return r;
  const first = list(r.value?.errors)[0];
  if (first) return fail("failed", `${cliOf(provider)} graphql: ${text(first.message) || "the query was refused"}`, { detail: text(first.message) });
  return ok(r.value?.data ?? null);
}

/** `-R [HOST/]OWNER/REPO` for a gh subcommand, when the slug is known. */
function repoFlag(provider) {
  if (!provider.slug) return [];
  return ["-R", provider.host && provider.host !== FORGES.github.host ? `${provider.host}/${provider.slug}` : provider.slug];
}

const repeat = (flag, values) => list(values).flatMap((v) => [flag, text(v)]);
const lastWord = (out) => text(out).trim().split(/\s+/).pop() ?? "";

// ---------------------------------------------------------------------------
// Change requests: one shape for a pull request and a merge request
//
//   number        the PR number or the MR iid
//   state         "open" | "merged" | "closed"
//   draft         boolean
//   source, target, sha   the two branches and the head commit
//   mergeable     true when the forge would merge it now, false when not, null while it is working it out
//   conflicts     boolean
//   mergeStatus   "ready" | "checking" | "conflicts" | "behind" | "checks" | "approval" | "draft" | "blocked" | "closed" | "unknown"
//   mergeStatusRaw  the forge's own word, for a caller that needs the finer state
//   autoMerge     set to merge when its checks pass
//   squash        GitLab's per-request squash flag; null on GitHub, which decides at merge time
//   mergeSha      the commit it landed as, once merged
//   checks        { state, failed, id, url, sha } or null in a list;
//                 state is "none" | "pending" | "passed" | "failed" | "canceled" | "skipped" | "blocked",
//                 failed names the checks or jobs that failed and are not allowed to
//   title, body, url, labels, author, updatedAt

const GH_CHANGE_LIST_FIELDS = "number,title,body,state,isDraft,mergeable,mergeStateStatus,reviewDecision,autoMergeRequest,mergeCommit,headRefName,baseRefName,headRefOid,url,labels,author,updatedAt";
const GH_CHANGE_FIELDS = `${GH_CHANGE_LIST_FIELDS},statusCheckRollup`;
const DRAFT_PREFIX = /^\s*(?:\[draft\]|\(draft\)|draft:)\s*/i;
const draftTitle = (title, draft) => (draft ? (DRAFT_PREFIX.test(title) ? title : `Draft: ${title}`) : title.replace(DRAFT_PREFIX, ""));
const MERGE_METHODS = ["merge", "squash", "rebase"];

/** Where one GitHub check stands: a check run by status and conclusion, a commit status by state. */
function ghCheckState(check) {
  if (check?.__typename === "StatusContext" || (check?.state && !check?.status)) {
    const s = upper(check.state);
    return s === "SUCCESS" ? "passed" : s === "FAILURE" || s === "ERROR" ? "failed" : "pending";
  }
  const status = upper(check?.status);
  if (status === "WAITING") return "blocked";
  if (status !== "COMPLETED") return "pending";
  switch (upper(check?.conclusion)) {
    case "SUCCESS": case "NEUTRAL": return "passed";
    case "SKIPPED": return "skipped";
    case "CANCELLED": return "canceled";
    case "ACTION_REQUIRED": return "blocked";
    case "STALE": return "pending";
    default: return "failed";
  }
}

function ghChecks(raw) {
  const runs = list(raw.statusCheckRollup);
  const states = runs.map(ghCheckState);
  const has = (s) => states.includes(s);
  const state = has("failed") ? "failed" : has("canceled") ? "canceled" : has("blocked") ? "blocked" : has("pending") ? "pending"
    : runs.length === 0 ? "none" : has("passed") ? "passed" : "skipped";
  return {
    state,
    failed: runs.filter((_, i) => states[i] === "failed").map((c) => text(c.name ?? c.context)).filter(Boolean),
    id: null,
    url: raw.url ? `${raw.url}/checks` : null,
    sha: raw.headRefOid ?? null,
  };
}

function ghMergeStatus(raw, state, draft, checks) {
  if (state !== "open") return "closed";
  const s = upper(raw.mergeStateStatus);
  if (upper(raw.mergeable) === "CONFLICTING" || s === "DIRTY") return "conflicts";
  if (draft) return "draft";
  if (s === "CLEAN" || s === "HAS_HOOKS" || s === "UNSTABLE") return "ready";
  if (s === "BEHIND") return "behind";
  if (s === "BLOCKED") {
    if (raw.reviewDecision === "REVIEW_REQUIRED") return "approval";
    if (raw.reviewDecision === "CHANGES_REQUESTED") return "blocked";
    return checks && !["passed", "none", "skipped"].includes(checks.state) ? "checks" : "blocked";
  }
  return s === "UNKNOWN" || s === "" ? "checking" : "unknown";
}

function ghChange(raw, withChecks = true) {
  const state = lower(raw.state) === "merged" ? "merged" : lower(raw.state) === "closed" ? "closed" : "open";
  const draft = Boolean(raw.isDraft);
  const checks = withChecks ? ghChecks(raw) : null;
  const mergeStatus = ghMergeStatus(raw, state, draft, checks);
  return {
    number: raw.number ?? null,
    title: text(raw.title),
    body: bodyText(raw.body),
    state,
    draft,
    source: raw.headRefName ?? null,
    target: raw.baseRefName ?? null,
    sha: raw.headRefOid ?? null,
    url: text(raw.url),
    mergeable: mergeStatus === "ready" ? true : mergeStatus === "checking" ? null : false,
    conflicts: mergeStatus === "conflicts",
    mergeStatus,
    mergeStatusRaw: lower(raw.mergeStateStatus) || null,
    autoMerge: raw.autoMergeRequest !== null && raw.autoMergeRequest !== undefined,
    squash: null,
    mergeSha: raw.mergeCommit?.oid ?? null,
    labels: names(raw.labels, "name"),
    author: raw.author?.login ?? null,
    updatedAt: raw.updatedAt ?? null,
    checks,
  };
}

const GL_MERGE_STATUS = {
  mergeable: "ready", can_be_merged: "ready",
  checking: "checking", unchecked: "checking", preparing: "checking", approvals_syncing: "checking", cannot_be_merged_recheck: "checking",
  conflict: "conflicts", cannot_be_merged: "conflicts",
  need_rebase: "behind",
  ci_must_pass: "checks", ci_still_running: "checks", external_status_checks: "checks",
  not_approved: "approval",
  draft_status: "draft",
  not_open: "closed",
  discussions_not_resolved: "blocked", blocked_status: "blocked", requested_changes: "blocked", merge_request_blocked: "blocked",
  jira_association_missing: "blocked", security_policy_violations: "blocked", locked_paths: "blocked", locked_lfs_files: "blocked",
  merge_time: "blocked", title_regex: "blocked", commits_status: "blocked",
};
const GL_PIPELINE_STATE = {
  success: "passed", failed: "failed", canceled: "canceled", canceling: "canceled", skipped: "skipped", manual: "blocked",
  created: "pending", pending: "pending", running: "pending", preparing: "pending", waiting_for_resource: "pending", scheduled: "pending",
};

function glChange(raw, withChecks = true, failed = []) {
  const state = raw.state === "merged" ? "merged" : raw.state === "closed" ? "closed" : "open";
  const rawStatus = raw.detailed_merge_status ?? raw.merge_status ?? null;
  const conflicts = Boolean(raw.has_conflicts) || GL_MERGE_STATUS[rawStatus] === "conflicts";
  const mergeStatus = state !== "open" ? "closed" : conflicts ? "conflicts" : GL_MERGE_STATUS[rawStatus] ?? "unknown";
  const p = raw.head_pipeline ?? raw.pipeline ?? null;
  return {
    number: raw.iid ?? null,
    title: text(raw.title),
    body: bodyText(raw.description),
    state,
    draft: Boolean(raw.draft ?? raw.work_in_progress),
    source: raw.source_branch ?? null,
    target: raw.target_branch ?? null,
    sha: raw.sha ?? null,
    url: text(raw.web_url),
    mergeable: mergeStatus === "ready" ? true : mergeStatus === "checking" ? null : false,
    conflicts,
    mergeStatus,
    mergeStatusRaw: rawStatus,
    autoMerge: Boolean(raw.merge_when_pipeline_succeeds),
    squash: Boolean(raw.squash || raw.squash_on_merge),
    mergeSha: raw.merge_commit_sha ?? raw.squash_commit_sha ?? null,
    labels: names(raw.labels, "name"),
    author: raw.author?.username ?? null,
    updatedAt: raw.updated_at ?? null,
    checks: !withChecks ? null
      : p ? { state: GL_PIPELINE_STATE[p.status] ?? "pending", failed, id: p.id ?? null, url: p.web_url ?? null, sha: p.sha ?? null }
      : { state: "none", failed: [], id: null, url: null, sha: raw.sha ?? null },
  };
}

/** The jobs that made a GitLab pipeline red. A job allowed to fail is not why, so it is left out. */
function glFailedJobs(provider, pipeline, opts) {
  if (!pipeline?.id || !["failed", "canceled"].includes(pipeline.status)) return [];
  const r = rest(provider, "GET", `{project}/pipelines/${pipeline.id}/jobs${queryString({ "scope[]": "failed", per_page: 100 })}`, opts);
  return r.ok ? list(r.value).filter((j) => !j.allow_failure).map((j) => text(j.name)).filter(Boolean) : [];
}

function glViewChange(provider, n, opts) {
  const r = rest(provider, "GET", `{project}/merge_requests/${n}`, opts);
  if (!r.ok) return r;
  if (!r.value) return fail("failed", "glab answered no merge request.");
  return ok(glChange(r.value, true, glFailedJobs(provider, r.value.head_pipeline, opts)));
}

/** One change request by number, with its merge status and its checks. */
export function viewChange(provider, num, opts = {}) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  if (provider?.kind === "gitlab") return glViewChange(provider, n, io(opts));
  const r = execJson(provider, ["pr", "view", n, ...repoFlag(provider ?? {}), "--json", GH_CHANGE_FIELDS], opts);
  return r.ok ? (r.value ? ok(ghChange(r.value)) : fail("failed", "gh answered no pull request.")) : r;
}

/**
 * Change requests, newest first as the forge orders them: filter by `source` branch, `target` branch and
 * `state` ("open" | "closed" | "merged" | "all"). Items carry `checks: null`; view one for its checks.
 */
export function listChanges(provider, { source, target, state = "open", limit = 30 } = {}, opts = {}) {
  if (!["open", "closed", "merged", "all"].includes(state)) return invalid(`state "${state}" is not open, closed, merged or all.`);
  if (provider?.kind === "gitlab") {
    const q = queryString({ state: state === "open" ? "opened" : state === "all" ? "" : state, source_branch: source, target_branch: target, order_by: "updated_at", sort: "desc" });
    const r = apiPaged(provider, `{project}/merge_requests${q}`, { ...io(opts), perPage: Math.min(100, limit), max: limit });
    return r.ok ? ok(r.value.map((mr) => glChange(mr, false))) : r;
  }
  const argv = ["pr", "list", ...repoFlag(provider ?? {}), "--state", state, ...(source ? ["--head", source] : []), ...(target ? ["--base", target] : []), "--limit", String(limit), "--json", GH_CHANGE_LIST_FIELDS];
  const r = execJson(provider, argv, opts);
  return r.ok ? ok(list(r.value).map((pr) => ghChange(pr, false))) : r;
}

/**
 * Opens a change request from `source` (default: the checked-out branch) into `target` (default: the
 * repository's default branch). The body goes by stdin. Answers the change request.
 */
export function createChange(provider, { title, body = "", source, target, draft = false, labels = [] } = {}, opts = {}) {
  if (!text(title).trim()) return invalid("A change request needs a title.");
  if (provider?.kind === "gitlab") {
    let from = source;
    if (!from) {
      const b = currentBranch(opts.cwd ?? provider.root, opts);
      if (!b.ok) return b;
      from = b.value;
    }
    let into = target;
    if (!into) {
      const p = rest(provider, "GET", "{project}", io(opts));
      if (!p.ok) return p;
      into = p.value?.default_branch;
      if (!into) return fail("failed", "glab named no default branch: pass a target branch.");
    }
    const r = rest(provider, "POST", "{project}/merge_requests", io(opts), {
      source_branch: from,
      target_branch: into,
      title: draftTitle(title, draft),
      description: text(body),
      ...(list(labels).length ? { labels: list(labels).join(",") } : {}),
    });
    return r.ok ? (r.value?.iid ? ok(glChange(r.value)) : fail("failed", "glab answered no merge request.")) : r;
  }
  const argv = [
    "pr", "create", ...repoFlag(provider ?? {}), "--title", title, "--body-file", "-",
    ...(source ? ["--head", source] : []), ...(target ? ["--base", target] : []),
    ...(draft ? ["--draft"] : []), ...repeat("--label", labels),
  ];
  const made = exec(provider, argv, opts, text(body));
  if (!made.ok) return made;
  const url = lastWord(made.value);
  const n = /\/pull\/(\d+)/.exec(url)?.[1];
  if (!n) return fail("failed", "gh pr create answered no pull request URL.", { detail: made.value.trim().slice(0, 200) });
  const seen = viewChange(provider, n, opts);
  // It exists either way: a failed read back must not read as a failed create.
  return seen.ok ? seen : ok({ ...ghChange({ number: Number(n), title, body, state: "OPEN", isDraft: draft, headRefName: source ?? null, baseRefName: target ?? null, url, labels: list(labels) }, false) });
}

/**
 * Edits a change request: `title`, `body`, `target`, `draft`, `addLabels`, `removeLabels`, `state`
 * ("open" | "closed"), and `squash` (GitLab's per-request flag; nothing to set on GitHub). Answers it as it now stands.
 */
export function updateChange(provider, num, { title, body, target, draft, addLabels = [], removeLabels = [], squash, state } = {}, opts = {}) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  if (state !== undefined && !["open", "closed"].includes(state)) return invalid(`state "${state}" is not open or closed.`);
  if (provider?.kind === "gitlab") {
    let named = title;
    if (draft !== undefined && named === undefined) {
      // Draft is a title prefix on GitLab, so flipping it needs the title.
      const was = rest(provider, "GET", `{project}/merge_requests/${n}`, io(opts));
      if (!was.ok) return was;
      named = text(was.value?.title);
    }
    const r = rest(provider, "PUT", `{project}/merge_requests/${n}`, io(opts), {
      ...(named !== undefined ? { title: draft === undefined ? named : draftTitle(named, draft) } : {}),
      ...(body !== undefined ? { description: text(body) } : {}),
      ...(target ? { target_branch: target } : {}),
      ...(list(addLabels).length ? { add_labels: list(addLabels).join(",") } : {}),
      ...(list(removeLabels).length ? { remove_labels: list(removeLabels).join(",") } : {}),
      ...(squash !== undefined ? { squash: Boolean(squash) } : {}),
      ...(state ? { state_event: state === "closed" ? "close" : "reopen" } : {}),
    });
    return r.ok ? (r.value?.iid ? ok(glChange(r.value)) : fail("failed", "glab answered no merge request.")) : r;
  }
  const repo = repoFlag(provider ?? {});
  const edits = [
    ...(title !== undefined ? ["--title", title] : []), ...(body !== undefined ? ["--body-file", "-"] : []),
    ...(target ? ["--base", target] : []), ...repeat("--add-label", addLabels), ...repeat("--remove-label", removeLabels),
  ];
  const steps = [
    edits.length ? [["pr", "edit", n, ...repo, ...edits], body !== undefined ? text(body) : undefined] : null,
    draft !== undefined ? [["pr", "ready", n, ...repo, ...(draft ? ["--undo"] : [])]] : null,
    state ? [["pr", state === "closed" ? "close" : "reopen", n, ...repo]] : null,
  ];
  for (const step of steps.filter(Boolean)) {
    const r = exec(provider, step[0], opts, step[1]);
    if (!r.ok) return r;
  }
  return viewChange(provider, n, opts);
}

/**
 * Merges a change request: `method` ("merge" | "squash" | "rebase"), `deleteBranch`, `whenChecksPass`,
 * and `sha` to refuse a head that moved. Answers `{ merged, queued, sha, change }`.
 */
export function mergeChange(provider, num, { method = "merge", deleteBranch = false, whenChecksPass = false, sha, subject, body } = {}, opts = {}) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  if (!MERGE_METHODS.includes(method)) return invalid(`method "${method}" is not merge, squash or rebase.`);
  if (sha !== undefined && !/^[0-9a-f]{40}$/i.test(text(sha))) return invalid("sha takes the full 40-character head commit: a short one is refused by the forge.");
  if (provider?.kind === "gitlab") {
    const message = [subject, body].map((s) => text(s).trim()).filter(Boolean).join("\n\n");
    // GitLab has no per-merge rebase: the project's merge method decides between
    // a merge commit and a fast-forward, so "rebase" is a merge without a squash.
    const r = rest(provider, "PUT", `{project}/merge_requests/${n}/merge`, io(opts), {
      squash: method === "squash",
      should_remove_source_branch: Boolean(deleteBranch),
      ...(sha ? { sha } : {}),
      ...(whenChecksPass ? { merge_when_pipeline_succeeds: true } : {}),
      ...(message ? { [method === "squash" ? "squash_commit_message" : "merge_commit_message"]: message } : {}),
    });
    if (!r.ok) return r;
    const change = glChange(r.value ?? {});
    const merged = change.state === "merged";
    // A fast-forward makes no merge commit: the head that was merged is what landed.
    return ok({ merged, queued: !merged && change.autoMerge, sha: merged ? change.mergeSha ?? change.sha : null, change });
  }
  const argv = [
    "pr", "merge", n, ...repoFlag(provider ?? {}), `--${method}`,
    ...(deleteBranch ? ["--delete-branch"] : []), ...(whenChecksPass ? ["--auto"] : []),
    ...(sha ? ["--match-head-commit", sha] : []), ...(subject ? ["--subject", subject] : []),
    ...(body !== undefined ? ["--body-file", "-"] : []),
  ];
  const done = exec(provider, argv, opts, body !== undefined ? text(body) : undefined);
  if (!done.ok) return done;
  const seen = viewChange(provider, n, opts);
  if (!seen.ok) return ok({ merged: whenChecksPass ? null : true, queued: whenChecksPass ? null : false, sha: null, change: null });
  const merged = seen.value.state === "merged";
  return ok({ merged, queued: !merged && seen.value.autoMerge, sha: merged ? seen.value.mergeSha : null, change: seen.value });
}

/** Approves a change request as the signed-in account. Answers `{ approved: true }`. */
export function approveChange(provider, num, opts = {}) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  const r = provider?.kind === "gitlab"
    ? rest(provider, "POST", `{project}/merge_requests/${n}/approve`, io(opts))
    : exec(provider, ["pr", "review", n, ...repoFlag(provider ?? {}), "--approve"], opts);
  return r.ok ? ok({ approved: true }) : r;
}

/**
 * Runs a change request's checks again: the failed runs on GitHub; on GitLab the failed pipeline,
 * or a new one when the head has none. Answers `{ started }`, the number of runs set going.
 */
export function retryChecks(provider, num, opts = {}) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  if (provider?.kind === "gitlab") {
    const mr = rest(provider, "GET", `{project}/merge_requests/${n}`, io(opts));
    if (!mr.ok) return mr;
    const p = mr.value?.head_pipeline ?? null;
    if (p && !["failed", "canceled"].includes(p.status)) return ok({ started: 0 });
    const r = rest(provider, "POST", p ? `{project}/pipelines/${p.id}/retry` : `{project}/merge_requests/${n}/pipelines`, io(opts));
    return r.ok ? ok({ started: 1 }) : r;
  }
  const repo = repoFlag(provider ?? {});
  const seen = execJson(provider, ["pr", "view", n, ...repo, "--json", "statusCheckRollup"], opts);
  if (!seen.ok) return seen;
  const runs = new Set();
  for (const check of list(seen.value?.statusCheckRollup)) {
    const id = /\/actions\/runs\/(\d+)/.exec(text(check.detailsUrl))?.[1];
    if (id && ["failed", "canceled"].includes(ghCheckState(check))) runs.add(id);
  }
  for (const id of runs) {
    const r = exec(provider, ["run", "rerun", id, ...repo, "--failed"], opts);
    if (!r.ok) return r;
  }
  return ok({ started: runs.size });
}

/** A comment on either kind of thing: `what` is the gh noun and `things` the GitLab collection. */
function comment(provider, what, things, num, body, opts) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  if (!text(body).trim()) return invalid("A comment needs a body.");
  if (provider?.kind === "gitlab") {
    const r = rest(provider, "POST", `{project}/${things}/${n}/notes`, io(opts), { body: text(body) });
    if (!r.ok) return r;
    const id = r.value?.id ?? null;
    const url = id && provider.host && provider.slug ? `https://${provider.host}/${provider.slug}/-/${things}/${n}#note_${id}` : null;
    return ok({ id, url });
  }
  const r = exec(provider, [what, "comment", n, ...repoFlag(provider ?? {}), "--body-file", "-"], opts, text(body));
  if (!r.ok) return r;
  const url = lastWord(r.value) || null;
  const id = /#issuecomment-(\d+)/.exec(url ?? "")?.[1];
  return ok({ id: id ? Number(id) : null, url });
}

/** Comments on a change request; the body goes by stdin. Answers `{ id, url }`. */
export function commentOnChange(provider, num, body, opts = {}) {
  return comment(provider, "pr", "merge_requests", num, body, opts);
}

// ---------------------------------------------------------------------------
// Issues: number (the iid on GitLab), title, body, state "open" | "closed",
// labels, url, assignees, milestone (its title or null), author, updatedAt

const GH_ISSUE_FIELDS = "number,title,body,state,labels,url,assignees,milestone,author,updatedAt";

const ghIssue = (raw) => ({
  number: raw.number ?? null,
  title: text(raw.title),
  body: bodyText(raw.body),
  state: lower(raw.state) === "closed" ? "closed" : "open",
  labels: names(raw.labels, "name"),
  url: text(raw.url),
  assignees: names(raw.assignees, "login"),
  milestone: raw.milestone?.title ?? null,
  author: raw.author?.login ?? null,
  updatedAt: raw.updatedAt ?? null,
});

const glIssue = (raw) => ({
  number: raw.iid ?? null,
  title: text(raw.title),
  body: bodyText(raw.description),
  state: lower(raw.state).startsWith("closed") ? "closed" : "open",
  labels: names(raw.labels, "name"),
  url: text(raw.web_url),
  assignees: names(raw.assignees, "username"),
  milestone: raw.milestone?.title ?? null,
  author: raw.author?.username ?? null,
  updatedAt: raw.updated_at ?? null,
});

/** GitLab takes a milestone by id, so its title is looked up, the group's milestones included. */
function glMilestoneId(provider, title, opts) {
  const r = rest(provider, "GET", `{project}/milestones${queryString({ title, include_ancestors: "true" })}`, opts);
  if (!r.ok) return r;
  const id = list(r.value).find((m) => m.title === title)?.id;
  return id ? ok(id) : fail("not-found", `No milestone is titled "${title}": create it first.`);
}

/** One issue by number. */
export function viewIssue(provider, num, opts = {}) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  const r = provider?.kind === "gitlab"
    ? rest(provider, "GET", `{project}/issues/${n}`, io(opts))
    : execJson(provider, ["issue", "view", n, ...repoFlag(provider ?? {}), "--json", GH_ISSUE_FIELDS], opts);
  if (!r.ok) return r;
  if (!r.value) return fail("failed", `${cliOf(provider)} answered no issue.`);
  return ok(provider.kind === "gitlab" ? glIssue(r.value) : ghIssue(r.value));
}

/** Issues by `state` ("open" | "closed" | "all"), `labels` (all of them) and `search` text, up to `limit`. */
export function listIssues(provider, { state = "open", labels = [], search, limit = 100 } = {}, opts = {}) {
  if (!["open", "closed", "all"].includes(state)) return invalid(`state "${state}" is not open, closed or all.`);
  if (provider?.kind === "gitlab") {
    const q = queryString({ state: state === "open" ? "opened" : state === "all" ? "" : state, labels: list(labels).join(","), search, order_by: "updated_at", sort: "desc" });
    const r = apiPaged(provider, `{project}/issues${q}`, { ...io(opts), perPage: Math.min(100, limit), max: limit });
    return r.ok ? ok(r.value.map(glIssue)) : r;
  }
  const argv = ["issue", "list", ...repoFlag(provider ?? {}), "--state", state, ...repeat("--label", labels), ...(search ? ["--search", search] : []), "--limit", String(limit), "--json", GH_ISSUE_FIELDS];
  const r = execJson(provider, argv, opts);
  return r.ok ? ok(list(r.value).map(ghIssue)) : r;
}

/** Opens an issue with `title`, `body` (by stdin), `labels` and a `milestone` title. Answers the issue. */
export function createIssue(provider, { title, body = "", labels = [], milestone } = {}, opts = {}) {
  if (!text(title).trim()) return invalid("An issue needs a title.");
  if (provider?.kind === "gitlab") {
    const stone = milestone ? glMilestoneId(provider, milestone, io(opts)) : null;
    if (stone && !stone.ok) return stone;
    const r = rest(provider, "POST", "{project}/issues", io(opts), {
      title,
      description: text(body),
      ...(list(labels).length ? { labels: list(labels).join(",") } : {}),
      ...(stone ? { milestone_id: stone.value } : {}),
    });
    return r.ok ? (r.value?.iid ? ok(glIssue(r.value)) : fail("failed", "glab answered no issue.")) : r;
  }
  const argv = ["issue", "create", ...repoFlag(provider ?? {}), "--title", title, "--body-file", "-", ...repeat("--label", labels), ...(milestone ? ["--milestone", milestone] : [])];
  const made = exec(provider, argv, opts, text(body));
  if (!made.ok) return made;
  const url = lastWord(made.value);
  const n = /\/issues\/(\d+)/.exec(url)?.[1];
  if (!n) return fail("failed", "gh issue create answered no issue URL.", { detail: made.value.trim().slice(0, 200) });
  const seen = viewIssue(provider, n, opts);
  return seen.ok ? seen : ok(ghIssue({ number: Number(n), title, body, state: "OPEN", labels: list(labels), url, milestone: milestone ? { title: milestone } : null }));
}

/**
 * Edits an issue: `title`, `body`, `addLabels`, `removeLabels`, `milestone` (a title, or null to clear),
 * and `state` ("open" | "closed") to reopen or close it. Answers the issue as it now stands.
 */
export function updateIssue(provider, num, { title, body, addLabels = [], removeLabels = [], milestone, state } = {}, opts = {}) {
  const n = numberOf(num);
  if (!n) return badNumber(num, provider);
  if (state !== undefined && !["open", "closed"].includes(state)) return invalid(`state "${state}" is not open or closed.`);
  if (provider?.kind === "gitlab") {
    const stone = milestone ? glMilestoneId(provider, milestone, io(opts)) : null;
    if (stone && !stone.ok) return stone;
    const r = rest(provider, "PUT", `{project}/issues/${n}`, io(opts), {
      ...(title !== undefined ? { title } : {}),
      ...(body !== undefined ? { description: text(body) } : {}),
      ...(list(addLabels).length ? { add_labels: list(addLabels).join(",") } : {}),
      ...(list(removeLabels).length ? { remove_labels: list(removeLabels).join(",") } : {}),
      ...(stone ? { milestone_id: stone.value } : milestone === null ? { milestone_id: 0 } : {}),
      ...(state ? { state_event: state === "closed" ? "close" : "reopen" } : {}),
    });
    return r.ok ? (r.value?.iid ? ok(glIssue(r.value)) : fail("failed", "glab answered no issue.")) : r;
  }
  const repo = repoFlag(provider ?? {});
  const edits = [
    ...(title !== undefined ? ["--title", title] : []), ...(body !== undefined ? ["--body-file", "-"] : []),
    ...repeat("--add-label", addLabels), ...repeat("--remove-label", removeLabels),
    ...(milestone ? ["--milestone", milestone] : milestone === null ? ["--remove-milestone"] : []),
  ];
  const steps = [
    edits.length ? [["issue", "edit", n, ...repo, ...edits], body !== undefined ? text(body) : undefined] : null,
    state ? [["issue", state === "closed" ? "close" : "reopen", n, ...repo]] : null,
  ];
  for (const step of steps.filter(Boolean)) {
    const r = exec(provider, step[0], opts, step[1]);
    if (!r.ok) return r;
  }
  return viewIssue(provider, n, opts);
}

/** Comments on an issue; the body goes by stdin. Answers `{ id, url }`. */
export function commentOnIssue(provider, num, body, opts = {}) {
  return comment(provider, "issue", "issues", num, body, opts);
}

/**
 * Makes sure a label exists, with `color` (hex, with or without "#") and `description` when it is made.
 * An existing label is left as it is. Answers `{ created }`.
 */
export function ensureLabel(provider, name, { color, description } = {}, opts = {}) {
  if (!text(name).trim() || flagLike(name)) return invalid(`${JSON.stringify(name ?? null)} is not a label name.`);
  const hex = text(color).replace(/^#/, "");
  const r = provider?.kind === "gitlab"
    ? rest(provider, "POST", "{project}/labels", io(opts), { name, color: `#${hex || "6699cc"}`, ...(description ? { description } : {}) })
    : exec(provider, ["label", "create", name, ...repoFlag(provider ?? {}), ...(hex ? ["--color", hex] : []), ...(description ? ["--description", description] : [])], opts);
  if (r.ok) return ok({ created: true });
  return r.error === "exists" ? ok({ created: false }) : r;
}
