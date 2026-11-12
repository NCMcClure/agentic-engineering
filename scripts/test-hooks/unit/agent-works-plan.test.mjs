// Plan issues on the board. The planning plugin keeps its backlog in issue
// files under .agents/plan/plan/ and owns every status change through one
// funnel, plan-status.mjs, so the board shows those issues read-only and a
// move runs the funnel in the card's worktree. The issues are read from the
// base branch on origin (else the local base), never a working tree: that is
// the merged truth, and a child's in-flight flip must not leak onto the board.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { boardConfig, listing, ready, summary } from "../../../plugins/agent-works/lib/board.mjs";
import { parseCard } from "../../../plugins/agent-works/lib/cards.mjs";
import { parseIssue, planCards } from "../../../plugins/agent-works/lib/plan.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const AW = path.join(REPO, "plugins", "agent-works", "scripts", "aw.mjs");
const FUNNEL = path.join(REPO, "plugins", "but-first-planning", "skills", "spec-init", "assets", "plan-status.mjs");
const P = ".agents/plan/plan";
const S1 = `${P}/01-foundations/01-skeleton`;
const S2 = `${P}/01-foundations/02-polish`;

const issue = (title, type, status, blockedBy = "- None - can start immediately") => `# ${title}

**Sprint**: [sprint](../sprint.md)
**Type**: ${type}
**Tracker**: <unassigned>
**Status**: ${status}

## Parent

[sprint](../sprint.md)

## What to build

Build ${title}.

## Acceptance criteria

- [ ] ${title} works
- [x] ${title} is specified

## Testing checkpoint

\`echo ok\`

## Blocked by

${blockedBy}
`;

const sprint = (title, rows) => `# ${title}

**Status**: not-started

## Issues

| Issue | Type | Title | Tracker | Status |
|-------|------|-------|---------|--------|
${rows.map(([n, type, t, file, status]) => `| ${n} | ${type} | [${t}](issues/${file}) | <unassigned> | ${status} |`).join("\n")}
`;

/** The plan tree as repo-relative path -> text: one sprint to build, one with every other status. */
const TREE = {
  ".agents/plan/tracker.md": "# Issue tracker: local\n",
  [`${P}/index.md`]: "# Plan\n\n## Epics\n\n| Epic | Title | Sprints | Status |\n|------|-------|---------|--------|\n| 01 | [Foundations](01-foundations/epic.md) | 2 | in-progress |\n",
  [`${P}/01-foundations/epic.md`]: "# Foundations\n\n**Status**: in-progress\n\n## Sprints\n\n| Sprint | Title | Issues | Status |\n|--------|-------|--------|--------|\n| 01 | [Skeleton](01-skeleton/sprint.md) | 4 | not-started |\n| 02 | [Polish](02-polish/sprint.md) | 3 | in-progress |\n",
  [`${S1}/sprint.md`]: sprint("Skeleton", [
    ["01", "AFK", "Setup", "01_issue_SETUP.md", "not-started"],
    ["02", "AFK", "Wiring", "02_issue_WIRING.md", "not-started"],
    ["03", "HITL", "Decide the layout", "03_issue_DECIDE-THE-LAYOUT.md", "not-started"],
    ["04", "REVIEW", "Skeleton is walked through", "04_issue_REVIEW-SKELETON.md", "not-started"],
  ]),
  [`${S1}/issues/01_issue_SETUP.md`]: issue("Setup", "AFK", "not-started"),
  [`${S1}/issues/02_issue_WIRING.md`]: issue("Wiring", "AFK", "not-started", "- [Setup](./01_issue_SETUP.md)"),
  [`${S1}/issues/03_issue_DECIDE-THE-LAYOUT.md`]: issue("Decide the layout", "HITL", "not-started"),
  [`${S1}/issues/04_issue_REVIEW-SKELETON.md`]: issue("Skeleton is walked through", "REVIEW", "not-started", "- [Wiring](./02_issue_WIRING.md)"),
  [`${S2}/sprint.md`]: sprint("Polish", [
    ["01", "AFK", "Stuck", "01_issue_STUCK.md", "blocked"],
    ["02", "AFK", "Shipped", "02_issue_SHIPPED.md", "done"],
    ["03", "AFK", "Moving", "03_issue_MOVING.md", "in-progress"],
  ]),
  [`${S2}/issues/01_issue_STUCK.md`]: issue("Stuck", "AFK", "blocked"),
  [`${S2}/issues/02_issue_SHIPPED.md`]: issue("Shipped", "AFK", "done"),
  [`${S2}/issues/03_issue_MOVING.md`]: issue("Moving", "AFK", "in-progress", "- [Shipped](../../02-polish/issues/02_issue_SHIPPED.md)"),
  ".agents/plan/progress/dispatch/01-01.json": `${JSON.stringify({
    sprint: "01-01",
    waves: [
      { n: 1, units: [{ coords: ["01-01-01"], type: "AFK", title: "Setup", files: ["lib/plan.mjs", "scripts/io.mjs"] }] },
      { n: 2, units: [{ coords: ["01-01-02"], type: "AFK", title: "Wiring", files: ["scripts/board.mjs"] }] },
    ],
  }, null, 2)}\n`,
};

