// agentic-teamwork's mr.mjs: the verbs the ship and land skills run, on both
// forges. A fake runner stands in for git, gh and glab: it answers canned
// output per call and records what was sent, so nothing here starts a process
// or reaches a network. Each route holds a list of answers taken in order, the
// last one repeating, which is how a case walks a request from pending to
// ready. Time is a counter the fake sleep advances.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { judge, main } from "../../../plugins/agentic-teamwork/scripts/mr.mjs";
import { runNode, tempDir, write } from "./helpers.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const LANDED = "f".repeat(40);
const REMOTES = { github: "git@github.com:someone/thing.git", gitlab: "git@gitlab.com:group/thing.git", other: "https://git.example.com/team/thing.git" };
const MR = "projects/group%2Fthing/merge_requests/7";
const PR_URL = "https://github.com/someone/thing/pull/7";
const MR_URL = "https://gitlab.com/group/thing/-/merge_requests/7";

/**
 * A runner for one checkout. `routes` maps a call to its answers: for gh the
 * first two words ("pr view"), for glab the method and path ("GET projects/…").
 * An answer is `{ json }`, `{ stdout }`, or a failure `{ status, stderr }`.
 */
function forge(kind, routes = {}) {
  const calls = [];
  const hits = {};
  const run = (cmd, argv, { input } = {}) => {
    if (cmd === "git") {
      if (argv[0] === "remote") return REMOTES[kind] ? { status: 0, stdout: `${REMOTES[kind]}\n`, stderr: "" } : { status: 2, stdout: "", stderr: "error: No such remote 'origin'\n" };
      if (argv[0] === "branch") return { status: 0, stdout: "feat/land\n", stderr: "" };
    }
    const key = cmd === "glab" && argv[0] === "api" ? `${argv[2]} ${argv[3].split("?")[0]}` : argv.slice(0, 2).join(" ");
    calls.push({ cmd, argv, key, input, body: input && cmd === "glab" ? JSON.parse(input) : undefined });
    const answers = routes[key];
    if (!answers) return { status: 1, stdout: "", stderr: `${cmd}: no route for ${key}\n` };
    const a = answers[Math.min(hits[key] ?? 0, answers.length - 1)];
    hits[key] = (hits[key] ?? 0) + 1;
    return { status: a.status ?? 0, stdout: a.json !== undefined ? JSON.stringify(a.json) : a.stdout ?? "", stderr: a.stderr ?? "" };
  };
  return { run, calls, keys: () => calls.map((c) => c.key), count: (key) => calls.filter((c) => c.key === key).length };
}

/** Runs one verb against a fake forge; `out` is what --json would print. */
async function mr(fake, argv, { stdin = "", cwd = "checkout", env = {} } = {}) {
  let clock = 0;
  const notes = [];
  const result = await main(argv, {
    run: fake.run, env, cwd, stdin: () => stdin, note: (line) => notes.push(line),
    now: () => clock, sleep: async (ms) => { clock += Math.max(ms, 1); },
  });
  return { ...result, notes, waited: clock };
}

/** A pull request as `gh pr view --json` prints it. */
function pr({ merge = "CLEAN", checks = ["SUCCESS"], state = "OPEN", sha = HEAD, review = null, draft = false, mergeable = "MERGEABLE", ...rest } = {}) {
  return {
    number: 7, title: "feat: land", body: "why", state, isDraft: draft, mergeable, mergeStateStatus: merge, reviewDecision: review,
    autoMergeRequest: null, mergeCommit: null, headRefName: "feat/land", baseRefName: "main", headRefOid: sha, url: PR_URL,
    labels: [], author: { login: "someone" }, updatedAt: "2026-01-01T00:00:00Z",
    statusCheckRollup: checks.map((c, i) => (c === "RUNNING"
      ? { __typename: "CheckRun", name: `check-${i}`, status: "IN_PROGRESS", conclusion: "", detailsUrl: "https://github.com/someone/thing/actions/runs/55/job/1" }
      : { __typename: "CheckRun", name: `check-${i}`, status: "COMPLETED", conclusion: c, detailsUrl: "https://github.com/someone/thing/actions/runs/55/job/1" })),
    ...rest,
  };
}

