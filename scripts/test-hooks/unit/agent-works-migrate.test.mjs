// The session hook's migration. Version 1.0 changed three defaults (the form
// of the CLAUDE.md twins, whether the guard refuses a command outside its
// lock, whether the board folder is tracked) and moved the board's folder. A
// repo that carries .agents/agent-works.json relied on the old ones, so each
// is written down for it and nothing loosens. The migration may not overwrite:
// what the config lacks goes into a file of its own, for the model to merge.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agent-works");
const HOOK = path.join(PLUGIN, "hooks", "session-start.mjs");
const AW = path.join(PLUGIN, "scripts", "aw.mjs");
const CONFIG = ".agents/agent-works.json";
const ADDITIONS = ".agents/retired/agent-works/config-additions.json";
const CARD = "---\nid: 0001\ntitle: One\nstatus: backlog\norder: 1\n---\n\n## Done when\n- it works\n";
// A config as the plugin's setup wrote it before 1.0.
const BEFORE = { version: 1, claude: { twins: "generated" }, guard: { ownerFiles: [], generated: [], rules: [] }, resources: {}, lockOrder: [], runs: [], counters: {} };

/** A committed repo holding `files` (JSON for an object), then `after` written and left uncommitted. */
function repo(t, files = {}, after = {}) {
  const { dir, git } = tempRepo(t, "aw-migrate-");
  const put = (set) => { for (const [rel, content] of Object.entries(set)) write(dir, rel, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`); };
  put({ "README.md": "fixture\n", ...files });
  git("add", "-A");
  git("commit", "-m", "fixture");
  put(after);
  const home = tempDir(t, "aw-migrate-home-");
  return { dir, git, home };
}

function hook(r, { cwd = r.dir } = {}) {
  const started = Date.now();
  const out = runNode(HOOK, [], {
    cwd,
    env: { ...process.env, HOME: r.home, USERPROFILE: r.home, CLAUDE_CONFIG_DIR: path.join(r.home, ".claude"), CLAUDE_PLUGIN_DATA: "", AW_HOME: path.join(r.home, "store"), CLAUDE_PROJECT_DIR: "" },
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup", session_id: "s", cwd }),
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  const parsed = out.stdout.trim() ? JSON.parse(out.stdout) : {};
  return { text: parsed.hookSpecificOutput?.additionalContext ?? "", person: parsed.systemMessage ?? "", ms: Date.now() - started };
}
const read = (r, rel) => { try { return fs.readFileSync(path.join(r.dir, rel), "utf8"); } catch { return null; } };
const additions = (r) => JSON.parse(read(r, ADDITIONS) ?? "null");
const MIGRATED = /agent-works moved this repo to its current layout/;

test("agent-works migrate: a repo without the config is not touched", (t) => {
  const r = repo(t, { ".agents/board/board.json": "{}\n", ".agents/board/0001-one.md": CARD });
  r.git("config", "--local", "agentic-engineering.plugins", "on Test 2026-01-01T00:00Z");
  const out = hook(r);
  assert.doesNotMatch(out.text, MIGRATED);
  assert.equal(out.person, "");
  assert.equal(r.git("status", "--porcelain"), "");
});

test("agent-works migrate: a config that does not name the twins keeps generated ones", (t) => {
  const { claude, ...unnamed } = BEFORE;
  const r = repo(t, { [CONFIG]: unnamed, "AGENTS.md": "# fixture\n", ".gitignore": "CLAUDE.md\n" });
  const out = hook(r);
  assert.match(out.text, MIGRATED);
  assert.deepEqual(additions(r).claude, { twins: "generated" });
  assert.match(out.text, /`claude\.twins` \(a config that does not name it now means a tracked symlink/);
  // Until the key is merged the hook goes on healing them as the files they were.
  assert.equal(read(r, "CLAUDE.md"), "@AGENTS.md\n");
  assert.ok(!fs.lstatSync(path.join(r.dir, "CLAUDE.md")).isSymbolicLink());

  const named = repo(t, { [CONFIG]: { ...BEFORE, claude: { twins: "committed" } } });
  hook(named);
  assert.equal(additions(named).claude, undefined);
});

test("agent-works migrate: the guard keeps refusing a command outside its lock", (t) => {
  const r = repo(t, { [CONFIG]: BEFORE });
  const out = hook(r);
  assert.deepEqual(additions(r), { guard: { locks: "deny" } });
  assert.match(out.text, /Merge its keys into \.agents\/agent-works\.json now, keeping everything that file already holds, then delete \.agents\/retired\/agent-works\/config-additions\.json: `guard\.locks` \(the guard now only warns/);
  assert.match(out.text, /They apply already; merging makes the config say so\./);
  assert.equal(out.person, "agent-works moved 1 path(s) to its current layout.");
  // The key is one the guard reads.
  assert.match(fs.readFileSync(path.join(PLUGIN, "lib", "guard-rules.mjs"), "utf8"), /cfg\.guard \|\| \{\}\)\.locks/);

  for (const locks of ["warn", "off", "deny"]) {
    const said = repo(t, { [CONFIG]: { ...BEFORE, guard: { ...BEFORE.guard, locks } } });
    assert.doesNotMatch(hook(said).text, MIGRATED, locks);
    assert.equal(read(said, ADDITIONS), null, locks);
  }
});

test("agent-works migrate: a board whose folder is committed stays a tracked board", (t) => {
  const r = repo(t, { [CONFIG]: BEFORE, ".agents/kanban/board.json": "{}\n", ".agents/kanban/0001-one.md": CARD });
  const out = hook(r);
  assert.deepEqual(additions(r).kanban, { tracked: true });
  assert.match(out.text, /`kanban\.tracked` \(the board folder is now kept out of git unless the config says it is shared/);

  const local = repo(t, { [CONFIG]: BEFORE, ".gitignore": ".agents/kanban/\n" }, { ".agents/kanban/board.json": "{}\n", ".agents/kanban/0001-one.md": CARD });
  hook(local);
  assert.equal(additions(local).kanban, undefined, "a board git never held stays out of git");

  const said = repo(t, { [CONFIG]: { ...BEFORE, kanban: { tracked: false } }, ".agents/kanban/board.json": "{}\n" });
  hook(said);
  assert.equal(additions(said).kanban, undefined, "a config that says is not second-guessed");
});

test("agent-works migrate: a board still in the old folder moves to the current one", (t) => {
  const r = repo(t, { [CONFIG]: BEFORE, ".gitignore": ".agents/board/\n" }, { ".agents/board/board.json": "{}\n", ".agents/board/0001-one.md": CARD });
  const out = hook(r);
  assert.match(out.text, /agent-works moved this repo to its current layout: \.agents\/board -> \.agents\/kanban; wrote /);
  assert.match(out.text, /The board in \.agents\/kanban\/ is working state, kept out of git: leave it out of the commit\./);
  assert.equal(read(r, ".agents/kanban/0001-one.md"), CARD);
  assert.ok(!fs.existsSync(path.join(r.dir, ".agents", "board")));
  assert.match(out.text, /Board: 0 in progress, 0 in review, 1 ready\./, "and the same session reads it there");
  const listed = runNode(AW, ["board", "list", "--json", "--all"], { cwd: r.dir });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /"id": "0001"/);
});

test("agent-works migrate: a tracked board moves as a tracked board, to the folder the config names", (t) => {
  const r = repo(t, { [CONFIG]: { ...BEFORE, paths: { kanban: "work/cards" } }, ".agents/board/board.json": "{}\n", ".agents/board/0001-one.md": CARD });
  const out = hook(r);
  assert.match(out.text, /\.agents\/board -> work\/cards/);
  assert.doesNotMatch(out.text, /leave it out of the commit/);
  assert.equal(read(r, "work/cards/0001-one.md"), CARD);
  assert.deepEqual(additions(r).kanban, { tracked: true });
});

test("agent-works migrate: the old folder stays where the config names it, where the new one exists, and in a linked worktree", (t) => {
  const kept = repo(t, { [CONFIG]: { ...BEFORE, paths: { kanban: ".agents/board" } }, ".agents/board/board.json": "{}\n" });
  assert.doesNotMatch(hook(kept).text, /->/);
  assert.ok(fs.existsSync(path.join(kept.dir, ".agents", "board", "board.json")));

  const both = repo(t, { [CONFIG]: BEFORE, ".agents/board/board.json": "{}\n", ".agents/kanban/board.json": "{}\n" });
  const out = hook(both);
  assert.doesNotMatch(out.text, /->|left these in place/);
  assert.equal(read(both, ".agents/board/board.json"), "{}\n");

  const main = repo(t, { [CONFIG]: BEFORE, ".agents/board/board.json": "{}\n", ".agents/board/0001-one.md": CARD, ".gitignore": ".claude/\n" });
  const worktree = path.join(main.dir, ".claude", "worktrees", "child");
  main.git("worktree", "add", "-b", "feat/child", worktree);
  assert.doesNotMatch(hook(main, { cwd: worktree }).text, /->/);
  assert.ok(fs.existsSync(path.join(worktree, ".agents", "board", "0001-one.md")), "the main checkout's session moves the board");
});

test("agent-works migrate: a second run changes nothing and reports no move; a reminder stands until the keys are merged", (t) => {
  const { claude, ...unnamed } = BEFORE;
  const r = repo(t, { [CONFIG]: unnamed, ".agents/board/board.json": "{}\n", ".agents/board/0001-one.md": CARD });
  const config = read(r, CONFIG);
  const first = hook(r);
  assert.match(first.text, MIGRATED);
  assert.doesNotMatch(first.text, /still waits/, "the first run says it once");
  assert.ok(first.ms < 3000, `${first.ms} ms`);
  assert.doesNotMatch(first.text, /could not finish/);
  const written = read(r, ADDITIONS);
  const status = r.git("status", "--porcelain");

  const second = hook(r);
  assert.doesNotMatch(second.text, MIGRATED);
  assert.equal(second.person, "");
  assert.match(second.text, /^\.agents\/retired\/agent-works\/config-additions\.json still waits to be merged into \.agents\/agent-works\.json \(claude\.twins, guard\.locks, kanban\.tracked\), then deleted\. They apply already; merging makes the config say so\./);
  assert.equal(read(r, ADDITIONS), written);
  assert.equal(read(r, CONFIG), config, "the config is the person's: never rewritten");
  assert.equal(r.git("status", "--porcelain"), status);

  // The model merges the keys and deletes the file: nothing is left to say.
  write(r.dir, CONFIG, `${JSON.stringify({ ...unnamed, ...JSON.parse(written), guard: { ...unnamed.guard, locks: "deny" } }, null, 2)}\n`);
  fs.rmSync(path.join(r.dir, ADDITIONS));
  const third = hook(r);
  assert.doesNotMatch(third.text, /still waits|moved this repo/);
  assert.equal(read(r, ADDITIONS), null);
  assert.match(third.text, /^Board: /);
});

test("agent-works migrate: nothing that exists is overwritten", (t) => {
  const mine = '{ "guard": { "locks": "ask" } }\n';
  const r = repo(t, { [CONFIG]: BEFORE, [ADDITIONS]: mine });
  const out = hook(r);
  assert.doesNotMatch(out.text, MIGRATED);
  assert.equal(read(r, ADDITIONS), mine);
  assert.match(out.text, /still waits to be merged .* \(guard\.locks\)/);
});

test("agent-works migrate: a config that does not parse is left to `aw doctor`", (t) => {
  const r = repo(t, { [CONFIG]: "{ not json\n" });
  assert.doesNotMatch(hook(r).text, MIGRATED);
  assert.equal(read(r, ADDITIONS), null);
});

test("agent-works migrate: a config `aw setup` writes today is already current", (t) => {
  const r = repo(t);
  const set = runNode(AW, ["setup", "--apply"], { cwd: r.dir, env: { ...process.env, HOME: r.home, USERPROFILE: r.home, AW_HOME: path.join(r.home, "store") } });
  assert.equal(set.status, 0, set.stderr + set.stdout);
  assert.ok(read(r, CONFIG));
  assert.doesNotMatch(hook(r).text, MIGRATED);
  assert.equal(read(r, ADDITIONS), null);
});

test("agent-works migrate: the migration reaches the repo only through the kernel's move and write", () => {
  const source = fs.readFileSync(HOOK, "utf8");
  const body = source.slice(source.indexOf("async function migrate("), source.indexOf("// ---- briefing"));
  assert.doesNotMatch(body, /\bfs\.(write|rename|rm|unlink|copy|mkdir|append|cp)\w*\(/);
});