const sources = (tree = TREE) => Object.entries(tree).map(([p, text]) => ({ path: p, text }));
const shadow = (text) => parseCard(`---\n${text}---\n`, "plan-x.md");
const byId = (cards) => Object.fromEntries(cards.map((c) => [c.id, c]));

/**
 * A repo whose main branch carries the plan tree and the real funnel, pushed
 * to a local bare origin, with a child worktree on its own branch.
 */
function planRepo(t, { remote = true, base = "main" } = {}) {
  const main = tempRepo(t, "board-plan-");
  if (base !== "main") main.git("symbolic-ref", "HEAD", `refs/heads/${base}`);
  for (const [rel, text] of Object.entries(TREE)) write(main.dir, rel, text);
  fs.copyFileSync(FUNNEL, path.join(main.dir, P, "plan-status.mjs"));
  write(main.dir, ".gitignore", ".claude/\n");
  if (base !== "main") write(main.dir, ".agents/manifest.json", `${JSON.stringify({ default_branch: base })}\n`);
  main.git("add", "-A");
  main.git("commit", "-q", "-m", "plan");
  if (remote) {
    const origin = tempDir(t, "board-plan-origin-");
    execFileSync("git", ["init", "-q", "--bare", origin]);
    main.git("remote", "add", "origin", origin);
    main.git("push", "-q", "-u", "origin", base);
  }
  const worktree = path.join(main.dir, ".claude", "worktrees", "child");
  main.git("worktree", "add", "-q", "-b", "feat/plan-setup", worktree);
  const kanban = path.join(fs.realpathSync(main.dir), ".agents", "kanban");
  return { main: main.dir, git: main.git, worktree, kanban };
}

const board = (cwd, ...args) => runNode(AW, ["board", ...args], { cwd, env: { ...process.env, CLAUDECODE: "", AW_AGENT: "", PL_AGENT: "", CLAUDE_AGENT_NAME: "" } });
// `list --json` answers a document with the cards in it; `ready --json` the cards themselves.
const listJson = (cwd, ...args) => {
  const out = board(cwd, ...args);
  assert.equal(out.status, 0, out.stderr);
  const doc = JSON.parse(out.stdout);
  return Array.isArray(doc) ? doc : doc.cards;
};
const issueStatus = (root, rel) => /\*\*Status\*\*: (\S+)/.exec(fs.readFileSync(path.join(root, rel), "utf8"))[1];
const bind = (r, coords, fields) => write(r.kanban, `plan-${coords}.md`, `---\nplan: ${coords}\n${fields}---\n`);

