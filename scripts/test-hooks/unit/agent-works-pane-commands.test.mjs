// The pane never writes the board: each thing it does is one run of the board
// CLI. commands.mjs holds that map, and here every entry of it is run for real
// against a board in a temp repository, through the plugin's own dispatcher,
// and the board is read back to see the change. An entry the CLI does not
// know, or a flag it refuses, fails here before it fails in a pane.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BOARD } from "../../../plugins/agent-works/hooks/kanban/commands.mjs";
import { KANBAN, board, boardOf, cardText, repo } from "./agent-works-pane-host.mjs";

/** Run one entry of the map; fails with the CLI's own words unless it exits `status`. */
function run(r, name, input, status = 0) {
  assert.equal(typeof BOARD[name], "function", `commands.mjs has no "${name}"`);
  const args = BOARD[name](input);
  const out = board(r.dir, ...args);
  assert.equal(out.status, status, `aw board ${args.join(" ")} exited ${out.status}: ${out.stderr || out.stdout}`);
  ran.add(name);
  return out.stdout.trim();
}
const ran = new Set();

test("every pane action is a real aw board action, and the board shows what it did", async (t) => {
  const r = repo(t, { origin: "https://github.com/example/board.git" });

  await t.test("add files a card, in a column or as a suggestion, with its fields", () => {
    assert.match(run(r, "add", { title: "Draw the lanes" }), /^Added card 0001 \[backlog\]: Draw the lanes$/);
    run(r, "add", { title: "Second card", status: "review", details: "- starts with a dash", priority: "high", labels: ["ui", "pane"], skills: ["agent-works:board"], files: ["a.mjs", "b.mjs"] });
    run(r, "add", { title: "Spotted in passing", suggest: true, source: "claude" });
    const b = boardOf(r.dir);
    assert.deepEqual(b.cards.map((c) => [c.id, c.status, c.source]), [["0003", "suggested", "claude"], ["0001", "backlog", "user"], ["0002", "review", "user"]]);
    const second = b.card("0002");
    assert.deepEqual([second.priority, second.labels, second.skills, second.files, second.body], ["high", ["ui", "pane"], ["agent-works:board"], ["a.mjs", "b.mjs"], "- starts with a dash"]);
    assert.match(run(r, "add", { title: "draw the LANES" }, 1), /^Already on the kanban board as card 0001/, "a title already on the board is not filed twice");
  });

  await t.test("epic files an epic, and add, edit and plan put cards in it", () => {
    assert.match(run(r, "epic", { title: "A faster board" }), /^Added card 0004 \[backlog\]: A faster board$/);
    run(r, "add", { title: "Slice one", epic: "0004" });
    run(r, "plan", { id: "0001", epic: "0004" });
    const b = boardOf(r.dir);
    assert.equal(b.card("0004").kind, "epic");
    assert.deepEqual(["0001", "0005"].map((id) => b.card(id).epic), ["0004", "0004"]);
    run(r, "plan", { id: "0001", epic: "none" });
    assert.equal(boardOf(r.dir).card("0001").epic, "");
  });

  await t.test("edit changes each field it is given and leaves the rest", () => {
    run(r, "edit", { id: "0001", title: "Draw every lane", owner: "sam", priority: "low", labels: ["ui"], skills: ["a:b", "c:d"], epic: "0004" });
    let card = boardOf(r.dir).card("0001");
    assert.deepEqual([card.title, card.owner, card.priority, card.labels, card.skills, card.epic], ["Draw every lane", "sam", "low", ["ui"], ["a:b", "c:d"], "0004"]);
    run(r, "edit", { id: "0001", labels: [], skills: ["a:b"], owner: "", epic: "none", kind: "gate", ref: "#12", needs: "a person" });
    card = boardOf(r.dir).card("0001");
    assert.deepEqual([card.labels, card.skills, card.owner, card.epic, card.kind, card.ref, card.needs, card.title], [[], ["a:b"], "", "", "gate", "#12", "a person", "Draw every lane"]);
    run(r, "edit", { id: "0001", kind: "task", ref: "", needs: "", details: "The whole body, replaced." });
    card = boardOf(r.dir).card("0001");
    assert.deepEqual([card.kind, card.ref, card.needs, card.body], ["task", "", "", "The whole body, replaced."]);
    assert.match(cardText(r.kanban, "0001"), /^title: Draw every lane$/m);
  });

  await t.test("note appends a dated line to the card", () => {
    run(r, "note", { id: "0001", text: "Half done: the lanes draw, the cards do not." });
    assert.match(boardOf(r.dir).card("0001").body, /^- \S+: Half done: the lanes draw, the cards do not\.$/m);
  });

  await t.test("move puts a card in a column, at a place, and archives it; reorder moves it within its lane", () => {
    run(r, "move", { id: "0001", to: "review" });
    assert.deepEqual(boardOf(r.dir).cards.filter((c) => c.status === "review").map((c) => c.id), ["0002", "0001"]);
    run(r, "move", { id: "0005", to: "review", index: 0, mr: 41 });
    let b = boardOf(r.dir);
    assert.deepEqual(b.cards.filter((c) => c.status === "review").map((c) => c.id), ["0005", "0002", "0001"]);
    assert.equal(b.card("0005").mr, 41);
    run(r, "reorder", { id: "0001", index: 0 });
    assert.deepEqual(boardOf(r.dir).cards.filter((c) => c.status === "review").map((c) => c.id), ["0001", "0005", "0002"]);
    run(r, "move", { id: "0003", to: "backlog" });
    run(r, "move", { id: "0002", to: "archived" });
    b = boardOf(r.dir);
    assert.deepEqual([b.card("0003").status, b.card("0002").status], ["backlog", "archived"]);
    assert.match(run(r, "move", { id: "0001", to: "nowhere" }, 2), /^$/, "an unknown column is refused, and says so on stderr");
  });

  await t.test("owe records a gate and settle closes it with its evidence; a move to done is refused", () => {
    assert.match(run(r, "owe", { title: "Full suite on main", ref: "PR 7", needs: "the main checkout", owner: "sam", details: "npm test" }), /^Owed as gate card 0006/);
    let gate = boardOf(r.dir).card("0006");
    assert.deepEqual([gate.kind, gate.status, gate.ref, gate.needs, gate.owner, gate.source], ["gate", "backlog", "PR 7", "the main checkout", "sam", "user"]);
    run(r, "move", { id: "0006", to: "done" }, 1);
    assert.equal(boardOf(r.dir).card("0006").status, "backlog");
    run(r, "settle", { id: "0006", evidence: "-n 4 passed, 212 of 212" });
    gate = boardOf(r.dir).card("0006");
    assert.equal(gate.status, "done");
    assert.match(gate.body, /^Settled \S+( by \S+)?: -n 4 passed, 212 of 212$/m);
  });

  await t.test("sprints: plan one, edit it, start it, put cards in it, close it", () => {
    assert.match(run(r, "sprintNew", { title: "Polish" }), /^Planned sprint s1: Polish/);
    run(r, "sprintNew", { title: "Next", goal: "Whatever rolls on", end: "2031-02-01" });
    run(r, "sprintEdit", { id: "s1", goal: "Ship the pane", end: "2031-01-15" });
    run(r, "sprintStart", { id: "s1" });
    let b = boardOf(r.dir);
    assert.deepEqual(b.sprints.map((s) => [s.id, s.state, s.goal, s.end]), [["s1", "active", "Ship the pane", "2031-01-15"], ["s2", "planned", "Whatever rolls on", "2031-02-01"]]);
    run(r, "add", { title: "Inside the sprint", sprint: "active" });
    run(r, "plan", { id: "0003", sprint: "s1" });
    run(r, "edit", { id: "0001", sprint: "active" });
    run(r, "move", { id: "0001", to: "done" });
    b = boardOf(r.dir);
    assert.deepEqual(["0001", "0003", "0007"].map((id) => b.card(id).sprint), ["s1", "s1", "s1"]);
    assert.match(run(r, "sprintClose", { id: "s1" }), /^Sprint s1 closed: 1 done card\(s\) archived, 2 unfinished card\(s\) to sprint s2\.$/);
    b = boardOf(r.dir);
    assert.deepEqual([b.card("0001").status, b.card("0003").sprint, b.card("0007").sprint, b.sprints[0].state], ["archived", "s2", "s2", "closed"]);
    run(r, "sprintStart");
    run(r, "edit", { id: "0003", sprint: "none" });
    assert.match(run(r, "sprintClose"), /^Sprint s2 closed/);
    b = boardOf(r.dir);
    assert.deepEqual([b.sprints[1].state, b.card("0003").sprint], ["closed", ""]);
  });

  await t.test("startMode sets how a card starts, and the settings read it back", () => {
    assert.equal(JSON.parse(run(r, "config")).startMode, "new-session");
    run(r, "startMode", { mode: "queue" });
    assert.equal(JSON.parse(run(r, "config")).startMode, "queue");
    assert.equal(JSON.parse(fs.readFileSync(path.join(r.kanban, "board.json"), "utf8")).startMode, "queue");
    run(r, "startMode", { mode: "sideways" }, 2);
    run(r, "startMode", { mode: "new-session" });
    assert.equal(boardOf(r.dir).startMode, "new-session");
  });

  await t.test("remote: status counts what a first pass would open, on and off set it, sync refuses while off", () => {
    let status = JSON.parse(run(r, "remoteStatus"));
    assert.deepEqual([status.enabled, status.provider, status.repo], [false, "github", "example/board"]);
    const open = boardOf(r.dir).cards.filter((c) => !["suggested", "archived"].includes(c.status)).length;
    assert.equal(status.unlinked, open, "every open card, none linked yet");
    // A pass talks to the tracker; with sync off the CLI says so before it starts anything.
    assert.match(run(r, "remoteSync", undefined, 1), /^$/);
    run(r, "remoteOn");
    status = JSON.parse(run(r, "remoteStatus"));
    assert.equal(status.enabled, true);
    assert.equal(boardOf(r.dir).remote.enabled, true);
    run(r, "remoteOff");
    assert.equal(boardOf(r.dir).remote.enabled, false);
  });

  await t.test("the reads: every card with the settings, and a listing by scope and kind", () => {
    const listed = JSON.parse(run(r, "read"));
    assert.deepEqual(Object.keys(listed).sort(), ["cards", "columns", "dir", "oldFolder", "scope", "sprints"]);
    assert.ok(listed.cards.some((c) => c.status === "archived"), "archived cards too: the pane draws one that is open");
    assert.equal(fs.realpathSync.native(listed.dir), fs.realpathSync.native(r.kanban));
    assert.match(run(r, "list", { scope: "all", kind: "epic" }), /^Epic 0004 /m);
    assert.match(run(r, "list", { scope: "backlog" }), /^Scope: backlog$/m);
    assert.match(run(r, "list"), /^Columns: backlog, in-progress, review, done \(plus suggested\)$/m);
  });

  await t.test("every entry of the map was run", () => {
    assert.deepEqual(Object.keys(BOARD).filter((name) => !ran.has(name)), []);
  });
});

