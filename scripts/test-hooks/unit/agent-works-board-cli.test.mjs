// `aw board` and `aw kanban`, as a person, an agent, a script and the pane
// call them: each action's words on stdout, its exit code, and the files it
// leaves. `aw kanban` is the same command under the name it had first, and
// what it printed then is pinned here line for line.
//
// Most cases start a real process, in a real git repo, because that is how
// the lock, the worktrees and the ignore rule meet. The cases that talk to a
// tracker call the command in-process with a runner that answers from memory.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cardView, parseCard } from "../../../plugins/agent-works/lib/cards.mjs";
import { bufferedIo } from "../../../plugins/agent-works/lib/common.mjs";
import { main as board } from "../../../plugins/agent-works/scripts/board.mjs";
import { LOCK_FILE, findings, readBoard } from "../../../plugins/agent-works/scripts/io.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const AW = path.join(REPO, "plugins", "agent-works", "scripts", "aw.mjs");
const GOLDEN = path.join(REPO, "scripts", "test-hooks", "cases", "agent-works", "cards");
const OLD = "2020-01-01T00:00:00.000Z";
const QUIET = { CLAUDECODE: "", AW_AGENT: "", PL_AGENT: "", CLAUDE_AGENT_NAME: "" };
const real = (p) => fs.realpathSync.native(p);

/** A project in a fresh repo: `aw(...args)` runs the CLI there, `cards()` reads its board, `kanban(...)` asserts a clean run and gives stdout. */
function project(t, { git = true } = {}) {
  const dir = real(git ? tempRepo(t, "aw-board-").dir : tempDir(t, "aw-board-"));
  const home = tempDir(t, "aw-home-");
  const p = {
    dir,
    kanban: path.join(dir, ".agents", "kanban"),
    aw(...args) {
      const opts = typeof args.at(-1) === "object" ? args.pop() : {};
      const { cwd = dir, input, ...env } = opts;
      const r = runNode(AW, args, { cwd, input, env: { ...process.env, ...QUIET, AW_HOME: home, ...env } });
      return { code: r.status, out: r.stdout, err: r.stderr };
    },
    run(...args) {
      const r = p.aw("kanban", ...args);
      assert.deepEqual([r.code, r.err], [0, ""], `kanban ${args.join(" ")}`);
      return r.out;
    },
    cards: () => Object.fromEntries(readBoard(p.kanban).cards.map((c) => [c.id, c])),
    read: (rel) => fs.readFileSync(path.join(dir, rel), "utf8"),
    write: (rel, text) => write(dir, rel, text),
    card(id, title, fields = {}) {
      const { at = new Date().toISOString(), status = "backlog", ...more } = fields;
      const front = { id, title, status, order: 0, source: "user", created: at, updated: at, ...more };
      const name = `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
      write(dir, `.agents/kanban/${name}`, `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`);
      return name;
    },
    git: (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
  };
  return p;
}

// ---- help ---------------------------------------------------------------

test("board --help lists the actions; no action at all prints them and exits 2", (t) => {
  const p = project(t);
  const help = p.aw("board", "--help");
  assert.equal(help.code, 0);
  assert.match(help.out, /^usage: aw board <action>/);
  for (const action of ["list", "add", "move", "plan", "epics", "sprint", "owe", "settle", "lint", "remote on", "propose", "evidence"]) assert.ok(help.out.includes(action), action);
  const bare = p.aw("kanban");
  assert.equal(bare.code, 2);
  assert.match(bare.out, /^usage: aw kanban <action>/);
  assert.ok(bare.out.includes("settle"));
  const unknown = p.aw("board", "bogus");
  assert.deepEqual([unknown.code, unknown.err], [2, 'aw board: no action "bogus" (aw board --help lists them)\n']);
  assert.equal(p.aw("board", "list", "--nope").code, 2);
});

// ---- what aw kanban has always done --------------------------------------

test("add, list and move", (t) => {
  const p = project(t);
  let r = p.aw("kanban", "add", "Write the README", "--details", "Start with install.", "--priority", "high", "--labels", "docs, readme");
  assert.deepEqual([r.code, r.err, r.out], [0, "", "Added card 0001 [backlog]: Write the README\n"]);
  const card = p.cards()["0001"];
  assert.deepEqual([card.file, card.priority, card.labels, card.body, card.source], ["0001-write-the-readme.md", "high", ["docs", "readme"], "Start with install.", "user"]);
  assert.match(card.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

  r = p.aw("kanban", "add", "write the readme!");
  assert.deepEqual([r.code, r.out], [1, "Already on the kanban board as card 0001 (backlog); nothing added.\n"]);
  assert.equal(p.aw("kanban", "add", "write the readme!", "--allow-duplicate").code, 0);

  p.aw("kanban", "add", "Second", "--from-file", "-", { input: "From stdin.\n" });
  assert.deepEqual([p.cards()["0003"].body, p.cards()["0003"].order], ["From stdin.", 2]);

  r = p.aw("kanban", "move", "1", "review");
  assert.deepEqual([r.code, r.out], [0, "Card 0001 is now in review.\n"]);
  assert.equal(p.cards()["0001"].status, "review");
  r = p.aw("kanban", "move", "0001", "nowhere");
  assert.deepEqual([r.code, r.err], [2, 'aw kanban: no column "nowhere": the columns are backlog, in-progress, review, done (plus suggested and archived)\n']);
  r = p.aw("kanban", "move", "77", "done");
  assert.deepEqual([r.code, r.err], [2, 'aw kanban: no card with id "77" (aw kanban list shows the ids)\n']);
  assert.equal(p.aw("board", "move", "77", "done").err, 'aw board: no card with id "77" (aw board list shows the ids)\n');

  p.aw("kanban", "move", "2", "archived");
  assert.deepEqual(p.run("list").split("\n"), ["Columns: backlog, in-progress, review, done (plus suggested)", "0003 [backlog] task: Second", "0001 [review] task: Write the README", ""]);
  const doc = JSON.parse(p.run("list", "--json", "--status", "review"));
  assert.deepEqual(doc.cards.map((c) => c.id), ["0001"]);
  assert.deepEqual(doc.columns.map((c) => c.id), ["backlog", "in-progress", "review", "done"]);
  assert.deepEqual(Object.keys(doc), ["dir", "oldFolder", "columns", "sprints", "scope", "cards"]);
  assert.deepEqual(doc.cards[0], cardView(p.cards()["0001"]));
  assert.equal(p.aw("kanban", "add", " ").code, 2);
  assert.match(p.aw("kanban", "add", "X", "--status", "nowhere").err, /no column "nowhere": the columns are backlog, in-progress, review, done\n$/);
  assert.equal(p.aw("kanban", "add", "X", "--priority", "urgent").code, 2);
});

test("an agent is the source of what it adds, and a suggestion waits", (t) => {
  const p = project(t);
  p.aw("kanban", "add", "Seen in passing", "--suggest", { AW_AGENT: "worker-1" });
  assert.deepEqual([p.cards()["0001"].status, p.cards()["0001"].source], ["suggested", "claude"]);
  p.aw("kanban", "add", "From a session", { CLAUDECODE: "1" });
  assert.equal(p.cards()["0002"].source, "claude");
  p.aw("kanban", "add", "Said to be the person's", "--source", "user", { CLAUDECODE: "1" });
  assert.equal(p.cards()["0003"].source, "user");
  p.aw("kanban", "move", "0001", "archived");
  assert.ok(!p.run("list").includes("0001"));
  assert.ok(p.run("list", "--all").includes("0001 [archived]"));
});

test("owe and settle a gate", (t) => {
  const p = project(t);
  let r = p.aw("kanban", "owe", "--ref", "#213", "--needs", "the main checkout", "Run the smoke gate", "--details", "`npm run smoke`", "--owner", "integrator");
  assert.equal(r.out, 'Owed as gate card 0001: Run the smoke gate (for #213; needs the main checkout). Settle it with: aw kanban settle 0001 --evidence "…"\n');
  const gate = p.cards()["0001"];
  assert.deepEqual([gate.kind, gate.status, gate.ref, gate.needs, gate.owner, gate.body], ["gate", "backlog", "#213", "the main checkout", "integrator", "`npm run smoke`"]);
  assert.ok(p.read(".agents/kanban/0001-run-the-smoke-gate.md").includes("kind: gate\n"));

  r = p.aw("kanban", "owe", "run the smoke gate", "--ref", "#213", "--needs", "x");
  assert.deepEqual([r.code, r.out], [1, "Already owed as card 0001 (backlog); nothing added.\n"]);
  assert.equal(p.aw("kanban", "owe", "Run the smoke gate", "--ref", "#214", "--needs", "x").code, 0);
  assert.equal(p.aw("kanban", "owe", "No ref").code, 2);
  assert.ok(p.run("list", "--kind", "gate").includes("0001 [backlog] gate @integrator: Run the smoke gate (for #213; needs the main checkout)"));

  p.aw("kanban", "add", "A task");
  r = p.aw("kanban", "settle", "0003", "--evidence", "ran");
  assert.deepEqual([r.code, r.err], [2, "aw kanban: card 0003 is a task, not a gate: use aw kanban move\n"]);
  assert.equal(p.aw("kanban", "settle", "0001", "--evidence", " ").code, 2);
  // A gate closes with what showed it holds, never by a plain move.
  r = p.aw("kanban", "move", "0001", "done");
  assert.equal(r.code, 1);
  assert.match(r.err, /0001 is a gate: settle it with the evidence instead \(aw kanban settle 0001 --evidence/);

  r = p.aw("kanban", "settle", "1", "--evidence", "npm run smoke: 27 of 27", { AW_AGENT: "w1" });
  assert.deepEqual([r.code, r.out], [0, "Gate 0001 is settled and in done.\n"]);
  const settled = p.cards()["0001"];
  assert.equal(settled.status, "done");
  assert.match(settled.body, /^`npm run smoke`\n\nSettled \d{4}-\S+Z by w1: npm run smoke: 27 of 27$/);
  r = p.aw("kanban", "settle", "0001", "--evidence", "again");
  assert.deepEqual([r.code, r.err], [2, "aw kanban: gate 0001 is already settled\n"]);

  // A gate that has the section keeps its evidence there.
  p.write(".agents/kanban/0009-eyes.md", "---\nid: 0009\ntitle: Eyes\nkind: gate\nref: x\n---\n\n## Evidence\n\n## Notes\n");
  p.run("settle", "9", "--evidence", "looked");
  assert.match(p.cards()["0009"].body, /^## Evidence\n\nSettled \S+: looked\n\n## Notes$/);
});

test("a card written before 1.0 keeps every field and its file through the CLI", (t) => {
  const p = project(t);
  const name = "0006-a-nested-block-the-board-does-not-know.md";
  p.write(`.agents/kanban/${name}`, fs.readFileSync(path.join(GOLDEN, name), "utf8"));
  const before = cardView(parseCard(p.read(`.agents/kanban/${name}`), name));
  assert.equal(p.aw("kanban", "move", "6", "review").code, 0);
  assert.deepEqual(fs.readdirSync(p.kanban).filter((f) => f.endsWith(".md")), [name]);
  const after = cardView(parseCard(p.read(`.agents/kanban/${name}`), name));
  assert.deepEqual(Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort(), ["order", "status", "updated"]);
  assert.match(p.read(`.agents/kanban/${name}`), /links:\n  - https:\/\/example\.com\/a\n  - https:\/\/example\.com\/b\nreview:\n  by: sam\n  state: "changes requested"\n\n# a comment a person left\n---\n/);
  // Every golden from before 1.0 lists, and lints no worse than it reads.
  for (const f of fs.readdirSync(GOLDEN).filter((x) => /^\d{4}-.*\.md$/.test(x) && !x.endsWith(".canon.md"))) p.write(`.agents/kanban/${f}`, fs.readFileSync(path.join(GOLDEN, f), "utf8"));
  const doc = JSON.parse(p.run("list", "--json", "--all"));
  assert.equal(doc.cards.length, 19);
});

test("two processes adding at once never mint the same id", async (t) => {
  const p = project(t);
  const start = (i) => new Promise((resolve) => {
    const child = spawn(process.execPath, [AW, "kanban", i % 2 ? "add" : "owe", `Card number ${i}`, ...(i % 2 ? [] : ["--ref", `#${i}`, "--needs", "x"])],
      { cwd: p.dir, env: { ...process.env, ...QUIET }, stdio: "ignore" });
    child.on("close", resolve);
  });
  const codes = await Promise.all(Array.from({ length: 10 }, (_, i) => start(i)));
  assert.deepEqual(codes, Array(10).fill(0));
  const names = fs.readdirSync(p.kanban).filter((f) => f.endsWith(".md"));
  assert.equal(names.length, 10);
  assert.deepEqual(Object.keys(p.cards()).sort(), ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010"]);
  assert.equal(new Set(names.map((f) => f.slice(0, 4))).size, 10);
  assert.equal(fs.existsSync(path.join(p.kanban, LOCK_FILE)), false);
  assert.deepEqual(fs.readdirSync(p.kanban).filter((f) => f.endsWith(".tmp")), []);
});

