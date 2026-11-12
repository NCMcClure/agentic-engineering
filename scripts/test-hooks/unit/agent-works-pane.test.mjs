// The kanban pane's hooks module, driven through the stand-in host in
// agent-works-pane-host.mjs against a real repository and the real board CLI:
// what it registers, the six tools, /kanban and its subcommands, every press
// of the pane and what it leaves on the board, Start and the dispatch skill,
// queue mode, sync with a tracker, and what an idle or closed pane costs.
// The board side by side is in agent-works-pane-client.test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir, write } from "./helpers.mjs";
import { DISPATCH, KANBAN, PLUGIN, board, boardOf, cardFiles, cardText, find, keys, lines, mount, need, repo, words } from "./agent-works-pane-host.mjs";

const TOOLS = ["list_tasks", "move_task", "owe_gate", "plan_task", "settle_gate", "surface_task"];
const isCli = (argv) => argv[0] === "node" && /scripts[\\/]aw\.mjs$/.test(argv[1]) && argv[2] === "board";
const writes = (m) => m.seen.runs.filter(isCli).map((argv) => argv.slice(3)).filter((a) => !(a[0] === "list" || (a[0] === "config" && a[1] === "--json") || (a[0] === "remote" && a[1] === "status")));
/** A pane open on a repository, drawn for a surface with text fields and no Client. */
async function opened(t, options = {}, setup = () => {}) {
  const r = repo(t, options);
  setup(r);
  const m = await mount(r.dir, options);
  await m.command("");
  return { r, m, draw: () => m.draw("vscode") };
}

test("session start registers /kanban and six tools, every one deferred, and starts nothing", async (t) => {
  const r = repo(t);
  const m = await mount(r.dir);
  assert.deepEqual(m.seen.commands.map((c) => c.name), ["kanban"]);
  assert.deepEqual(m.seen.tools.map((x) => x.name).sort(), TOOLS);
  for (const tool of m.seen.tools) {
    assert.equal(tool.isDeferred, true, `${tool.name} is deferred: an idle session carries its name and no more`);
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.description.length > 80, `${tool.name} says when to reach for it`);
  }
  assert.equal(m.seen.timers.length, 0, "no timer until the pane opens");
  assert.deepEqual(m.seen.runs, [], "no process");
  assert.equal(m.seen.lists, 0, "nothing read");
  assert.equal(fs.existsSync(r.kanban), false, "and no board folder made");
  assert.deepEqual([...new Set(m.events())].sort(), ["command.run", "session.start", "tool.call", "ui.close", "ui.fault", "ui.message", "ui.render"], "no hook on a turn, a prompt, or another tool");
  assert.deepEqual(m.hooks.filter((h) => h.event === "tool.call").map((h) => h.matcher.tool).sort(), TOOLS.map((name) => `mcp__agent-works__${name}`));  // A hook whose answer the host waits on still answers when it fails.
  for (const h of m.hooks.filter((x) => ["tool.call", "command.run", "ui.close"].includes(x.event))) assert.equal(typeof h.rescue, "function", `${h.event} has a .catch`);
  assert.match(m.hooks.find((h) => h.event === "tool.call").rescue().deny, /^the board tool failed/);
});

test("hooks.json loads the pane as a module, and the tools' names are written out for the host to read", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  assert.deepEqual(hooks.modules, ["./kanban/register.mjs"]);
  const source = fs.readFileSync(path.join(KANBAN, "register.mjs"), "utf8");
  for (const name of TOOLS) assert.ok(source.includes(`{ tool: "mcp__agent-works__${name}" }`), `${name}'s matcher is a literal`);
});

test("surface_task files a suggestion once: the same title again names the first card", async (t) => {
  const r = repo(t);
  const m = await mount(r.dir);
  const first = await m.tool("surface_task", { title: "Fix the flaky lock test", details: "It races on a slow runner.", kind: "bug", files: ["scripts/locks.mjs"], priority: "high", skills: ["agent-works:board"] });
  assert.equal(first.result, "Added card 0001 [suggested]: Fix the flaky lock test");
  const card = boardOf(r.dir).card("0001");
  assert.deepEqual([card.status, card.source, card.priority, card.labels, card.files, card.skills, card.body], ["suggested", "claude", "high", ["bug"], ["scripts/locks.mjs"], ["agent-works:board"], "It races on a slow runner."]);
  assert.match(m.seen.toasts.at(-1), /^Claude suggested a task on the kanban board: Fix the flaky lock test\./);

  const again = await m.tool("surface_task", { title: "fix the FLAKY lock test!", details: "again" });
  assert.equal(again.result, "Already on the kanban board as card 0001 (suggested); nothing added.");
  assert.equal(again.deny, undefined, "a duplicate is an answer, not an error");
  assert.deepEqual(cardFiles(r.kanban), ["0001-fix-the-flaky-lock-test.md"]);
  assert.equal((await m.tool("surface_task", { title: "  " })).result, "Not added: a task needs a title.");
  assert.match((await m.tool("surface_task", { title: "In an epic", details: "x", epic: "0001" })).deny, /"0001" is no epic/);
});

