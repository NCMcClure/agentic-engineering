// agent-works guard.mjs as the host runs it: a payload on stdin, one decision
// on stdout, a line in the decision log. Where it acts (the config's marker,
// a linked work tree), what it gathers (the branch, the lock store, a run's
// items), that it fails open, and `--explain`. Every child gets its own store.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PLUGIN, world } from "./agent-works-coord-support.mjs";
import { tempRepo, write } from "./helpers.mjs";

const GUARD = path.join(PLUGIN, "hooks", "guard.mjs");
const CONFIG = { guard: { ownerFiles: ["local.ini"], generated: [{ match: "^gen/", how: "Run codegen." }] } };

/** Run the guard with `stdin` (an object is a payload) in `cwd`. Returns `{ status, stdout, stderr, doc }`. */
function guard(w, stdin, { cwd = w.proj, env = {}, args = [] } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd, env: w.env(env), encoding: "utf8", input: typeof stdin === "string" ? stdin : JSON.stringify(stdin), timeout: 60_000,
  });
  let doc = null;
  try { doc = JSON.parse(r.stdout); } catch { /* no decision, or text */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, doc, out: doc?.hookSpecificOutput ?? null };
}
const bash = (command, cwd, tool = "Bash") => ({ tool_name: tool, cwd, tool_input: { command } });
const edit = (file, cwd, tool = "Edit") => ({ tool_name: tool, cwd, tool_input: { file_path: file } });
const silent = (r, what) => assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], what);
const logOf = (w, cwd = w.proj) => {
  const file = path.join(w.home, "projects", w.id(cwd), "guard.log");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
};
const head = (root, branch) => fs.writeFileSync(path.join(root, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);

test("agent-works guard hook: a deny and an ask are permission decisions, and what trips nothing is silent", (t) => {
  const w = world(t, CONFIG);
  const denied = guard(w, bash("git add -A", w.proj));
  assert.deepEqual([denied.status, denied.stderr], [0, ""]);
  assert.deepEqual(Object.keys(denied.doc), ["hookSpecificOutput"]);
  assert.deepEqual([denied.out.hookEventName, denied.out.permissionDecision], ["PreToolUse", "deny"]);
  assert.match(denied.out.permissionDecisionReason, /^Stage files by path\./);
  assert.ok(denied.out.permissionDecisionReason.includes("  local.ini\n"));
  assert.equal(guard(w, edit(path.join(w.proj, "local.ini"), w.proj)).out.permissionDecision, "ask");
  assert.equal(guard(w, edit("gen/x.h", w.proj, "Write")).out.permissionDecision, "deny");
  assert.equal(guard(w, { tool_name: "NotebookEdit", cwd: w.proj, tool_input: { notebook_path: "gen/x.ipynb" } }).out.permissionDecision, "deny");
  assert.equal(guard(w, bash("git add local.ini", w.proj, "PowerShell")).out.permissionDecision, "deny");
  silent(guard(w, bash("git add src/a.py && git commit -m x", w.proj)), "an exact path on a branch");
  silent(guard(w, bash("ls", w.proj)));
  silent(guard(w, { tool_name: "Read", cwd: w.proj, tool_input: { command: "git add -A" } }), "a tool the guard does not read");
});

test("agent-works guard hook: the tool call is judged from a folder below the top", (t) => {
  const w = world(t, CONFIG);
  const sub = path.join(w.proj, "pkg", "src");
  fs.mkdirSync(sub, { recursive: true });
  assert.match(guard(w, bash("git add ../../local.ini", sub)).out.permissionDecisionReason, /would take the owner's own files/);
  assert.equal(guard(w, edit("../../gen/a.h", sub)).out.permissionDecision, "deny");
  silent(guard(w, edit("gen/a.h", sub)), "pkg/src/gen is not the top's gen");
  // no cwd in the payload: the session's project folder is the one judged
  const r = guard(w, { tool_name: "Bash", tool_input: { command: "git add -A" } }, { cwd: w.tmp, env: { CLAUDE_PROJECT_DIR: w.proj } });
  assert.equal(r.out.permissionDecision, "deny");
});

test("agent-works guard hook: every decision is one line in the project's log", (t) => {
  const w = world(t, CONFIG);
  guard(w, bash("git add -A", w.proj), { env: { AW_AGENT: "a7" } });
  guard(w, bash("git status", w.proj));
  const lines = logOf(w);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\{"at": "\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", "decision": "deny", "rule": "staging-blanket", "agent": "a7", "tool": "Bash", "subject": "git add -A"\}$/);
  guard(w, bash(`git add -A # ${"é".repeat(700)}`, w.proj));
  const long = JSON.parse(logOf(w)[1]);
  assert.deepEqual([long.agent, long.subject.length], [null, 600]);
  assert.ok(/^[\x20-\x7e]*$/.test(logOf(w)[1]), "the log is ASCII");
  w.writeConfig(w.proj, { guard: { log: false } });
  fs.rmSync(path.join(w.home, "projects", w.id(), "guard.log"));
  assert.equal(guard(w, bash("git add -A", w.proj)).out.permissionDecision, "deny");
  assert.deepEqual(logOf(w), []);
});

test("agent-works guard hook: a warning reaches the model, and the commit rule reads the checkout's branch", (t) => {
  const w = world(t, CONFIG);
  head(w.proj, "main");
  const warned = guard(w, bash("git commit -m x", w.proj));
  assert.ok(!("permissionDecision" in warned.out), "a warning by default: nobody is asked");
  assert.match(warned.out.additionalContext, /This commits on `main`\. Work goes on a branch/);
  assert.equal(JSON.parse(logOf(w)[0]).decision, "warn");
  // a commit that runs in another checkout is judged by that checkout's branch
  const other = w.project("other");
  fs.mkdirSync(path.join(other, "sub"));
  silent(guard(w, bash(`cd "${other}" && git commit -m x`, w.proj)));
  silent(guard(w, bash(`git -C "${path.join(other, "sub")}" commit -m x`, w.proj)));
  silent(guard(w, bash('cd "$ELSEWHERE" && git commit -m x', w.proj)), "an unresolved folder gives no finding");
  w.writeConfig(other, {});
  assert.match(guard(w, bash(`cd "${w.proj}" && git commit -m x`, other)).out.additionalContext, /commits on `main`/);
  silent(guard(w, bash("git commit -m x", other)));
  w.writeConfig(w.proj, { guard: { defaultBranch: { commit: "ask" } } });
  assert.equal(guard(w, bash("git commit -m x", w.proj)).out.permissionDecision, "ask");
  fs.writeFileSync(path.join(w.proj, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
  silent(guard(w, bash("git commit -m x", w.proj)), "a detached HEAD is on no branch");
});

test("agent-works guard hook: inert without the config, and open on every failure", (t) => {
  const w = world(t, CONFIG);
  const bare = w.project("bare");
  silent(guard(w, bash("git add -A", bare)), "no .agents/agent-works.json");
  silent(guard(w, edit(path.join(bare, "local.ini"), bare)));
  silent(guard(w, bash("git add -A", path.join(w.tmp, "no", "such", "folder"))));
  assert.ok(!fs.existsSync(w.home), "an inert guard leaves no trace in the store");
  for (const raw of ["", "not json", "[1, 2]", "null", '{"cwd": 5}', '{"tool_name": "Bash"}',
    JSON.stringify({ tool_name: "Bash", tool_input: "x", cwd: w.proj }), JSON.stringify({ tool_name: "Bash", tool_input: { command: 7 }, cwd: w.proj }),
    JSON.stringify({ tool_name: "Edit", tool_input: {}, cwd: w.proj }), JSON.stringify({ tool_name: "Bash", tool_input: { command: 'git commit -m "unclosed' }, cwd: 9 })]) {
    silent(guard(w, raw), raw);
  }
  assert.equal(guard(w, `\uFEFF${JSON.stringify(bash("git add -A", w.proj))}`).out.permissionDecision, "deny", "a byte order mark is not a failure");
  fs.writeFileSync(path.join(w.proj, ".agents", "agent-works.json"), "{ broken");
  assert.equal(guard(w, bash("git add -A", w.proj)).out.permissionDecision, "deny", "the defaults still guard");
  fs.writeFileSync(path.join(w.proj, ".agents", "agent-works.json"), JSON.stringify({ guard: 5, resources: [1], runs: "x" }));
  silent(guard(w, bash("anything --at all", w.proj)), "a config of the wrong shape blocks nothing");
  // a store that cannot be written loses the log, not the decision
  const blocked = path.join(w.tmp, "a-file");
  fs.writeFileSync(blocked, "");
  w.writeConfig(w.proj, CONFIG);
  const r = guard(w, bash("git add -A", w.proj), { env: { AW_HOME: path.join(blocked, "store") } });
  assert.deepEqual([r.status, r.stderr, r.out.permissionDecision], [0, "", "deny"]);
});

test("agent-works guard hook: a linked work tree is judged by its own tree and the main checkout's config", (t) => {
  const w = world(t);
  const { dir: main, git } = tempRepo(t, "aw-guard-main-");
  write(main, "src/a.txt", "a\n");
  git("add", "src/a.txt");
  git("commit", "-q", "-m", "one");
  // the config is the owner's own here: not committed, so the work tree has no copy
  w.writeConfig(main, { guard: { ownerFiles: ["local.ini"], generated: [{ match: "^gen/", how: "Run codegen." }] } });
  const tree = path.join(fs.realpathSync.native(w.tmp), "tree");
  git("worktree", "add", "-q", "-b", "feat/tree", tree);
  assert.ok(!fs.existsSync(path.join(tree, ".agents")), "the work tree carries no config");

  assert.equal(guard(w, bash("git add -A", tree)).out.permissionDecision, "deny");
  assert.equal(guard(w, edit(path.join(tree, "gen", "x.h"), tree)).out.permissionDecision, "deny", "paths are read against the work tree");
  assert.equal(guard(w, edit(path.join(tree, "local.ini"), tree)).out.permissionDecision, "ask");
  silent(guard(w, bash("git commit -m x", tree)), "the work tree is on its own branch");
  assert.match(guard(w, bash("git commit -m x", main)).out.additionalContext, /commits on `main`/);
  assert.match(guard(w, bash(`git -C "${main}" commit -m x`, tree)).out.additionalContext, /commits on `main`/);
  // one log for the repository, whichever tree the call came from
  assert.equal(logOf(w, tree).length, 5);
  assert.deepEqual(logOf(w, tree), logOf(w, main));
  // a work tree's own copy of the config is the one read
  w.writeConfig(tree, { guard: { staging: { blanket: "ask" } } });
  assert.equal(guard(w, bash("git add -A", tree)).out.permissionDecision, "ask");
  silent(guard(w, edit(path.join(tree, "gen", "x.h"), tree)));
  // a repository whose main checkout has no config is left alone from every tree
  const { dir: plain, git: git2 } = tempRepo(t, "aw-guard-plain-");
  write(plain, "a.txt", "a\n");
  git2("add", "a.txt");
  git2("commit", "-q", "-m", "one");
  const second = path.join(fs.realpathSync.native(w.tmp), "second");
  git2("worktree", "add", "-q", "-b", "feat/second", second);
  silent(guard(w, bash("git add -A", second)));
});

test("agent-works guard hook: a resource another agent holds is a warning; guard.locks makes it a refusal", (t) => {
  const resources = { editor: { scope: "project", match: ["\\bbuild\\.sh\\b"] }, gpu: { scope: "machine", match: ["train\\.py"] } };
  const w = world(t, { resources });
  const other = w.project("other", { resources });
  silent(guard(w, bash("./build.sh", w.proj)), "free: nothing to say");
  assert.equal(w.aw(["lock", "acquire", "editor", "--as", "a1", "--for", "x", "--wait", "0"]).status, 0);
  assert.equal(w.aw(["lock", "acquire", "gpu", "--as", "b2", "--for", "y", "--wait", "0"], { cwd: other }).status, 0);

  const warned = guard(w, bash("AW_AGENT=a9 ./build.sh", w.proj));
  assert.ok(!("permissionDecision" in warned.out));
  assert.match(warned.out.additionalContext, /another agent holds the lock: editor \(held by a1\)/);
  assert.match(guard(w, bash("python train.py", w.proj)).out.additionalContext, /gpu \(held by b2\)/, "a machine lock is seen from every project");
  silent(guard(w, bash("AW_AGENT=a1 ./build.sh", w.proj)), "the holder");
  silent(guard(w, bash("./build.sh", w.proj), { env: { AW_AGENT: "a1" } }), "the holder, named by the session");
  silent(guard(w, bash("aw lock run editor --for x -- ./build.sh", w.proj)), "the wrapper waits its turn");
  silent(guard(w, bash("./build.sh", other)), "a project lock is another project's own");
  assert.deepEqual(logOf(w).map((l) => JSON.parse(l)).map((l) => [l.decision, l.rule]), [["warn", "resource-lock"], ["warn", "resource-lock"]]);

  w.writeConfig(w.proj, { resources, guard: { locks: "deny" } });
  const denied = guard(w, bash("AW_AGENT=a9 ./build.sh", w.proj));
  assert.equal(denied.out.permissionDecision, "deny");
  assert.match(denied.out.permissionDecisionReason, /"a9" does not hold the lock \(editor: held by a1\)/);
  silent(guard(w, bash("AW_AGENT=a1 ./build.sh", w.proj)));
  assert.equal(guard(w, bash("AW_AGENT=a1 python train.py", w.proj)).out.permissionDecision, "deny");
  assert.equal(w.aw(["lock", "release", "editor", "--as", "a1"]).status, 0);
  assert.match(guard(w, bash("AW_AGENT=a1 ./build.sh", w.proj)).out.permissionDecisionReason, /\(editor: free\)/);
  w.writeConfig(w.proj, { resources, guard: { locks: "enforce" } });
  assert.equal(guard(w, bash("./build.sh", w.proj)).out.permissionDecision, "deny");
});

test("agent-works guard hook: a run budget counts a run's items from the folder and the groups file", (t) => {
  const w = world(t, { runs: [{
    id: "render", match: ["render\\.py\\b"], free: 3,
    count: { allFlags: ["--all"], groupFlag: "--group", matchFlag: "--match", groupsFile: "groups.json", itemsDir: "shots" },
  }] });
  for (let i = 0; i < 40; i += 1) write(w.proj, `shots/item${i % 4}__view${i}/shot.json`, "{}");
  write(w.proj, "shots/.cache/x", "");
  write(w.proj, "groups.json", JSON.stringify({ smoke: ["item1__*", "!*view5"], one: ["*view7"] }));
  silent(guard(w, bash("python render.py a b c", w.proj)));
  silent(guard(w, bash("python render.py --group one", w.proj)));
  silent(guard(w, bash("python render.py --all --match '*view7'", w.proj)));
  assert.match(guard(w, bash("python render.py --group smoke", w.proj)).out.permissionDecisionReason, /asks for 9 items \(group smoke\)/);
  assert.match(guard(w, bash("python render.py --all", w.proj)).out.permissionDecisionReason, /40 items: everything \(40\)/);
  const ok = guard(w, bash('AW_RUN="full: the work is finished, the one pass before the baseline" python render.py --all', w.proj));
  assert.match(ok.out.additionalContext, /allowed for the stated reason/);
  assert.match(ok.doc.systemMessage, /let through — full: the work is finished/);
  const logged = JSON.parse(logOf(w).at(-1));
  assert.deepEqual([logged.decision, logged.rule, logged.notice], ["warn", "run-budget", ok.doc.systemMessage]);
});

test("agent-works guard hook: a pattern that does not compile is skipped, and noted in the log once", (t) => {
  const w = world(t, { guard: { rules: [{ id: "broken", match: ["([a"], message: "never" }, { id: "deploy", match: ["\\bdeploy\\b"], message: "Not from here." }] } });
  silent(guard(w, bash("make test", w.proj)));
  silent(guard(w, bash("make lint", w.proj)));
  let lines = logOf(w).map((l) => JSON.parse(l));
  assert.equal(lines.length, 1, "the same note is not repeated");
  assert.deepEqual([lines[0].decision, lines[0].rule, lines[0].subject, lines[0].note],
    ["allow", "pattern-skipped", "make test", 'guard.rules[broken]: "([a" is not a regular expression']);
  assert.equal(guard(w, bash("deploy now", w.proj)).out.permissionDecisionReason, "Not from here.");
  lines = logOf(w).map((l) => JSON.parse(l));
  assert.deepEqual([lines[1].decision, lines[1].rule, lines[1].note], ["deny", "deploy", lines[0].note]);
});

test("agent-works guard hook: an edit through a link is judged by the file it reaches", { skip: process.platform === "win32" && "making a link needs a privilege there" }, (t) => {
  const w = world(t, CONFIG);
  const link = path.join(w.tmp, "link");
  fs.symlinkSync(w.proj, link, "dir");
  assert.equal(guard(w, edit(path.join(link, "gen", "x.h"), link)).out.permissionDecision, "deny");
  assert.equal(guard(w, edit(path.join(link, "local.ini"), w.proj)).out.permissionDecision, "ask");
  assert.equal(guard(w, bash("git add local.ini", link)).out.permissionDecision, "deny");
});

test("agent-works guard hook: --explain says what would be decided, and logs nothing", (t) => {
  const w = world(t, CONFIG);
  const explain = (...args) => guard(w, "", { args: ["--explain", ...args] });
  const doc = explain("git add -A && git push -f", "--cwd", w.proj, "--json").doc;
  assert.deepEqual(Object.keys(doc), ["tool", "cwd", "config", "decision", "rule", "message", "all", "segments"]);
  assert.deepEqual([doc.tool, doc.decision, doc.rule, doc.segments], ["Bash", "deny", "staging-blanket", [["git", "add", "-A"], ["git", "push", "-f"]]]);
  assert.deepEqual(doc.all, [{ decision: "deny", rule: "staging-blanket" }, { decision: "ask", rule: "force-push" }]);
  assert.equal(fs.realpathSync.native(doc.config), fs.realpathSync.native(path.join(w.proj, ".agents", "agent-works.json")));

  const text = explain("git add -A && git push -f", "--cwd", w.proj).stdout;
  assert.ok(text.startsWith("decision: deny   rule: staging-blanket\nalso:     force-push (ask)\nsegment:  [git] [add] [-A]\nsegment:  [git] [push] [-f]\n\nStage files by path."), text);
  assert.match(explain("--file", "gen/a.h", "--cwd", w.proj).stdout, /^decision: deny {3}rule: generated-file\n\nDo not edit gen\/a\.h by hand\. Run codegen\.\n$/);
  assert.equal(explain("git status", "--cwd", w.proj).stdout, "decision: allow\nsegment:  [git] [status]\n");
  assert.equal(explain("git add -A", "--tool", "PowerShell", "--cwd", w.proj, "--json").doc.tool, "PowerShell");
  // the tool and its input, as a hook payload names them
  assert.match(explain("Bash", "git add -A", "--cwd", w.proj).stdout, /^decision: deny {3}rule: staging-blanket\n/);
  assert.deepEqual(explain("Write", JSON.stringify({ file_path: "local.ini" }), "--cwd", w.proj, "--json").doc.all, [{ decision: "ask", rule: "owner-file-edit" }]);
  // run from the folder itself, with no --cwd
  assert.match(guard(w, "", { args: ["--explain", "git add local.ini"], cwd: w.proj }).stdout, /^decision: deny {3}rule: staging-owner-files\n/);

  const bare = w.project("bare");
  const inert = explain("git add -A", "--cwd", bare, "--json").doc;
  assert.deepEqual([inert.config, inert.decision, inert.message], [null, "allow", "no .agents/agent-works.json at or above this folder: the guard is inert here"]);
  fs.writeFileSync(path.join(w.proj, ".agents", "agent-works.json"), "{ broken");
  assert.match(explain("ls", "--cwd", w.proj).stdout, /is not valid JSON.*\(the built-in defaults apply\)\n$/s);
  w.writeConfig(w.proj, { guard: { rules: [{ id: "broken", match: ["([a"] }] } });
  assert.match(explain("make", "--cwd", w.proj).stdout, /\nskipped: {2}guard\.rules\[broken\]: "\(\[a" is not a regular expression\n/);

  const bad = explain("--no-such-flag");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: guard\.mjs --explain/);
  assert.ok(!fs.existsSync(path.join(w.home, "projects")), "explaining is not logged");
});
