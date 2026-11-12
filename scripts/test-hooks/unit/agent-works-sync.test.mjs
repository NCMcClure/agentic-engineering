// Keeping a card in step with the work on it: what a tool call did, which
// card it was about, the move a card is owed, the reminder on a timer, what a
// stop asks, and the evidence lines the sweep reads. Then keeping a card in
// step with its issue: which labels, milestone and parent say a column, a
// sprint and an epic on each forge, how an issue reads back, and which side
// wins. All pure, over boards built here, so no hook, git or tracker runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardConfig, briefLine, note, summary } from "../../../plugins/agent-works/lib/board.mjs";
import {
  NUDGE_MS, ASK_MS, adoptColumns, afterTool, ago, cardFromIssue, cardHash, cardsOf, decide, drift, epicLabel, epicOfIssue, epicOfLabels, githubHad,
  githubIssue, githubLabels, githubParent, githubProject, gitlabBoard, gitlabFields, gitlabIssue, isBoardLabel, isEpicUrl, isLocalOnly, issueOfForge,
  ledgerOf, linked, milestoneTitle, observe, parentKeys, planOf, pulled, record, remoteHash, remoteKey, section, signals, sprintOfIssue, stale,
  statusLabel, statusOf, stopAsk, sweepCards, tally, working,
} from "../../../plugins/agent-works/lib/sync.mjs";

const T0 = Date.parse("2026-11-03T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60 * 1000;
const CLI = 'node "/p/board.mjs"';

const card = (id, fields = {}) => ({ id, title: `Card ${id}`, status: "backlog", kind: "task", labels: [], skills: [], after: [], files: [], updated: iso(T0), ...fields });
const boardOf = (...cards) => ({ ...boardConfig(), cards });
const ev = (kind, at, ids, extra = {}) => ({ kind, at: iso(at), ids, ...extra });

// ---- observe ------------------------------------------------------------

test("edits, commits, and pushes are work", () => {
  assert.deepEqual(observe({ tool: "Edit", input: { file_path: "/r/a.mjs" } }), { kind: "edit", ids: [] });
  assert.deepEqual(observe({ tool: "Write", input: { file_path: "/r/b.mjs" } }), { kind: "edit", ids: [] });
  assert.deepEqual(observe({ tool: "Bash", input: { command: 'git commit -m "feat: x"' }, output: { stdout: "[feat/x 1a2b3c4] feat: x" } }), { kind: "commit", ids: [] });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "git -C /r push -u origin feat/x" } }), { kind: "push", ids: [] });
  assert.equal(observe({ tool: "Bash", input: { command: "git commit -m x" }, output: { stdout: "nothing to commit, working tree clean" } }), null);
  assert.equal(observe({ tool: "Bash", input: { command: "npm test" } }), null);
  assert.equal(observe({ tool: "Read", input: { file_path: "/r/a.mjs" } }), null);
});

test("a change request opened or merged is read from the command and its output, on either forge", () => {
  const created = observe({ tool: "Bash", input: { command: "glab mr create --fill --remove-source-branch" }, output: { stdout: "https://gitlab.example/g/p/-/merge_requests/42\n" } });
  assert.deepEqual(created, { kind: "mr-open", ids: [], mr: 42 });
  const sha = "a".repeat(40);
  assert.deepEqual(observe({ tool: "Bash", input: { command: `node "/p/mr.mjs" merge 42 --sha ${sha}` }, output: { stdout: `!42 merged at ${sha}\n` } }),
    { kind: "mr-merge", ids: [], mr: 42, sha });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "glab api -X PUT projects/:id/merge_requests/7/merge -F should_remove_source_branch=true" }, output: `{"state":"merged","merge_commit_sha":"${sha}"}` }),
    { kind: "mr-merge", ids: [], mr: 7, sha });
  // A refused merge merged nothing, and a create with no URL opened nothing.
  assert.equal(observe({ tool: "Bash", input: { command: `node mr.mjs merge 42 --sha ${sha}` }, output: { stdout: "!42 not merged: the pipeline failed" } }), null);
  assert.equal(observe({ tool: "Bash", input: { command: "glab mr create --fill" }, output: { stderr: "403 Forbidden" } }), null);
  assert.deepEqual(observe({ tool: "Bash", input: { command: 'gh pr create --title "x" --body-file -' }, output: { stdout: "https://github.com/someone/thing/pull/17\n" } }), { kind: "mr-open", ids: [], mr: 17 });
  assert.deepEqual(observe({ tool: "Bash", input: { command: 'node "/p/mr.mjs" open --title x' }, output: { stdout: "#18 opened: https://github.com/someone/thing/pull/18\n" } }), { kind: "mr-open", ids: [], mr: 18 });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "gh pr merge 17 --merge --delete-branch" }, output: { stdout: "✓ Merged pull request #17 (x)\n" } }), { kind: "mr-merge", ids: [], mr: 17 });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "gh api -X PUT repos/someone/thing/pulls/17/merge" }, output: `{"sha":"${sha}","merged":true}` }), { kind: "mr-merge", ids: [], mr: 17, sha });
});