// ---- the pure half ----------------------------------------------------

test("an issue file gives its coordinates, fields, blockers, and acceptance criteria", () => {
  const rel = `${S1}/issues/02_issue_WIRING.md`;
  const parsed = parseIssue(TREE[rel].replace(/\n/g, "\r\n"), rel);
  assert.deepEqual(parsed, {
    coords: "01-01-02", title: "Wiring", type: "AFK", status: "not-started", tracker: "<unassigned>",
    blockedBy: ["01-01-01"], acceptance: [{ done: false, text: "Wiring works" }, { done: true, text: "Wiring is specified" }], path: rel,
  });
  assert.deepEqual(parseIssue(TREE[`${S2}/issues/03_issue_MOVING.md`], `${S2}/issues/03_issue_MOVING.md`).blockedBy, ["01-02-02"], "a link up and back down resolves");
  assert.equal(parseIssue("# x\n", `${P}/01-a/01-b/sprint.md`), null, "only issue files are issues");
});

test("lanes follow the plan status and the shadow's loop fields", () => {
  const shadows = {
    "01-01-01": shadow("plan: 01-01-01\nsession: card-0003\n"),
    "01-01-02": shadow("plan: 01-01-02\nsession: card-0004\nmr: 12\n"),
  };
  const { cards, errors } = planCards(sources(), { shadows, columns: boardConfig().columns });
  assert.deepEqual(errors, []);
  const lanes = Object.fromEntries(cards.map((c) => [c.id, c.status]));
  assert.deepEqual(lanes, {
    "01-01-01": "in-progress", // not started on the base, but a session holds it
    "01-01-02": "review", // a change request is open
    "01-01-03": "backlog",
    "01-01-04": "backlog",
    "01-02-01": "backlog", // blocked stays in the backlog, with a badge
    "01-02-02": "done",
    "01-02-03": "in-progress", // in-progress on the base itself
  });
  const c = byId(cards);
  assert.equal(c["01-02-01"].blocked, true);
  assert.equal(c["01-01-01"].session, "card-0003");
  assert.equal(c["01-01-02"].mr, 12);
  assert.ok(cards.every((x) => x.source === "plan" && x.plan === x.id));
});

test("Blocked by holds a card back, HITL needs the person, and REVIEW is a gate owed once its blockers are done", () => {
  const config = boardConfig();
  const base = planCards(sources(), { columns: config.columns }).cards;
  const b = { ...config, cards: base };
  assert.deepEqual(ready(b).map((c) => c.id), ["01-01-01"], "02 waits on 01; HITL, the gate, blocked, and in-flight issues are not ready");

  const c = byId(base);
  assert.equal(c["01-01-03"].needs, "the person");
  assert.equal(c["01-01-04"].kind, "gate");
  assert.equal(c["01-01-04"].needs, "the person");
  assert.equal(c["01-01-04"].ref, `${S1}/issues/04_issue_REVIEW-SKELETON.md`);
  assert.deepEqual(listing(b, "gates"), [], "the walkthrough is not owed while what it reviews is unbuilt");
  assert.equal(summary(b).owed, 0);

  const done = { ...TREE };
  for (const f of ["01_issue_SETUP.md", "02_issue_WIRING.md"]) done[`${S1}/issues/${f}`] = done[`${S1}/issues/${f}`].replace("**Status**: not-started", "**Status**: done");
  const after = { ...config, cards: planCards(sources(done), { columns: config.columns }).cards };
  assert.deepEqual(listing(after, "gates").map((x) => x.id), ["01-01-04"]);
  assert.equal(summary(after).owed, 1);
  assert.deepEqual(ready(after).map((x) => x.id), [], "the HITL issue still needs the person");
});

