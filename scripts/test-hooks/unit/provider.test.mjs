// scripts/shared/provider.mjs: the argv it builds for each operation on both
// forges, and the object each answer is normalized into.
//
// A fake runner stands in for gh, glab, git and ssh. It records every call
// (program, argv, cwd, stdin, environment) and answers canned output in order,
// so nothing here starts a process or reaches a network. The one exception is
// the PATH lookup, which is the point of that check: it reads a temp directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ERROR_KINDS, FORGES, api, apiPaged, approveChange, authStatus, checkCli, classifyFailure, cliPath,
  commentOnChange, commentOnIssue, createChange, createIssue, currentBranch, detect, ensureLabel, graphql,
  listChanges, listIssues, mergeChange, parseRemote, retryChecks, updateChange, updateIssue, viewChange, viewIssue,
} from "../../shared/provider.mjs";

const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const GH = { kind: "github", cli: "gh", host: "github.com", slug: "someone/thing", root: "checkout" };
const GHE = { ...GH, host: "github.example.com" };
const GL = { kind: "gitlab", cli: "glab", host: "gitlab.com", slug: "group/sub/thing", root: "checkout" };
const GLS = { ...GL, host: "gitlab.example.com", slug: "group/thing" };
const R = ["-R", "someone/thing"];
const P = "projects/group%2Fsub%2Fthing";
const JSON_BODY = ["-H", "Content-Type: application/json", "--input", "-"];
const GH_CHANGE_LIST_FIELDS = "number,title,body,state,isDraft,mergeable,mergeStateStatus,reviewDecision,autoMergeRequest,mergeCommit,headRefName,baseRefName,headRefOid,url,labels,author,updatedAt";
const GH_CHANGE_FIELDS = `${GH_CHANGE_LIST_FIELDS},statusCheckRollup`;
const GH_ISSUE_FIELDS = "number,title,body,state,labels,url,assignees,milestone,author,updatedAt";

/**
 * A runner answering `answers` in order: `{ json }`, `{ stdout }`, or a failure
 * `{ status, stderr, code }`. A call past the end answers an empty success.
 */
function fake(...answers) {
  const calls = [];
  const run = (cmd, argv, { cwd, input, env } = {}) => {
    const a = answers[calls.length] ?? {};
    calls.push({ cmd, argv, cwd, input, env });
    return { status: "status" in a ? a.status : 0, stdout: a.json !== undefined ? JSON.stringify(a.json) : a.stdout ?? "", stderr: a.stderr ?? "", code: a.code };
  };
  return { run, calls, lines: () => calls.map((c) => [c.cmd, ...c.argv]), sent: (i) => JSON.parse(calls[i].input) };
}

/** A runner for detect: git answers the remote URL, ssh resolves the aliases it is given. */
function checkout(url, aliases = null) {
  const calls = [];
  const run = (cmd, argv, { cwd } = {}) => {
    calls.push({ cmd, argv, cwd });
    if (cmd === "git") return url ? { status: 0, stdout: `${url}\n`, stderr: "" } : { status: 2, stdout: "", stderr: "error: No such remote 'origin'\n" };
    if (cmd === "ssh" && aliases) return { status: 0, stdout: `user git\nhostname ${aliases[argv[1]] ?? argv[1]}\nport 22\n`, stderr: "" };
    return { status: null, stdout: "", stderr: "", code: "ENOENT" };
  };
  return { run, calls };
}

const NOT_FOUND_GH = { status: 1, stderr: "GraphQL: Could not resolve to a PullRequest with the number of 12. (repository.pullRequest)\n" };
const NOT_FOUND_GL = { status: 1, stdout: '{"message":"404 Not found"}', stderr: "glab: 404 Not found (HTTP 404)\n" };

// ---------------------------------------------------------------------------
// Detection

const REMOTES = [
  // url, kind, host, slug
  ["https://github.com/someone/thing.git", "github", "github.com", "someone/thing"],
  ["https://github.com/someone/thing", "github", "github.com", "someone/thing"],
  ["https://github.com/someone/thing/", "github", "github.com", "someone/thing"],
  ["https://user:token@github.com/someone/thing.git", "github", "github.com", "someone/thing"],
  ["git@github.com:someone/thing.git", "github", "github.com", "someone/thing"],
  ["ssh://git@github.com/someone/thing.git", "github", "github.com", "someone/thing"],
  ["ssh://git@ssh.github.com:443/someone/thing.git", "github", "github.com", "someone/thing"],
  ["git://github.com/someone/thing.git", "github", "github.com", "someone/thing"],
  ["https://github.example.com/someone/thing.git", "github", "github.example.com", "someone/thing"],
  ["git@github.example.com:someone/thing.git", "github", "github.example.com", "someone/thing"],
  ["https://tenant.ghe.com/someone/thing", "github", "tenant.ghe.com", "someone/thing"],
  ["https://gitlab.com/group/thing.git", "gitlab", "gitlab.com", "group/thing"],
  ["git@gitlab.com:group/sub/thing.git", "gitlab", "gitlab.com", "group/sub/thing"],
  ["git@altssh.gitlab.com:group/thing.git", "gitlab", "gitlab.com", "group/thing"],
  ["https://gitlab.example.com/group/sub/thing.git", "gitlab", "gitlab.example.com", "group/sub/thing"],
  ["ssh://git@gitlab.example.com:2222/group/thing.git", "gitlab", "gitlab.example.com", "group/thing"],
  ["https://gitlab.example.com:8443/group/thing.git", "gitlab", "gitlab.example.com:8443", "group/thing"],
  ["HTTPS://GitLab.Example.com/group/thing.git", "gitlab", "gitlab.example.com", "group/thing"],
  ["https://git.example.com/team/thing.git", null, "git.example.com", "team/thing"],
  ["https://bitbucket.org/team/thing.git", null, "bitbucket.org", "team/thing"],
  ["https://git.example.com/thing.git", null, "git.example.com", null],
  ["/srv/git/thing.git", null, null, null],
  ["../thing", null, null, null],
  ["file:///srv/git/thing.git", null, null, null],
  ["C:\\repos\\thing", null, null, null],
  ["C:/repos/thing.git", null, null, null],
  ["-oProxyCommand=evil:someone/thing", null, null, null],
];

test("detect names the forge, host and slug from the origin remote", () => {
  for (const [url, kind, host, slug] of REMOTES) {
    const repo = checkout(url);
    const forge = FORGES[kind] ?? null;
    assert.deepEqual(
      detect("checkout", { env: {}, run: repo.run }),
      { kind, cli: forge?.cli ?? null, host, slug, noun: forge?.noun ?? null, short: forge?.short ?? null, root: "checkout" },
      url,
    );
    assert.deepEqual(repo.calls[0], { cmd: "git", argv: ["remote", "get-url", "origin"], cwd: "checkout" }, url);
  }
});

test("detect's nouns are the forge's own", () => {
  const gh = detect("checkout", { env: {}, run: checkout("git@github.com:someone/thing.git").run });
  const gl = detect("checkout", { env: {}, run: checkout("git@gitlab.com:group/thing.git").run });
  assert.deepEqual([gh.cli, gh.noun, gh.short], ["gh", "pull request", "PR"]);
  assert.deepEqual([gl.cli, gl.noun, gl.short], ["glab", "merge request", "MR"]);
  assert.deepEqual([FORGES.github.ciFile, FORGES.gitlab.ciFile], [".github/workflows/ci.yml", ".gitlab-ci.yml"]);
});

test("parseRemote drops credentials, the .git suffix and an ssh port", () => {
  assert.deepEqual(parseRemote("https://user:token@gitlab.example.com/group/thing.git"), { host: "gitlab.example.com", slug: "group/thing", ssh: false });
  assert.deepEqual(parseRemote("ssh://git@gitlab.example.com:2222/group/thing.git"), { host: "gitlab.example.com", slug: "group/thing", ssh: true });
  assert.deepEqual(parseRemote("git@github.com:someone/thing"), { host: "github.com", slug: "someone/thing", ssh: true });
  assert.equal(parseRemote(""), null);
  assert.equal(parseRemote(undefined), null);
});