/** A merge request as the GitLab API returns it. */
function mrJson({ dms = "mergeable", pipeline = "success", state = "opened", squash = false, sha = HEAD, ...rest } = {}) {
  return {
    iid: 7, state, title: "feat: land", description: "why", source_branch: "feat/land", target_branch: "main", web_url: MR_URL,
    detailed_merge_status: dms, squash, sha, labels: [], author: { username: "someone" }, updated_at: "2026-01-01T00:00:00Z",
    head_pipeline: pipeline === null ? null : { id: 99, status: pipeline, sha, web_url: "https://gitlab.com/group/thing/-/pipelines/99" },
    ...rest,
  };
}
const FAILED_JOBS = { json: [{ name: "validate", allow_failure: false }, { name: "lint-advice", allow_failure: true }] };
const seq = (...items) => items.map((json) => ({ json }));
const viewing = { github: (...prs) => ({ "pr view": seq(...prs) }), gitlab: (...mrs) => ({ [`GET ${MR}`]: seq(...mrs) }) };

/** The same state on each forge, so one case can assert it reads the same on both. */
const STATES = {
  green: { github: pr(), gitlab: mrJson() },
  running: { github: pr({ merge: "BLOCKED", checks: ["RUNNING"] }), gitlab: mrJson({ dms: "ci_still_running", pipeline: "running" }) },
  checking: { github: pr({ merge: "UNKNOWN", mergeable: "UNKNOWN", checks: [] }), gitlab: mrJson({ dms: "checking", pipeline: null }) },
  failed: { github: pr({ merge: "BLOCKED", checks: ["FAILURE"] }), gitlab: mrJson({ dms: "ci_must_pass", pipeline: "failed" }) },
  conflicts: { github: pr({ merge: "DIRTY", mergeable: "CONFLICTING", checks: ["RUNNING"] }), gitlab: mrJson({ dms: "conflict", pipeline: "running" }) },
  behind: { github: pr({ merge: "BEHIND", checks: ["RUNNING"] }), gitlab: mrJson({ dms: "need_rebase", pipeline: "running" }) },
  approval: { github: pr({ merge: "BLOCKED", review: "REVIEW_REQUIRED" }), gitlab: mrJson({ dms: "not_approved" }) },
  draft: { github: pr({ merge: "BLOCKED", draft: true }), gitlab: mrJson({ dms: "draft_status", draft: true }) },
  blocked: { github: pr({ merge: "BLOCKED", review: "CHANGES_REQUESTED" }), gitlab: mrJson({ dms: "discussions_not_resolved" }) },
  merged: { github: pr({ state: "MERGED", mergeCommit: { oid: LANDED } }), gitlab: mrJson({ state: "merged", merge_commit_sha: LANDED }) },
  closed: { github: pr({ state: "CLOSED" }), gitlab: mrJson({ state: "closed", dms: "not_open" }) },
  unchecked: { github: pr({ checks: [] }), gitlab: mrJson({ pipeline: null }) },
};
const FORGES = ["github", "gitlab"];
const routesFor = (kind, ...states) => ({
  ...viewing[kind](...states.map((s) => STATES[s][kind])),
  ...(kind === "gitlab" ? { "GET projects/group%2Fthing/pipelines/99/jobs": [FAILED_JOBS] } : {}),
});

// ---------------------------------------------------------------------------
// check, and which forge this is