test("dispatch files are picked up, and a broken dispatch file is an error rather than a crash", () => {
  const { cards } = planCards(sources(), { columns: boardConfig().columns });
  const c = byId(cards);
  assert.deepEqual(c["01-01-01"].files, ["lib/plan.mjs", "scripts/io.mjs"]);
  assert.deepEqual(c["01-01-02"].files, ["scripts/board.mjs"]);
  assert.deepEqual(c["01-02-01"].files, []);
  const broken = planCards(sources({ ...TREE, ".agents/plan/progress/dispatch/01-02.json": "{" }), { columns: boardConfig().columns });
  assert.equal(broken.cards.length, 7);
  assert.deepEqual(broken.errors.map((e) => e.file), [".agents/plan/progress/dispatch/01-02.json"]);
});

// ---- through the CLI, against a real repo -----------------------------

test("status, list, show, and ready include plan cards, and list --scope plan shows them alone", (t) => {
  const r = planRepo(t);
  assert.equal(board(r.main, "add", "Loose card").status, 0);
  const all = listJson(r.main, "list", "--json").map((c) => c.id);
  assert.ok(all.includes("0001") && all.includes("01-01-01"), all.join(" "));
  const plan = listJson(r.main, "list", "--scope", "plan", "--json");
  assert.deepEqual(plan.map((c) => c.id), ["01-01-01", "01-01-02", "01-01-03", "01-01-04", "01-02-01", "01-02-03", "01-02-02"]);
  assert.deepEqual(listJson(r.main, "ready", "--json").map((c) => c.id), ["0001", "01-01-01"]);
  const status = board(r.main, "status");
  assert.match(status.stdout, /^ {2}01-02-01 \[backlog\] plan task: Stuck \(blocked\)$/m);
  assert.match(status.stdout, /^ {2}01-01-03 \[backlog\] plan task: Decide the layout \(needs the person\)$/m);
  const show = board(r.main, "show", "01-01-01");
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /^plan issue \.agents\/plan\/plan\/01-foundations\/01-skeleton\/issues\/01_issue_SETUP\.md, read from origin\/main$/m);
  assert.match(show.stdout, /^files: lib\/plan\.mjs, scripts\/io\.mjs$/m);
  assert.match(show.stdout, /^# Setup$/m);
  assert.match(board(r.main, "show", "01-01-02").stdout, /^blocked by: 01-01-01 \(backlog\)$/m);
});

test("the board reads the base branch on origin, never a working tree or an unpushed commit", (t) => {
  const r = planRepo(t);
  const readyIds = () => listJson(r.worktree, "ready", "--json").map((c) => c.id);
  assert.deepEqual(readyIds(), ["01-01-01"]);

  // The child flips Setup to done in its worktree and commits it on its branch.
  const flip = runNode(path.join(r.worktree, P, "plan-status.mjs"), ["set", "01-01-01", "done"], { cwd: r.worktree });
  assert.equal(flip.status, 0, flip.stderr);
  execFileSync("git", ["-C", r.worktree, "commit", "-q", "-am", "setup done"]);
  assert.deepEqual(readyIds(), ["01-01-01"], "a child's in-flight flip does not leak onto the board");

  // The same flip on main, committed but not pushed, is not merged truth yet.
  assert.equal(runNode(path.join(r.main, P, "plan-status.mjs"), ["set", "01-01-01", "done"], { cwd: r.main }).status, 0);
  assert.deepEqual(readyIds(), ["01-01-01"], "an uncommitted edit in the main checkout is not read");
  r.git("commit", "-q", "-am", "setup done");
  assert.deepEqual(readyIds(), ["01-01-01"], "a commit origin has not seen is not read");
  r.git("push", "-q", "origin", "main");
  assert.deepEqual(readyIds(), ["01-01-02"], "once origin has it, Setup is done and Wiring is ready");
});

test("with no remote, reading falls back to the local base, named by the manifest", (t) => {
  const r = planRepo(t, { remote: false, base: "trunk" });
  const show = board(r.main, "show", "01-01-01");
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /read from trunk$/m);
  assert.deepEqual(listJson(r.main, "ready", "--json").map((c) => c.id), ["01-01-01"]);
});