test("the furthest a card would move wins: a change request opened over the push beside it", () => {
  assert.equal(observe({ tool: "Bash", input: { command: "git push -u origin feat/x && glab mr create --fill" }, output: { stdout: "…/merge_requests/9" } }).kind, "mr-open");
});

test("board verbs and the model's board tools name their cards", () => {
  assert.deepEqual(observe({ tool: "Bash", input: { command: 'node "/p/scripts/board.mjs" move 0007 review --mr 12' } }), { kind: "board", verb: "move", ids: ["0007"], column: "review" });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "node board.mjs claim 01-02-03" } }), { kind: "board", verb: "claim", ids: ["01-02-03"] });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "node board.mjs grant 0001,0002 --by x" } }), { kind: "board", verb: "grant", ids: ["0001", "0002"] });
  assert.equal(observe({ tool: "Bash", input: { command: "node board.mjs show 0007" } }), null, "reading is not acting");
  assert.deepEqual(observe({ tool: "Bash", input: { command: 'node "/p/scripts/aw.mjs" board move 0007 review --mr 12' } }), { kind: "board", verb: "move", ids: ["0007"], column: "review" });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "aw kanban settle 0009 --evidence ok" } }), { kind: "board", verb: "settle", ids: ["0009"] });
  assert.deepEqual(observe({ tool: "Bash", input: { command: "aw --root /r board note 0007 waiting" } }), { kind: "board", verb: "note", ids: ["0007"] });
  assert.equal(observe({ tool: "Bash", input: { command: "aw lock run gpu --for x -- echo 0007" } }), null);
  assert.deepEqual(observe({ tool: "mcp__agent-works__move_task", input: { id: "0007", column: "in-progress" } }), { kind: "board", verb: "move", ids: ["0007"], column: "in-progress" });
  assert.equal(observe({ tool: "mcp__agent-works__list_tasks", input: {} }), null);
});

test("a tool output that arrives as a JSON string is read the same", () => {
  const out = JSON.stringify({ stdout: "https://g/p/-/merge_requests/5" });
  assert.deepEqual(observe({ tool: "Shell", input: { command: "glab mr create --fill" }, output: out }), { kind: "mr-open", ids: [], mr: 5 });
});

// ---- which card, and the ledger -----------------------------------------

test("the working card is the branch's, else the focus, never a finished one", () => {
  const b = boardOf(card("0001", { branch: "feat/a", status: "in-progress" }), card("0002", { status: "in-progress" }), card("0003", { branch: "feat/c", status: "done" }));
  assert.equal(working(b, { branch: "feat/a" }).id, "0001");
  assert.equal(working(b, { branch: "feat/zzz", focus: "0002" }).id, "0002");
  assert.equal(working(b, { branch: "feat/c" }), null);
  assert.deepEqual(cardsOf(b, { kind: "edit", ids: [] }, { branch: "feat/a" }), ["0001"]);
  assert.deepEqual(cardsOf(b, { kind: "board", verb: "move", ids: ["0002", "9999"] }, { branch: "feat/a" }), ["0002"]);
});

test("a merged MR is about the cards that carry it", () => {
  const b = boardOf(card("0001", { status: "review", mr: 12 }), card("0002", { status: "review", mr: 13 }));
  assert.deepEqual(cardsOf(b, { kind: "mr-merge", ids: [], mr: 12 }, {}), ["0001"]);
});

test("moving an unbound card into progress focuses it; moving it on lets go", () => {
  const b = boardOf(card("0002", { status: "in-progress" }), card("0003", { status: "in-progress", session: "child" }));
  let l = record(ledgerOf(null), { kind: "board", verb: "move", ids: ["0002"], column: "in-progress" }, { at: iso(T0), now: T0, board: b });
  assert.equal(l.focus, "0002");
  l = record(l, { kind: "board", verb: "move", ids: ["0003"], column: "in-progress" }, { at: iso(T0), now: T0, board: b });
  assert.equal(l.focus, "0002", "a card a child holds is the child's");
  l = record(l, { kind: "board", verb: "move", ids: ["0002"], column: "review" }, { at: iso(T0), now: T0, board: b });
  assert.equal(l.focus, null);
});

test("the ledger keeps a day of events and reads anything as a ledger", () => {
  const b = boardOf();
  const old = { kind: "edit", ids: ["0001"], at: iso(T0 - 25 * 60 * MIN) };
  const l = record(ledgerOf({ events: [old], asked: [], focus: 3 }), { kind: "edit", ids: ["0001"] }, { at: iso(T0), now: T0, board: b });
  assert.equal(l.events.length, 1);
  assert.deepEqual(l.asked, {});
  assert.equal(l.focus, null);
  assert.deepEqual(ledgerOf("garbage"), { v: 1, events: [], asked: {}, told: {}, focus: null });
});

// ---- drift ----------------------------------------------------------------