test("detect resolves an ssh alias through ssh -G, without connecting", () => {
  const repo = checkout("git@work:group/thing.git", { work: "gitlab.example.com" });
  const found = detect("checkout", { env: {}, run: repo.run });
  assert.deepEqual([found.kind, found.host, found.slug], ["gitlab", "gitlab.example.com", "group/thing"]);
  assert.deepEqual(repo.calls[1], { cmd: "ssh", argv: ["-G", "work"], cwd: "checkout" });

  const named = detect("checkout", { env: {}, run: checkout("git@github-work:someone/thing.git", { "github-work": "github.com" }).run });
  assert.deepEqual([named.kind, named.host], ["github", "github.com"]);

  // ssh answers a host it has no alias for with the same name: it is a real host.
  const plain = detect("checkout", { env: {}, run: checkout("git@gitbox:team/thing.git", {}).run });
  assert.deepEqual([plain.kind, plain.host, plain.slug], [null, "gitbox", "team/thing"]);
});

test("detect leaves the host open when an alias cannot be resolved", () => {
  const found = detect("checkout", { env: {}, run: checkout("git@gitlab-work:group/thing.git").run });
  assert.deepEqual([found.kind, found.host, found.slug], ["gitlab", null, "group/thing"]);
});

test("detect asks ssh nothing when the host already names its forge", () => {
  const repo = checkout("git@gitlab.example.com:group/thing.git");
  detect("checkout", { env: {}, run: repo.run });
  assert.deepEqual(repo.calls.map((c) => c.cmd), ["git"]);
});

test("detect takes an override for a host whose name says nothing", () => {
  const url = "https://git.example.com/team/thing.git";
  const told = detect("checkout", { env: {}, run: checkout(url).run, kind: "gitlab" });
  assert.deepEqual([told.kind, told.cli, told.host, told.slug, told.short], ["gitlab", "glab", "git.example.com", "team/thing", "MR"]);
  // The CLIs' own host variables name it too.
  assert.equal(detect("checkout", { env: { GITLAB_HOST: "https://git.example.com" }, run: checkout(url).run }).kind, "gitlab");
  assert.equal(detect("checkout", { env: { GH_HOST: "git.example.com" }, run: checkout(url).run }).kind, "github");
  // An override that is not a forge means "work it out".
  assert.equal(detect("checkout", { env: {}, run: checkout("git@github.com:someone/thing.git").run, kind: "auto" }).kind, "github");
  // Host and slug can be passed where there is no remote to read.
  const bare = detect("checkout", { env: {}, run: checkout(null).run, kind: "gitlab", host: "gitlab.example.com", slug: "group/thing" });
  assert.deepEqual([bare.kind, bare.host, bare.slug], ["gitlab", "gitlab.example.com", "group/thing"]);
});

test("detect reads the remote it is told to, and never throws", () => {
  const repo = checkout("git@gitlab.com:group/thing.git");
  detect("checkout", { env: {}, run: repo.run, remote: "mirror" });
  assert.deepEqual(repo.calls[0].argv, ["remote", "get-url", "mirror"]);

  const nulls = { kind: null, cli: null, host: null, slug: null, noun: null, short: null, root: "checkout" };
  assert.deepEqual(detect("checkout", { env: {}, run: checkout(null).run }), nulls);
  assert.deepEqual(detect("checkout", { env: {}, run: () => { throw new Error("no git here"); } }), nulls);
  const flag = checkout("git@gitlab.com:group/thing.git");
  assert.deepEqual(detect("checkout", { env: {}, run: flag.run, remote: "--upload-pack=x" }), nulls);
  assert.equal(flag.calls.length, 0, "a remote that reads as a flag is never handed to git");
});

test("currentBranch asks git, and a detached HEAD is not a branch", () => {
  const on = fake({ stdout: "feat/provider\n" });
  assert.deepEqual(currentBranch("checkout", { run: on.run, env: {} }), { ok: true, value: "feat/provider" });
  assert.deepEqual(on.calls[0], { cmd: "git", argv: ["branch", "--show-current"], cwd: "checkout", input: undefined, env: {} });
  assert.equal(currentBranch("checkout", { run: fake({ stdout: "\n" }).run, env: {} }).error, "invalid");
  assert.equal(currentBranch("checkout", { run: fake({ status: null, code: "ENOENT" }).run, env: {} }).error, "not-installed");
});

// ---------------------------------------------------------------------------
// Readiness

test("cliPath and checkCli find a CLI on PATH without starting it", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-path-"));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "provider-empty-"));
  t.after(() => { for (const d of [dir, empty]) fs.rmSync(d, { recursive: true, force: true }); });
  const file = path.join(dir, process.platform === "win32" ? "glab.exe" : "glab");
  fs.writeFileSync(file, "");
  fs.chmodSync(file, 0o755);

  const found = cliPath("glab", { PATH: dir });
  assert.equal(path.dirname(found), dir);
  assert.match(path.basename(found).toLowerCase(), /^glab(\.exe)?$/);
  assert.equal(cliPath("no-such-forge-cli", { PATH: empty }), null);
  assert.equal(cliPath("no-such-forge-cli", {}), null);

  const ready = checkCli(GL, { env: { PATH: dir } });
  assert.equal(ready.ok, true);
  assert.equal(ready.value.cli, "glab");
  assert.equal(path.dirname(ready.value.path), dir);

  const missing = checkCli({ ...GLS, cli: "no-such-forge-cli" }, { env: { PATH: empty } });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "not-installed");
  assert.match(missing.hint, /no-such-forge-cli is not installed or not on PATH/);
  assert.match(missing.hint, /auth login --hostname gitlab\.example\.com/);
  assert.equal(checkCli({ kind: null }, { env: {} }).error, "unknown-provider");
});

test("authStatus asks the CLI about the provider's host", () => {
  const gh = fake({ stdout: "github.com\n  ✓ Logged in to github.com account someone (keyring)\n  - Active account: true\n" });
  assert.deepEqual(authStatus(GH, { run: gh.run, env: {} }), { ok: true, value: { host: "github.com", account: "someone" } });
  assert.deepEqual(gh.lines(), [["gh", "auth", "status", "--hostname", "github.com"]]);

  const gl = fake({ stdout: "gitlab.example.com\n  ✓ Logged in to gitlab.example.com as someone (config.yml)\n" });
  assert.deepEqual(authStatus(GLS, { run: gl.run, env: {} }), { ok: true, value: { host: "gitlab.example.com", account: "someone" } });
  assert.deepEqual(gl.lines(), [["glab", "auth", "status", "--hostname", "gitlab.example.com"]]);

  // With no host known the CLI answers for the hosts it has.
  const open = fake({});
  authStatus({ ...GL, host: null }, { run: open.run, env: {} });
  assert.deepEqual(open.lines(), [["glab", "auth", "status"]]);
});