test("move_task records a move and never starts anything; list_tasks and plan_task read and plan", async (t) => {
  const r = repo(t);
  const m = await mount(r.dir);
  board(r.dir, "add", "Wire the pane");
  board(r.dir, "epic", "The pane");
  board(r.dir, "sprint", "new", "Polish");
  board(r.dir, "sprint", "start");

  assert.match((await m.tool("move_task", { id: "0001", status: "doing" })).deny, /^no column "doing": the columns are backlog, in-progress, review, done/);
  assert.match((await m.tool("move_task", { id: "0099", status: "review" })).deny, /^no card with id "0099"/);
  assert.equal(boardOf(r.dir).card("0001").status, "backlog", "a refused move writes nothing");
  assert.equal((await m.tool("move_task", { id: "1", status: "in-progress" })).result, "Card 0001 is now in in-progress.");
  assert.equal((await m.tool("move_task", { id: "0001", column: "review", mr: 41 })).result, "Card 0001 is now in review (!41).");
  assert.deepEqual([boardOf(r.dir).card("0001").status, boardOf(r.dir).card("0001").mr], ["review", 41]);
  assert.deepEqual([m.seen.submits, m.seen.commandRuns], [[], []], "a move hands nothing to this session");
  assert.ok(m.seen.runs.every(isCli), "and runs nothing but the board CLI");

  assert.equal((await m.tool("plan_task", { id: "0001", epic: "0002", sprint: "active" })).result, "Card 0001: epic 0002, sprint s1.");
  assert.equal((await m.tool("plan_task", { id: "0001" })).result, "Nothing to change: give an epic or a sprint.");
  assert.equal((await m.tool("plan_task", { id: "0001", sprint: "none" })).result, "Card 0001: epic 0002, sprint none.");
  const listed = (await m.tool("list_tasks", {})).result;
  assert.match(listed, /^Sprint s1 "Polish" \(active\)$/m);
  assert.match(listed, /^Epic 0002 ▱▱▱▱▱▱▱▱ 0\/1: The pane$/m);
  assert.match(listed, /^1 more open card\(s\) outside this scope \(scope "all" lists them\)\.$/m);
  assert.match((await m.tool("list_tasks", { scope: "0002" })).result, /^0001 \[review\] task: Wire the pane \(epic 0002; !41\)$/m);
  assert.match((await m.tool("list_tasks", { scope: "nonsense" })).deny, /^no scope "nonsense"/);
});