test("a bound move flips the issue file in the worktree only", (t) => {
  const r = planRepo(t);
  bind(r, "01-01-01", `session: card-0003\nbranch: feat/plan-setup\nworktree: ${r.worktree}\n`);
  const rel = `${S1}/issues/01_issue_SETUP.md`;
  const out = board(r.main, "move", "01-01-01", "in-progress");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^Card 01-01-01 is now in in-progress: /);
  assert.equal(issueStatus(r.worktree, rel), "in-progress", "the funnel ran in the worktree");
  assert.equal(issueStatus(r.main, rel), "not-started", "the main checkout is untouched");
  assert.equal(r.git("status", "--porcelain").trim(), "", "and so is everything git tracks there");
  assert.match(execFileSync("git", ["-C", r.worktree, "status", "--porcelain"], { encoding: "utf8" }), /01_issue_SETUP\.md/);
  const [card] = listJson(r.main, "list", "--scope", "plan", "--json").filter((c) => c.id === "01-01-01");
  assert.equal(card.planStatus, "not-started", "the board still reads the base");
  assert.equal(card.status, "in-progress");

  const review = board(r.main, "move", "01-01-01", "review", "--mr", "12");
  assert.equal(review.status, 0, review.stderr);
  assert.match(fs.readFileSync(path.join(r.kanban, "plan-01-01-01.md"), "utf8"), /^mr: 12$/m);
  assert.equal(issueStatus(r.worktree, rel), "in-progress", "review records the change request and leaves the issue to the child");
  assert.equal(listJson(r.main, "list", "--scope", "plan", "--json").find((c) => c.id === "01-01-01").status, "review");
  assert.equal(board(r.main, "move", "01-01-01", "review").status, 2, "review needs --mr");
});

test("a move to done is refused, and an unbound move asks for a dispatch", (t) => {
  const r = planRepo(t);
  const done = board(r.main, "move", "01-01-01", "done");
  assert.equal(done.status, 1);
  assert.match(done.stderr, /done when its pull or merge request merges/);
  const unbound = board(r.main, "move", "01-01-01", "in-progress");
  assert.equal(unbound.status, 1);
  assert.match(unbound.stderr, /dispatch it/);
  bind(r, "01-01-01", `worktree: ${r.worktree}\n`);
  assert.equal(board(r.main, "move", "01-01-01", "done").status, 1, "bound or not");
  assert.equal(issueStatus(r.worktree, `${S1}/issues/01_issue_SETUP.md`), "not-started");
  assert.equal(board(r.main, "move", "01-01-01", "nowhere").status, 2);
});

test("abandon sets the issue back to not-started in its worktree and unbinds the card", (t) => {
  const r = planRepo(t);
  bind(r, "01-01-01", `session: card-0003\nbranch: feat/plan-setup\nworktree: ${r.worktree}\n`);
  r.git("config", "branch.feat/plan-setup.agentic-engineering-push", "the person 2026-10-28: card 01-01-01");
  assert.equal(board(r.main, "move", "01-01-01", "in-progress").status, 0);
  const out = board(r.main, "abandon", "01-01-01");
  assert.equal(out.status, 0, out.stderr);
  assert.equal(issueStatus(r.worktree, `${S1}/issues/01_issue_SETUP.md`), "not-started");
  assert.ok(!fs.existsSync(path.join(r.kanban, "plan-01-01-01.md")), "nothing is left to shadow");
  assert.equal(listJson(r.main, "list", "--scope", "plan", "--json").find((c) => c.id === "01-01-01").status, "backlog");
  assert.throws(() => r.git("config", "--get", "branch.feat/plan-setup.agentic-engineering-push"), "the push grant goes with the binding");
  assert.equal(board(r.main, "abandon", "01-01-01").status, 1, "nothing left to abandon");
});