test("an MR opened owes review, a merge owes done, work on a backlog card owes progress", () => {
  const c = card("0007", { status: "in-progress", branch: "feat/x" });
  const b = boardOf(c);
  assert.deepEqual(drift(b, c, [ev("mr-open", T0 + MIN, ["0007"], { mr: 12 })]), { to: "review", key: "review:12", why: "!12 opened", args: "move 0007 review --mr 12" });
  const sha = "b".repeat(40);
  assert.equal(drift(b, c, [ev("mr-open", T0 + MIN, ["0007"], { mr: 12 }), ev("mr-merge", T0 + 2 * MIN, ["0007"], { mr: 12, sha })]).args, `done 0007 --merged ${sha}`);
  const fresh = card("0008");
  assert.equal(drift(boardOf(fresh), fresh, [ev("commit", T0 + MIN, ["0008"])]).args, "move 0008 in-progress");
  assert.equal(drift(boardOf(fresh), fresh, [ev("commit", T0 + MIN, ["0008"])], { worktree: true }).args, "claim 0008");
});

test("no drift once the card shows it, or when the event came before the card's last change", () => {
  const c = card("0007", { status: "review", mr: 12 });
  assert.equal(drift(boardOf(c), c, [ev("mr-open", T0 + MIN, ["0007"], { mr: 12 })]), null);
  const moved = card("0007", { status: "in-progress", updated: iso(T0 + 5 * MIN) });
  assert.equal(drift(boardOf(moved), moved, [ev("mr-open", T0 + MIN, ["0007"], { mr: 12 })]), null);
  const done = card("0007", { status: "done" });
  assert.equal(drift(boardOf(done), done, [ev("mr-merge", T0 + MIN, ["0007"], { mr: 12 })]), null);
  const gate = card("0009", { kind: "gate" });
  assert.equal(drift(boardOf(gate), gate, [ev("commit", T0 + MIN, ["0009"])]), null);
});

// ---- the timer --------------------------------------------------------

test("a reminder after NUDGE_MS of work under an unchanged card, then twice as long", () => {
  const c = card("0007", { status: "in-progress" });
  const work = [ev("edit", T0 + MIN, ["0007"]), ev("commit", T0 + 2 * MIN, ["0007"])];
  assert.equal(stale(c, work, {}, T0 + NUDGE_MS - MIN), null);
  assert.deepEqual(stale(c, work, {}, T0 + NUDGE_MS), { since: T0, work: "an edit, a commit" });
  const told = { at: iso(T0 + NUDGE_MS), n: 1, updated: c.updated };
  assert.equal(stale(c, work, told, T0 + NUDGE_MS + NUDGE_MS), null, "the second waits twice as long");
  assert.ok(stale(c, work, told, T0 + NUDGE_MS + 2 * NUDGE_MS));
  // Once the card changes, the backoff starts over from that change.
  const moved = { ...c, updated: iso(T0 + 3 * NUDGE_MS) };
  assert.equal(stale(moved, [...work, ev("edit", T0 + 3 * NUDGE_MS + MIN, ["0007"])], told, T0 + 4 * NUDGE_MS).since, T0 + 3 * NUDGE_MS);
  assert.equal(stale(c, [], {}, T0 + 10 * NUDGE_MS), null, "no work, no reminder");
});

test("after a tool call: a drift is told once per move it owes, a stale card on the timer", () => {
  const c = card("0007", { status: "in-progress", branch: "feat/x" });
  const b = boardOf(c);
  let l = { ...ledgerOf(null), events: [ev("mr-open", T0 + MIN, ["0007"], { mr: 12 })] };
  const first = afterTool(b, l, ["0007"], { now: T0 + MIN, cli: CLI });
  assert.match(first.text, /^Card 0007 "Card 0007" is in in-progress, and !12 opened: move it now, node "\/p\/board.mjs" move 0007 review --mr 12$/);
  l = { ...l, told: { ...l.told, ...first.told } };
  assert.equal(afterTool(b, l, ["0007"], { now: T0 + 2 * MIN, cli: CLI }), null);
  const s = afterTool(b, { ...ledgerOf(null), events: [ev("edit", T0 + MIN, ["0007"])] }, ["0007"], { now: T0 + NUDGE_MS, cli: CLI });
  assert.match(s.text, /has said in-progress for 20 min while this session kept working on it \(an edit\)/);
  assert.match(s.text, /note 0007 "<what changed>"/);
  assert.equal(s.told["0007"].n, 1);
});

// ---- the stop -------------------------------------------------------------

test("a stop asks about a drift and about work since the card last changed", () => {
  const b = boardOf(card("0007", { status: "in-progress" }), card("0008", { status: "in-progress" }));
  const l = { ...ledgerOf(null), events: [ev("mr-open", T0 + MIN, ["0007"], { mr: 12 }), ev("edit", T0 + MIN, ["0008"]), ev("commit", T0 + 2 * MIN, ["0008"])] };
  const ask = stopAsk(b, l, { now: T0 + 3 * MIN, cli: CLI });
  assert.match(ask.text, /^Before you stop, check the cards this session worked on:/);
  assert.match(ask.text, /- 0007 "Card 0007" is in in-progress, and !12 opened\. node "\/p\/board.mjs" move 0007 review --mr 12/);
  assert.match(ask.text, /- 0008 "Card 0008" is in in-progress, after an edit, a commit since it last changed\./);
  assert.match(ask.text, /say so in one line and stop/);
  assert.deepEqual(Object.keys(ask.asked).sort(), ["0007", "0008"]);
});