test("owe_gate owes a check and settle_gate settles it with the evidence, once", async (t) => {
  const r = repo(t);
  const m = await mount(r.dir);
  assert.match((await m.tool("owe_gate", { title: "Pane drawn on the desktop", ref: "PR 35", needs: "a person's eye", details: "open /kanban" })).result, /^Owed as gate card 0001: Pane drawn on the desktop \(for PR 35; needs a person's eye\)/);
  assert.deepEqual([boardOf(r.dir).card("0001").kind, boardOf(r.dir).card("0001").source], ["gate", "claude"]);
  assert.equal((await m.tool("owe_gate", { title: "Pane drawn on the desktop", ref: "PR 35", needs: "x" })).result, "Already owed as card 0001 (backlog); nothing added.");
  assert.equal((await m.tool("owe_gate", { title: "No ref", needs: "x" })).result, "Not added: a gate needs a title, what it is owed for (ref) and what running it needs (needs).");
  assert.match((await m.tool("list_tasks", { scope: "gates" })).result, /^0001 \[backlog\] gate: Pane drawn on the desktop \(for PR 35; needs a person's eye\)$/m);
  assert.match((await m.tool("move_task", { id: "0001", status: "done" })).result, /is a gate: settle it with the evidence instead/);
  assert.equal((await m.tool("settle_gate", { id: "0001", evidence: " " })).result, "Not settled: a gate is settled with its evidence, the command that ran and what it showed.");

  assert.equal((await m.tool("settle_gate", { id: "0001", evidence: "opened /kanban in the app, the lanes drew" })).result, "Gate 0001 is settled and in done.");
  assert.match(cardText(r.kanban, "0001"), /^Settled \S+( by \S+)?: opened \/kanban in the app, the lanes drew$/m);
  assert.match((await m.tool("settle_gate", { id: "0001", evidence: "again" })).deny, /already settled/);
});

test("/kanban opens the pane and looks every 3 s; an unchanged board starts no process, and closing stops the poll", async (t) => {
  const { r, m, draw } = await opened(t);
  assert.deepEqual(m.seen.opens.map((p) => [p.id, p.title, p.focus]), [["kanban", "Kanban", true]]);
  assert.deepEqual(m.seen.timers.map((x) => x.ms), [3000]);
  assert.match(words(await draw()), /^No cards yet\. Add one with \+ New, or press n here\.$/m);

  let before = m.seen.runs.length;
  await m.tick();
  await m.tick();
  assert.equal(m.seen.runs.length, before, "no board folder: nothing to read");

  board(r.dir, "add", "Filed from a shell");
  await m.tick();
  assert.ok(m.seen.runs.length > before, "the folder changed: the board is read");
  assert.match(words(await draw()), /^0001 Filed from a shell ready$/m);
  before = m.seen.runs.length;
  for (let i = 0; i < 5; i++) await m.tick();
  assert.equal(m.seen.runs.length, before, "nothing changed: five polls, no process");
  for (let i = 0; i < 5; i++) await m.tick();
  assert.equal(m.seen.runs.length, before + 2, "every tenth poll reads in full, for plan issues the folder does not show");
  assert.deepEqual(writes(m), [], "and a poll never writes");

  await m.close();
  assert.equal(m.seen.timers[0].cancelled, true, "closing the pane stops the poll");
  before = m.seen.runs.length;
  board(r.dir, "add", "Filed while closed");
  await m.tick();
  assert.equal(m.seen.runs.length, before, "closed, it reads nothing");

  assert.match((await m.command("")).text, /^Kanban opened: 2 cards in .*kanban$/);
  assert.deepEqual(m.seen.timers.map((x) => x.cancelled), [true, false], "opening again starts one poll");
});

test("/kanban says so, in a toast too, when the pane cannot be opened or placed", async (t) => {
  const r = repo(t);
  for (const [options, why] of [[{ noPane: true }, "no pane host"], [{ unplaced: true }, "this surface has no place for a pane"]]) {
    const m = await mount(r.dir, options);
    const said = (await m.command("")).text;
    assert.equal(said, `The kanban pane could not be opened: ${why}. The cards are still there: aw board list.`);
    assert.deepEqual(m.seen.toasts, [said]);
    assert.equal(m.seen.timers.length, 0, "and nothing polls");
  }
});

test("a reload finds the pane still up and picks the poll back up", async (t) => {
  const r = repo(t);
  board(r.dir, "add", "Still here");
  const m = await mount(r.dir, { panes: [{ id: "kanban", isPlaced: true }] });
  await m.settle();
  assert.deepEqual(m.seen.timers.map((x) => x.ms), [3000]);
  assert.match(words(await m.draw("vscode")), /^0001 Still here ready$/m);
});

test("Start hands a ready card to the dispatch skill and moves nothing itself", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => { board(x.dir, "add", "Draw the lanes"); board(x.dir, "add", "Needs a design", "--needs", "a design"); });
  await m.press(await draw(), "start-0001");
  assert.deepEqual(m.seen.commandRuns, [{ command: DISPATCH, args: "0001" }]);
  assert.deepEqual(m.seen.submits, [], "no prompt: the skill runs as a command");
  assert.match(m.seen.toasts.at(-1), /^Queued \/agent-works:dispatch 0001: it runs in this session once it is idle\.$/);
  assert.equal(boardOf(r.dir).card("0001").status, "backlog", "the dispatch moves the card, not the button");
  assert.deepEqual(writes(m), [], "the pane wrote nothing");

  await m.press(await draw(), "card-0002");
  assert.equal(find(await draw(), "start"), null, "a card that needs a person has no Start");
  await m.post({ type: "start", id: "0002" });
  assert.equal(m.seen.toasts.at(-1), "0002 does not start: it needs a design.");
  assert.equal(m.seen.commandRuns.length, 1);
});

test("a card asked to start is marked queued until its command has begun, and is not asked for twice", async (t) => {
  const { m, draw } = await opened(t, { busy: true }, (x) => { board(x.dir, "add", "One"); board(x.dir, "add", "Two"); });
  const mark = async (id) => lines([need(await draw(), `card-${id}`)])[0];
  await m.press(await draw(), "start-0001");
  await m.press(await draw(), "start-0002");
  assert.deepEqual([await mark("0001"), await mark("0002")], ["0001 One queued", "0002 Two queued"]);
  assert.deepEqual(m.seen.commandRuns, [], "the host is in a turn: nothing has run yet");
  await m.post({ type: "start", id: "0001" });
  await m.post({ type: "move", id: "0001", to: "in-progress" });
  await m.idle();
  assert.deepEqual(m.seen.commandRuns, [{ command: DISPATCH, args: "0001" }, { command: DISPATCH, args: "0002" }], "each once, in the order asked");
  assert.deepEqual([await mark("0001"), await mark("0002")], ["0001 One ready", "0002 Two ready"], "begun: the mark is the board's again");
});

test("with the board's start mode on queue, Start asks the skill to work the card in this session", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => { board(x.dir, "add", "One"); board(x.dir, "add", "Two"); });
  await m.press(await draw(), "mode");
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.kanban, "board.json"), "utf8")).startMode, "queue", "the mode is the board's, written by the CLI");
  assert.deepEqual(writes(m), [["config", "--start-mode=queue"]]);
  assert.equal(lines(await draw()).find((l) => l.startsWith("Starts:")), "Starts: queue here");

  await m.press(await draw(), "start-0001");
  await m.press(await draw(), "start-0002");
  assert.deepEqual(m.seen.commandRuns, [{ command: DISPATCH, args: "0001 --serial" }, { command: DISPATCH, args: "0002 --serial" }]);
  assert.deepEqual(m.seen.submits, []);
  assert.deepEqual(boardOf(r.dir).cards.map((c) => c.status), ["backlog", "backlog"]);

  await m.press(await draw(), "mode");
  assert.equal(boardOf(r.dir).startMode, "new-session");
  await m.press(await draw(), "start-0001");
  assert.deepEqual(m.seen.commandRuns.at(-1), { command: DISPATCH, args: "0001" });
});