test("the pane's files run the CLI through the map and nowhere else", () => {
  const actions = fs.readFileSync(path.join(KANBAN, "actions.mjs"), "utf8");
  const used = new Set([...["actions.mjs", "host.mjs", "tools.mjs", "register.mjs"].map((f) => fs.readFileSync(path.join(KANBAN, f), "utf8")).join("\n").matchAll(/\bBOARD\.(\w+)\(/g)].map((m) => m[1]));
  assert.deepEqual(Object.keys(BOARD).filter((name) => !used.has(name)), [], "an entry nothing calls is dead");
  assert.deepEqual([...used].filter((name) => !(name in BOARD)), [], "a call the map does not have");
  for (const file of ["actions.mjs", "tools.mjs", "register.mjs", "views.mjs", "model.mjs"]) {
    const text = fs.readFileSync(path.join(KANBAN, file), "utf8");
    assert.doesNotMatch(text, /runBoard\(\s*host\s*,\s*\[/, `${file} hands the CLI arguments it wrote itself`);
    assert.doesNotMatch(text, /change\(\s*\[/, `${file} hands the CLI arguments it wrote itself`);
  }
  assert.match(actions, /runBoard\(host, args/);
});

test("a title that begins with a dash is turned down by the CLI, with nothing written", (t) => {
  const r = repo(t);
  const out = board(r.dir, ...BOARD.add({ title: "-n is not a flag here" }));
  assert.equal(out.status, 2);
  assert.equal(fs.existsSync(r.kanban) && fs.readdirSync(r.kanban).some((f) => f.endsWith(".md")), false);
});