test("a writer waits for the lock, and takes over one a dead writer left", (t) => {
  const p = project(t);
  p.run("add", "First");
  const lock = path.join(p.kanban, LOCK_FILE);
  fs.writeFileSync(lock, "999999");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(p.aw("kanban", "add", "After a crash").code, 0);
  assert.equal(fs.existsSync(lock), false);
  // A reader never waits.
  fs.writeFileSync(lock, "999999");
  assert.equal(p.aw("kanban", "list").code, 0);
  fs.rmSync(lock);
});

test("the board.json of a board names its columns", (t) => {
  const p = project(t);
  p.write(".agents/kanban/board.json", JSON.stringify({ columns: [
    { id: "todo", title: "To do", role: null }, { id: "doing", title: "Doing", role: "start" }, { id: "shipped", title: "Shipped", role: "done" }], startMode: "queue" }));
  p.run("owe", "Gate", "--ref", "#1", "--needs", "x");
  assert.equal(p.cards()["0001"].status, "todo");
  p.run("settle", "0001", "--evidence", "ok");
  assert.equal(p.cards()["0001"].status, "shipped");
  assert.equal(p.aw("kanban", "move", "0001", "review").code, 2);
});

test("epics and sprints: plan, scope, close", (t) => {
  const p = project(t);
  p.run("add", "Faster sync", "--kind", "epic");
  assert.equal(p.run("sprint", "new", "Polish", "--goal", "Ship", "--end", "2026-03-01"), "Planned sprint s1: Polish. Start it: aw kanban sprint start s1\n");
  p.run("sprint", "new", "Next");
  assert.equal(p.run("sprint", "start", "s1"), 'Sprint s1 "Polish" is active.\n');
  let r = p.aw("kanban", "sprint", "start", "s2");
  assert.deepEqual([r.code, r.err], [2, "aw kanban: sprint s1 is still active: close it first\n"]);

  p.run("add", "In the sprint", "--sprint", "active", "--epic", "1");
  p.run("add", "Outside");
  assert.deepEqual([p.cards()["0002"].sprint, p.cards()["0002"].epic], ["s1", "0001"]);
  r = p.aw("kanban", "add", "Bad", "--epic", "0003");
  assert.deepEqual([r.code, r.err], [2, 'aw kanban: "0003" is no epic (aw kanban epics lists them)\n']);
  p.run("owe", "Run the smoke", "--ref", "#1", "--needs", "main");
  assert.equal(p.cards()["0004"].sprint, "s1");

  assert.deepEqual(p.run("list").trimEnd().split("\n"), [
    "Columns: backlog, in-progress, review, done (plus suggested)",
    'Sprint s1 "Polish" (active, ends 2026-03-01): Ship',
    "Epic 0001 ▱▱▱▱▱▱▱▱ 0/1: Faster sync",
    "Scope: sprint s1",
    "0002 [backlog] task: In the sprint (epic 0001; sprint s1)",
    "0004 [backlog] gate: Run the smoke (for #1; needs main; sprint s1)",
    '1 more open card(s) outside this scope (scope "all" lists them).',
  ]);
  assert.ok(p.run("list", "--scope", "backlog").includes("0003 [backlog] task: Outside"));
  assert.ok(p.run("list", "--scope", "1").includes("Scope: epic 0001"));
  assert.ok(p.run("list", "--scope", "gates").includes("0004 [backlog] gate: Run the smoke"));
  assert.equal(p.aw("kanban", "list", "--scope", "nope").code, 2);
  assert.equal(p.run("epics"), "0001 ▱▱▱▱▱▱▱▱ 0/1: Faster sync\n");
  assert.deepEqual(JSON.parse(p.run("epics", "--json")).map((e) => [e.id, e.kind, e.progress]), [["0001", "epic", { done: 0, total: 1 }]]);
  assert.equal(p.run("plan", "3", "--epic", "0001", "--sprint", "s2"), "Card 0003: epic 0001, sprint s2.\n");
  assert.equal(p.run("plan", "3", "--epic", "none"), "Card 0003: epic none, sprint s2.\n");
  assert.equal(p.aw("kanban", "plan", "3").err, "aw kanban: nothing to change: give --epic or --sprint\n");
  assert.equal(p.aw("kanban", "plan", "1", "--epic", "1").err, "aw kanban: an epic is not a card of its own\n");
  assert.match(p.aw("kanban", "plan", "3", "--sprint", "s9").err, /no open sprint "s9" \(open: s1, s2\)/);

  p.run("move", "0002", "done");
  assert.equal(p.run("epics"), "0001 ▰▰▰▰▰▰▰▰ 1/1: Faster sync\n");
  assert.equal(p.run("sprint", "close"), "Sprint s1 closed: 1 done card(s) archived, 1 unfinished card(s) to sprint s2.\n");
  const cards = p.cards();
  assert.deepEqual([[cards["0002"].status, cards["0002"].sprint], [cards["0004"].status, cards["0004"].sprint]], [["archived", "s1"], ["backlog", "s2"]]);
  const sprints = readBoard(p.kanban).sprints;
  assert.deepEqual(sprints.map((s) => s.state), ["closed", "planned"]);
  assert.equal(sprints[0].closed.done, 1);
  assert.match(p.run("sprint"), /^Sprint s1 "Polish" \(closed, ends 2026-03-01\): Ship · 1 done, 1 rolled on\nSprint s2 "Next" \(planned\) · 2 card\(s\)\n$/);
  assert.equal(p.aw("kanban", "sprint", "close").err, "aw kanban: no sprint is active: name the one to close\n");
  assert.deepEqual(JSON.parse(p.run("sprint", "list", "--json")).map((s) => s.id), ["s1", "s2"]);
  assert.equal(p.run("sprint", "edit", "s2", "--goal", "Tidy", "--end", "2026-04-01"), "Sprint s2 changed.\n");
  assert.equal(p.run("sprint", "start"), 'Sprint s2 "Next" is active.\n');
  assert.equal(p.run("sprint", "close", "s2"), "Sprint s2 closed: 0 done card(s) archived, 2 unfinished card(s) to the backlog.\n");
});