test("check names the forge, its word for a change request, and the signed-in account", async (t) => {
  const bin = tempDir(t, "mr-bin-");
  for (const cli of ["gh", "glab"]) fs.chmodSync(write(bin, process.platform === "win32" ? `${cli}.EXE` : cli, ""), 0o755);
  const env = { PATH: bin, PATHEXT: ".EXE" };
  const gh = await mr(forge("github", { "auth status": [{ stdout: "github.com\n  ✓ Logged in to github.com account someone (keyring)\n" }] }), ["check"], { env });
  assert.equal(gh.exit, 0, JSON.stringify(gh));
  assert.deepEqual(gh.out, { forge: "github", noun: "pull request", cli: "gh", host: "github.com", slug: "someone/thing", account: "someone" });
  const gl = await mr(forge("gitlab", { "auth status": [{ stdout: "gitlab.com\n  ✓ Logged in to gitlab.com as someone\n" }] }), ["check"], { env });
  assert.deepEqual(gl.out, { forge: "gitlab", noun: "merge request", cli: "glab", host: "gitlab.com", slug: "group/thing", account: "someone" });
  assert.match(gl.text, /a change request here is a merge request$/);

  const out = await mr(forge("github", { "auth status": [{ status: 1, stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n" }] }), ["check"], { env });
  assert.equal(out.exit, 7);
  assert.equal(out.error.kind, "not-authenticated");
  assert.match(out.error.message, /gh auth login --hostname github\.com/);
});

test("a forge it cannot name is a change request it cannot reach, until told which it is", async (t) => {
  for (const kind of ["other", "none"]) {
    const fake = forge(kind);
    const unknown = await mr(fake, ["status", "7"]);
    assert.equal(unknown.exit, 7, kind);
    assert.equal(unknown.error.kind, "unknown-provider");
    assert.match(unknown.error.message, /its change requests cannot be reached\. Pass --forge github or --forge gitlab\./);
    assert.deepEqual(fake.calls, [], "nothing was asked of a CLI");
  }
  const routes = { "GET projects/team%2Fthing/merge_requests/7": seq(mrJson()) };
  const told = await mr(forge("other", routes), ["status", "7", "--forge", "gitlab"]);
  assert.equal(told.exit, 0, JSON.stringify(told));
  assert.equal(told.out.noun, "merge request");

  // The marker's `forge` answers the same question for everyone who clones the repo.
  const checkout = tempDir(t, "mr-marker-");
  write(checkout, ".agents/manifest.json", JSON.stringify({ forge: "gitlab" }));
  const recorded = await mr(forge("other", routes), ["status", "7"], { cwd: checkout });
  assert.equal(recorded.exit, 0, JSON.stringify(recorded));
  assert.equal(recorded.out.forge, "gitlab");
});

// ---------------------------------------------------------------------------
// open

test("open creates a pull request from the checked-out branch, the body on stdin", async () => {
  const fake = forge("github", { "pr list": seq([]), "pr create": [{ stdout: `${PR_URL}\n` }], "pr view": seq(pr({ merge: "BLOCKED", checks: ["RUNNING"] })) });
  const { exit, out, text } = await mr(fake, ["open", "--title", "feat: land", "--body-file", "-", "--target", "main", "--draft", "--label", "infra"], { stdin: "What changed, with `backticks`.\n" });
  assert.equal(exit, 0, JSON.stringify(out));
  assert.deepEqual(fake.keys(), ["pr list", "pr create", "pr view"]);
  const create = fake.calls[1];
  assert.deepEqual(create.argv, ["pr", "create", "-R", "someone/thing", "--title", "feat: land", "--body-file", "-", "--head", "feat/land", "--base", "main", "--draft", "--label", "infra"]);
  assert.equal(create.input, "What changed, with `backticks`.\n");
  assert.deepEqual([out.created, out.number, out.url, out.forge, out.noun], [true, 7, PR_URL, "github", "pull request"]);
  assert.equal("body" in out, false, "the body is not echoed back");
  assert.equal(text, `PR #7 opened: ${PR_URL}`);
});

test("open creates a merge request into the project's default branch", async () => {
  const fake = forge("gitlab", {
    "GET projects/group%2Fthing/merge_requests": seq([]),
    "GET projects/group%2Fthing": seq({ default_branch: "trunk" }),
    "POST projects/group%2Fthing/merge_requests": seq(mrJson({ dms: "checking", pipeline: null, target_branch: "trunk" })),
  });
  const { exit, out, text } = await mr(fake, ["open", "--title", "feat: land", "--body", "Why."]);
  assert.equal(exit, 0, JSON.stringify(out));
  assert.deepEqual(fake.calls.at(-1).body, { source_branch: "feat/land", target_branch: "trunk", title: "feat: land", description: "Why." });
  assert.deepEqual([out.created, out.number, out.target, out.noun], [true, 7, "trunk", "merge request"]);
  assert.equal(text, `MR !7 opened: ${MR_URL}`);
});

test("open reports the request a branch already has instead of making a second", async () => {
  for (const [kind, list, create] of [["github", "pr list", "pr create"], ["gitlab", "GET projects/group%2Fthing/merge_requests", "POST projects/group%2Fthing/merge_requests"]]) {
    const fake = forge(kind, { [list]: seq([STATES.green[kind]]) });
    const { exit, out, text } = await mr(fake, ["open", "--title", "feat: land", "--source", "feat/other"]);
    assert.equal(exit, 0, kind);
    assert.equal(out.created, false);
    assert.equal(out.number, 7);
    assert.match(text, /is already open from feat\/other/);
    assert.equal(fake.count(create), 0);
    assert.ok(fake.calls[0].argv.join(" ").includes("feat/other") || fake.calls[0].argv[3].includes("source_branch=feat%2Fother"), "the list is filtered by the source branch");
  }
});

test("open needs a title before it asks the forge anything", async () => {
  const fake = forge("github");
  const { exit, error } = await mr(fake, ["open", "--body", "x"]);
  assert.equal(exit, 2);
  assert.match(error.message, /a pull request needs a title/);
  assert.deepEqual(fake.calls, []);
});

// ---------------------------------------------------------------------------
// status

test("status reads a request into the same object on both forges", async () => {
  for (const kind of FORGES) {
    const { exit, out } = await mr(forge(kind, routesFor(kind, "failed")), ["status", "7"]);
    assert.equal(exit, 0, kind);
    assert.deepEqual(
      [out.number, out.state, out.source, out.target, out.sha, out.mergeStatus, out.checks.state],
      [7, "open", "feat/land", "main", HEAD, "checks", "failed"], kind,
    );
    assert.deepEqual(out.checks.failed, kind === "github" ? ["check-0"] : ["validate"], "what failed is named; a job allowed to fail is not");
  }
});

test("status --branch finds the open request from that branch", async () => {
  const gh = forge("github", { "pr list": seq([pr()]), ...routesFor("github", "green") });
  assert.equal((await mr(gh, ["status", "--branch", "feat/land"])).out.number, 7);
  assert.deepEqual(gh.calls[0].argv.slice(0, 8), ["pr", "list", "-R", "someone/thing", "--state", "open", "--head", "feat/land"]);
  const gl = forge("gitlab", { "GET projects/group%2Fthing/merge_requests": seq([mrJson()]), ...routesFor("gitlab", "green") });
  assert.equal((await mr(gl, ["status", "--branch", "feat/land"])).out.number, 7);
  assert.match(gl.calls[0].argv[3], /state=opened&source_branch=feat%2Fland/);

  const none = await mr(forge("github", { "pr list": seq([]) }), ["status", "--branch", "feat/nothing"]);
  assert.equal(none.exit, 7);
  assert.deepEqual(none.error, { kind: "not-found", message: "no open pull request from feat/nothing" });
});

test("status as text is one line, in the forge's own notation", async () => {
  const gh = await mr(forge("github", routesFor("github", "green")), ["status", "7"]);
  assert.equal(gh.text, `PR #7 open ready checks passed ${PR_URL}/checks head ${HEAD}`);
  const gl = await mr(forge("gitlab", routesFor("gitlab", "failed")), ["status", "7"]);
  assert.equal(gl.text, `MR !7 open checks checks failed (failed: validate) https://gitlab.com/group/thing/-/pipelines/99 head ${HEAD}`);
});

// ---------------------------------------------------------------------------
// wait: one case per exit code, each on both forges

test("wait exits 0 on green and mergeable", async () => {
  for (const kind of FORGES) {
    const { exit, out, waited } = await mr(forge(kind, routesFor(kind, "green")), ["wait", "7"]);
    assert.deepEqual([exit, out.exit, out.reason, out.sha], [0, 0, "green and mergeable", HEAD], kind);
    assert.equal(waited, 0, "nothing to wait for");
  }
});

test("wait keeps waiting through the states that resolve by themselves", async () => {
  for (const kind of FORGES) {
    const fake = forge(kind, routesFor(kind, "checking", "running", "running", "green"));
    const { exit, notes, waited } = await mr(fake, ["wait", "7", "--interval", "10", "--timeout", "600"]);
    assert.equal(exit, 0, kind);
    assert.equal(fake.count(kind === "github" ? "pr view" : `GET ${MR}`), 4);
    assert.equal(waited, 30_000, "one interval between reads");
    assert.equal(notes.length, 2, `one progress line per change of state: ${notes.join(" | ")}`);
  }
});

test("wait exits 1 when the checks failed or were canceled, naming them and where to look", async () => {
  for (const kind of FORGES) {
    const { exit, out, text } = await mr(forge(kind, routesFor(kind, "failed")), ["wait", "7"]);
    assert.equal(exit, 1, kind);
    assert.match(out.reason, /^checks failed: /);
    assert.ok(out.checks.url, "the page to send the branch's owner to");
    assert.equal(text.split("\n").length, 1);
  }
  const canceled = await mr(forge("gitlab", { [`GET ${MR}`]: seq(mrJson({ dms: "ci_must_pass", pipeline: "canceled" })), "GET projects/group%2Fthing/pipelines/99/jobs": seq([]) }), ["wait", "7"]);
  assert.deepEqual([canceled.exit, canceled.out.reason], [1, "checks canceled"]);
});

test("wait exits 3 when it is still waiting at the timeout", async () => {
  for (const kind of FORGES) {
    const { exit, out } = await mr(forge(kind, routesFor(kind, "running")), ["wait", "7", "--interval", "10", "--timeout", "25"]);
    assert.equal(exit, 3, kind);
    assert.equal(out.reason, "still waiting after 25s: checks running");
  }
});

test("wait exits 4 when the request needs an approval", async () => {
  for (const kind of FORGES) assert.equal((await mr(forge(kind, routesFor(kind, "approval")), ["wait", "7"])).exit, 4, kind);
});

test("wait exits 5 on conflicts or a branch behind its target, without waiting for the checks", async () => {
  for (const kind of FORGES) {
    for (const state of ["conflicts", "behind"]) {
      const fake = forge(kind, routesFor(kind, state));
      const { exit, out, waited } = await mr(fake, ["wait", "7", "--timeout", "600"]);
      assert.equal(exit, 5, `${kind} ${state}`);
      assert.match(out.reason, /main: sync the branch with it$/);
      assert.equal(waited, 0, `${kind} ${state}: one read, no waiting`);
    }
  }
});

test("wait exits 6 on any other blocker, and names it", async () => {
  for (const kind of FORGES) {
    for (const [state, reason] of [["draft", /is a draft$/], ["blocked", /^blocked \(/], ["closed", /is closed$/], ["merged", /is merged$/]]) {
      const { exit, out } = await mr(forge(kind, routesFor(kind, state)), ["wait", "7"]);
      assert.equal(exit, 6, `${kind} ${state}`);
      assert.match(out.reason, reason, `${kind} ${state}`);
    }
  }
});

test("wait starts the checks once when the forge wants them and the head has none", async () => {
  const fake = forge("gitlab", {
    [`GET ${MR}`]: seq(mrJson({ dms: "ci_must_pass", pipeline: null }), mrJson({ dms: "ci_must_pass", pipeline: null }), mrJson({ dms: "ci_must_pass", pipeline: null }), mrJson({ dms: "ci_still_running", pipeline: "running" }), mrJson()),
    [`POST ${MR}/pipelines`]: seq({ id: 100, status: "created" }),
  });
  const { exit, notes } = await mr(fake, ["wait", "7", "--timeout", "600"]);
  assert.equal(exit, 0);
  assert.equal(fake.count(`POST ${MR}/pipelines`), 1);
  assert.match(notes[0], /^MR !7: no checks on the head; started them$/);
});

test("a request called mergeable with no checks is given a moment for them to appear", async () => {
  for (const kind of FORGES) {
    const appear = await mr(forge(kind, routesFor(kind, "unchecked", "running", "green")), ["wait", "7"]);
    assert.deepEqual([appear.exit, appear.out.reason], [0, "green and mergeable"], kind);

    const never = await mr(forge(kind, routesFor(kind, "unchecked")), ["wait", "7", "--interval", "10", "--settle", "30"]);
    assert.deepEqual([never.exit, never.out.reason, never.waited], [0, "mergeable, with no checks on the head", 30_000], kind);

    const atOnce = await mr(forge(kind, routesFor(kind, "unchecked")), ["wait", "7", "--settle", "0"]);
    assert.deepEqual([atOnce.exit, atOnce.waited], [0, 0], kind);
  }
});

// ---------------------------------------------------------------------------
// merge

test("merge lands the reviewed head of a pull request with a merge commit and removes the branch", async () => {
  const fake = forge("github", { "pr view": seq(pr(), STATES.merged.github), "pr merge": [{ stdout: "" }] });
  const { exit, out, text } = await mr(fake, ["merge", "7", "--sha", HEAD]);
  assert.equal(exit, 0, JSON.stringify(out));
  assert.deepEqual(fake.keys(), ["pr view", "pr merge", "pr view"]);
  assert.deepEqual(fake.calls[1].argv, ["pr", "merge", "7", "-R", "someone/thing", "--merge", "--delete-branch", "--match-head-commit", HEAD]);
  assert.deepEqual([out.merged, out.state, out.mergeSha], [true, "merged", LANDED]);
  assert.equal(text, `PR #7 merged at ${LANDED}`);
});

test("merge turns a merge request's squash flag off, reads it back, then merges the pinned head", async () => {
  const fake = forge("gitlab", {
    [`GET ${MR}`]: seq(mrJson({ squash: true }), mrJson()),
    [`PUT ${MR}`]: seq(mrJson()),
    [`PUT ${MR}/merge`]: seq(mrJson({ state: "merged", merge_commit_sha: LANDED })),
  });
  const { exit, out } = await mr(fake, ["merge", "7", "--sha", HEAD]);
  assert.equal(exit, 0, JSON.stringify(out));
  assert.deepEqual(fake.keys(), [`GET ${MR}`, `PUT ${MR}`, `GET ${MR}`, `PUT ${MR}/merge`]);
  assert.deepEqual(fake.calls[1].body, { squash: false });
  assert.deepEqual(fake.calls[3].body, { squash: false, should_remove_source_branch: true, sha: HEAD });
  assert.deepEqual([out.merged, out.mergeSha], [true, LANDED]);

  // A fast-forward makes no merge commit: the reviewed head is what landed.
  const ff = forge("gitlab", { [`GET ${MR}`]: seq(mrJson()), [`PUT ${MR}/merge`]: seq(mrJson({ state: "merged" })) });
  assert.equal((await mr(ff, ["merge", "7", "--sha", HEAD])).out.mergeSha, HEAD);
  assert.equal(ff.count(`PUT ${MR}`), 0, "a flag that is already off is left alone");
});

test("merge refuses when squash still reads on after turning it off", async () => {
  const fake = forge("gitlab", { [`GET ${MR}`]: seq(mrJson({ squash: true })), [`PUT ${MR}`]: seq(mrJson({ squash: true })) });
  const { exit, out } = await mr(fake, ["merge", "7", "--sha", HEAD]);
  assert.equal(exit, 1);
  assert.equal(out.merged, false);
  assert.match(out.reason, /squash still reads on/);
  assert.equal(fake.count(`PUT ${MR}/merge`), 0);
});

test("merge refuses a head that moved since the review, and a request that is not ready", async () => {
  for (const [kind, mergeCall] of [["github", "pr merge"], ["gitlab", `PUT ${MR}/merge`]]) {
    const moved = forge(kind, viewing[kind](kind === "github" ? pr({ sha: "a".repeat(40) }) : mrJson({ sha: "a".repeat(40) })));
    const refused = await mr(moved, ["merge", "7", "--sha", HEAD]);
    assert.equal(refused.exit, 1, kind);
    assert.equal(refused.out.reason, `the head moved: reviewed ${HEAD}, the head is ${"a".repeat(40)}`);
    assert.equal(moved.count(mergeCall), 0);

    for (const state of ["running", "failed", "approval", "conflicts"]) {
      const fake = forge(kind, routesFor(kind, state));
      const early = await mr(fake, ["merge", "7", "--sha", HEAD]);
      assert.equal(early.exit, 1, `${kind} ${state}`);
      assert.equal(early.out.merged, false);
      assert.equal(fake.count(mergeCall), 0, `${kind} ${state}: no merge call`);
    }
  }
});

test("merge requires the full 40-character head sha, and a method the forges share, before asking anything", async () => {
  for (const kind of FORGES) {
    const fake = forge(kind);
    for (const args of [[], ["--sha", HEAD.slice(0, 8)], ["--sha", HEAD.toUpperCase()]]) {
      const { exit, error } = await mr(fake, ["merge", "7", ...args]);
      assert.equal(exit, 2, args.join(" "));
      assert.match(error.message, /40-character/);
    }
    const method = await mr(fake, ["merge", "7", "--sha", HEAD, "--method", "octopus"]);
    assert.equal(method.exit, 2);
    assert.deepEqual(fake.calls, []);
  }
});

test("merge takes another method and can keep the branch", async () => {
  const gh = forge("github", { "pr view": seq(pr(), STATES.merged.github), "pr merge": [{ stdout: "" }] });
  assert.equal((await mr(gh, ["merge", "7", "--sha", HEAD, "--method", "squash", "--keep-branch"])).exit, 0);
  assert.deepEqual(gh.calls[1].argv.slice(5), ["--squash", "--match-head-commit", HEAD]);
  const gl = forge("gitlab", { [`GET ${MR}`]: seq(mrJson({ squash: true })), [`PUT ${MR}/merge`]: seq(mrJson({ state: "merged", squash_commit_sha: LANDED })) });
  assert.equal((await mr(gl, ["merge", "7", "--sha", HEAD, "--method", "squash", "--keep-branch"])).exit, 0);
  assert.deepEqual(gl.calls.at(-1).body, { squash: true, should_remove_source_branch: false, sha: HEAD });
  assert.equal(gl.count(`PUT ${MR}`), 0, "asked to squash, the flag is left on");
});

test("a merge the forge itself refuses is a refusal with its reason, not a crash", async () => {
  const fake = forge("gitlab", { [`GET ${MR}`]: seq(mrJson()), [`PUT ${MR}/merge`]: [{ status: 1, stdout: '{"message":"405 Method Not Allowed"}', stderr: "glab: 405 Method Not Allowed (HTTP 405)\n" }] });
  const { exit, out } = await mr(fake, ["merge", "7", "--sha", HEAD]);
  assert.equal(exit, 1);
  assert.equal(out.merged, false);
  assert.match(out.reason, /refused/);
});

// ---------------------------------------------------------------------------
// approve, retry, comment

test("approve approves as the signed-in account on both forges", async () => {
  const gh = forge("github", { "pr review": [{ stdout: "" }] });
  assert.deepEqual((await mr(gh, ["approve", "7"])).out, { number: 7, approved: true });
  assert.deepEqual(gh.calls[0].argv, ["pr", "review", "7", "-R", "someone/thing", "--approve"]);
  const gl = forge("gitlab", { [`POST ${MR}/approve`]: seq({ id: 1 }) });
  assert.equal((await mr(gl, ["approve", "7"])).text, "MR !7 approved");
});

test("retry reruns what failed", async () => {
  const gh = forge("github", { "pr view": seq(STATES.failed.github), "run rerun": [{ stdout: "" }] });
  assert.deepEqual((await mr(gh, ["retry", "7"])).out, { number: 7, started: 1 });
  assert.deepEqual(gh.calls[1].argv, ["run", "rerun", "55", "-R", "someone/thing", "--failed"]);
  const gl = forge("gitlab", { [`GET ${MR}`]: seq(STATES.failed.gitlab), "POST projects/group%2Fthing/pipelines/99/retry": seq({ id: 99 }) });
  assert.equal((await mr(gl, ["retry", "7"])).out.started, 1);
  const green = await mr(forge("gitlab", routesFor("gitlab", "green")), ["retry", "7"]);
  assert.equal(green.text, "MR !7: nothing to run again");
});

test("comment sends its body by stdin, and needs one", async () => {
  const gh = forge("github", { "pr comment": [{ stdout: `${PR_URL}#issuecomment-12\n` }] });
  const made = await mr(gh, ["comment", "7", "--body-file", "-"], { stdin: "The unit lane failed: see the run.\n" });
  assert.deepEqual(made.out, { number: 7, id: 12, url: `${PR_URL}#issuecomment-12` });
  assert.equal(gh.calls[0].input, "The unit lane failed: see the run.\n");
  const gl = forge("gitlab", { [`POST ${MR}/notes`]: seq({ id: 5 }) });
  assert.equal((await mr(gl, ["comment", "7", "--body", "Rerun please."])).exit, 0);
  assert.deepEqual(gl.calls[0].body, { body: "Rerun please." });
  const empty = await mr(forge("github"), ["comment", "7", "--body-file", "-"], { stdin: "  \n" });
  assert.equal(empty.exit, 2);
});

// ---------------------------------------------------------------------------
// failures, usage, and the command line itself

test("a forge that cannot be asked exits 7 with what went wrong and the line that fixes it", async () => {
  const cases = [
    [{ status: 1, stderr: "glab: 403 Forbidden (HTTP 403)\n<!DOCTYPE html><html><title>Forbidden</title></html>\n" }, "network", /could not reach gitlab\.com/],
    [{ status: 1, stdout: '{"message":"404 Not found"}', stderr: "glab: 404 Not found (HTTP 404)\n" }, "not-found", /nothing at that number/],
    [{ status: 1, stderr: "glab: 401 Unauthorized (HTTP 401)\n" }, "not-authenticated", /glab auth login --hostname gitlab\.com/],
  ];
  for (const [answer, kind, message] of cases) {
    const { exit, error } = await mr(forge("gitlab", { [`GET ${MR}`]: [answer] }), ["wait", "7"]);
    assert.equal(exit, 7, kind);
    assert.equal(error.kind, kind);
    assert.match(error.message, message);
  }
  const missing = await mr(forge("github", { "pr view": [{ status: 127, stderr: "gh: command not found\n" }] }), ["status", "7"]);
  assert.deepEqual([missing.exit, missing.error.kind], [7, "not-installed"]);
});

test("a usage error exits 2 and asks nothing of a forge", async () => {
  for (const kind of FORGES) {
    const fake = forge(kind);
    for (const argv of [["frobnicate", "7"], [], ["wait"], ["wait", "seven"], ["wait", "0"], ["wait", "7", "--interval", "soon"], ["status", "7", "--forge", "bitbucket"], ["status", "7", "--nope"]]) {
      const { exit, error } = await mr(fake, argv);
      assert.equal(exit, 2, argv.join(" "));
      assert.equal(error.kind, "usage");
    }
    assert.deepEqual(fake.calls, []);
  }
});

test("judge reads one state the same way whichever forge it came from", () => {
  const change = (over) => ({ state: "open", mergeStatus: "ready", mergeStatusRaw: "clean", target: "main", checks: { state: "passed", failed: [] }, ...over });
  assert.deepEqual(judge(change({})), { exit: 0, reason: "green and mergeable" });
  assert.deepEqual(judge(change({ checks: { state: "skipped", failed: [] } })), { exit: 0, reason: "green and mergeable" });
  assert.deepEqual(judge(change({ checks: null })), { exit: 0, reason: "mergeable, with no checks on the head", unchecked: true });
  assert.deepEqual(judge(change({ checks: { state: "failed", failed: ["lint", "unit"] } })), { exit: 1, reason: "checks failed: lint, unit" });
  assert.deepEqual(judge(change({ mergeStatus: "checks", checks: { state: "none", failed: [] } })), { wait: "no checks on the head", restart: true });
  assert.deepEqual(judge(change({ mergeStatus: "checks", checks: { state: "blocked", failed: [] } })), { exit: 6, reason: "a check is waiting on a person" });
  assert.deepEqual(judge(change({ mergeStatus: "unknown", mergeStatusRaw: "has_hooks" })), { exit: 6, reason: "merge status has_hooks" });
  assert.deepEqual(judge(change({ state: "merged" }), "pull request"), { exit: 6, reason: "the pull request is merged" });
  // A failure outranks everything a person could clear, so its owner hears first.
  assert.equal(judge(change({ mergeStatus: "approval", checks: { state: "failed", failed: [] } })).exit, 1);
});

test("the command line prints one line, or one object with --json, and sets the exit code", () => {
  const usage = runNode("plugins/agentic-teamwork/scripts/mr.mjs", ["frobnicate"]);
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, "");
  assert.match(usage.stderr, /^mr: usage: mr\.mjs <check\|open\|status\|wait\|merge\|approve\|retry\|comment>/);
  const json = runNode("plugins/agentic-teamwork/scripts/mr.mjs", ["wait", "seven", "--json", "--forge", "github"]);
  assert.equal(json.status, 2);
  assert.deepEqual(JSON.parse(json.stdout), { error: { kind: "usage", message: '"seven" is not a pull request number' } });
});