for (const [name, options] of [["refuses to run a command for a mod", { refuseCommands: true }], ["has no way to run a command", { noCommands: true }]]) {
  test(`a host that ${name}: Start shows the one command to type, and asks nothing in its place`, async (t) => {
    const { r, m, draw } = await opened(t, options, (x) => board(x.dir, "add", "Draw the lanes"));
    await m.press(await draw(), "start-0001");
    assert.deepEqual([m.seen.commandRuns, m.seen.submits], [[], []]);
    assert.match(m.seen.toasts.at(-1), /^This host did not run \/agent-works:dispatch 0001 for the pane \(.+\)\. Type it at the prompt to start the card\.$/);
    assert.ok(lines(await draw()).includes(m.seen.toasts.at(-1)), "and the pane keeps saying it under the board");
    assert.equal(lines([need(await draw(), "card-0001")])[0], "0001 Draw the lanes ready", "the card is not left marked queued");
    assert.equal(boardOf(r.dir).card("0001").status, "backlog");
  });
}

test("an epic is handed to this session to break down, and a gate to run and settle, in plain words", async (t) => {
  const { m, draw } = await opened(t, {}, (x) => { board(x.dir, "epic", "A faster board"); board(x.dir, "owe", "Full suite on main", "--ref", "PR 7", "--needs", "the main checkout"); });
  await m.press(await draw(), "epics");
  await m.press(await draw(), "open-0001");
  await m.press(await draw(), "start");
  await m.press(await draw(), "back");
  await m.press(await draw(), "card-0002");
  await m.press(await draw(), "start");
  assert.deepEqual(m.seen.commandRuns, [], "neither is the dispatch skill's to start");
  assert.equal(m.seen.submits.length, 2);
  const [epic, gate] = m.seen.submits;
  assert.deepEqual([epic.asUser, gate.asUser], [true, true]);
  assert.match(epic.text, /^Break down epic 0001 "A faster board" on the kanban board into cards, and do none of the work itself\./);
  assert.match(epic.text, /scripts\/aw\.mjs" board add "<title>" --epic 0001 --details "<details>"/);
  assert.match(gate.text, /^Run the owed gate 0002 "Full suite on main" from the kanban board\./);
  assert.match(gate.text, /scripts\/aw\.mjs" board settle 0002 --evidence "<the command and its result>"/);
  assert.deepEqual(writes(m), []);
});

test("a new card goes into the column picked and the scope shown; the board is drawn from the disk", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => { board(x.dir, "sprint", "new", "Polish"); board(x.dir, "sprint", "start"); board(x.dir, "add", "Outside the sprint"); });
  assert.equal(lines(await draw())[0], "Sprint s1 · Polish · 0/0 done");
  await m.press(await draw(), "new");
  assert.match(words(await draw()), /^Goes into sprint s1: the scope the board shows\.$/m);
  await m.pick(await draw(), "new-status", "review");
  await m.type(await draw(), "new-title", "  Inside the sprint ");
  const card = boardOf(r.dir).card("0002");
  assert.deepEqual([card.title, card.status, card.sprint, card.source], ["Inside the sprint", "review", "s1", "user"]);
  assert.deepEqual(writes(m), [["add", "Inside the sprint", "--status=review", "--sprint=active", "--source=user"]]);
  assert.equal(lines(await draw())[0], "Sprint s1 · Polish · 0/1 done", "back on the board, read again");
  assert.equal(m.seen.afters.at(-1).ms, 150, "a change of view asks for the pane's focus back");
  await m.seen.afters.at(-1).fn();
  assert.deepEqual(m.seen.opens.at(-1), { id: "kanban", title: "Kanban", focus: true });

  await m.type(await draw(), "new-title", "nothing", "vscode").catch(() => {});
  await m.press(await draw(), "new");
  await m.type(await draw(), "new-title", "   ");
  assert.equal(boardOf(r.dir).cards.length, 2, "a blank title adds nothing");
});

test("scope and the gates filter are the pane's own: they narrow the lanes and write nothing", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => {
    board(x.dir, "epic", "Faster sync");
    board(x.dir, "add", "Outside");
    board(x.dir, "sprint", "new", "Polish");
    board(x.dir, "sprint", "start", "s1");
    board(x.dir, "add", "Inside", "--sprint", "active", "--epic", "0001");
    board(x.dir, "owe", "Full suite", "--ref", "PR 7", "--needs", "main");
  });
  const head = async () => lines(await draw())[0];
  assert.equal(await head(), "Sprint s1 · Polish · 0/2 done");
  await m.press(await draw(), "scope");
  assert.equal(await head(), "Backlog: 1 card(s) in no sprint");
  await m.press(await draw(), "scope");
  assert.equal(await head(), "All cards: 3");
  await m.press(await draw(), "epics");
  await m.press(await draw(), "show-0001");
  assert.equal(await head(), "Epic 0001 · Faster sync · ▱▱▱▱▱▱▱▱ 0/1");
  assert.deepEqual(keys(await draw()).filter((k) => k.startsWith("card-")), ["card-0003"]);

  // The scope is the session's: another surface draws the one chosen.
  assert.equal(lines(await m.draw("mobile"))[0], "Epic 0001 · Faster sync · ▱▱▱▱▱▱▱▱ 0/1");
  await m.press(await draw(), "new");
  await m.type(await draw(), "new-title", "Another slice");
  assert.deepEqual([boardOf(r.dir).card("0005").epic, boardOf(r.dir).card("0005").sprint], ["0001", ""], "a card made in an epic's scope joins the epic");

  await m.press(await draw(), "scope");
  assert.equal(await head(), "Sprint s1 · Polish · 0/2 done");
  await m.press(await draw(), "gates");
  assert.deepEqual(keys(await draw()).filter((k) => k.startsWith("card-")), ["card-0004"]);
  assert.ok(lines(await draw()).includes("Showing: gates (1)"));
  await m.press(await draw(), "gates");
  assert.deepEqual(keys(await draw()).filter((k) => k.startsWith("card-")), ["card-0003", "card-0004"]);
  assert.deepEqual(writes(m).map((a) => a[0]), ["add"], "only the new card was written");
});