test("a stop is quiet once the card moved after the work, and does not ask twice", () => {
  const moved = boardOf(card("0007", { status: "review", mr: 12, updated: iso(T0 + 5 * MIN) }));
  const l = { ...ledgerOf(null), events: [ev("commit", T0 + MIN, ["0007"]), ev("mr-open", T0 + 2 * MIN, ["0007"], { mr: 12 })] };
  assert.equal(stopAsk(moved, l, { now: T0 + 6 * MIN, cli: CLI }), null);
  const b = boardOf(card("0008", { status: "in-progress" }));
  const work = { ...ledgerOf(null), events: [ev("edit", T0 + MIN, ["0008"])] };
  const first = stopAsk(b, work, { now: T0 + 2 * MIN, cli: CLI });
  const after = { ...work, asked: first.asked, events: [...work.events, ev("edit", T0 + 3 * MIN, ["0008"])] };
  assert.equal(stopAsk(b, after, { now: T0 + 4 * MIN, cli: CLI }), null, "new work within ASK_MS waits");
  assert.ok(stopAsk(b, after, { now: T0 + 2 * MIN + ASK_MS, cli: CLI }), "and is asked about after it");
});

test("a CARD line the board does not show is asked about", () => {
  const b = boardOf(card("0007", { status: "in-progress" }));
  const ask = stopAsk(b, ledgerOf(null), { now: T0, cli: CLI, lastMessage: "CARD 0007 review !12 lanes=unit:pass owed=-\n\nVerdict: done." });
  assert.match(ask.text, /0007 "Card 0007": your CARD line says review !12, and the board has it in in-progress\. node "\/p\/board.mjs" move 0007 review --mr 12/);
  assert.equal(stopAsk(boardOf(card("0007", { status: "review", mr: 12 })), ledgerOf(null), { now: T0, cli: CLI, lastMessage: "CARD 0007 review !12 lanes=- owed=-" }), null);
  assert.equal(stopAsk(b, ledgerOf(null), { now: T0, cli: CLI, lastMessage: "CARD 0007 nonsense" }), null);
});

test("a subagent is asked only about its own work that left the worktree", () => {
  const b = boardOf(card("0007", { status: "in-progress" }));
  const l = { ...ledgerOf(null), events: [ev("edit", T0 + MIN, ["0007"], { agent: "a1" }), ev("commit", T0 + MIN, ["0007"], { agent: "a2" })] };
  assert.equal(stopAsk(b, l, { now: T0 + 2 * MIN, cli: CLI, agent: "a1" }), null, "plain edits are the session's to judge");
  const ask = stopAsk(b, l, { now: T0 + 2 * MIN, cli: CLI, agent: "a2" });
  assert.match(ask.text, /^Before you finish: your work touched cards the board tracks\.\n- 0007 "Card 0007" is in in-progress, after a commit since it last changed\./);
  assert.match(ask.text, /say in your final report what changed/);
  assert.deepEqual(Object.keys(ask.asked), ["a2:0007"]);
});

// ---- the briefing, the note, the sweep's reading ---------------------------

test("the briefing names in-flight cards untouched for a day", () => {
  const b = boardOf(card("0001", { status: "in-progress", updated: iso(T0 - 25 * 60 * MIN) }), card("0002", { status: "review", mr: 3 }));
  assert.equal(summary(b).untouched, 0, "without a time it counts nothing");
  assert.equal(briefLine(summary(b, T0)), "Board: 1 in progress (0001), 1 in review (0002 !3). 1 in flight has not changed for a day: /agent-works:sync-cards checks it.");
});

test("a note lands under Notes, dated, and refuses a plan card", () => {
  const b = boardOf(card("0007", { body: "## Done when\n- x\n\n## Notes\n- earlier\n\n## Review" }), card("0008", { body: "" }), card("01-02-03", { source: "plan" }));
  const [n] = note(b, "7", "still building\nthe CLI", "2026-11-03T13:00:00.000Z").cards;
  assert.equal(n.body, "## Done when\n- x\n\n## Notes\n- earlier\n- 2026-11-03T13:00:00.000Z: still building the CLI\n\n## Review");
  assert.equal(n.updated, "2026-11-03T13:00:00.000Z");
  assert.equal(note(b, "0008", "x", "t").cards[0].body, "## Notes\n\n- t: x");
  assert.throws(() => note(b, "01-02-03", "x", "t"), /plan issue/);
  assert.throws(() => note(b, "0007", "  ", "t"), /needs the text/);
});

