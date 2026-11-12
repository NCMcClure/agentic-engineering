// agent-works scripts/status.mjs: derived from the board, the store and git;
// each part left out when its source is absent, and said so when it cannot be read.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HAS_GIT, common, project, script } from "./agent-works-homes.mjs";

const status = await script("status.mjs");

const card = (id, title, lane, extra = "") => `---\nid: "${id}"\ntitle: ${title}\nstatus: ${lane}\norder: 1\npriority: normal\nlabels: []\nskills: []\nsource: user\n`
  + `created: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\n${extra}---\n\nBody.\n`;
const BOARD = { columns: [{ id: "todo", title: "Todo" }, { id: "doing", title: "In Progress", role: "start" }, { id: "done", title: "Done", role: "done" }] };
// No reader of the board and nothing of the store: what the command does by itself.
const ALONE = { board: null, locks: null, leases: null, claims: null };

function withBoard(t, folder = ".agents/kanban") {
  const p = project(t, { config: {} });
  const w = (name, text) => p.write(`${folder}/${name}`, text);
  w("board.json", JSON.stringify(BOARD));
  w("0001-first-thing.md", card("0001", "First thing", "todo"));
  w("0002-in-hand.md", card("0002", "In hand", "doing", "owner: a1\n"));
  w("0003-shipped.md", card("0003", "Shipped", "done"));
  w("0004-full-suite.md", card("0004", "Full suite on the merged tree", "todo", 'kind: gate\nneeds: the GPU\nref: "PR 12"\n'));
  w("0005-settled.md", card("0005", "Settled gate", "done", "kind: gate\n"));
  return p;
}

test("agent-works status: a project with nothing in it", async (t) => {
  const p = project(t, { config: {} });
  const [code, out, err] = await p.aw("status", "--json");
  assert.deepEqual([code, err], [0, ""]);
  const doc = JSON.parse(out);
  assert.deepEqual(Object.keys(doc), ["project", "root", "branch", "statusFile", "board", "coordination", "done"]);
  assert.match(doc.project, /^acme-[0-9a-f]{8}$/);
  assert.deepEqual([doc.root, doc.branch, doc.board, doc.statusFile, doc.done], [common.posix(p.root), "feat/x", null, null, null]);
  const [, text] = await p.aw("status");
  assert.ok(text.startsWith(`${doc.project}   branch feat/x\n\nboard: none here\n`), text);
  assert.equal((await p.aw("status", "--merges", "few"))[0], 2);
});