test("authStatus tells signed out from missing from unreachable", () => {
  const out = authStatus(GH, { run: fake({ status: 1, stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n" }).run, env: {} });
  assert.equal(out.error, "not-authenticated");
  assert.equal(out.hint, "gh is not signed in to github.com. Run: gh auth login --hostname github.com");

  // Any other refusal from `auth status` is still a sign-in problem.
  assert.equal(authStatus(GLS, { run: fake({ status: 1, stderr: "x gitlab.example.com: api call failed\n" }).run, env: {} }).error, "not-authenticated");

  const missing = authStatus(GLS, { run: fake({ status: null, code: "ENOENT" }).run, env: {} });
  assert.equal(missing.error, "not-installed");
  assert.match(missing.hint, /^glab is not installed or not on PATH\. Install it \(.+\), then run: glab auth login --hostname gitlab\.example\.com$/);

  const away = authStatus(GLS, { run: fake({ status: 1, stderr: "dial tcp: lookup gitlab.example.com: no such host\n" }).run, env: {} });
  assert.equal(away.error, "network");
  assert.match(away.hint, /could not reach gitlab\.example\.com/);
});

// ---------------------------------------------------------------------------
// Failures

const FAILURES = [
  // what the runner answered, the kind, the HTTP status
  [{ status: null, code: "ENOENT" }, "not-installed", null],
  [{ status: null, code: "ETIMEDOUT" }, "network", null],
  [{ status: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\n" }, "not-authenticated", null],
  [{ status: 1, stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)\n" }, "not-authenticated", 401],
  [{ status: 1, stdout: '{"message":"401 Unauthorized"}', stderr: "glab: 401 Unauthorized (HTTP 401)\n" }, "not-authenticated", 401],
  [{ status: 1, stderr: "GraphQL: Could not resolve to an Issue with the number of 99. (repository.issue)\n" }, "not-found", null],
  [{ status: 1, stderr: "gh: Not Found (HTTP 404)\n" }, "not-found", 404],
  [{ status: 1, stdout: '{"message":"404 Project Not Found"}', stderr: "glab: 404 Project Not Found (HTTP 404)\n" }, "not-found", 404],
  [{ status: 1, stderr: "gh: API rate limit exceeded for user ID 1. (HTTP 403)\n" }, "rate-limited", 403],
  [{ status: 1, stderr: "glab: 429 Too Many Requests (HTTP 429)\n" }, "rate-limited", 429],
  [{ status: 1, stderr: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n' }, "network", null],
  [{ status: 1, stderr: 'Get "https://gitlab.example.com/api/v4/user": dial tcp: lookup gitlab.example.com: no such host\n' }, "network", null],
  [{ status: 1, stderr: "gh: HTTP 502\n" }, "network", 502],
  [{ status: 1, stdout: "<!DOCTYPE html><html><title>Access denied</title></html>", stderr: "glab: (HTTP 403)\n" }, "network", 403],
  [{ status: 1, stdout: '{"message":"403 Forbidden"}', stderr: "glab: 403 Forbidden (HTTP 403)\n" }, "forbidden", 403],
  [{ status: 1, stderr: "GraphQL: Resource not accessible by integration (addComment)\n" }, "forbidden", null],
  [{ status: 1, stderr: 'a pull request for branch "feat/provider" into branch "main" already exists:\nhttps://github.com/someone/thing/pull/12\n' }, "exists", null],
  [{ status: 1, stdout: '{"message":["Another open merge request already exists for this source branch: !12"]}', stderr: "glab: (HTTP 409)\n" }, "exists", 409],
  [{ status: 1, stderr: "GraphQL: Pull request is not mergeable: the merge commit cannot be cleanly created. (mergePullRequest)\n" }, "refused", null],
  [{ status: 1, stdout: '{"message":"405 Method Not Allowed"}', stderr: "glab: 405 Method Not Allowed (HTTP 405)\n" }, "refused", 405],
  [{ status: 1, stdout: '{"message":"SHA does not match HEAD of source branch"}', stderr: "glab: SHA does not match HEAD of source branch (HTTP 409)\n" }, "refused", 409],
  [{ status: 1, stderr: "something else went wrong\n" }, "failed", null],
];

test("a failed call is classified by what went wrong", () => {
  for (const [answer, kind, status] of FAILURES) {
    const cli = (answer.stderr ?? "").startsWith("glab") || (answer.stdout ?? "").startsWith("{") ? GLS : GH;
    const r = classifyFailure(answer, cli);
    assert.deepEqual([r.ok, r.error, r.status], [false, kind, status], JSON.stringify(answer));
    assert.ok(ERROR_KINDS.includes(r.error));
    assert.equal(typeof r.hint, "string");
    assert.ok(r.hint.length > 0 && !r.hint.includes("\n"), `one line: ${r.hint}`);
  }
});

test("every operation returns the failure instead of throwing", () => {
  const gone = viewChange(GH, 12, { run: fake(NOT_FOUND_GH).run, env: {} });
  assert.deepEqual([gone.ok, gone.error], [false, "not-found"]);
  assert.match(gone.detail, /Could not resolve to a PullRequest/);
  assert.equal(gone.hint, "github.com/someone/thing has nothing at that number or path, or this account cannot see it.");
  assert.equal(viewIssue(GL, 12, { run: fake(NOT_FOUND_GL).run, env: {} }).error, "not-found");
  assert.equal(viewIssue(GL, 12, { run: () => { throw Object.assign(new Error("spawn glab ENOENT"), { code: "ENOENT" }); }, env: {} }).error, "not-installed");
  assert.equal(viewIssue(GH, 12, { run: fake({ stdout: "not json" }).run, env: {} }).error, "failed");
});

test("bad input and an unknown forge never reach a CLI", () => {
  const none = fake();
  const o = { run: none.run, env: {} };
  for (const n of [0, -1, "--web", "1; rm", "", null, 1.5]) {
    assert.equal(viewChange(GH, n, o).error, "invalid", String(n));
    assert.equal(viewIssue(GL, n, o).error, "invalid", String(n));
  }
  assert.equal(mergeChange(GH, 12, { method: "octopus" }, o).error, "invalid");
  assert.equal(mergeChange(GL, 12, { sha: "a1b2c3d" }, o).error, "invalid");
  assert.equal(listChanges(GH, { state: "draft" }, o).error, "invalid");
  assert.equal(listIssues(GL, { state: "merged" }, o).error, "invalid");
  assert.equal(createChange(GH, { title: " " }, o).error, "invalid");
  assert.equal(createIssue(GL, {}, o).error, "invalid");
  assert.equal(commentOnIssue(GH, 12, "", o).error, "invalid");
  assert.equal(ensureLabel(GH, "--force", {}, o).error, "invalid");
  const unknown = { kind: null, cli: null, host: "git.example.com", slug: "team/thing" };
  for (const r of [viewChange(unknown, 12, o), listIssues(unknown, {}, o), api(unknown, "GET", "{project}", o), apiPaged(unknown, "{project}/issues", o), graphql(unknown, "{ viewer { login } }", {}, o), authStatus(unknown, o)]) {
    assert.equal(r.error, "unknown-provider");
  }
  assert.equal(none.calls.length, 0);
});

// ---------------------------------------------------------------------------
// The call itself: where it runs and what it is told

test("a call runs in the checkout, with prompts off and the GitLab host pinned", () => {
  const gh = fake({ json: [] });
  listIssues(GH, {}, { run: gh.run, env: { KEEP: "1", GH_HOST: "elsewhere.example.com" } });
  assert.equal(gh.calls[0].cwd, "checkout");
  assert.equal(gh.calls[0].input, undefined);
  assert.deepEqual(
    Object.fromEntries(["KEEP", "GH_PROMPT_DISABLED", "GH_NO_UPDATE_NOTIFIER", "NO_COLOR", "GITLAB_HOST"].map((k) => [k, gh.calls[0].env[k]])),
    { KEEP: "1", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1", GITLAB_HOST: undefined },
  );

  const gl = fake({ json: [] });
  listIssues(GLS, {}, { run: gl.run, env: { GITLAB_HOST: "elsewhere.example.com" }, cwd: "another" });
  assert.equal(gl.calls[0].cwd, "another");
  assert.deepEqual([gl.calls[0].env.GITLAB_HOST, gl.calls[0].env.NO_PROMPT, gl.calls[0].env.NO_COLOR], ["gitlab.example.com", "1", "1"]);

  // With no host known, the CLI's own configuration decides.
  const open = fake({ json: [] });
  listIssues({ ...GL, host: null }, {}, { run: open.run, env: { GITLAB_HOST: "configured.example.com" } });
  assert.equal(open.calls[0].env.GITLAB_HOST, "configured.example.com");
});

test("a GitHub Enterprise host rides on -R and --hostname", () => {
  const view = fake({ json: {} });
  viewIssue(GHE, 3, { run: view.run, env: {} });
  assert.deepEqual(view.lines()[0].slice(0, 6), ["gh", "issue", "view", "3", "-R", "github.example.com/someone/thing"]);
  const raw = fake({ json: {} });
  api(GHE, "GET", "{project}", { run: raw.run, env: {} });
  assert.deepEqual(raw.lines(), [["gh", "api", "-X", "GET", "repos/someone/thing", "--hostname", "github.example.com"]]);
});

test("api names this repository for {project}, sends fields as -f and a body as JSON on stdin", () => {
  const gh = fake({ json: { default_branch: "main" } }, { json: { number: 4 } });
  assert.deepEqual(api(GH, "get", "{project}", { run: gh.run, env: {} }), { ok: true, value: { default_branch: "main" } });
  api(GH, "POST", "{project}/milestones", { run: gh.run, env: {}, body: { title: "Sprint 1", due_on: "2026-02-01T12:00:00Z" } });
  assert.deepEqual(gh.lines(), [
    ["gh", "api", "-X", "GET", "repos/someone/thing"],
    ["gh", "api", "-X", "POST", "repos/someone/thing/milestones", ...JSON_BODY],
  ]);
  assert.deepEqual(gh.sent(1), { title: "Sprint 1", due_on: "2026-02-01T12:00:00Z" });

  const gl = fake({ json: [] }, { stdout: "plain text\n" }, { json: {} }, { json: {} });
  api(GL, "GET", "{project}/labels", { run: gl.run, env: {}, fields: { per_page: 100, search: "epic" } });
  assert.deepEqual(api(GL, "GET", "{project}/repository/files/README.md/raw", { run: gl.run, env: {}, raw: true }), { ok: true, value: "plain text\n" });
  api({ ...GL, slug: null }, "GET", "{project}", { run: gl.run, env: {} });
  api({ ...GL, projectId: 4242 }, "GET", "{project}", { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [
    ["glab", "api", "-X", "GET", `${P}/labels`, "-f", "per_page=100", "-f", "search=epic"],
    ["glab", "api", "-X", "GET", `${P}/repository/files/README.md/raw`],
    ["glab", "api", "-X", "GET", "projects/:id"],
    ["glab", "api", "-X", "GET", "projects/4242"],
  ]);
});

test("apiPaged reads pages until a short one, up to max", () => {
  const two = fake({ json: [{ id: 1 }, { id: 2 }] }, { json: [{ id: 3 }] });
  const all = apiPaged(GL, "{project}/milestones?state=active", { run: two.run, env: {}, perPage: 2 });
  assert.deepEqual(all, { ok: true, value: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  assert.deepEqual(two.lines().map((l) => l[4]), [`${P}/milestones?state=active&per_page=2&page=1`, `${P}/milestones?state=active&per_page=2&page=2`]);

  const capped = fake({ json: [{ id: 1 }, { id: 2 }] }, { json: [{ id: 3 }, { id: 4 }] });
  assert.equal(apiPaged(GH, "{project}/milestones", { run: capped.run, env: {}, perPage: 2, max: 3 }).value.length, 3);
  assert.equal(capped.lines()[0][4], "repos/someone/thing/milestones?per_page=2&page=1");
  assert.equal(apiPaged(GL, "{project}/milestones", { run: fake(NOT_FOUND_GL).run, env: {} }).error, "not-found");
});

test("graphql sends the query as a field and answers data", () => {
  const gh = fake({ json: { data: { repository: { id: "R_1" } } } });
  const q = "query($owner: String!, $first: Int!) { repository(owner: $owner) { id } }";
  assert.deepEqual(graphql(GHE, q, { owner: "someone", first: 5 }, { run: gh.run, env: {} }), { ok: true, value: { repository: { id: "R_1" } } });
  assert.deepEqual(gh.lines(), [["gh", "api", "graphql", "--hostname", "github.example.com", "-f", `query=${q}`, "-f", "owner=someone", "-F", "first=5"]]);

  const gl = fake({ json: { errors: [{ message: "Field 'nope' doesn't exist on type 'Query'" }] } });
  const refused = graphql(GL, "{ nope }", {}, { run: gl.run, env: {} });
  assert.deepEqual([refused.error, refused.detail], ["failed", "Field 'nope' doesn't exist on type 'Query'"]);
  assert.deepEqual(gl.lines(), [["glab", "api", "graphql", "-f", "query={ nope }"]]);
});

// ---------------------------------------------------------------------------
// Change requests

const GH_PR = {
  number: 12,
  title: "Add the provider layer",
  body: "Why.\r\n\r\nHow.\r\n",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  autoMergeRequest: null,
  mergeCommit: null,
  headRefName: "feat/provider",
  baseRefName: "main",
  headRefOid: HEAD,
  url: "https://github.com/someone/thing/pull/12",
  labels: [{ id: "LA_1", name: "feature", description: "", color: "0e8a16" }],
  author: { id: "U_1", is_bot: false, login: "someone", name: "Some One" },
  updatedAt: "2026-01-02T03:04:05Z",
  statusCheckRollup: [
    { __typename: "CheckRun", name: "validate", workflowName: "ci", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/someone/thing/actions/runs/101/job/1" },
    { __typename: "CheckRun", name: "unit", workflowName: "ci", status: "COMPLETED", conclusion: "SKIPPED", detailsUrl: "https://github.com/someone/thing/actions/runs/101/job/2" },
    { __typename: "StatusContext", context: "license/cla", state: "SUCCESS", targetUrl: "https://example.com/cla" },
  ],
};

const GL_MR = {
  id: 9001,
  iid: 12,
  project_id: 4242,
  title: "Add the provider layer",
  description: "Why.\r\n\r\nHow.\r\n",
  state: "opened",
  draft: false,
  work_in_progress: false,
  source_branch: "feat/provider",
  target_branch: "main",
  sha: HEAD,
  web_url: "https://gitlab.com/group/sub/thing/-/merge_requests/12",
  merge_status: "can_be_merged",
  detailed_merge_status: "mergeable",
  has_conflicts: false,
  merge_when_pipeline_succeeds: false,
  squash: false,
  squash_on_merge: false,
  merge_commit_sha: null,
  squash_commit_sha: null,
  labels: ["feature"],
  author: { id: 1, username: "someone", name: "Some One" },
  updated_at: "2026-01-02T03:04:05.678Z",
  head_pipeline: { id: 99, iid: 5, status: "success", sha: HEAD, web_url: "https://gitlab.com/group/sub/thing/-/pipelines/99" },
};

const CHANGE = {
  number: 12,
  title: "Add the provider layer",
  body: "Why.\n\nHow.",
  state: "open",
  draft: false,
  source: "feat/provider",
  target: "main",
  sha: HEAD,
  mergeable: true,
  conflicts: false,
  mergeStatus: "ready",
  autoMerge: false,
  mergeSha: null,
  labels: ["feature"],
  author: "someone",
};

test("viewChange reads a pull request and a merge request into the same object", () => {
  const gh = fake({ json: GH_PR });
  const pr = viewChange(GH, 12, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [["gh", "pr", "view", "12", ...R, "--json", GH_CHANGE_FIELDS]]);
  assert.deepEqual(pr, { ok: true, value: {
    ...CHANGE,
    url: "https://github.com/someone/thing/pull/12",
    mergeStatusRaw: "clean",
    squash: null,
    updatedAt: "2026-01-02T03:04:05Z",
    checks: { state: "passed", failed: [], id: null, url: "https://github.com/someone/thing/pull/12/checks", sha: HEAD },
  } });

  const gl = fake({ json: GL_MR });
  const mr = viewChange(GL, "12", { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "GET", `${P}/merge_requests/12`]]);
  assert.deepEqual(mr, { ok: true, value: {
    ...CHANGE,
    url: "https://gitlab.com/group/sub/thing/-/merge_requests/12",
    mergeStatusRaw: "mergeable",
    squash: false,
    updatedAt: "2026-01-02T03:04:05.678Z",
    checks: { state: "passed", failed: [], id: 99, url: "https://gitlab.com/group/sub/thing/-/pipelines/99", sha: HEAD },
  } });

  assert.deepEqual(Object.keys(pr.value).sort(), Object.keys(mr.value).sort());
  assert.deepEqual(Object.keys(pr.value.checks), Object.keys(mr.value.checks));
});

test("viewChange names what failed, and leaves out what is allowed to", () => {
  const rollup = [
    { __typename: "CheckRun", name: "validate", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/someone/thing/actions/runs/101/job/1" },
    { __typename: "CheckRun", name: "unit", status: "IN_PROGRESS", conclusion: "", detailsUrl: "https://github.com/someone/thing/actions/runs/102/job/2" },
    { __typename: "StatusContext", context: "coverage", state: "ERROR" },
  ];
  const pr = viewChange(GH, 12, { run: fake({ json: { ...GH_PR, mergeStateStatus: "BLOCKED", reviewDecision: "", statusCheckRollup: rollup } }).run, env: {} }).value;
  assert.deepEqual([pr.checks.state, pr.checks.failed, pr.mergeStatus, pr.mergeable], ["failed", ["validate", "coverage"], "checks", false]);

  const gl = fake(
    { json: { ...GL_MR, detailed_merge_status: "ci_must_pass", head_pipeline: { ...GL_MR.head_pipeline, status: "failed" } } },
    { json: [{ name: "validate", status: "failed", allow_failure: false }, { name: "lint-advice", status: "failed", allow_failure: true }] },
  );
  const mr = viewChange(GL, 12, { run: gl.run, env: {} }).value;
  assert.deepEqual(gl.lines()[1], ["glab", "api", "-X", "GET", `${P}/pipelines/99/jobs?scope%5B%5D=failed&per_page=100`]);
  assert.deepEqual([mr.checks.state, mr.checks.failed, mr.mergeStatus, mr.mergeable], ["failed", ["validate"], "checks", false]);

  // The jobs are a detail: failing to list them does not fail the read.
  const blind = fake({ json: { ...GL_MR, head_pipeline: { ...GL_MR.head_pipeline, status: "canceled" } } }, NOT_FOUND_GL);
  assert.deepEqual(viewChange(GL, 12, { run: blind.run, env: {} }).value.checks.failed, []);
});

const GH_STATES = [
  // mergeStateStatus, mergeable, extra, then mergeStatus, mergeable, conflicts
  ["CLEAN", "MERGEABLE", {}, "ready", true, false],
  ["HAS_HOOKS", "MERGEABLE", {}, "ready", true, false],
  ["UNSTABLE", "MERGEABLE", {}, "ready", true, false],
  ["UNKNOWN", "UNKNOWN", {}, "checking", null, false],
  ["DIRTY", "CONFLICTING", {}, "conflicts", false, true],
  ["BEHIND", "MERGEABLE", {}, "behind", false, false],
  ["BLOCKED", "MERGEABLE", { reviewDecision: "REVIEW_REQUIRED" }, "approval", false, false],
  ["BLOCKED", "MERGEABLE", { reviewDecision: "CHANGES_REQUESTED" }, "blocked", false, false],
  ["BLOCKED", "MERGEABLE", { reviewDecision: "" }, "blocked", false, false],
  ["BLOCKED", "MERGEABLE", { reviewDecision: "", statusCheckRollup: [{ __typename: "CheckRun", name: "unit", status: "QUEUED" }] }, "checks", false, false],
  ["BLOCKED", "MERGEABLE", { isDraft: true }, "draft", false, false],
  ["CLEAN", "MERGEABLE", { state: "MERGED", mergeCommit: { oid: HEAD } }, "closed", false, false],
];
const GL_STATES = [
  // detailed_merge_status, extra, then mergeStatus, mergeable, conflicts
  ["mergeable", {}, "ready", true, false],
  ["checking", {}, "checking", null, false],
  ["unchecked", {}, "checking", null, false],
  ["approvals_syncing", {}, "checking", null, false],
  ["conflict", { has_conflicts: true }, "conflicts", false, true],
  ["need_rebase", {}, "behind", false, false],
  ["ci_must_pass", {}, "checks", false, false],
  ["ci_still_running", {}, "checks", false, false],
  ["not_approved", {}, "approval", false, false],
  ["draft_status", { draft: true }, "draft", false, false],
  ["discussions_not_resolved", {}, "blocked", false, false],
  ["a_status_from_the_future", {}, "unknown", false, false],
  ["not_open", { state: "merged" }, "closed", false, false],
  // An older server has only merge_status.
  [undefined, { merge_status: "can_be_merged" }, "ready", true, false],
  [undefined, { merge_status: "cannot_be_merged" }, "conflicts", false, true],
];

test("both forges' merge states read as one small set", () => {
  for (const [status, mergeable, extra, want, can, conflicts] of GH_STATES) {
    const pr = viewChange(GH, 12, { run: fake({ json: { ...GH_PR, mergeStateStatus: status, mergeable, ...extra } }).run, env: {} }).value;
    assert.deepEqual([pr.mergeStatus, pr.mergeable, pr.conflicts], [want, can, conflicts], `${status} ${JSON.stringify(extra)}`);
  }
  for (const [status, extra, want, can, conflicts] of GL_STATES) {
    const mr = viewChange(GL, 12, { run: fake({ json: { ...GL_MR, detailed_merge_status: status, ...extra } }).run, env: {} }).value;
    assert.deepEqual([mr.mergeStatus, mr.mergeable, mr.conflicts], [want, can, conflicts], `${status} ${JSON.stringify(extra)}`);
  }
});

test("both forges' check states read as one small set", () => {
  const run = (status, conclusion) => ({ __typename: "CheckRun", name: "unit", status, conclusion });
  const github = [
    [[], "none"],
    [[run("COMPLETED", "SUCCESS"), run("COMPLETED", "NEUTRAL")], "passed"],
    [[run("COMPLETED", "SKIPPED")], "skipped"],
    [[run("COMPLETED", "SUCCESS"), run("QUEUED", "")], "pending"],
    [[run("COMPLETED", "SUCCESS"), { __typename: "StatusContext", context: "deploy", state: "PENDING" }], "pending"],
    [[run("WAITING", "")], "blocked"],
    [[run("COMPLETED", "ACTION_REQUIRED")], "blocked"],
    [[run("COMPLETED", "CANCELLED"), run("IN_PROGRESS", "")], "canceled"],
    [[run("COMPLETED", "TIMED_OUT"), run("COMPLETED", "CANCELLED")], "failed"],
  ];
  for (const [rollup, want] of github) {
    assert.equal(viewChange(GH, 12, { run: fake({ json: { ...GH_PR, statusCheckRollup: rollup } }).run, env: {} }).value.checks.state, want, JSON.stringify(rollup));
  }
  const gitlab = [["success", "passed"], ["failed", "failed"], ["canceled", "canceled"], ["skipped", "skipped"], ["manual", "blocked"], ["created", "pending"], ["pending", "pending"], ["running", "pending"], ["waiting_for_resource", "pending"], ["scheduled", "pending"]];
  for (const [status, want] of gitlab) {
    const mr = viewChange(GL, 12, { run: fake({ json: { ...GL_MR, head_pipeline: { ...GL_MR.head_pipeline, status } } }, { json: [] }).run, env: {} }).value;
    assert.equal(mr.checks.state, want, status);
  }
  const bare = viewChange(GL, 12, { run: fake({ json: { ...GL_MR, head_pipeline: null } }).run, env: {} }).value;
  assert.deepEqual(bare.checks, { state: "none", failed: [], id: null, url: null, sha: HEAD });
});

test("listChanges finds the change requests of a branch", () => {
  const { statusCheckRollup, ...listed } = GH_PR;
  const gh = fake({ json: [listed] });
  const prs = listChanges(GH, { source: "feat/provider", target: "main" }, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [["gh", "pr", "list", ...R, "--state", "open", "--head", "feat/provider", "--base", "main", "--limit", "30", "--json", GH_CHANGE_LIST_FIELDS]]);
  assert.deepEqual([prs.value.length, prs.value[0].number, prs.value[0].sha, prs.value[0].mergeStatus, prs.value[0].checks], [1, 12, HEAD, "ready", null]);

  const { head_pipeline, ...row } = GL_MR;
  const gl = fake({ json: [row] });
  const mrs = listChanges(GL, { source: "feat/provider" }, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "GET", `${P}/merge_requests?state=opened&source_branch=feat%2Fprovider&order_by=updated_at&sort=desc&per_page=30&page=1`]]);
  assert.deepEqual([mrs.value.length, mrs.value[0].number, mrs.value[0].sha, mrs.value[0].mergeStatus, mrs.value[0].checks], [1, 12, HEAD, "ready", null]);
  assert.deepEqual(Object.keys(prs.value[0]).sort(), Object.keys(mrs.value[0]).sort());

  const all = fake({ json: [] });
  listChanges(GL, { state: "all", limit: 5 }, { run: all.run, env: {} });
  assert.equal(all.lines()[0][4], `${P}/merge_requests?order_by=updated_at&sort=desc&per_page=5&page=1`);
  const merged = fake({ json: [] });
  listChanges(GH, { state: "merged", limit: 5 }, { run: merged.run, env: {} });
  assert.deepEqual(merged.lines()[0].slice(5), ["--state", "merged", "--limit", "5", "--json", GH_CHANGE_LIST_FIELDS]);
});

test("createChange opens a pull request with the body on stdin, then reads it back", () => {
  const gh = fake({ stdout: "https://github.com/someone/thing/pull/12\n" }, { json: GH_PR });
  const made = createChange(GH, { title: "Add the provider layer", body: "Why.\n\n`$(not a shell)`", source: "feat/provider", target: "main", draft: true, labels: ["feature", "needs review"] }, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [
    ["gh", "pr", "create", ...R, "--title", "Add the provider layer", "--body-file", "-", "--head", "feat/provider", "--base", "main", "--draft", "--label", "feature", "--label", "needs review"],
    ["gh", "pr", "view", "12", ...R, "--json", GH_CHANGE_FIELDS],
  ]);
  assert.equal(gh.calls[0].input, "Why.\n\n`$(not a shell)`");
  assert.deepEqual([made.ok, made.value.number, made.value.url], [true, 12, "https://github.com/someone/thing/pull/12"]);

  // gh picks the branch and the base itself when they are not named.
  const plain = fake({ stdout: "Creating pull request\nhttps://github.com/someone/thing/pull/13\n" }, NOT_FOUND_GH);
  const partial = createChange(GH, { title: "Second" }, { run: plain.run, env: {} });
  assert.deepEqual(plain.lines()[0], ["gh", "pr", "create", ...R, "--title", "Second", "--body-file", "-"]);
  assert.equal(plain.calls[0].input, "");
  // It was created, so a read back that fails still answers the pull request.
  assert.deepEqual([partial.ok, partial.value.number, partial.value.title, partial.value.state, partial.value.checks], [true, 13, "Second", "open", null]);

  assert.equal(createChange(GH, { title: "x" }, { run: fake({ stdout: "nothing useful\n" }).run, env: {} }).error, "failed");
});

test("createChange opens a merge request through the API, with the body in the JSON on stdin", () => {
  const gl = fake({ json: { ...GL_MR, title: "Draft: Add the provider layer", draft: true, detailed_merge_status: "draft_status" } });
  const made = createChange(GL, { title: "Add the provider layer", body: "Why.", source: "feat/provider", target: "main", draft: true, labels: ["feature", "needs review"] }, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "POST", `${P}/merge_requests`, ...JSON_BODY]]);
  assert.deepEqual(gl.sent(0), { source_branch: "feat/provider", target_branch: "main", title: "Draft: Add the provider layer", description: "Why.", labels: "feature,needs review" });
  assert.deepEqual([made.value.number, made.value.draft, made.value.mergeStatus], [12, true, "draft"]);

  // With no branches named: the checked-out branch, into the project's default branch.
  const plain = fake({ stdout: "feat/provider\n" }, { json: { id: 4242, default_branch: "trunk" } }, { json: GL_MR });
  createChange(GL, { title: "Draft: already marked", draft: true }, { run: plain.run, env: {} });
  assert.deepEqual(plain.lines(), [
    ["git", "branch", "--show-current"],
    ["glab", "api", "-X", "GET", P],
    ["glab", "api", "-X", "POST", `${P}/merge_requests`, ...JSON_BODY],
  ]);
  assert.equal(plain.calls[0].cwd, "checkout");
  assert.deepEqual(plain.sent(2), { source_branch: "feat/provider", target_branch: "trunk", title: "Draft: already marked", description: "" });

  const twice = createChange(GL, { title: "x", source: "feat/provider", target: "main" }, { run: fake({ status: 1, stdout: '{"message":["Another open merge request already exists for this source branch: !12"]}', stderr: "glab: (HTTP 409)\n" }).run, env: {} });
  assert.equal(twice.error, "exists");
});

test("updateChange edits a pull request in gh's own steps, then reads it back", () => {
  const gh = fake({}, {}, {}, { json: { ...GH_PR, state: "CLOSED" } });
  const now = updateChange(GH, 12, { title: "New title", body: "New body", target: "release", draft: false, addLabels: ["a"], removeLabels: ["b"], squash: false, state: "closed" }, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [
    ["gh", "pr", "edit", "12", ...R, "--title", "New title", "--body-file", "-", "--base", "release", "--add-label", "a", "--remove-label", "b"],
    ["gh", "pr", "ready", "12", ...R],
    ["gh", "pr", "close", "12", ...R],
    ["gh", "pr", "view", "12", ...R, "--json", GH_CHANGE_FIELDS],
  ]);
  assert.equal(gh.calls[0].input, "New body");
  assert.deepEqual([now.value.state, now.value.mergeStatus], ["closed", "closed"]);

  const draft = fake({}, {}, { json: GH_PR });
  updateChange(GH, 12, { draft: true, state: "open" }, { run: draft.run, env: {} });
  assert.deepEqual(draft.lines().slice(0, 2), [["gh", "pr", "ready", "12", ...R, "--undo"], ["gh", "pr", "reopen", "12", ...R]]);

  // The first step that fails is the answer; nothing after it runs.
  const stop = fake({ status: 1, stderr: "HTTP 403: Must have admin rights to Repository. (https://api.github.com/repos/someone/thing)\n" });
  assert.equal(updateChange(GH, 12, { title: "x", state: "closed" }, { run: stop.run, env: {} }).error, "forbidden");
  assert.equal(stop.calls.length, 1);
});

test("updateChange edits a merge request in one call", () => {
  const gl = fake({ json: { ...GL_MR, squash: false } });
  const now = updateChange(GL, 12, { title: "New title", body: "New body", target: "release", addLabels: ["a", "b"], removeLabels: ["c"], squash: false, state: "closed" }, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "PUT", `${P}/merge_requests/12`, ...JSON_BODY]]);
  assert.deepEqual(gl.sent(0), { title: "New title", description: "New body", target_branch: "release", add_labels: "a,b", remove_labels: "c", squash: false, state_event: "close" });
  assert.equal(now.value.squash, false);

  // Draft is a title prefix on GitLab: flipping it reads the title first.
  const ready = fake({ json: { ...GL_MR, title: "Draft: Add the provider layer" } }, { json: GL_MR });
  updateChange(GL, 12, { draft: false }, { run: ready.run, env: {} });
  assert.deepEqual(ready.lines().map((l) => l.slice(2, 5)), [["-X", "GET", `${P}/merge_requests/12`], ["-X", "PUT", `${P}/merge_requests/12`]]);
  assert.deepEqual(ready.sent(1), { title: "Add the provider layer" });
  const draft = fake({ json: GL_MR });
  updateChange(GL, 12, { title: "Add the provider layer", draft: true }, { run: draft.run, env: {} });
  assert.deepEqual(draft.sent(0), { title: "Draft: Add the provider layer" });
});

test("mergeChange merges a pull request and reports what landed", () => {
  const landed = "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567";
  const gh = fake({}, { json: { ...GH_PR, state: "MERGED", mergeCommit: { oid: landed } } });
  const done = mergeChange(GH, 12, { method: "squash", deleteBranch: true, sha: HEAD, subject: "Add the provider layer (#12)", body: "One layer." }, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [
    ["gh", "pr", "merge", "12", ...R, "--squash", "--delete-branch", "--match-head-commit", HEAD, "--subject", "Add the provider layer (#12)", "--body-file", "-"],
    ["gh", "pr", "view", "12", ...R, "--json", GH_CHANGE_FIELDS],
  ]);
  assert.equal(gh.calls[0].input, "One layer.");
  assert.deepEqual([done.value.merged, done.value.queued, done.value.sha, done.value.change.state], [true, false, landed, "merged"]);

  const auto = fake({}, { json: { ...GH_PR, mergeStateStatus: "BLOCKED", autoMergeRequest: { enabledAt: "2026-01-02T03:04:05Z", mergeMethod: "REBASE" } } });
  const queued = mergeChange(GH, 12, { method: "rebase", whenChecksPass: true }, { run: auto.run, env: {} });
  assert.deepEqual(auto.lines()[0], ["gh", "pr", "merge", "12", ...R, "--rebase", "--auto"]);
  assert.equal(auto.calls[0].input, undefined);
  assert.deepEqual([queued.value.merged, queued.value.queued, queued.value.sha], [false, true, null]);

  const plain = fake({}, { json: { ...GH_PR, state: "MERGED", mergeCommit: { oid: landed } } });
  mergeChange(GH, 12, {}, { run: plain.run, env: {} });
  assert.deepEqual(plain.lines()[0], ["gh", "pr", "merge", "12", ...R, "--merge"]);

  const moved = mergeChange(GH, 12, { sha: HEAD }, { run: fake({ status: 1, stderr: "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)\n" }).run, env: {} });
  assert.equal(moved.error, "refused");
});

test("mergeChange merges a merge request and reports what landed", () => {
  const landed = "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567";
  const gl = fake({ json: { ...GL_MR, state: "merged", detailed_merge_status: "not_open", squash_commit_sha: landed } });
  const done = mergeChange(GL, 12, { method: "squash", deleteBranch: true, sha: HEAD, subject: "Add the provider layer", body: "One layer." }, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "PUT", `${P}/merge_requests/12/merge`, ...JSON_BODY]]);
  assert.deepEqual(gl.sent(0), { squash: true, should_remove_source_branch: true, sha: HEAD, squash_commit_message: "Add the provider layer\n\nOne layer." });
  assert.deepEqual([done.value.merged, done.value.queued, done.value.sha, done.value.change.state], [true, false, landed, "merged"]);

  const auto = fake({ json: { ...GL_MR, detailed_merge_status: "ci_still_running", merge_when_pipeline_succeeds: true } });
  const queued = mergeChange(GL, 12, { whenChecksPass: true }, { run: auto.run, env: {} });
  assert.deepEqual(auto.sent(0), { squash: false, should_remove_source_branch: false, merge_when_pipeline_succeeds: true });
  assert.deepEqual([queued.value.merged, queued.value.queued, queued.value.sha], [false, true, null]);

  // A fast-forward makes no merge commit: the head is what landed.
  const forward = fake({ json: { ...GL_MR, state: "merged" } });
  const ff = mergeChange(GL, 12, { method: "rebase", subject: "Land it" }, { run: forward.run, env: {} });
  assert.deepEqual(forward.sent(0), { squash: false, should_remove_source_branch: false, merge_commit_message: "Land it" });
  assert.equal(ff.value.sha, HEAD);

  const no = mergeChange(GL, 12, {}, { run: fake({ status: 1, stdout: '{"message":"405 Method Not Allowed"}', stderr: "glab: 405 Method Not Allowed (HTTP 405)\n" }).run, env: {} });
  assert.deepEqual([no.error, no.status], ["refused", 405]);
});

test("approveChange approves on both forges", () => {
  const gh = fake({});
  assert.deepEqual(approveChange(GH, 12, { run: gh.run, env: {} }), { ok: true, value: { approved: true } });
  assert.deepEqual(gh.lines(), [["gh", "pr", "review", "12", ...R, "--approve"]]);
  const gl = fake({ json: { id: 9001, iid: 12, approved: true } });
  assert.deepEqual(approveChange(GL, 12, { run: gl.run, env: {} }), { ok: true, value: { approved: true } });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "POST", `${P}/merge_requests/12/approve`]]);
});

test("retryChecks reruns what failed, or starts what is missing", () => {
  const rollup = [
    { __typename: "CheckRun", name: "validate", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/someone/thing/actions/runs/101/job/1" },
    { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/someone/thing/actions/runs/101/job/2" },
    { __typename: "CheckRun", name: "deploy", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: "https://github.com/someone/thing/actions/runs/103/job/3" },
    { __typename: "CheckRun", name: "docs", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/someone/thing/actions/runs/104/job/4" },
    { __typename: "StatusContext", context: "coverage", state: "FAILURE", targetUrl: "https://example.com/coverage" },
  ];
  const gh = fake({ json: { statusCheckRollup: rollup } });
  assert.deepEqual(retryChecks(GH, 12, { run: gh.run, env: {} }), { ok: true, value: { started: 2 } });
  assert.deepEqual(gh.lines(), [
    ["gh", "pr", "view", "12", ...R, "--json", "statusCheckRollup"],
    ["gh", "run", "rerun", "101", ...R, "--failed"],
    ["gh", "run", "rerun", "103", ...R, "--failed"],
  ]);

  const red = fake({ json: { ...GL_MR, head_pipeline: { ...GL_MR.head_pipeline, status: "failed" } } }, { json: { id: 99, status: "pending" } });
  assert.deepEqual(retryChecks(GL, 12, { run: red.run, env: {} }), { ok: true, value: { started: 1 } });
  assert.deepEqual(red.lines(), [["glab", "api", "-X", "GET", `${P}/merge_requests/12`], ["glab", "api", "-X", "POST", `${P}/pipelines/99/retry`]]);

  const none = fake({ json: { ...GL_MR, head_pipeline: null } }, { json: { id: 100, status: "created" } });
  assert.deepEqual(retryChecks(GL, 12, { run: none.run, env: {} }), { ok: true, value: { started: 1 } });
  assert.deepEqual(none.lines()[1], ["glab", "api", "-X", "POST", `${P}/merge_requests/12/pipelines`]);

  const green = fake({ json: GL_MR });
  assert.deepEqual(retryChecks(GL, 12, { run: green.run, env: {} }), { ok: true, value: { started: 0 } });
  assert.equal(green.calls.length, 1);
});

test("comments go by stdin on both forges", () => {
  const body = "Looks right.\n\n```sh\necho \"$HOME\" && exit 1\n```\n";
  const pr = fake({ stdout: "https://github.com/someone/thing/pull/12#issuecomment-3456\n" });
  assert.deepEqual(commentOnChange(GH, 12, body, { run: pr.run, env: {} }), { ok: true, value: { id: 3456, url: "https://github.com/someone/thing/pull/12#issuecomment-3456" } });
  assert.deepEqual(pr.lines(), [["gh", "pr", "comment", "12", ...R, "--body-file", "-"]]);
  assert.equal(pr.calls[0].input, body);

  const issue = fake({ stdout: "https://github.com/someone/thing/issues/5#issuecomment-3457\n" });
  assert.deepEqual(commentOnIssue(GH, 5, body, { run: issue.run, env: {} }).value, { id: 3457, url: "https://github.com/someone/thing/issues/5#issuecomment-3457" });
  assert.deepEqual(issue.lines(), [["gh", "issue", "comment", "5", ...R, "--body-file", "-"]]);

  const mr = fake({ json: { id: 77, body, author: { username: "someone" } } });
  assert.deepEqual(commentOnChange(GL, 12, body, { run: mr.run, env: {} }), { ok: true, value: { id: 77, url: "https://gitlab.com/group/sub/thing/-/merge_requests/12#note_77" } });
  assert.deepEqual(mr.lines(), [["glab", "api", "-X", "POST", `${P}/merge_requests/12/notes`, ...JSON_BODY]]);
  assert.deepEqual(mr.sent(0), { body });

  const note = fake({ json: { id: 78 } });
  assert.deepEqual(commentOnIssue({ ...GL, host: null }, 5, body, { run: note.run, env: {} }).value, { id: 78, url: null });
  assert.deepEqual(note.lines(), [["glab", "api", "-X", "POST", `${P}/issues/5/notes`, ...JSON_BODY]]);
});

// ---------------------------------------------------------------------------
// Issues

const GH_ISSUE = {
  number: 5,
  title: "Publish the plan",
  body: "## What to build\r\n\r\nThe thing.\r\n",
  state: "OPEN",
  labels: [{ id: "LA_2", name: "ready-for-agent", description: "", color: "1d76db" }, { id: "LA_3", name: "status:todo", description: "", color: "ededed" }],
  url: "https://github.com/someone/thing/issues/5",
  assignees: [{ id: "U_1", login: "someone", name: "Some One" }],
  milestone: { number: 2, title: "Sprint 1", description: "", dueOn: "2026-02-01T12:00:00Z" },
  author: { id: "U_2", is_bot: false, login: "another", name: "" },
  updatedAt: "2026-01-02T03:04:05Z",
};

const GL_ISSUE = {
  id: 7001,
  iid: 5,
  project_id: 4242,
  title: "Publish the plan",
  description: "## What to build\r\n\r\nThe thing.\r\n",
  state: "opened",
  labels: ["ready-for-agent", "status:todo"],
  web_url: "https://gitlab.com/group/sub/thing/-/issues/5",
  assignees: [{ id: 1, username: "someone", name: "Some One" }],
  milestone: { id: 31, iid: 2, title: "Sprint 1", due_date: "2026-02-01" },
  author: { id: 2, username: "another", name: "" },
  updated_at: "2026-01-02T03:04:05.678Z",
};

const ISSUE = {
  number: 5,
  title: "Publish the plan",
  body: "## What to build\n\nThe thing.",
  state: "open",
  labels: ["ready-for-agent", "status:todo"],
  assignees: ["someone"],
  milestone: "Sprint 1",
  author: "another",
};

test("viewIssue reads an issue into the same object on both forges", () => {
  const gh = fake({ json: GH_ISSUE });
  const one = viewIssue(GH, 5, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [["gh", "issue", "view", "5", ...R, "--json", GH_ISSUE_FIELDS]]);
  assert.deepEqual(one, { ok: true, value: { ...ISSUE, url: "https://github.com/someone/thing/issues/5", updatedAt: "2026-01-02T03:04:05Z" } });

  const gl = fake({ json: GL_ISSUE });
  const other = viewIssue(GL, 5, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "GET", `${P}/issues/5`]]);
  assert.deepEqual(other, { ok: true, value: { ...ISSUE, url: "https://gitlab.com/group/sub/thing/-/issues/5", updatedAt: "2026-01-02T03:04:05.678Z" } });
  assert.deepEqual(Object.keys(one.value).sort(), Object.keys(other.value).sort());

  const closed = viewIssue(GL, 5, { run: fake({ json: { ...GL_ISSUE, state: "closed", assignees: [], milestone: null, description: null } }).run, env: {} }).value;
  assert.deepEqual([closed.state, closed.assignees, closed.milestone, closed.body], ["closed", [], null, ""]);
  assert.equal(viewIssue(GH, 5, { run: fake({ json: { ...GH_ISSUE, state: "CLOSED" } }).run, env: {} }).value.state, "closed");
});

test("listIssues filters by state, labels and search", () => {
  const gh = fake({ json: [GH_ISSUE, { ...GH_ISSUE, number: 6, state: "CLOSED" }] });
  const some = listIssues(GH, { state: "all", labels: ["ready-for-agent", "status:todo"], search: "plan in:title", limit: 50 }, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [["gh", "issue", "list", ...R, "--state", "all", "--label", "ready-for-agent", "--label", "status:todo", "--search", "plan in:title", "--limit", "50", "--json", GH_ISSUE_FIELDS]]);
  assert.deepEqual(some.value.map((i) => [i.number, i.state]), [[5, "open"], [6, "closed"]]);

  const plain = fake({ json: [] });
  listIssues(GH, {}, { run: plain.run, env: {} });
  assert.deepEqual(plain.lines(), [["gh", "issue", "list", ...R, "--state", "open", "--limit", "100", "--json", GH_ISSUE_FIELDS]]);

  const gl = fake({ json: [GL_ISSUE] });
  const others = listIssues(GL, { state: "closed", labels: ["ready-for-agent", "status:todo"], search: "the plan", limit: 50 }, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "GET", `${P}/issues?state=closed&labels=ready-for-agent%2Cstatus%3Atodo&search=the+plan&order_by=updated_at&sort=desc&per_page=50&page=1`]]);
  assert.deepEqual(others.value[0], { ...ISSUE, url: "https://gitlab.com/group/sub/thing/-/issues/5", updatedAt: "2026-01-02T03:04:05.678Z" });

  // More than a page: GitLab is read until the limit.
  const page = (from) => Array.from({ length: 100 }, (_, i) => ({ ...GL_ISSUE, iid: from + i }));
  const long = fake({ json: page(1) }, { json: page(101) });
  const many = listIssues(GL, { limit: 150 }, { run: long.run, env: {} });
  assert.equal(many.value.length, 150);
  assert.deepEqual(long.lines().map((l) => l[4]), [
    `${P}/issues?state=opened&order_by=updated_at&sort=desc&per_page=100&page=1`,
    `${P}/issues?state=opened&order_by=updated_at&sort=desc&per_page=100&page=2`,
  ]);
});

test("createIssue opens an issue with the body on stdin", () => {
  const gh = fake({ stdout: "https://github.com/someone/thing/issues/5\n" }, { json: GH_ISSUE });
  const made = createIssue(GH, { title: "Publish the plan", body: "## What to build\n\nThe thing.", labels: ["ready-for-agent", "status:todo"], milestone: "Sprint 1" }, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [
    ["gh", "issue", "create", ...R, "--title", "Publish the plan", "--body-file", "-", "--label", "ready-for-agent", "--label", "status:todo", "--milestone", "Sprint 1"],
    ["gh", "issue", "view", "5", ...R, "--json", GH_ISSUE_FIELDS],
  ]);
  assert.equal(gh.calls[0].input, "## What to build\n\nThe thing.");
  assert.deepEqual([made.value.number, made.value.milestone], [5, "Sprint 1"]);

  const blind = createIssue(GH, { title: "Second", labels: ["a"] }, { run: fake({ stdout: "https://github.com/someone/thing/issues/6\n" }, { status: 1, stderr: "gh: HTTP 502\n" }).run, env: {} });
  assert.deepEqual(blind.value, { number: 6, title: "Second", body: "", state: "open", labels: ["a"], url: "https://github.com/someone/thing/issues/6", assignees: [], milestone: null, author: null, updatedAt: null });

  const gl = fake({ json: [{ id: 30, title: "Sprint 10" }, { id: 31, title: "Sprint 1" }] }, { json: GL_ISSUE });
  const other = createIssue(GL, { title: "Publish the plan", body: "The thing.", labels: ["ready-for-agent", "status:todo"], milestone: "Sprint 1" }, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [
    ["glab", "api", "-X", "GET", `${P}/milestones?title=Sprint+1&include_ancestors=true`],
    ["glab", "api", "-X", "POST", `${P}/issues`, ...JSON_BODY],
  ]);
  assert.deepEqual(gl.sent(1), { title: "Publish the plan", description: "The thing.", labels: "ready-for-agent,status:todo", milestone_id: 31 });
  assert.equal(other.value.number, 5);

  const bare = fake({ json: GL_ISSUE });
  createIssue(GL, { title: "No frills" }, { run: bare.run, env: {} });
  assert.deepEqual(bare.sent(0), { title: "No frills", description: "" });

  const lost = createIssue(GL, { title: "x", milestone: "Sprint 9" }, { run: fake({ json: [] }).run, env: {} });
  assert.deepEqual([lost.error, lost.hint], ["not-found", 'No milestone is titled "Sprint 9": create it first.']);
});

test("updateIssue edits, relabels, and closes or reopens", () => {
  const gh = fake({}, {}, { json: { ...GH_ISSUE, state: "CLOSED" } });
  const now = updateIssue(GH, 5, { title: "New title", body: "New body", addLabels: ["status:done"], removeLabels: ["status:todo"], milestone: null, state: "closed" }, { run: gh.run, env: {} });
  assert.deepEqual(gh.lines(), [
    ["gh", "issue", "edit", "5", ...R, "--title", "New title", "--body-file", "-", "--add-label", "status:done", "--remove-label", "status:todo", "--remove-milestone"],
    ["gh", "issue", "close", "5", ...R],
    ["gh", "issue", "view", "5", ...R, "--json", GH_ISSUE_FIELDS],
  ]);
  assert.equal(gh.calls[0].input, "New body");
  assert.equal(now.value.state, "closed");

  const reopen = fake({}, { json: GH_ISSUE });
  updateIssue(GH, 5, { state: "open" }, { run: reopen.run, env: {} });
  assert.deepEqual(reopen.lines()[0], ["gh", "issue", "reopen", "5", ...R]);
  const stone = fake({}, { json: GH_ISSUE });
  updateIssue(GH, 5, { milestone: "Sprint 2" }, { run: stone.run, env: {} });
  assert.deepEqual(stone.lines()[0], ["gh", "issue", "edit", "5", ...R, "--milestone", "Sprint 2"]);
  assert.equal(stone.calls[0].input, undefined);

  const gl = fake({ json: { ...GL_ISSUE, state: "closed" } });
  const other = updateIssue(GL, 5, { title: "New title", body: "New body", addLabels: ["status:done"], removeLabels: ["status:todo"], milestone: null, state: "closed" }, { run: gl.run, env: {} });
  assert.deepEqual(gl.lines(), [["glab", "api", "-X", "PUT", `${P}/issues/5`, ...JSON_BODY]]);
  assert.deepEqual(gl.sent(0), { title: "New title", description: "New body", add_labels: "status:done", remove_labels: "status:todo", milestone_id: 0, state_event: "close" });
  assert.equal(other.value.state, "closed");

  const back = fake({ json: GL_ISSUE });
  updateIssue(GL, 5, { state: "open" }, { run: back.run, env: {} });
  assert.deepEqual(back.sent(0), { state_event: "reopen" });
});

test("ensureLabel makes a label once and leaves an existing one alone", () => {
  const gh = fake({}, { status: 1, stderr: 'label with name "epic:auth" already exists; use `--force` to update its color and description\n' });
  assert.deepEqual(ensureLabel(GH, "epic:auth", { color: "#1d76db", description: "Epic 1" }, { run: gh.run, env: {} }), { ok: true, value: { created: true } });
  assert.deepEqual(ensureLabel(GH, "epic:auth", {}, { run: gh.run, env: {} }), { ok: true, value: { created: false } });
  assert.deepEqual(gh.lines(), [
    ["gh", "label", "create", "epic:auth", ...R, "--color", "1d76db", "--description", "Epic 1"],
    ["gh", "label", "create", "epic:auth", ...R],
  ]);

  const gl = fake({ json: { id: 1, name: "epic::auth" } }, { status: 1, stdout: '{"message":"Label already exists"}', stderr: "glab: Label already exists (HTTP 409)\n" });
  assert.deepEqual(ensureLabel(GL, "epic::auth", { color: "1d76db", description: "Epic 1" }, { run: gl.run, env: {} }), { ok: true, value: { created: true } });
  assert.deepEqual(ensureLabel(GL, "epic::auth", {}, { run: gl.run, env: {} }), { ok: true, value: { created: false } });
  assert.deepEqual(gl.lines()[0], ["glab", "api", "-X", "POST", `${P}/labels`, ...JSON_BODY]);
  assert.deepEqual([gl.sent(0), gl.sent(1)], [{ name: "epic::auth", color: "#1d76db", description: "Epic 1" }, { name: "epic::auth", color: "#6699cc" }]);
  assert.equal(ensureLabel(GL, "x", {}, { run: fake(NOT_FOUND_GL).run, env: {} }).error, "not-found");
});