test("the sweep's scopes", () => {
  const b = boardOf(card("0001"), card("0002", { status: "suggested" }), card("0003", { status: "in-progress" }), card("0004", { status: "review" }),
    card("0005", { kind: "gate" }), card("01-01-01", { source: "plan", status: "in-progress" }), card("01-01-02", { source: "plan" }));
  assert.deepEqual(sweepCards(b, "in-flight").map((c) => c.id), ["0003", "0004", "01-01-01"]);
  assert.deepEqual(sweepCards(b, "backlog").map((c) => c.id), ["0001"]);
  assert.deepEqual(sweepCards(b, "suggested").map((c) => c.id), ["0002"]);
  assert.equal(sweepCards(b, "everything"), null);
});

test("signals say what the local evidence shows, plainly", () => {
  const c = card("0007", { status: "review", mr: 12, updated: iso(T0 - 3 * 24 * 60 * MIN) });
  const facts = {
    base: "origin/main", branch: { name: "feat/x", guessed: false, local: true, remote: true, ahead: 2, lastAt: iso(T0 - 90 * MIN) },
    merge: null, mentions: [], touched: ["1a2b3c4 feat: x"], worktree: { path: "/w/x", exists: true, dirty: 1, branch: "feat/x" },
  };
  assert.deepEqual(signals(c, facts, T0), [
    "feat/x exists (local and origin), 2 commits ahead of origin/main, last commit 2 h ago",
    "worktree /w/x on feat/x, 1 uncommitted change",
    "!12 is on the card: its state is the forge's to say",
    "its files changed on origin/main since it was filed: 1 commit, latest 1a2b3c4 feat: x",
    "the card has not changed for 3 days",
  ]);
  const merged = signals(card("0008"), { base: "origin/main", branch: { name: "feat/y", guessed: true }, merge: { sha: "c".repeat(40), via: "Merge branch 'feat/y' into 'main'" }, mentions: [], touched: [], worktree: null }, T0);
  assert.deepEqual(merged, ["merged into origin/main at cccccccccccc (Merge branch 'feat/y' into 'main')"]);
  assert.deepEqual(signals(card("0009"), { base: "main", branch: { name: "feat/z", guessed: true }, merge: null, mentions: [], touched: [], worktree: null }, T0),
    ["no branch, worktree, merge, or commit found for it"]);
});

test("section, tally, and ago", () => {
  assert.equal(section("\n## Done when\n- a\n- b\n\n## Notes\nx\n", "Done when"), "- a\n- b");
  assert.equal(section("no sections", "Done when"), "");
  assert.equal(tally([{ kind: "edit" }, { kind: "edit" }, { kind: "push" }]), "2 edits, a push");
  assert.equal(ago(35 * MIN), "35 min");
  assert.equal(ago(3 * 60 * MIN), "3 h");
  assert.equal(ago(3 * 24 * 60 * MIN), "3 days");
  assert.ok(ASK_MS > 0 && NUDGE_MS > 0);
});

// ---- a card and its issue -----------------------------------------------

const COLUMNS = boardConfig().columns;
const full = (id, fields = {}) => card(id, { order: 0, priority: "normal", source: "user", created: iso(T0), unknown: [], body: "", file: `${id}-card.md`, ...fields });
const issue = (number, fields = {}) => ({
  number, title: `Issue ${number}`, body: "", url: `https://github.com/someone/thing/issues/${number}`, updatedAt: iso(T0 + MIN), isOpen: true, status: "backlog",
  labels: [], milestone: null, parent: null, isEpic: false, ...fields,
});

test("the labels the board keeps for itself say a column and an epic", () => {
  assert.equal(statusLabel("in-progress"), "status:in-progress");
  assert.equal(epicLabel("0004"), "epic:0004");
  assert.ok(isBoardLabel("status:x") && isBoardLabel("epic:0004") && !isBoardLabel("bug") && !isBoardLabel("statusquo"));
  assert.equal(statusOf(["bug", "status:review"]), "review");
  assert.equal(statusOf(["bug"]), null);
  assert.deepEqual(epicOfLabels(["epic:0004", "bug"]), { label: "0004" });
  assert.equal(epicOfLabels(["bug"]), null);
  assert.equal(milestoneTitle({ id: "s2", title: " Polish " }), "Polish");
  assert.equal(milestoneTitle({ id: "s2", title: " " }), "s2");
  assert.deepEqual([remoteKey(7, false), remoteKey(7, true)], ["issue#7", "epic#7"]);
  assert.ok(isEpicUrl("https://gitlab.com/groups/g/-/epics/2") && !isEpicUrl("https://gitlab.com/g/p/-/issues/2"));
});

test("a remote board's column names become columns: the first in progress starts, the last finished closes", () => {
  assert.deepEqual(adoptColumns(["To do", "In Progress", "Doing more", "Done", "Shipped"]), [
    { id: "to-do", title: "To do", role: null }, { id: "in-progress", title: "In Progress", role: "start" }, { id: "doing-more", title: "Doing more", role: null },
    { id: "done", title: "Done", role: null }, { id: "shipped", title: "Shipped", role: "done" },
  ]);
  assert.deepEqual(adoptColumns(["Active"]), [{ id: "active", title: "Active", role: "start" }]);
});