test("a card's fields are edited through the CLI, one change at a time, and a key the pane does not know survives", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => {
    board(x.dir, "add", "Draw the lanes");
    board(x.dir, "epic", "The pane");
    board(x.dir, "sprint", "new", "Polish");
    const file = path.join(x.kanban, "0001-draw-the-lanes.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("\n---\n", "\nestimate: 3\n---\n"));
  });
  await m.press(await draw(), "card-0001");
  await m.type(await draw(), "title", "Draw every lane");
  await m.pick(await draw(), "kind", "gate");
  await m.type(await draw(), "ref", "PR 9");
  await m.type(await draw(), "needs", "a wide terminal");
  await m.pick(await draw(), "kind", "task");
  await m.pick(await draw(), "epic", "0002");
  await m.pick(await draw(), "sprint", "s1");
  await m.pick(await draw(), "priority", "high");
  await m.type(await draw(), "owner", "sam");
  await m.type(await draw(), "labels", "ui, pane");
  await m.type(await draw(), "skill-type", "/code-diet:ladder");
  await m.pick(await draw(), "skill-pick", DISPATCH);
  await m.type(await draw(), "note", "The lanes draw; the cards do not yet.");
  let card = boardOf(r.dir).card("0001");
  assert.deepEqual(
    [card.title, card.kind, card.ref, card.needs, card.epic, card.sprint, card.priority, card.owner, card.labels, card.skills],
    ["Draw every lane", "task", "PR 9", "a wide terminal", "0002", "s1", "high", "sam", ["ui", "pane"], ["code-diet:ladder", DISPATCH]],
  );
  assert.match(card.body, /^- \S+: The lanes draw; the cards do not yet\.$/m);
  assert.match(cardText(r.kanban, "0001"), /^estimate: 3$/m, "the line the pane does not know is still there");
  assert.equal(cardFiles(r.kanban)[0], "0001-draw-the-lanes.md", "the file keeps its name");
  assert.equal(need(await draw(), "title", "Input").props.value, "Draw every lane", "the open card is drawn from what was read back");

  await m.press(await draw(), `skill-${DISPATCH}`);
  await m.pick(await draw(), "epic", "none");
  await m.pick(await draw(), "sprint", "none");
  await m.type(await draw(), "labels", "");
  card = boardOf(r.dir).card("0001");
  assert.deepEqual([card.skills, card.epic, card.sprint, card.labels], [["code-diet:ladder"], "", "", []]);
  assert.ok(writes(m).every((a) => a[0] === "edit" || a[0] === "note"), "every change was an edit or a note");
  assert.equal(writes(m).length, 17);
});

test("moves from the pane: the column picker, the arrows, a place in the lane, accept, archive", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => {
    for (const title of ["One", "Two", "Three"]) board(x.dir, "add", title);
    board(x.dir, "add", "Spotted", "--suggest");
    board(x.dir, "sprint", "new", "Polish");
  });
  const lane = (status) => boardOf(r.dir).cards.filter((c) => c.status === status).map((c) => c.id);
  await m.press(await draw(), "card-0001");
  await m.pick(await draw(), "status", "review");
  assert.deepEqual(lane("review"), ["0001"]);
  assert.equal(m.seen.commandRuns.length, 0, "the picker is a plain move: nothing starts");
  await m.press(await draw(), "back");

  await m.press(await draw(), "right-0001");
  assert.deepEqual(lane("done"), ["0001"]);
  await m.press(await draw(), "left-0001");
  await m.press(await draw(), "left-0001");
  assert.deepEqual(lane("in-progress"), ["0001"], "one lane at a time");
  await m.press(await draw(), "left-0001");
  await m.press(await draw(), "left-0001");
  assert.deepEqual(lane("backlog"), ["0002", "0003", "0001"], "and no further than the first");

  await m.press(await draw(), "right-0002");
  assert.deepEqual(m.seen.commandRuns, [{ command: DISPATCH, args: "0002" }], "the arrow into the start column asks for the card to start");
  assert.deepEqual(lane("backlog"), ["0002", "0003", "0001"], "and moves nothing");

  await m.post({ type: "nudge", id: "0001", by: -1 });
  assert.deepEqual(lane("backlog"), ["0002", "0001", "0003"]);
  await m.post({ type: "nudge", id: "0002", index: 2 });
  assert.deepEqual(lane("backlog"), ["0001", "0003", "0002"]);
  await m.post({ type: "nudge", id: "0001", by: -1 });
  assert.deepEqual(lane("backlog"), ["0001", "0003", "0002"], "the top stays the top");
  await m.post({ type: "move", id: "0003", to: "review", index: 0 });
  await m.post({ type: "move", id: "0002", to: "review", index: 0 });
  assert.deepEqual(lane("review"), ["0002", "0003"], "a drop lands at the place it was dropped");

  // Accepting while the board shows the sprint puts the card in it.
  board(r.dir, "sprint", "start");
  await m.tick();
  await m.press(await draw(), "right-0004");
  assert.deepEqual([boardOf(r.dir).card("0004").status, boardOf(r.dir).card("0004").sprint], ["backlog", "s1"]);

  await m.press(await draw(), "scope");
  await m.press(await draw(), "scope");
  await m.press(await draw(), "card-0003");
  await m.press(await draw(), "archive");
  assert.equal(boardOf(r.dir).card("0003").status, "archived");
  assert.ok(lines(await draw()).includes("All cards: 3"), "archiving goes back to the board");
});