test("board.json is written the way it always was, with sprints once there is one", (t) => {
  const p = project(t);
  p.run("sprint", "new", "Polish");
  const text = p.read(".agents/kanban/board.json");
  assert.ok(text.startsWith('{\n  "columns": [\n    {\n      "id": "backlog",'));
  assert.ok(text.includes('"startMode": "new-session",\n  "remote": {\n    "enabled": false\n  },\n  "sprints": [\n    {\n      "id": "s1",\n      "title": "Polish",\n      "goal": "",\n      "start": "",\n      "end": "",\n      "state": "planned",\n      "closed": null\n    }\n  ]\n}\n'));
  assert.ok(!text.includes("parallel"));
  assert.equal(p.run("config", "--start-mode", "queue", "--parallel", "3").split("\n")[1], "Start mode: queue. Parallel: 3. Tracker sync: off.");
  assert.deepEqual([JSON.parse(p.read(".agents/kanban/board.json")).startMode, JSON.parse(p.read(".agents/kanban/board.json")).parallel], ["queue", 3]);
  assert.equal(p.aw("board", "config", "--start-mode", "later").code, 2);
});

// ---- where the board is ---------------------------------------------------

test("the old folder is the board until the new one exists", (t) => {
  const p = project(t);
  p.write(".agents/board/board.json", "{}");
  p.run("add", "In the old folder");
  assert.ok(fs.existsSync(path.join(p.dir, ".agents/board/0001-in-the-old-folder.md")));
  assert.equal(fs.existsSync(p.kanban), false);
  let r = p.aw("kanban", "lint");
  assert.equal(r.code, 1);
  assert.match(r.out, /KANBAN_OLD_FOLDER/);
  fs.renameSync(path.join(p.dir, ".agents/board"), p.kanban);
  r = p.aw("kanban", "lint");
  assert.deepEqual([r.code, r.out], [0, "kanban: clean\n"]);
  // An old folder with no board.json is not the board.
  const q = project(t);
  q.write(".agents/board/0001-x.md", '---\nid: "0001"\n---\n');
  assert.equal(JSON.parse(q.run("list", "--json")).dir.endsWith(".agents/kanban"), true);
});

test("the config names the folder, and a project outside git has a board too", (t) => {
  const p = project(t);
  p.write(".agents/agent-works.json", JSON.stringify({ paths: { kanban: "work/cards" } }));
  p.run("add", "Elsewhere");
  assert.ok(fs.existsSync(path.join(p.dir, "work/cards/0001-elsewhere.md")));
  assert.match(p.read(".git/info/exclude"), /^work\/cards\/$/m);
  const loose = project(t, { git: false });
  loose.write(".agents/agent-works.json", "{}");
  loose.run("add", "No repository here");
  assert.ok(fs.existsSync(path.join(loose.kanban, "0001-no-repository-here.md")));
  assert.equal(loose.aw("kanban", "lint").code, 0);
});

test("a worktree works the main tree's board, also through --root", (t) => {
  const p = project(t);
  p.write("README.md", "x\n");
  p.git("add", "README.md");
  p.git("commit", "-q", "-m", "first");
  const tree = path.join(real(tempDir(t, "aw-wt-")), "wt");
  p.git("worktree", "add", "-q", "-b", "feat/y", tree);
  const r = p.aw("kanban", "add", "From a worktree", { cwd: tree });
  assert.deepEqual([r.code, r.err], [0, ""]);
  assert.ok(fs.existsSync(path.join(p.kanban, "0001-from-a-worktree.md")));
  assert.equal(fs.existsSync(path.join(tree, ".agents")), false);
  assert.equal(p.aw("--root", tree, "board", "add", "Through root", { cwd: tempDir(t, "aw-else-") }).code, 0);
  assert.deepEqual(Object.keys(p.cards()), ["0001", "0002"]);
  assert.equal(p.git("-C", tree, "status", "--porcelain"), "");
});