test("the hash of what a tracker holds: title, column, body, labels, and the planning once there is some", () => {
  const c = full("0001", { title: "T", body: " Body \n", labels: ["b", "a"] });
  assert.equal(cardHash(c), cardHash({ ...c, body: "Body", labels: ["a", "b"], owner: "kim", order: 9 }));
  assert.notEqual(cardHash(c), cardHash({ ...c, status: "review" }));
  assert.equal(remoteHash(c), cardHash(c), "a card planned into nothing keeps the hash it had");
  assert.notEqual(remoteHash({ ...c, sprint: "s1" }), remoteHash(c));
  assert.notEqual(remoteHash({ ...c, epic: "0004" }), remoteHash({ ...c, sprint: "0004" }));
  // The values cards written before 1.0 carry in syncedHash still match.
  assert.equal(cardHash({ title: "Write the README", status: "backlog", body: "", labels: [] }), "1b57a8b2");
  assert.ok(isLocalOnly({ status: "suggested" }) && isLocalOnly({ status: "archived" }) && !isLocalOnly({ status: "backlog" }));
});

test("linking records where the issue is and what was synced; pulling takes the issue's side", () => {
  const c = full("0001", { title: "Mine", labels: ["x"], sprint: "s1" });
  const there = issue(5, { title: "Theirs", body: "New body", labels: ["bug"], status: "review" });
  const l = linked(c, "github", there);
  assert.deepEqual(l.remote, { provider: "github", number: 5, url: there.url, updatedAt: there.updatedAt, syncedHash: remoteHash(c) });
  const p = pulled(l, "github", there, { sprint: "", epic: "0004" });
  assert.deepEqual([p.title, p.body, p.labels, p.status, p.sprint, p.epic, p.updated], ["Theirs", "New body", ["bug"], "review", undefined, "0004", there.updatedAt]);
  assert.equal(p.remote.syncedHash, remoteHash(p));
  // An issue with no column leaves the card where it is, and nothing changed means nothing is stamped.
  const same = pulled(l, "github", issue(5, { title: "Mine", labels: ["x"], status: null }), { sprint: "s1", epic: "" });
  assert.deepEqual([same.status, same.updated], ["backlog", c.updated]);
});

test("which side wins: the card when only it changed, the issue when it is newer", () => {
  const base = full("0001", { title: "T", updated: iso(T0) });
  const there = issue(5, { title: "T", updatedAt: iso(T0) });
  const synced = linked(base, "github", there);
  const theirs = (card, i) => pulled(card, "github", i, { sprint: "", epic: "" });
  assert.equal(decide(synced, there, theirs(synced, there)), "same");
  // The issue was touched without changing what the card holds: only the link's time moves.
  const touched = { ...there, updatedAt: iso(T0 + MIN) };
  assert.equal(decide(synced, touched, theirs(synced, touched)), "touch");
  const edited = { ...synced, title: "T, edited here", updated: iso(T0 + 2 * MIN) };
  assert.equal(decide(edited, there, theirs(edited, there)), "push");
  const remote = { ...there, title: "T, edited there", updatedAt: iso(T0 + 3 * MIN) };
  assert.equal(decide(synced, remote, theirs(synced, remote)), "pull");
  assert.equal(decide(edited, remote, theirs(edited, remote)), "pull", "both changed, the issue later");
  const earlier = { ...there, title: "T, edited there", updatedAt: iso(T0 + MIN) };
  assert.equal(decide(edited, earlier, theirs(edited, earlier)), "push", "both changed, the card later");
});

test("a milestone is a sprint by title, a parent an epic by its issue or its label", () => {
  const b = { ...boardConfig({ sprints: [{ id: "s1", title: "Polish", state: "active" }, { id: "s2", title: "" }] }), cards: [] };
  assert.deepEqual(sprintOfIssue(b, issue(1, { milestone: "Polish" }), "s9"), { sprint: "s1", unmatched: null });
  assert.deepEqual(sprintOfIssue(b, issue(1, { milestone: "s2" })), { sprint: "s2", unmatched: null });
  assert.deepEqual(sprintOfIssue(b, issue(1, { milestone: "Someday" }), "s1"), { sprint: "s1", unmatched: "Someday" });
  assert.deepEqual(sprintOfIssue(b, issue(1), "s1"), { sprint: "", unmatched: null });

  const epic = linked(full("0004", { kind: "epic" }), "github", issue(40));
  const group = linked(full("0005", { kind: "epic" }), "gitlab", issue(2, { url: "https://gitlab.com/groups/g/-/epics/2", isEpic: true }));
  const cards = [epic, group, full("0006")];
  assert.equal(epicOfIssue(cards, issue(1, { parent: { number: 40, isEpic: false } })), "0004");
  assert.equal(epicOfIssue(cards, issue(1, { parent: { number: 2, isEpic: true } })), "0005");
  assert.equal(epicOfIssue(cards, issue(1, { parent: { number: 2, isEpic: false } }), "0009"), "0009", "an issue #2 is not the epic &2");
  assert.equal(epicOfIssue(cards, issue(1, { parent: { label: "0004" } })), "0004");
  assert.equal(epicOfIssue(cards, issue(1, { parent: { label: "0006" } }), "0004"), "0004", "a label that names no epic keeps the card's");
  assert.equal(epicOfIssue(cards, issue(1), "0004"), "");
  assert.deepEqual([...parentKeys([issue(1, { parent: { number: 40, isEpic: false } }), issue(2, { parent: { label: "0004" } }), issue(3)])], ["issue#40"]);

  const byId = new Map(cards.map((c) => [c.id, c]));
  assert.deepEqual(planOf(full("0007", { epic: "0004", sprint: "s1" }), b, byId), { sprint: b.sprints[0], epic: { id: "0004", remote: { number: 40, isEpic: false } } });
  assert.deepEqual(planOf(full("0007", { epic: "0006", sprint: "s7" }), b, byId), { sprint: null, epic: { id: "0006", remote: null } });
  assert.deepEqual(planOf(epic, b, byId), { sprint: null, epic: null });
});