test("a refused move leaves the card where it was and says why under the board", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => board(x.dir, "owe", "Full suite", "--ref", "PR 7", "--needs", "main"));
  await m.post({ type: "move", id: "0001", to: "done" });
  assert.equal(boardOf(r.dir).card("0001").status, "backlog");
  const drawn = lines(await draw());
  assert.ok(drawn.some((l) => /^0001 is a gate: settle it with the evidence instead/.test(l)), drawn.join("\n"));
  await m.post({ type: "move", id: "0001", to: "nowhere" });
  assert.ok(lines(await draw()).some((l) => /^no column "nowhere"/.test(l)));
  await m.post({ type: "move", id: "9999", to: "done" });
  await m.post({ type: "explode", id: "0001" });
  await m.post("move");
  assert.equal(boardOf(r.dir).card("0001").status, "backlog", "a post that names nothing known does nothing");

  board(r.dir, "add", "From a shell");
  await m.tick();
  assert.ok(!lines(await draw()).some((l) => /^no column/.test(l)), "the answer goes once the board has changed");
});

test("a gate is settled from its card with the evidence typed there", async (t) => {
  const { r, m, draw } = await opened(t, {}, (x) => board(x.dir, "owe", "Full suite", "--ref", "PR 7", "--needs", "main"));
  await m.press(await draw(), "card-0001");
  await m.press(await draw(), "settle");
  assert.equal(m.seen.toasts.at(-1), "Write what showed the check holds, then Settle.");
  assert.equal(boardOf(r.dir).card("0001").status, "backlog", "no evidence, nothing settled");
  need(await draw(), "evidence", "Input").props.onInput("npm test: 212 passed");
  assert.equal(need(await draw(), "evidence", "Input").props.value, "npm test: 212 passed");
  await m.press(await draw(), "settle");
  assert.equal(m.seen.toasts.at(-1), "Gate 0001 is settled and in done.");
  const card = boardOf(r.dir).card("0001");
  assert.equal(card.status, "done");
  assert.match(card.body, /^Settled \S+( by \S+)?: npm test: 212 passed$/m);
  assert.equal(find(await draw(), "evidence", "Input"), null);
  assert.deepEqual(writes(m), [["settle", "0001", "--evidence=npm test: 212 passed"]]);
});

test("sprints from the pane: plan, edit, start, and close once the person has seen what closing does", async (t) => {
  const { r, m, draw } = await opened(t, { answers: ["Keep it open", "Close it"] }, (x) => { board(x.dir, "add", "One"); board(x.dir, "add", "Two"); });
  await m.press(await draw(), "sprints");
  await m.type(await draw(), "new-sprint", "Polish");
  await m.type(await draw(), "new-sprint", "Later");
  await m.type(await draw(), "goal-s1", "Ship the pane");
  await m.type(await draw(), "end-s1", "2031-01-15");
  await m.press(await draw(), "start-s1");
  assert.deepEqual(boardOf(r.dir).sprints.map((s) => [s.id, s.state, s.goal, s.end]), [["s1", "active", "Ship the pane", "2031-01-15"], ["s2", "planned", "", ""]]);
  assert.equal(find(await draw(), "start-s2"), null);
  board(r.dir, "plan", "0001", "--sprint", "s1");
  board(r.dir, "plan", "0002", "--sprint", "s1");
  board(r.dir, "move", "0001", "done");
  await m.tick();
  await m.press(await draw(), "back");
  assert.equal(lines(await draw())[0], "Sprint s1 · Polish · ends 2031-01-15 · 1/2 done", "starting a sprint narrows the board to it");

  await m.press(await draw(), "sprints");
  await m.press(await draw(), "close-s1");
  assert.deepEqual(m.seen.asks, [{ question: "Close sprint s1? 1 done card(s) archived, 1 unfinished card(s) to sprint s2.", options: ["Close it", "Keep it open"] }]);
  assert.equal(boardOf(r.dir).sprints[0].state, "active", "kept open: nothing closed");
  await m.press(await draw(), "close-s1");
  const b = boardOf(r.dir);
  assert.deepEqual([b.sprints[0].state, b.sprints[0].closed.done, b.sprints[0].closed.rolled, b.card("0001").status, b.card("0002").sprint], ["closed", 1, 1, "archived", "s2"]);
  assert.equal(m.seen.toasts.at(-1), "Sprint s1 closed: 1 done card(s) archived, 1 unfinished card(s) to sprint s2.");
  await m.press(await draw(), "back");
  assert.equal(lines(await draw())[0], "All cards: 1", "with its sprint closed the board shows every card again");
});