test("abandon returns a loose card to the backlog without its binding", (t) => {
  const r = planRepo(t);
  assert.equal(board(r.main, "add", "Loose").status, 0);
  assert.equal(board(r.main, "move", "0001", "review", "--mr", "4").status, 0);
  assert.equal(board(r.main, "abandon", "0001").status, 0);
  const text = fs.readFileSync(path.join(r.kanban, "0001-loose.md"), "utf8");
  assert.match(text, /^status: backlog$/m);
  assert.doesNotMatch(text, /^mr:/m);
  assert.equal(board(r.main, "move", "0001", "done").status, 0);
  assert.equal(board(r.main, "abandon", "0001").status, 1, "a finished card is not abandoned");
});

test("plan cards are never written as loose cards", (t) => {
  const r = planRepo(t);
  assert.equal(board(r.main, "epic", "Round").status, 0);
  assert.equal(board(r.main, "plan", "01-01-01", "--epic", "0001").status, 1);
  assert.equal(board(r.main, "settle", "01-01-04", "--evidence", "looked").status, 1);
  assert.equal(board(r.main, "add", "Setup").status, 1, "a title the plan already has is a duplicate");
  assert.equal(board(r.main, "add", "After setup", "--after", "01-01-01").status, 0, "a loose card may wait on a plan issue");
  assert.equal(board(r.main, "move", "0002", "backlog", "--mr", "3").status, 0, "renumbering the backlog skips plan cards");
  assert.equal(board(r.main, "lint", "--fix").status, 0);
  assert.deepEqual(fs.readdirSync(r.kanban).filter((f) => f.endsWith(".md")).sort(), ["0001-round.md", "0002-after-setup.md"]);
});

test("grant, claim, and done on a plan card: the funnel runs in the worktree, the shadow holds the binding, the grant comes and goes", (t) => {
  const r = planRepo(t);
  const rel = `${S1}/issues/01_issue_SETUP.md`;
  const grantKey = "branch.feat/plan-setup.agentic-engineering-push";
  const granted = board(r.main, "grant", "01-01-01", "--by", "Pat 2026-10-28T09:00Z", "--branch", "feat/plan-setup");
  assert.equal(granted.status, 0, granted.stderr);
  const brief = board(r.main, "brief", "01-01-01");
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /`\/but-first-planning:build-tdd`/);
  assert.match(brief.stdout, /- \[ \] Setup works/);

  const claimed = board(r.worktree, "claim", "01-01-01");
  assert.equal(claimed.status, 0, claimed.stderr);
  assert.equal(issueStatus(r.worktree, rel), "in-progress", "the funnel ran in the child's worktree");
  assert.equal(issueStatus(r.main, rel), "not-started", "and nowhere else");
  const shadowText = fs.readFileSync(path.join(r.kanban, "plan-01-01-01.md"), "utf8");
  assert.match(shadowText, /^branch: feat\/plan-setup$/m);
  assert.match(shadowText, /^grant: Pat 2026-10-28T09:00Z: push feat\/plan-setup and open the pull or merge request \(card 01-01-01\)$/m);
  assert.equal(r.git("config", "--get", grantKey).trim(), "Pat 2026-10-28T09:00Z: push feat/plan-setup and open the pull or merge request (card 01-01-01)");
  assert.equal(listJson(r.main, "list", "--scope", "plan", "--json").find((c) => c.id === "01-01-01").status, "in-progress");

  const done = board(r.main, "done", "01-01-01", "--merged", "0123456789abcdef0123456789abcdef01234567");
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /01-01-01 is still not-started on origin\/main: fetch origin/);
  assert.throws(() => r.git("config", "--get", grantKey), "the grant is revoked");
  assert.match(fs.readFileSync(path.join(r.kanban, "plan-01-01-01.md"), "utf8"), /^merged: 0123456789abcdef0123456789abcdef01234567$/m);
});