test("an open issue with no card becomes one, linked as it stands", () => {
  const c = cardFromIssue("0012", "gitlab", issue(9, { title: "Café: déjà vu", body: "Filed there.", labels: ["bug"] }), { status: "review", order: 3, epic: "0004", sprint: "" });
  assert.deepEqual([c.id, c.file, c.title, c.status, c.order, c.kind, c.epic, c.sprint, c.body, c.labels, c.created], ["0012", "0012-cafe-deja-vu.md", "Café: déjà vu", "review", 3, "task", "0004", undefined, "Filed there.", ["bug"], iso(T0 + MIN)]);
  assert.deepEqual(c.remote, { provider: "gitlab", number: 9, url: "https://github.com/someone/thing/issues/9", updatedAt: iso(T0 + MIN), syncedHash: remoteHash(c) });
});

test("GitHub: an issue reads its column from a status label, or from the project's Status", () => {
  const node = { id: "I_1", number: 1, title: "T", body: "a\r\nb\n", url: "u", updatedAt: "t", state: "OPEN", labels: { nodes: [{ name: "bug" }, { name: "status:review" }, { name: "epic:0004" }] }, milestone: { title: "Polish" } };
  assert.deepEqual(githubIssue(node, { columns: COLUMNS }), {
    number: 1, title: "T", body: "a\nb", url: "u", updatedAt: "t", isOpen: true, status: "review", labels: ["bug"], milestone: "Polish", parent: { label: "0004" }, isEpic: false, nodeId: "I_1", itemId: null,
  });
  assert.equal(githubIssue({ ...node, labels: { nodes: [] } }, { columns: COLUMNS }).status, "backlog", "an open issue that names no column is in the first");
  assert.equal(githubIssue({ ...node, state: "CLOSED" }, { columns: COLUMNS }).status, "done");
  assert.deepEqual(githubIssue({ ...node, parent: { number: 40 } }, { columns: COLUMNS }).parent, { number: 40, isEpic: false });
  assert.equal(githubIssue({ title: "no number" }, { columns: COLUMNS }), null);

  const project = githubProject({ id: "P_1", number: 3, owner: { login: "someone" }, field: { id: "F_1", options: [{ id: "o1", name: "Todo" }, { id: "o2", name: "In progress" }, { id: "o3", name: "Done" }] } });
  assert.deepEqual([project.columns.map((c) => `${c.id}:${c.role}`), [...project.options]], [["todo:null", "in-progress:start", "done:done"], [["todo", "o1"], ["in-progress", "o2"], ["done", "o3"]]]);
  assert.equal(githubProject({ id: "P_1", number: 3, owner: { login: "x" }, field: null }), null);
  const placed = { ...node, projectItems: { nodes: [{ id: "IT_9", project: { id: "P_other" } }, { id: "IT_1", project: { id: "P_1" }, fieldValueByName: { optionId: "o2" } }] } };
  const read = githubIssue(placed, { project, columns: project.columns });
  assert.deepEqual([read.status, read.itemId], ["in-progress", "IT_1"]);
  assert.equal(githubIssue(node, { project, columns: project.columns }).status, null, "not on the project: no column");
  assert.equal(githubIssue({ ...placed, state: "CLOSED" }, { project, columns: project.columns }).status, "done");
});