test("the board is untracked unless the repo says otherwise", (t) => {
  const p = project(t);
  p.run("add", "Working state");
  assert.match(p.read(".git/info/exclude"), /^\.agents\/kanban\/$/m);
  assert.equal(p.git("status", "--porcelain"), "");
  p.run("add", "Again");
  assert.equal(p.read(".git/info/exclude").match(/\.agents\/kanban\//g).length, 1);
  assert.deepEqual(findings(p.dir), []);

  // The opt-in: the folder is left for the repo to commit, and lint says so until it does.
  const tracked = project(t);
  tracked.write(".agents/agent-works.json", JSON.stringify({ kanban: { tracked: true } }));
  tracked.run("add", "Shared with the team");
  assert.ok(!(fs.existsSync(path.join(tracked.dir, ".git/info/exclude")) && tracked.read(".git/info/exclude").includes(".agents/kanban")));
  assert.deepEqual(findings(tracked.dir).map((f) => f.code), ["KANBAN_UNTRACKED"]);
  tracked.git("add", ".agents");
  assert.deepEqual(findings(tracked.dir), []);

  // A board that is already committed stays tracked with no config at all.
  const had = project(t);
  had.card("0001", "Committed long ago");
  had.git("add", ".agents");
  had.git("commit", "-q", "-m", "board");
  had.run("add", "A new card on a tracked board");
  assert.ok(!(fs.existsSync(path.join(had.dir, ".git/info/exclude")) && had.read(".git/info/exclude").includes(".agents/kanban")));
  assert.match(had.git("status", "--porcelain"), /0002-a-new-card-on-a-tracked-board\.md/);
});

// ---- lint -----------------------------------------------------------------

test("lint in an empty repo prints one zero document", (t) => {
  const p = project(t);
  const r = p.aw("kanban", "lint", "--json");
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out), { summary: { critical: 0, warning: 0, info: 0 }, findings: [] });
  assert.deepEqual(findings(p.dir), []);
  assert.equal(p.aw("board", "lint").out, "board: clean\n");
  assert.equal(fs.existsSync(p.kanban), false, "a read makes no folder");
});

test("lint: a clean board, invalid cards, and what a card's age says", (t) => {
  const p = project(t);
  p.write(".git/info/exclude", ".agents/kanban/\n");
  p.card("0001", "Fine");
  p.card("0002", "A gate", { kind: "gate", ref: "#1", needs: "x" });
  p.write(".agents/kanban/README.md", "# Notes beside the cards\n");
  assert.deepEqual(findings(p.dir), []);

  p.write(".agents/kanban/0003-broken.md", "no frontmatter here\n");
  p.card("0004", "Twin");
  p.write(".agents/kanban/0005-twin-two.md", `---\nid: 0004\ntitle: Twin two\ncreated: ${OLD}\nupdated: ${OLD}\n---\n`);
  p.card("0006", "A spike", { kind: "spike" });
  p.card("0007", "Gate with no ref", { kind: "gate" });
  let found = findings(p.dir);
  assert.deepEqual([...new Set(found.map((f) => f.code))], ["KANBAN_CARD_INVALID"]);
  assert.deepEqual([...new Set(found.map((f) => f.level))], ["warning"]);
  const said = found.map((f) => `${f.path} ${f.message}`).join("\n");
  for (const part of [".agents/kanban/0003-broken.md not a card", "also the id of 0004-twin.md", "disagree", 'kind "spike"', "a gate without ref"]) assert.ok(said.includes(part), part);

  for (const f of ["0003-broken.md", "0005-twin-two.md", "0006-a-spike.md", "0007-gate-with-no-ref.md"]) fs.rmSync(path.join(p.kanban, f));
  p.card("0011", "Lost", { status: "blocked" });
  p.card("0012", "Forgotten", { status: "in-progress", at: OLD });
  p.card("0013", "Fresh", { status: "in-progress" });
  p.card("0014", "Owed long", { kind: "gate", ref: "#9", needs: "the main checkout", at: OLD });
  p.card("0015", "Settled long ago", { kind: "gate", ref: "#8", status: "done", at: OLD });
  p.card("0016", "Waiting for a reader", { status: "review" });
  p.card("0017", "Lost in planning", { epic: "0099", sprint: "s7" });
  found = Object.fromEntries(findings(p.dir).map((f) => [f.code, f]));
  assert.deepEqual(Object.keys(found).sort(), ["GATE_OWED_OLD", "KANBAN_EPIC_UNKNOWN", "KANBAN_REVIEW_UNLINKED", "KANBAN_SPRINT_UNKNOWN", "KANBAN_STALE_START", "KANBAN_STATUS_UNKNOWN"]);
  assert.ok(found.KANBAN_STATUS_UNKNOWN.path.endsWith("0011-lost.md"));
  assert.ok(found.KANBAN_STALE_START.path.endsWith("0012-forgotten.md"));
  assert.match(found.GATE_OWED_OLD.message, /^owed for #9 for \d+ days; needs the main checkout$/);
  assert.equal(found.KANBAN_REVIEW_UNLINKED.level, "info");
  const r = p.aw("kanban", "lint", "--json");
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).findings.map((f) => f.code).sort(), Object.keys(found).sort());
  assert.deepEqual(JSON.parse(r.out).summary, { critical: 0, warning: 5, info: 1 });

  // The project sets the ages; 7 and 3 days are what it gets without.
  p.write(".agents/agent-works.json", JSON.stringify({ kanban: { gateOwedDays: 100000, staleStartDays: 100000 } }));
  assert.ok(!findings(p.dir).some((f) => ["GATE_OWED_OLD", "KANBAN_STALE_START"].includes(f.code)));
});

test("lint ages: seven days in progress, three days owed, a day past a sprint's end", (t) => {
  const p = project(t);
  p.write(".git/info/exclude", ".agents/kanban/\n");
  const now = Date.parse("2026-06-10T12:00:00.000Z");
  const ago = (days) => new Date(now - days * 86_400_000).toISOString();
  p.card("0001", "Six days", { status: "in-progress", at: ago(6.9) });
  p.card("0002", "Eight days", { status: "in-progress", at: ago(7.1) });
  p.card("0003", "Owed two", { kind: "gate", ref: "a", at: ago(2.9) });
  p.card("0004", "Owed four", { kind: "gate", ref: "b", at: ago(3.1) });
  p.write(".agents/kanban/board.json", JSON.stringify({ sprints: [{ id: "s1", title: "S", state: "active", end: "2026-06-08" }] }));
  assert.deepEqual(findings(p.dir, { now }).map((f) => `${f.code} ${path.basename(f.path)}`).sort(),
    ["GATE_OWED_OLD 0004-owed-four.md", "KANBAN_SPRINT_OVERDUE board.json", "KANBAN_STALE_START 0002-eight-days.md"]);
});

test("lint --fix gives a duplicate id a new one and brings a lost card back", (t) => {
  const p = project(t);
  p.card("0004", "Twin", { at: "2026-01-01T00:00:00.000Z" });
  p.write(".agents/kanban/0005-twin-two.md", "---\nid: 0004\ntitle: Twin two\ncreated: 2026-02-01T00:00:00.000Z\nupdated: 2026-02-01T00:00:00.000Z\n---\n");
  p.card("0006", "Lost", { status: "blocked" });
  const r = p.aw("board", "lint", "--fix");
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^fixed 0007 \(0007-twin-two\.md\)\nfixed 0006 \(0006-lost\.md\)\nboard: clean\n$/);
  assert.deepEqual(fs.readdirSync(p.kanban).filter((f) => f.endsWith(".md")), ["0004-twin.md", "0006-lost.md", "0007-twin-two.md"]);
  assert.equal(p.cards()["0006"].status, "backlog");
  assert.match(p.cards()["0006"].body, /its status was "blocked"/);
});

// ---- what the pane calls ----------------------------------------------------