test("turning sync on asks the person first, with what the first pass would open; no leaves it off", async (t) => {
  const sync = (argv) => (argv.includes("remote") && argv.includes("sync") ? { stdout: "Synced with github: 2 pushed, 0 pulled.\n" } : null);
  const { r, m, draw } = await opened(t, { origin: "git@github.com:example/board.git", answers: ["Keep it off", "Turn it on"], run: sync }, (x) => {
    board(x.dir, "add", "One");
    board(x.dir, "add", "Two");
    board(x.dir, "add", "Local only", "--suggest");
  });
  await m.press(await draw(), "settings");
  await m.press(await draw(), "sync-toggle");
  assert.deepEqual(m.seen.asks, [{
    question: "Sync this board with github example/board? The first pass opens 2 issue(s), one for each card without one, and brings in the open issues that have no card.",
    options: ["Turn it on", "Keep it off"],
  }]);
  assert.equal(boardOf(r.dir).remote.enabled, false);
  assert.deepEqual(writes(m), [], "asked and declined: nothing ran");
  assert.equal(m.seen.toasts.at(-1), "Sync stays off.");

  await m.press(await draw(), "sync-toggle");
  assert.equal(boardOf(r.dir).remote.enabled, true);
  assert.deepEqual(writes(m), [["remote", "on"], ["remote", "sync"]], "on, then the first pass");
  let drawn = lines(await draw());
  assert.ok(drawn.includes("Turn sync off") && drawn.includes("Sync now"));
  assert.ok(drawn.includes("synced: Synced with github: 2 pushed, 0 pulled."));

  await m.press(await draw(), "sync-now");
  assert.deepEqual(writes(m).at(-1), ["remote", "sync"]);
  await m.press(await draw(), "sync-toggle");
  assert.equal(boardOf(r.dir).remote.enabled, false);
  assert.equal(m.seen.asks.length, 2, "turning it off asks nothing");
  drawn = lines(await draw());
  assert.ok(drawn.includes("sync off") && !drawn.includes("Sync now"));
});

test("sync is not turned on when the person dismisses the question, or where no tracker is found", async (t) => {
  const dismissed = await opened(t, { origin: "git@gitlab.com:example/board.git" }, (x) => board(x.dir, "add", "One"));
  await dismissed.m.press(await dismissed.draw(), "settings");
  await dismissed.m.press(await dismissed.draw(), "sync-toggle");
  assert.match(dismissed.m.seen.asks[0].question, /^Sync this board with gitlab example\/board\? The first pass opens 1 issue\(s\)/);
  assert.equal(boardOf(dismissed.r.dir).remote.enabled, false);

  const none = await opened(t, { answers: ["Turn it on"] }, (x) => board(x.dir, "add", "One"));
  await none.m.press(await none.draw(), "settings");
  await none.m.press(await none.draw(), "sync-toggle");
  assert.deepEqual(none.m.seen.asks, [], "nothing to ask about");
  assert.equal(none.m.seen.toasts.at(-1), "Sync was not turned on: the origin remote is neither GitHub nor GitLab.");
  assert.equal(boardOf(none.r.dir).remote.enabled, false);
});

test("a failed pass says why and the pane keeps the board; an open pane syncs on its interval and a closed one never", async (t) => {
  let fail = true;
  const passes = [];
  const sync = (argv) => {
    if (!(argv.includes("remote") && argv.includes("sync"))) return null;
    passes.push(argv);
    return fail ? { exitCode: 1, stderr: "aw board: gh is not logged in: run gh auth login\n" } : { stdout: "Synced with github: 0 pushed, 0 pulled.\n" };
  };
  const { r, m, draw } = await opened(t, { origin: "https://github.com/example/board.git", run: sync, options: { syncIntervalSeconds: 30 } }, (x) => { board(x.dir, "add", "One"); board(x.dir, "remote", "on"); });
  await m.press(await draw(), "settings");
  await m.press(await draw(), "sync-now");
  assert.ok(lines(await draw()).includes("sync failed: gh is not logged in: run gh auth login"));
  assert.equal(boardOf(r.dir).cards.length, 1);

  fail = false;
  passes.length = 0;
  for (let i = 0; i < 9; i++) await m.tick();
  assert.equal(passes.length, 0, "not due yet");
  await m.tick();
  assert.equal(passes.length, 1, "thirty seconds of an open pane: one pass");
  assert.ok(lines(await draw()).includes("synced: Synced with github: 0 pushed, 0 pulled."));
  await m.close();
  for (let i = 0; i < 30; i++) await m.tick();
  assert.equal(passes.length, 1, "closed, it never syncs");
});