test("GitHub: a card's labels are its own, its column without a project, its epic without a parent link", () => {
  const c = full("0007", { labels: ["bug"], status: "review" });
  const hung = { sprint: null, epic: { id: "0004", remote: { number: 40, isEpic: false } } };
  const loose = { sprint: null, epic: { id: "0004", remote: null } };
  assert.deepEqual(githubLabels(c, { sprint: null, epic: null }, { hasProject: false, hasSubIssues: true }), ["bug", "status:review"]);
  assert.deepEqual(githubLabels(c, hung, { hasProject: true, hasSubIssues: true }), ["bug"]);
  assert.deepEqual(githubLabels(c, hung, { hasProject: true, hasSubIssues: false }), ["bug", "epic:0004"]);
  assert.deepEqual(githubLabels(c, loose, { hasProject: false, hasSubIssues: true }), ["bug", "status:review", "epic:0004"]);
  assert.deepEqual([githubParent(hung, true), githubParent(hung, false), githubParent(loose, true)], [40, null, null]);
  assert.deepEqual(githubHad(issue(1, { labels: ["bug"], status: "backlog", parent: { label: "0004" } }), false), ["bug", "status:backlog", "epic:0004"]);
  assert.deepEqual(githubHad(issue(1, { labels: ["bug"], status: "backlog", parent: { number: 40, isEpic: false } }), true), ["bug"]);
  assert.deepEqual(issueOfForge({ number: 3, title: "T", body: "b", state: "closed", labels: ["bug", "status:done"], url: "u", milestone: "Polish", updatedAt: "t" }, { status: "done", parent: { label: "0004" } }),
    { number: 3, title: "T", body: "b", url: "u", updatedAt: "t", isOpen: false, status: "done", labels: ["bug"], milestone: "Polish", parent: { label: "0004" }, isEpic: false });
});

test("GitLab: a board's lists are the columns between Open and Closed, and an issue reads its list", () => {
  const board = gitlabBoard([{ lists: [{ position: 2, label: { name: "Review" } }, { position: 1, label: { name: "Doing" } }, { position: 0, list_type: "backlog" }] }]);
  assert.deepEqual(board.columns.map((c) => `${c.id}:${c.role}`), ["open:null", "doing:start", "review:null", "closed:done"]);
  assert.deepEqual([...board.labelOf], [["doing", "Doing"], ["review", "Review"]]);
  assert.equal(gitlabBoard([]), null);
  assert.equal(gitlabBoard([{ lists: [] }]), null);

  const raw = { id: 1007, iid: 7, title: "T", description: "d", web_url: "https://gitlab.com/g/p/-/issues/7", updated_at: "t", state: "opened", labels: ["Doing", "bug", "epic:0004"], milestone: { title: "Polish" } };
  assert.deepEqual(gitlabIssue(raw, { board, columns: board.columns }), {
    number: 7, title: "T", body: "d", url: raw.web_url, updatedAt: "t", isOpen: true, status: "doing", labels: ["bug"], milestone: "Polish", parent: { label: "0004" }, isEpic: false, globalId: 1007, epicId: null,
  });
  assert.equal(gitlabIssue({ ...raw, labels: ["bug"] }, { board, columns: board.columns }).status, "open");
  assert.equal(gitlabIssue({ ...raw, state: "closed" }, { board, columns: board.columns }).status, "closed");
  assert.equal(gitlabIssue({ ...raw, labels: ["status:review"] }, { columns: COLUMNS }).status, "review", "no board: the status label");
  const inEpic = gitlabIssue({ ...raw, epic: { id: 9001, iid: 2 } }, { board, columns: board.columns, hasEpics: true });
  assert.deepEqual([inEpic.parent, inEpic.epicId], [{ number: 2, isEpic: true }, 9001]);
  assert.deepEqual(gitlabIssue({ ...raw, epic: { id: 9001, iid: 2 } }, { board, columns: board.columns }).parent, { label: "0004" }, "a project whose group has no epics reads the label");
  const epic = gitlabIssue({ id: 9001, iid: 2, title: "E", web_url: "https://gitlab.com/groups/g/-/epics/2", state: "opened", labels: [], milestone: { title: "x" } }, { board, columns: board.columns, hasEpics: true });
  assert.deepEqual([epic.isEpic, epic.status, epic.milestone, epic.parent], [true, null, null, null]);
  assert.equal(gitlabIssue({ title: "no iid" }, { columns: COLUMNS }), null);
});

test("GitLab: the fields an issue is written with carry the list's label, the milestone and the epic, and clear what the card dropped", () => {
  const board = gitlabBoard([{ lists: [{ position: 0, label: { name: "Doing" } }] }]);
  const c = full("0007", { title: "T", body: "b", labels: ["bug"], status: "doing" });
  const inEpic = { sprint: { id: "s1" }, epic: { id: "0004", remote: { number: 2, isEpic: true } } };
  assert.deepEqual(gitlabFields(c, inEpic, undefined, { board, epicId: 9001, milestoneId: 77 }), { title: "T", description: "b", labels: "bug,Doing", milestone_id: "77", epic_id: "9001" });
  assert.deepEqual(gitlabFields(c, inEpic, undefined, { board, epicId: null, milestoneId: null }), { title: "T", description: "b", labels: "bug,Doing,epic:0004" });
  assert.deepEqual(gitlabFields({ ...c, status: "open" }, { sprint: null, epic: null }, undefined, { board }), { title: "T", description: "b", labels: "bug" });
  assert.deepEqual(gitlabFields(c, { sprint: null, epic: null }, undefined, {}), { title: "T", description: "b", labels: "bug,status:doing" });
  const was = issue(7, { milestone: "Polish", parent: { number: 2, isEpic: true } });
  assert.deepEqual(gitlabFields(c, { sprint: null, epic: null }, was, { board }), { title: "T", description: "b", labels: "bug,Doing", milestone_id: "0", epic_id: "0" });
});