for (const [how, mods] of [["through the board's reader", { locks: null, leases: null, claims: null }], ["from the cards' frontmatter", ALONE]]) {
  test(`agent-works status: the board, the gates owed and the status file, ${how}`, async (t) => {
    const p = withBoard(t);
    p.write(".agents/memory/project/2026-01-09-project-status.md", "---\nname: project-status\ndescription: d\ntype: status\nupdated: 2026-01-09\n---\n\n# Status\n");
    const doc = await status.collect(p.root, { env: p.env(), mods });
    const b = doc.board;
    assert.deepEqual(Object.keys(b), ["dir", "done", "columns", "cards", "gates", "sprint", "epics"]);
    assert.deepEqual([b.dir, b.done, b.sprint, b.epics], [common.posix(p.at(".agents/kanban")), "done", null, []]);
    assert.deepEqual(b.columns.map((c) => [c.id, c.title, c.count]), [["todo", "Todo", 2], ["doing", "In Progress", 1], ["done", "Done", 2]]);
    assert.deepEqual(b.gates.map((g) => [g.id, g.needs, g.ref]), [["0004", "the GPU", "PR 12"]]);
    assert.deepEqual(b.cards[1], { id: "0002", title: "In hand", status: "doing", kind: "task", owner: "a1", needs: "", ref: "", priority: "normal",
      updated: "2026-01-05T10:00:00.000Z", epic: "", sprint: "" });
    assert.deepEqual(doc.statusFile, { path: ".agents/memory/project/2026-01-09-project-status.md", lines: 8, budget: 120, updated: "2026-01-09" });
    const text = status.textOf(doc);
    for (const part of ["status file: .agents/memory/project/2026-01-09-project-status.md (8/120 lines, updated 2026-01-09)", "board: Todo 2, In Progress 1, Done 2",
      "  [Todo] 0001 First thing\n", "  [In Progress] 0002 In hand  (a1)", "gates owed: 1", "  0004 Full suite on the merged tree  (for PR 12; needs the GPU)"]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
    assert.ok(!text.includes("Shipped")); // done is not listed card by card
    assert.equal(status.brief(doc), "board: Todo 2, In Progress 1, Done 2; gates owed: 0004 Full suite on the merged tree");
  });
}

test("agent-works status: a status no column knows becomes a column, and settled gates are owed by nobody", async (t) => {
  const p = withBoard(t);
  p.write(".agents/kanban/0006-odd.md", card("0006", "Odd", "parked"));
  p.remove(".agents/kanban/0004-full-suite.md");
  const doc = await status.collect(p.root, { env: p.env(), mods: ALONE });
  assert.deepEqual(doc.board.columns.at(-1), { id: "parked", title: "parked", count: 1 });
  assert.ok(status.textOf(doc).includes("gates owed: none"));
});

test("agent-works status: the active sprint and the open epics, with the sprint's cards listed", async (t) => {
  const p = withBoard(t);
  p.write(".agents/kanban/board.json", JSON.stringify({ ...BOARD, sprints: [{ id: "s1", title: "First", state: "closed" },
    { id: "s2", title: "Ship it", goal: "the importer", end: "2026-02-01", state: "active" }] }));
  p.write(".agents/kanban/0007-epic.md", card("0007", "The importer", "todo", "kind: epic\n"));
  p.write(".agents/kanban/0008-a.md", card("0008", "Part a", "done", 'epic: "0007"\nsprint: s2\n'));
  p.write(".agents/kanban/0009-b.md", card("0009", "Part b", "doing", 'epic: "0007"\nsprint: s2\n'));
  p.write(".agents/kanban/0010-c.md", card("0010", "Part c", "todo", 'epic: "0007"\n'));
  for (const mods of [ALONE, { locks: null, leases: null, claims: null }]) {
    const doc = await status.collect(p.root, { env: p.env(), mods });
    assert.equal(doc.board.sprint.line, 'Sprint s2 "Ship it" (active, ends 2026-02-01): the importer');
    assert.deepEqual(doc.board.epics, [{ id: "0007", title: "The importer", done: 1, total: 3, bar: "▰▰▰▱▱▱▱▱ 1/3" }]);
    const text = status.textOf(doc);
    assert.ok(text.includes('board: Todo 4, In Progress 2, Done 3\nSprint s2 "Ship it" (active, ends 2026-02-01): the importer\n  epic 0007 ▰▰▰▱▱▱▱▱ 1/3: The importer\n'), text);
    assert.ok(text.includes("  [In Progress] 0009 Part b\n"));
    assert.ok(!text.includes("Part c") && !text.includes("In hand")); // not the sprint's: they wait in the backlog
    assert.ok(status.brief(doc).endsWith('\nSprint s2 "Ship it" (active, ends 2026-02-01): the importer'));
  }
  assert.deepEqual([status.progressBar(0, 0), status.progressBar(1, 16), status.progressBar(8, 8)], ["▱▱▱▱▱▱▱▱ 0/0", "▰▱▱▱▱▱▱▱ 1/16", "▰▰▰▰▰▰▰▰ 8/8"]);
});

test("agent-works status: the board's old folder is read while the new one does not exist", async (t) => {
  const p = withBoard(t, ".agents/board");
  for (const mods of [ALONE, { locks: null, leases: null, claims: null }]) {
    const b = (await status.collect(p.root, { env: p.env(), mods })).board;
    assert.ok(b.dir.endsWith(".agents/board"));
    assert.equal(b.cards.length, 5);
  }
});

test("agent-works status: locks, leases and claims are asked of the store's modules, and only this project's and the machine's are shown", async (t) => {
  const p = project(t, { config: {} });
  const id = common.projectId(p.root);
  const asked = [];
  const mods = {
    locks: { allLocks: (home) => { asked.push(["locks", home]); return [
      { resource: "editor", scope: id, held: true, waiting: [], agent: "a1", project: id, since: "2026-01-05T10:00:00Z", refreshed: "x", pid: 7, heldMinutes: 2, for: "tests" },
      { resource: "gpu", scope: "machine", held: true, agent: "b2", project: "other-12345678", since: "2026-01-05T11:00:00Z", for: null },
      { resource: "theirs", scope: "other-12345678", held: true, agent: "c3" },
      { resource: "queued", scope: id, held: false, waiting: ["d4"] },
    ]; } },
    leases: { live: (home, options) => { asked.push(["leases", home, options]); return [{ id: "L1", resource: "gpu", agent: "a1", project: id, share: 0.5, mem: 1024, for: "bake", since: "s", pid: 9 }]; } },
    claims: { read: (home, project) => { asked.push(["claims", home, project]); return { schema: { floor: 3, claims: [{ agent: "a1", value: 4, for: "the index", since: "s", until: "u" }] }, alpha: { floor: null, claims: [{ agent: "b2" }] } }; } },
  };
  const c = await status.coordination(p.root, p.env(), mods);
  assert.deepEqual(asked, [["locks", p.home], ["leases", p.home, { prune: false }], ["claims", p.home, id]]);
  assert.deepEqual(c, {
    locks: [{ resource: "editor", scope: id, agent: "a1", project: id, for: "tests", since: "2026-01-05T10:00:00Z" },
      { resource: "gpu", scope: "machine", agent: "b2", project: "other-12345678", since: "2026-01-05T11:00:00Z" }],
    leases: [{ resource: "gpu", agent: "a1", project: id, share: 0.5, mem: 1024, for: "bake", since: "s" }],
    claims: [{ counter: "alpha", agent: "b2" }, { counter: "schema", agent: "a1", value: 4, for: "the index", since: "s" }],
  });
  const doc = { ...(await status.collect(p.root, { env: p.env(), mods })), done: null };
  const text = status.textOf(doc);
  assert.ok(text.endsWith("\n\nlocks: editor held by a1 (tests), gpu held by b2\nleases: gpu by a1\nclaims: alpha by b2, schema=4 by a1"), text);
  assert.equal(status.brief(doc), "locks: editor held by a1 (tests), gpu held by b2");
});

test("agent-works status: a part of the store that cannot be read says so, and the rest prints", async (t) => {
  const p = project(t, { config: {} });
  const mods = { locks: { allLocks: () => [] }, leases: {}, claims: { read: () => { throw new Error("the file is locked"); } } };
  const c = await status.coordination(p.root, p.env(), mods);
  assert.deepEqual(c, { locks: [], leases: [], claims: [],
    unavailable: { leases: "scripts/coord/leases.mjs exports no live", claims: "scripts/coord/claims.mjs: read failed: the file is locked" } });
  const text = status.textOf({ ...(await status.collect(p.root, { env: p.env(), mods })), done: null });
  assert.ok(text.endsWith("locks: none held\nleases: cannot be read (scripts/coord/leases.mjs exports no live)\nclaims: cannot be read (scripts/coord/claims.mjs: read failed: the file is locked)"), text);
  // None of the three: the whole part is null, in one line of the text.
  const none = await status.collect(p.root, { env: p.env(), mods: ALONE });
  assert.equal(none.coordination, null);
  assert.ok(status.textOf(none).includes("\n\nlocks, leases, claims: cannot be read here"));
});

test("agent-works status: a lock in the store shows in `aw status`", async (t) => {
  const p = project(t, { config: {} });
  const id = common.projectId(p.root);
  const stamp = common.nowIso();
  common.writeJson(`${p.home}/locks/${id}/editor.lock`, { agent: "a1", project: id, for: "tests", pid: process.pid, since: stamp, refreshed: stamp });
  const doc = JSON.parse((await p.aw("status", "--json"))[1]);
  // The lock command's own module reads the store: where it is not installed, the part says so instead.
  if (doc.coordination !== null && !doc.coordination.unavailable?.locks) {
    assert.deepEqual(doc.coordination.locks.map((l) => [l.resource, l.agent]), [["editor", "a1"]]);
    assert.ok((await p.aw("status"))[1].includes("editor held by a1 (tests)"));
  }
});

test("agent-works status: done is the git log: the last merges, or the last commits of a history without any", { skip: !HAS_GIT && "needs git" }, async (t) => {
  const p = project(t, { git: "real" });
  assert.equal(status.merges(p.root, 5), null); // no commit yet
  p.write("a.txt", "1");
  p.git("add", "a.txt");
  p.git("commit", "-q", "-m", "First");
  p.git("checkout", "-q", "-b", "topic");
  p.write("b.txt", "1");
  p.git("add", "b.txt");
  p.git("commit", "-q", "-m", "Second   with\ttabs");
  let done = status.merges(p.root, 5);
  assert.deepEqual([done.kind, done.rows.map((r) => r.subject)], ["commits", ["Second   with\ttabs", "First"]]);
  assert.match(done.rows[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(status.merges(p.root, 1).rows.length, 1);
  p.git("checkout", "-q", "main");
  p.git("merge", "-q", "--no-ff", "-m", "Merge topic", "topic");
  done = status.merges(p.root, 5);
  assert.deepEqual([done.kind, done.rows.map((r) => r.subject)], ["merges", ["Merge topic"]]);
  const [code, text] = await p.aw("status");
  assert.equal(code, 0);
  assert.match(text, /\n\ndone \(the last 1 merges on this branch\):\n {2}\d{4}-\d{2}-\d{2} [0-9a-f]+ Merge topic\n$/);
  assert.ok(text.startsWith(`${common.projectId(p.root)}   branch main\n`));
});