test("every write answers --json with the card as it now stands", (t) => {
  const p = project(t);
  const json = (...args) => JSON.parse(p.run(...args, "--json"));
  const added = json("add", "Draw the lanes", "--labels", "pane", "--files", "src/a.mjs,src/b.mjs");
  assert.deepEqual([added.id, added.file, added.labels, added.files, added.body], ["0001", "0001-draw-the-lanes.md", ["pane"], ["src/a.mjs", "src/b.mjs"], "## Done when\n\n## Notes"]);
  json("add", "Second");
  json("add", "Third", "--after", "1, 2");
  assert.deepEqual(p.cards()["0003"].after, ["0001", "0002"]);
  assert.equal(json("epic", "A goal").kind, "epic");

  const edited = json("edit", "1", "--title", "Draw the lanes well", "--priority", "high", "--skills", "a,b", "--owner", "kim", "--epic", "4", "--append", "A note at the end.");
  assert.deepEqual([edited.title, edited.priority, edited.skills, edited.owner, edited.epic, edited.file], ["Draw the lanes well", "high", ["a", "b"], "kim", "0004", "0001-draw-the-lanes.md"]);
  assert.ok(edited.body.endsWith("## Notes\n\nA note at the end."));
  assert.equal(json("edit", "1", "--owner", "", "--epic", "none", "--details", "New body.").body, "New body.");
  assert.deepEqual([p.cards()["0001"].owner, p.cards()["0001"].epic], [undefined, undefined]);
  assert.equal(p.aw("board", "edit", "1").code, 2);
  assert.equal(p.run("edit", "1", "--labels", "x"), "Card 0001 changed: labels.\n");

  assert.equal(json("reorder", "3", "0").order, 0);
  assert.deepEqual(JSON.parse(p.run("list", "--json", "--status", "backlog")).cards.map((c) => c.id), ["0003", "0001", "0002", "0004"]);
  assert.deepEqual([json("move", "2", "in-progress", "--index", "0").status, json("move", "1", "in-progress", "--index", "0").order], ["in-progress", 0]);
  assert.deepEqual(JSON.parse(p.run("list", "--json", "--status", "in-progress")).cards.map((c) => [c.id, c.order]), [["0001", 0], ["0002", 1]]);
  assert.equal(json("move", "1", "review", "--mr", "!12").mr, 12);
  assert.equal(p.aw("board", "move", "1", "review", "--mr", "twelve").code, 2);
  assert.match(json("note", "1", "waiting on a reader").body, /## Notes\n\n- \d{4}-\S+Z: waiting on a reader$/);
  assert.equal(json("plan", "2", "--epic", "4").epic, "0004");

  const shown = json("show", "2");
  assert.deepEqual([shown.id, shown.hold, shown.doneCriteria], ["0002", { why: "status", status: "in-progress" }, ""]);
  assert.deepEqual(json("show", "4").children, ["0002"]);
  assert.match(p.run("show", "4"), /Children: 0 of 1 finished\.\n  0002 \[in-progress\] task: Second \(epic 0004\)\n$/);
  const status = json("status");
  assert.deepEqual([status.exists, status.lanes, status.inProgress.map((c) => c.id), status.review, status.ready], [true, { backlog: 1, "in-progress": 1, review: 1, done: 0 }, ["0002"], [{ id: "0001", title: "Draw the lanes well", mr: 12 }], 0]);
  assert.equal(p.run("status", "--brief"), "Board: 1 in progress (0002), 1 in review (0001 !12).\n");
  assert.match(p.run("status"), /^Board at .*\nBacklog \(1\)\n  0003 \[backlog\] task: Third\nIn progress \(1\)\n/);
  assert.deepEqual(json("ready"), []);
  assert.equal(p.run("ready"), "Nothing is ready.\n");
  assert.deepEqual(json("config").columns.map((c) => c.role), [null, "start", "review", "done"]);
});

// ---- the loop ---------------------------------------------------------------

test("propose, grant, bind, claim, wait, done and abandon carry a card through a round", (t) => {
  const p = project(t);
  p.write("README.md", "x\n");
  p.git("add", "README.md");
  p.git("commit", "-q", "-m", "first");
  const b = (...args) => p.aw("board", ...args);
  b("epic", "A goal");
  b("add", "Add kebab case", "--files", "src/kebab.mjs", "--epic", "1", "--details", "Turn a title into kebab case.\n\n## Done when\n\n- [ ] `kebab(\"A b\")` is `a-b`.");
  b("add", "Add snake case", "--files", "src/snake.mjs", "--details", "## Done when\n\n- [ ] snake works.");
  b("add", "Touch kebab too", "--files", "src/kebab.mjs", "--details", "## Done when\n\n- [ ] ok");
  b("add", "No criteria yet");

  let r = b("propose");
  assert.match(r.out, /^Run \(2 of 2\):\n  0002 Add kebab case\n  0003 Add snake case\nHeld:\n  0004 Touch kebab too: overlaps 0002 \(proposed\) on src\/kebab\.mjs\n  0005 No criteria yet: names no files, so it cannot run beside 0002 \(proposed\); names no files, so it cannot run beside 0003 \(proposed\)\n/);
  assert.match(r.out, /On a clear yes: aw board grant 0002,0003 --by "<who, when>"\n$/);
  assert.deepEqual(JSON.parse(b("propose", "--json", "--max", "1").out).run.map((c) => c.id), ["0002"]);

  assert.equal(b("grant", "2,3").code, 2);
  r = b("grant", "2", "3", "--by", "Pat, 2026-10-28");
  assert.equal(r.out, 'Card 0002 granted: "Pat, 2026-10-28: push feat/add-kebab-case and open the pull or merge request (card 0002)"\nCard 0003 granted: "Pat, 2026-10-28: push feat/add-snake-case and open the pull or merge request (card 0003)"\n');
  assert.equal(b("grant", "1", "--by", "Pat").code, 1, "an epic is not worked by the loop");

  r = b("brief", "2");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^# Card 0002: Add kebab case\n/);
  assert.ok(r.out.includes("Turn a title into kebab case.") && r.out.includes('- [ ] `kebab("A b")` is `a-b`.') && r.out.includes("- `src/kebab.mjs`"));
  assert.ok(r.out.includes(`node "${AW}" board claim 0002`) && r.out.includes("git switch -c feat/add-kebab-case"));
  assert.ok(r.out.includes('The claim writes the person\'s push grant ("Pat, 2026-10-28: push feat/add-kebab-case'));
  assert.ok(!/\{\{/.test(r.out));
  r = b("brief", "5");
  assert.equal(r.code, 1);
  assert.match(r.err, /0005 has no done criteria under ## Done when/);

  assert.equal(b("bind", "2", "--session", "card-0002").out, "Card 0002 is bound to card-0002.\n");
  assert.deepEqual([p.cards()["0002"].status, p.cards()["0002"].session], ["in-progress", "card-0002"]);
  assert.equal(b("bind", "2", "--session", "other").code, 1);
  assert.equal(b("bind", "2").code, 2);

  assert.match(b("claim", "2").err, /claim runs in the card's own worktree, never the main checkout/);
  const tree = path.join(real(tempDir(t, "aw-wt-")), "kebab");
  p.git("worktree", "add", "-q", "-b", "feat/add-kebab-case", tree);
  r = b("claim", "2", { cwd: tree });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Card 0002 is claimed on feat\/add-kebab-case in .*kebab; push grant written to branch\.feat\/add-kebab-case\.agentic-engineering-push\n$/);
  assert.equal(p.git("config", "--get", "branch.feat/add-kebab-case.agentic-engineering-push"), "Pat, 2026-10-28: push feat/add-kebab-case and open the pull or merge request (card 0002)");
  assert.deepEqual([p.cards()["0002"].branch, real(p.cards()["0002"].worktree)], ["feat/add-kebab-case", tree]);
  assert.match(b("claim", "3", { cwd: tree }).err, /0003's grant covers feat\/add-snake-case, and this worktree is on feat\/add-kebab-case/);

  r = b("wait", "--timeout", "0", { AW_WAIT_POLL_MS: "10" });
  assert.deepEqual([r.code, r.out], [3, "Still waiting after 0s: 0002 in-progress. Run wait again.\n"]);
  b("move", "2", "review", "--mr", "7");
  assert.equal(b("wait", "--ids", "2", "--timeout", "0").out, "0002 reached review (!7)\n");
  const facts = JSON.parse(b("evidence", "2", "--json").out);
  assert.deepEqual([facts.cards[0].id, facts.cards[0].facts.branch.name, facts.cards[0].facts.branch.local, facts.cards[0].doneWhen], ["0002", "feat/add-kebab-case", true, '- [ ] `kebab("A b")` is `a-b`.']);
  assert.match(b("evidence").out, /^Read from main; fetch first for what origin knows\.\n0002 \[review\] task: Add kebab case .*\n  - feat\/add-kebab-case exists \(local\), 0 commits ahead of main/);
  assert.equal(b("evidence", "--scope", "nowhere").code, 2);

  assert.equal(b("done", "2").code, 2);
  r = b("done", "2", "--merged", "4f2c9e1aa0b1");
  assert.equal(r.out, "Card 0002 is done at 4f2c9e1aa0b1; the push grant for feat/add-kebab-case is revoked.\nEpic 0001 is done: its last card closed.\n");
  assert.deepEqual([p.cards()["0002"].status, p.cards()["0002"].merged, p.cards()["0001"].status], ["done", "4f2c9e1aa0b1", "done"]);
  assert.throws(() => p.git("config", "--get", "branch.feat/add-kebab-case.agentic-engineering-push"));

  b("bind", "3", "--terminal");
  r = b("abandon", "3");
  assert.equal(r.out, "Card 0003 is abandoned, back in backlog; the push grant for feat/add-snake-case is revoked.\n");
  const back = p.cards()["0003"];
  assert.deepEqual([back.status, back.session, back.branch, back.grant], ["backlog", undefined, undefined, undefined]);
  assert.equal(b("abandon", "2").code, 1);

  // A grant left on a branch no card works is named by lint.
  p.git("config", "branch.feat/gone.agentic-engineering-push", "Pat: by hand");
  assert.ok(findings(p.dir).some((f) => f.code === "KANBAN_GRANT_ORPHAN" && f.message.includes("feat/gone")));
});

test("wait wakes on a CARD line a child wrote into its card", (t) => {
  const p = project(t);
  p.run("add", "A task", "--status", "in-progress", "--details", "## Report\n\nCARD 0001 blocked !- lanes=- owed=-");
  // A line that was already there does not count.
  assert.equal(p.aw("board", "wait", "--timeout", "0").code, 3);
  const child = spawn(process.execPath, [AW, "board", "wait", "--timeout", "20"], { cwd: p.dir, env: { ...process.env, ...QUIET, AW_WAIT_POLL_MS: "25" } });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  return new Promise((resolve, reject) => {
    setTimeout(() => p.aw("board", "edit", "1", "--append", "CARD 0001 failed !- lanes=unit:fail owed=-"), 150);
    child.on("close", (code) => {
      try {
        assert.deepEqual([code, out], [0, "0001 reported: CARD 0001 failed !- lanes=unit:fail owed=-\n"]);
        resolve();
      } catch (e) { reject(e); }
    });
  });
});

// ---- a tracker's issues -------------------------------------------------------

/** Call the command in-process against `p`, with `run` standing in for git, gh and glab. */
async function withRunner(p, run, ...args) {
  const io = { ...bufferedIo({ cwd: p.dir, env: { ...process.env, ...QUIET } }), run, command: "board" };
  let code;
  try { code = await board(["remote", ...args], io); } catch (e) { return { code: e.exitCode ?? 1, out: io.out(), err: e.message }; }
  return { code, out: io.out(), err: io.err() };
}

/**
 * A tracker in memory. `routes` are tried in order against `<cmd> <argv joined by spaces>`; the first whose pattern
 * matches answers (`json`, `stdout`, or a failure `{ status, stderr }`), given the match and the call. Every call is
 * recorded.
 */
function tracker(url, routes) {
  const calls = [];
  const run = (cmd, argv, { input } = {}) => {
    const line = `${cmd} ${argv.join(" ")}`;
    calls.push({ cmd, argv, input, line });
    if (cmd === "git") return { status: 0, stdout: `${url}\n`, stderr: "" };
    for (const [pattern, answer] of routes) {
      const m = pattern.exec(line);
      if (!m) continue;
      const a = typeof answer === "function" ? answer(m, { argv, input }) : answer;
      return { status: a.status ?? 0, stdout: a.json !== undefined ? JSON.stringify(a.json) : a.stdout ?? "", stderr: a.stderr ?? "" };
    }
    return { status: 1, stdout: "", stderr: `no answer for: ${line.slice(0, 120)}` };
  };
  return { run, calls, lines: (re) => calls.filter((c) => re.test(c.line)) };
}

test("remote status says where the board stands with no call to the tracker; on and off are a line of board.json", async (t) => {
  const p = project(t);
  p.run("add", "First");
  p.run("add", "A thought", "--suggest");
  const hub = tracker("git@github.com:someone/thing.git", []);
  let r = await withRunner(p, hub.run, "status");
  assert.equal(r.out, "Tracker sync is off: github someone/thing.\n0 card(s) linked to an issue, 1 without one, 0 changed since the last pass.\naw board remote on turns it on; the first pass opens an issue for each card without one.\n");
  assert.deepEqual(hub.calls.map((c) => c.cmd), ["git"]);
  assert.deepEqual(JSON.parse((await withRunner(p, hub.run, "status", "--json")).out), { enabled: false, provider: "github", repo: "someone/thing", linked: 0, unlinked: 1, changed: 0 });
  r = await withRunner(p, hub.run, "sync");
  assert.deepEqual([r.code, r.err], [1, "sync with a tracker is off for this board: aw board remote on turns it on"]);
  assert.equal((await withRunner(p, hub.run, "on")).out, "Tracker sync is on. aw board remote sync runs a pass.\n");
  assert.equal(readBoard(p.kanban).remote.enabled, true);
  assert.equal((await withRunner(p, hub.run, "off")).out, "Tracker sync is off.\n");
  assert.equal(readBoard(p.kanban).remote.enabled, false);
  assert.equal((await withRunner(p, tracker("https://example.org/a/b.git", []).run, "status")).out.split("\n")[0], "Tracker sync is off: the origin remote is neither GitHub nor GitLab.");
});

const ghIssue = (n, more = {}) => ({
  id: `I_${n}`, number: n, title: `Issue ${n}`, body: "", url: `https://github.com/someone/thing/issues/${n}`, updatedAt: "2026-05-01T10:00:00Z",
  state: "OPEN", labels: { nodes: [] }, milestone: null, parent: null, ...more,
});

test("remote sync with GitHub: labels say the column, a milestone the sprint, a parent the epic", async (t) => {
  const p = project(t);
  p.write(".agents/kanban/board.json", JSON.stringify({ remote: { enabled: true }, sprints: [{ id: "s1", title: "Polish", goal: "Ship", end: "2026-03-01", state: "active" }] }));
  p.run("add", "Faster sync", "--kind", "epic", "--details", "The goal.");
  p.run("add", "Cache the list", "--epic", "1", "--sprint", "s1", "--labels", "perf", "--details", "Cache it.");
  p.run("add", "Local thought", "--suggest");
  let next = 10;
  const made = new Map();
  const view = (n) => ({ number: n, title: made.get(n).title, body: made.get(n).body, state: made.get(n).state ?? "OPEN", labels: (made.get(n).labels ?? []).map((name) => ({ name })), url: `https://github.com/someone/thing/issues/${n}`, milestone: made.get(n).milestone ? { title: made.get(n).milestone } : null, updatedAt: "2026-05-02T10:00:00Z" });
  const hub = tracker("https://github.com/someone/thing.git", [
    [/projectsV2/, { status: 1, stderr: "GraphQL: Your token has not been granted the required scopes (read:project)" }],
    [/issues\(first: 100/, { json: { data: { repository: { issues: { nodes: [
      ghIssue(3, { title: "Found on the tracker", body: "Someone filed this.", labels: { nodes: [{ name: "status:review" }, { name: "bug" }] }, milestone: { title: "Polish" } }),
      ghIssue(4, { title: "Closed long ago", state: "CLOSED" }),
    ] } } } } }],
    [/gh label create (\S+)/, { stdout: "" }],
    [/gh api -X GET repos\/someone\/thing\/milestones/, { json: [] }],
    [/gh api -X POST repos\/someone\/thing\/milestones/, { json: { number: 5 } }],
    [/gh issue create /, (m, { argv, input }) => {
      const n = next++;
      const all = (name) => argv.flatMap((a, i) => (argv[i - 1] === name ? [a] : []));
      made.set(n, { title: all("--title")[0], body: input, labels: all("--label"), milestone: all("--milestone")[0] });
      return { stdout: `https://github.com/someone/thing/issues/${n}\n` };
    }],
    [/gh issue view (\d+)/, (m) => ({ json: view(Number(m[1])) })],
    [/issue\(number: \$number\)/, (m, { argv }) => ({ json: { data: { repository: { issue: { id: `I_${argv.at(-1).split("=")[1]}` } } } } })],
    [/addSubIssue/, { json: { data: { addSubIssue: { issue: { id: "x" } } } } }],
  ]);

  const dry = await withRunner(p, hub.run, "sync", "--dry-run");
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out.split("\n")[0], "Would sync with github: 2 pushed, 1 pulled (1 new card(s)).");
  assert.equal(hub.lines(/issue create/).length, 0);
  assert.equal(p.cards()["0001"].remote, undefined);

  const r = await withRunner(p, hub.run, "sync");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "Synced with github: 2 pushed, 1 pulled (1 new card(s)).\nNo access to project boards, so columns sync as labels. To use a project board: gh auth refresh -s project\n");

  // The epic went first, so the card could hang from its issue.
  const creates = hub.lines(/issue create/);
  assert.deepEqual(creates.map((c) => c.argv.filter((a, i) => ["--title", "--label", "--milestone"].includes(c.argv[i - 1]))), [["Faster sync", "status:backlog"], ["Cache the list", "perf", "status:backlog", "Polish"]]);
  assert.deepEqual(creates.map((c) => c.input), ["The goal.", "Cache it."]);
  assert.deepEqual(JSON.parse(hub.lines(/-X POST repos\/someone\/thing\/milestones/)[0].input), { title: "Polish", due_on: "2026-03-01T12:00:00Z", description: "Ship" });
  const hang = hub.lines(/addSubIssue/)[0];
  assert.ok(hang.argv.includes("issueId=I_10") && hang.argv.includes("subIssueId=I_11"));
  assert.deepEqual(hub.lines(/label create/).map((c) => c.argv[2]), ["status:backlog", "perf"]);

  const cards = p.cards();
  assert.deepEqual(cards["0001"].remote, { provider: "github", number: 10, url: "https://github.com/someone/thing/issues/10", updatedAt: "2026-05-02T10:00:00Z", syncedHash: cards["0001"].remote.syncedHash });
  assert.equal(cards["0002"].remote.number, 11);
  assert.equal(cards["0003"].remote, undefined, "a suggestion stays here");
  const pulled = cards["0004"];
  assert.deepEqual([pulled.title, pulled.status, pulled.labels, pulled.sprint, pulled.body, pulled.remote.number, pulled.file], ["Found on the tracker", "review", ["bug"], "s1", "Someone filed this.", 3, "0004-found-on-the-tracker.md"]);
  assert.equal(Object.keys(cards).length, 4, "a closed issue with no card makes none");
  assert.match(p.read(".agents/kanban/0002-cache-the-list.md"), /remote:\n  provider: github\n  number: 11\n  url: https:\/\/github\.com\/someone\/thing\/issues\/11\n  updatedAt: 2026-05-02T10:00:00Z\n  syncedHash: [0-9a-f]+\n---/);

  // Second pass: a local move is pushed as a label swap and a close; a change on the tracker is pulled.
  p.run("move", "2", "done");
  const hub2 = tracker("https://github.com/someone/thing.git", [
    [/projectsV2/, { status: 1, stderr: "no scopes" }],
    [/issues\(first: 100/, { json: { data: { repository: { issues: { nodes: [
      ghIssue(10, { title: "Faster sync, renamed there", body: "The goal.", labels: { nodes: [{ name: "status:backlog" }] }, updatedAt: "2099-01-01T00:00:00Z" }),
      ghIssue(11, { title: "Cache the list", body: "Cache it.", labels: { nodes: [{ name: "perf" }, { name: "status:backlog" }] }, milestone: { title: "Polish" }, parent: { number: 10 }, updatedAt: "2026-05-02T10:00:00Z" }),
      ghIssue(3, { title: "Found on the tracker", body: "Someone filed this.", labels: { nodes: [{ name: "status:review" }, { name: "bug" }] }, milestone: { title: "Polish" } }),
    ] } } } } }],
    [/gh label create/, { stdout: "" }],
    [/gh api -X GET repos\/someone\/thing\/milestones/, { json: [{ title: "Polish", number: 5, due_on: "2026-03-01T12:00:00Z" }] }],
    [/gh issue (edit|close) 11/, { stdout: "" }],
    [/gh issue view 11/, { json: { number: 11, title: "Cache the list", body: "Cache it.", state: "CLOSED", labels: [{ name: "perf" }, { name: "status:done" }], url: "https://github.com/someone/thing/issues/11", milestone: { title: "Polish" }, updatedAt: "2026-05-03T10:00:00Z" } }],
  ]);
  const second = await withRunner(p, hub2.run, "sync", "--json");
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(JSON.parse(second.out), { provider: "github", pushed: 1, pulled: 1, created: 0, skipped: 0, columns: false, notices: ["No access to project boards, so columns sync as labels. To use a project board: gh auth refresh -s project"], dryRun: false });
  const edit = hub2.lines(/issue edit 11/)[0];
  assert.deepEqual(edit.argv.slice(edit.argv.indexOf("--add-label")), ["--add-label", "status:done", "--remove-label", "status:backlog"]);
  assert.equal(hub2.lines(/issue close 11/).length, 1);
  assert.equal(hub2.lines(/SubIssue/).length, 0, "the parent did not change");
  const now = p.cards();
  assert.deepEqual([now["0001"].title, now["0001"].updated, now["0001"].file], ["Faster sync, renamed there", "2099-01-01T00:00:00Z", "0001-faster-sync.md"]);
  assert.equal(now["0002"].remote.updatedAt, "2026-05-03T10:00:00Z");
  // Nothing changed on either side: a third pass writes nothing.
  const quiet = tracker("https://github.com/someone/thing.git", [
    [/projectsV2/, { status: 1, stderr: "no scopes" }],
    [/issues\(first: 100/, { json: { data: { repository: { issues: { nodes: [
      ghIssue(10, { title: "Faster sync, renamed there", body: "The goal.", labels: { nodes: [{ name: "status:backlog" }] }, updatedAt: "2099-01-01T00:00:00Z" }),
    ] } } } } }],
  ]);
  const stamp = fs.statSync(path.join(p.kanban, "0001-faster-sync.md")).mtimeMs;
  assert.equal((await withRunner(p, quiet.run, "sync")).out.split("\n")[0], "Synced with github: 0 pushed, 0 pulled.");
  assert.equal(fs.statSync(path.join(p.kanban, "0001-faster-sync.md")).mtimeMs, stamp);
});

test("remote sync with GitLab: a board's lists are the columns, a group epic holds its cards", async (t) => {
  const p = project(t);
  p.write(".agents/kanban/board.json", JSON.stringify({ remote: { enabled: true }, sprints: [{ id: "s1", title: "Polish", end: "2026-03-01", state: "active" }] }));
  p.run("add", "Faster sync", "--kind", "epic");
  const P = "projects/group%2Fthing";
  const glIssue = (iid, more = {}) => ({ id: 1000 + iid, iid, title: `Issue ${iid}`, description: "", web_url: `https://gitlab.com/group/thing/-/issues/${iid}`, updated_at: "2026-05-01T10:00:00Z", state: "opened", labels: [], milestone: null, ...more });
  const sent = (call) => Object.fromEntries(call.argv.flatMap((a, i) => (call.argv[i - 1] === "-f" ? [[a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]] : [])));
  const lab = tracker("git@gitlab.com:group/thing.git", [
    [new RegExp(`glab api -X GET ${P}/boards`), { json: [{ lists: [{ position: 1, label: { name: "Doing" } }, { position: 0, label: { name: "To do" } }] }] }],
    [new RegExp(`glab api -X GET ${P}$`), { json: { namespace: { kind: "group", id: 42 } } }],
    [/glab api -X GET groups\/42\/epics\?per_page=1$/, { json: [] }],
    [new RegExp(`glab api -X GET ${P}/issues\\?`), { json: [
      glIssue(7, { title: "In the epic there", labels: ["Doing", "bug", "status:old"], milestone: { title: "Polish" }, epic: { id: 9001, iid: 2 } }),
      glIssue(8, { title: "Under a milestone nobody planned", milestone: { title: "Someday" } }),
    ] }],
    [/glab api -X GET groups\/42\/epics\?per_page=100/, { json: [{ id: 9001, iid: 2, title: "An epic there", description: "Its goal.", web_url: "https://gitlab.com/groups/group/-/epics/2", updated_at: "2026-05-01T10:00:00Z", state: "opened", labels: [] }] }],
    [/glab api -X POST groups\/42\/epics/, { json: { id: 9002, iid: 3, title: "Faster sync", description: "## Done when\n\n## Notes", web_url: "https://gitlab.com/groups/group/-/epics/3", updated_at: "2026-05-02T10:00:00Z", state: "opened", labels: [] } }],
  ]);
  const r = await withRunner(p, lab.run, "sync");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.trimEnd().split("\n"), [
    "Synced with gitlab: 1 pushed, 3 pulled (3 new card(s)).", "The board took the tracker board's columns.",
    'milestone "Someday" matches no sprint on this board; left as it is.',
  ]);
  const b = readBoard(p.kanban);
  assert.deepEqual(b.columns, [
    { id: "open", title: "Open", role: null }, { id: "to-do", title: "To do", role: null }, { id: "doing", title: "Doing", role: "start" }, { id: "closed", title: "Closed", role: "done" },
  ]);
  assert.deepEqual(sent(lab.lines(/-X POST groups\/42\/epics/)[0]), { title: "Faster sync", description: "## Done when\n\n## Notes", labels: "" });
  const cards = Object.fromEntries(b.cards.map((c) => [c.title, c]));
  assert.deepEqual([cards["Faster sync"].remote.number, cards["Faster sync"].remote.url], [3, "https://gitlab.com/groups/group/-/epics/3"]);
  assert.deepEqual([cards["An epic there"].kind, cards["An epic there"].id, cards["An epic there"].status], ["epic", "0002", "open"]);
  const child = cards["In the epic there"];
  assert.deepEqual([child.status, child.labels, child.sprint, child.epic, child.kind], ["doing", ["bug"], "s1", "0002", "task"]);
  assert.equal(cards["Under a milestone nobody planned"].sprint, undefined);

  // A card planned here goes up with its list's label, its milestone's id and its epic's global id.
  p.run("add", "Planned here", "--status", "doing", "--epic", "2", "--sprint", "s1", "--labels", "perf", "--details", "Do it.");
  p.run("move", "3", "closed");
  const lab2 = tracker("git@gitlab.com:group/thing.git", [
    [new RegExp(`glab api -X GET ${P}/boards`), { json: [{ lists: [{ position: 1, label: { name: "Doing" } }, { position: 0, label: { name: "To do" } }] }] }],
    [new RegExp(`glab api -X GET ${P}$`), { json: { namespace: { kind: "group", id: 42 } } }],
    [/glab api -X GET groups\/42\/epics\?per_page=1$/, { json: [] }],
    [new RegExp(`glab api -X GET ${P}/issues\\?`), { json: [glIssue(7, { title: "In the epic there", labels: ["Doing", "bug"], milestone: { title: "Polish" }, epic: { id: 9001, iid: 2 } })] }],
    [/glab api -X GET groups\/42\/epics\?per_page=100/, { json: [{ id: 9001, iid: 2, title: "An epic there", description: "Its goal.", web_url: "https://gitlab.com/groups/group/-/epics/2", updated_at: "2026-05-01T10:00:00Z", state: "opened", labels: [] }] }],
    [new RegExp(`glab api -X GET ${P}/milestones`), { json: [{ id: 77, title: "Polish", due_date: "2026-02-01" }] }],
    [new RegExp(`glab api -X PUT ${P}/milestones/77`), { json: {} }],
    [new RegExp(`glab api -X POST ${P}/issues`), { json: glIssue(9, { title: "Planned here", description: "Do it.", labels: ["Doing", "perf"], milestone: { title: "Polish" }, epic: { id: 9001, iid: 2 }, updated_at: "2026-05-04T10:00:00Z" }) }],
    [new RegExp(`glab api -X PUT ${P}/issues/7`), { json: glIssue(7, { title: "In the epic there", labels: ["bug"], state: "closed", milestone: { title: "Polish" }, epic: { id: 9001, iid: 2 }, updated_at: "2026-05-04T11:00:00Z" }) }],
  ]);
  const second = await withRunner(p, lab2.run, "sync");
  assert.equal(second.code, 0, second.err);
  assert.equal(second.out, "Synced with gitlab: 2 pushed, 0 pulled.\n");
  assert.deepEqual(sent(lab2.lines(new RegExp(`-X POST ${P}/issues`))[0]), { title: "Planned here", description: "Do it.", labels: "perf,Doing", milestone_id: "77", epic_id: "9001" });
  assert.deepEqual(sent(lab2.lines(new RegExp(`-X PUT ${P}/milestones/77`))[0]), { due_date: "2026-03-01" });
  assert.deepEqual(sent(lab2.lines(new RegExp(`-X PUT ${P}/issues/7`))[0]), { title: "In the epic there", description: "", labels: "bug", milestone_id: "77", epic_id: "9001", state_event: "close" });
  const after = Object.fromEntries(readBoard(p.kanban).cards.map((c) => [c.title, c]));
  assert.deepEqual([after["Planned here"].remote.number, after["In the epic there"].status, after["In the epic there"].remote.updatedAt], [9, "closed", "2026-05-04T11:00:00Z"]);
});

test("a tracker nobody can reach fails the pass with what to do, and writes nothing", async (t) => {
  const p = project(t);
  p.write(".agents/kanban/board.json", JSON.stringify({ remote: { enabled: true } }));
  p.run("add", "First");
  const out = tracker("https://github.com/someone/thing.git", [[/./, { status: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" }]]);
  const r = await withRunner(p, out.run, "sync");
  assert.equal(r.code, 1);
  assert.match(r.err, /^gh: gh is not signed in to github\.com\. Run: gh auth login/);
  assert.equal(p.cards()["0001"].remote, undefined);
});