test("/kanban's subcommands change the board through the same CLI, and say what it said", async (t) => {
  const r = repo(t, { origin: "https://github.com/example/board.git" });
  const sync = (argv) => (argv.includes("remote") && argv.includes("sync") ? { stdout: "Synced with github: 1 pushed, 0 pulled.\n" } : null);
  const m = await mount(r.dir, { answers: ["Turn it on"], run: sync });
  assert.equal((await m.command("add Wire the pane")).text, "Added card 0001 [backlog]: Wire the pane");
  assert.equal((await m.command('epic "The pane"')).text, "Added card 0002 [backlog]: The pane");
  assert.match((await m.command("sprint new Wave three")).text, /^Planned sprint s1: Wave three\./);
  assert.equal((await m.command("sprint start s1")).text, 'Sprint s1 "Wave three" is active.');
  assert.match((await m.command("sprint start s1")).text, /^sprint s1 is active; only a planned sprint starts$/);
  assert.equal((await m.command("add Inside the wave")).text, "Added card 0003 [backlog]: Inside the wave");
  assert.equal(boardOf(r.dir).card("0003").sprint, "s1", "a card added while a sprint is active joins it, as in the pane");
  assert.equal((await m.command("sprint close")).text, "Sprint s1 closed: 0 done card(s) archived, 1 unfinished card(s) to the backlog.");
  assert.deepEqual(m.seen.asks, [], "typed out, a close is not asked about again");
  assert.equal((await m.command("sprint close")).text, "No sprint is active: name the one to close.");
  assert.equal((await m.command("sprint")).text, "Usage: /kanban sprint new <title> | start [<id>] | close [<id>]");
  assert.match((await m.command("frobnicate")).text, /^\/kanban opens the board\. \/kanban add <title> \| epic <title> \|/);
  assert.match((await m.command("add")).text, /^\/kanban opens the board\./);

  assert.equal((await m.command("sync on")).text, "Remote sync is on. Synced with github: 1 pushed, 0 pulled.");
  assert.equal(m.seen.asks.length, 1, "turning sync on asks, typed or pressed");
  assert.equal((await m.command("sync now")).text, "Remote sync is on. Synced with github: 1 pushed, 0 pulled.");
  assert.equal((await m.command("sync off")).text, "Remote sync is off.");
  assert.equal(boardOf(r.dir).remote.enabled, false);
  assert.equal(m.seen.timers.length, 0, "a subcommand opens no pane and starts no poll");
  assert.deepEqual(m.seen.opens, []);
});

test("a board still in .agents/board keeps working there, and the pane says so", async (t) => {
  const r = repo(t);
  write(r.dir, ".agents/board/board.json", "{}\n");
  write(r.dir, ".agents/board/0001-old-card.md", "---\nid: 0001\ntitle: Old card\nstatus: backlog\n---\n");
  const m = await mount(r.dir);
  assert.match((await m.command("")).text, /^Kanban opened: 1 cards in .*[\\/]\.agents[\\/]board \(the folder the board had first: it keeps working\)$/);
  assert.match(words(await m.draw("vscode")), /^These cards are still in \.agents\/board; Settings says more\.$/m);
  await m.command("add Next to it");
  assert.deepEqual(fs.readdirSync(path.join(r.dir, ".agents", "board")).filter((f) => f.endsWith(".md")).sort(), ["0001-old-card.md", "0002-next-to-it.md"]);
  assert.equal(fs.existsSync(r.kanban), false, "no second board is made beside it");
});

test("outside a repository the board lives in the folder itself, and the pane still opens", async (t) => {
  const dir = fs.realpathSync.native(tempDir(t, "pane-bare-"));
  const m = await mount(dir);
  assert.match((await m.command("")).text, /^Kanban opened: no board in .* yet; the first card creates it\.$/);
  assert.equal((await m.tool("surface_task", { title: "Anything", details: "x" })).result, "Added card 0001 [suggested]: Anything");
  assert.ok(fs.existsSync(path.join(dir, ".agents", "kanban", "0001-anything.md")));
});

test("when the CLI cannot be run the pane says so and keeps the last board it read", async (t) => {
  let broken = false;
  const run = (argv) => (broken && argv[0] === "node" ? { exitCode: 1, stderr: "node: not found\n" } : null);
  const { m, draw } = await opened(t, { run }, (x) => board(x.dir, "add", "One"));
  broken = true;
  await m.post({ type: "shift", id: "0001", by: 1 });
  await m.press(await draw(), "card-0001");
  await m.type(await draw(), "owner", "sam");
  assert.equal(m.seen.toasts.at(-1), "node: not found");
  assert.match(words(await draw()), /^One 0001$/m, "the card is still drawn");
  const fresh = await mount(m.session.cwd, { run });
  assert.equal((await fresh.command("")).text, "Kanban opened, but the board could not be read: node: not found");
  assert.match(words(await fresh.draw("vscode")), /^The board could not be read: node: not found$/m);
});
