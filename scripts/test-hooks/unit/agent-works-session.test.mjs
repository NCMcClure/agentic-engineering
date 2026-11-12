// The session hook's briefing: how an orchestrator gets its round back after a
// restart or a compaction, how a child learns which card it is working, and
// what a repo set up for agent work gets at the start of every session (its
// CLAUDE.md twins healed, the session registered). It runs on every session
// start, so it says a few lines or nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const HOOK = path.join(REPO, "plugins", "agent-works", "hooks", "session-start.mjs");
const AW = path.join(REPO, "plugins", "agent-works", "scripts", "aw.mjs");
const CONFIG = ".agents/agent-works.json";
const STAMP = new Date().toISOString();
const SETTLED = { version: 1, claude: { twins: "link" }, guard: { locks: "warn" } };

function repoWithWorktree(t, { answer = "on", config = null } = {}) {
  const main = tempRepo(t, "aw-session-");
  // Answered, so what the hook says does not depend on the machine's own settings.
  if (answer) main.git("config", "--local", "agentic-engineering.plugins", `${answer} Test 2026-01-01T00:00Z`);
  write(main.dir, "README.md", "fixture\n");
  write(main.dir, ".gitignore", ".claude/\n");
  if (config) write(main.dir, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  main.git("add", "-A");
  main.git("commit", "-m", "fixture");
  const worktree = path.join(main.dir, ".claude", "worktrees", "child");
  main.git("worktree", "add", "-b", "feat/child", worktree);
  const home = tempDir(t, "aw-session-home-");
  return { main: main.dir, git: main.git, worktree, kanban: path.join(main.dir, ".agents", "kanban"), home, store: path.join(home, "store") };
}

/** A card file as the board leaves it: the fields it sets are written by hand here. */
function card(kanban, id, title, fields = "", body = "") {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  write(kanban, `${id}-${slug}.md`, `---\nid: ${id}\ntitle: ${title}\n${fields}created: ${STAMP}\nupdated: ${STAMP}\n---\n${body}`);
}

/** Run the hook as a host does, with a home and a store of its own; null for no output. */
function hook(r, payload, { cwd = r.main, env = {} } = {}) {
  const out = runNode(HOOK, [], {
    cwd,
    env: { ...process.env, HOME: r.home, USERPROFILE: r.home, CLAUDE_CONFIG_DIR: path.join(r.home, ".claude"), CLAUDE_PLUGIN_DATA: "", AW_HOME: r.store, AW_AGENT: "", CLAUDE_PROJECT_DIR: "", ...env },
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  return out.stdout.trim() ? JSON.parse(out.stdout) : null;
}
const context = (out) => out?.hookSpecificOutput?.additionalContext ?? "";
/** What the hook says of its own, before the critical lines. */
const briefing = (out) => context(out).split("Critical, from agent-works:")[0].trim();
const start = (cwd, extra = {}) => ({ hook_event_name: "SessionStart", source: "startup", session_id: "s", cwd, ...extra });

test("agent-works session: no board, no word about one", (t) => {
  const r = repoWithWorktree(t);
  assert.equal(briefing(hook(r, start(r.main))), "");
  assert.equal(briefing(hook(r, start(r.worktree), { cwd: r.worktree })), "");
  assert.match(context(hook(r, start(r.main))), /^Critical, from agent-works:/);
});

test("agent-works session: a board folder that holds no cards says nothing", (t) => {
  const r = repoWithWorktree(t);
  write(r.kanban, "board.json", '{"sprints":[]}\n');
  assert.equal(briefing(hook(r, start(r.main))), "");
});

test("agent-works session: the main checkout gets the board in one line", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0001", "Cards", "status: in-progress\norder: 1\nsession: card-0001\nmr: 12\n");
  card(r.kanban, "0002", "CLI", "status: backlog\norder: 1\n");
  card(r.kanban, "0003", "Live lane", "status: backlog\norder: 2\nkind: gate\nneeds: the person\nref: !12\n");
  const out = hook(r, start(r.main));
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(briefing(out), "Board: 1 in progress (0001 card-0001 !12), 0 in review, 1 ready, 1 gate owed. The board is the record: /agent-works:orchestrate resumes it.");
});

test("agent-works session: the board line is the one `aw board status --brief` prints", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0001", "Cards", "status: review\norder: 1\nmr: 7\n");
  const brief = runNode(AW, ["board", "status", "--brief"], { cwd: r.main }).stdout.trim();
  assert.match(brief, /^Board: /);
  assert.ok(briefing(hook(r, start(r.main))).startsWith(brief));
});

test("agent-works session: a worktree whose branch a card names is told which card it is working, and what done means", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Claim the push grant", "status: in-progress\norder: 1\nbranch: feat/child\n", "\n## Done when\n- the grant is in git config\n- [ ] a second claim is refused\n\n## Notes\n");
  // A worktree session is handed the main checkout as its project dir; the payload's cwd is what counts.
  const out = hook(r, start(r.worktree), { cwd: r.main, env: { CLAUDE_PROJECT_DIR: r.main } });
  assert.equal(briefing(out), `You are working card 0007 "Claim the push grant". Done when: the grant is in git config; a second claim is refused. `
    + `Its brief: node "${AW}" board brief 0007. Cadence: /agent-works:work-card; end your final message with the CARD line.`);
});

test("agent-works session: a card written before `## Done when` is read by its old heading, and one without criteria is still named", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Old card", "status: in-progress\norder: 1\nbranch: feat/child\n", "\n## Done looks like\n\nThe suite passes.\n");
  assert.match(briefing(hook(r, start(r.worktree), { cwd: r.worktree })), /^You are working card 0007 "Old card"\. Done when: The suite passes\.\. Its brief: /);
  card(r.kanban, "0007", "Old card", "status: in-progress\norder: 1\nbranch: feat/child\n");
  assert.match(briefing(hook(r, start(r.worktree), { cwd: r.worktree })), /^You are working card 0007 "Old card"\. Its brief: /);
});

test("agent-works session: a worktree no card names gets the board, like the main checkout", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Elsewhere", "status: in-progress\norder: 1\nbranch: feat/other\n");
  assert.match(briefing(hook(r, start(r.worktree), { cwd: r.worktree })), /^Board: 1 in progress \(0007\)/);
});

test("agent-works session: a finished card on the branch no longer binds it", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Shipped", "status: done\norder: 1\nbranch: feat/child\n");
  card(r.kanban, "0008", "Next", "status: backlog\norder: 1\n");
  assert.match(briefing(hook(r, start(r.worktree), { cwd: r.worktree })), /^Board: /);
});

test("agent-works session: with no cwd in the payload, or no payload at all, it briefs from the project dir", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0001", "Cards", "status: backlog\norder: 1\n");
  const elsewhere = fs.realpathSync.native(r.home);
  for (const payload of [{ hook_event_name: "SessionStart" }, "", "{\"hook_event_name\":"]) {
    assert.match(briefing(hook(r, payload, { cwd: elsewhere, env: { CLAUDE_PROJECT_DIR: r.main } })), /^Board: /, JSON.stringify(payload));
  }
});

test("agent-works session: a subagent gets the lines for every agent and no briefing", (t) => {
  const r = repoWithWorktree(t, { config: SETTLED });
  card(r.kanban, "0001", "Cards", "status: backlog\norder: 1\n");
  const text = context(hook(r, { hook_event_name: "SubagentStart", agent_type: "general-purpose", session_id: "s", cwd: r.main }));
  assert.match(text, /^Critical, from agent-works:/);
  assert.match(text, /\/agent-works:resource-locks/);
  assert.match(text, /Hubs: a directory with an AGENTS\.md/);
  assert.doesNotMatch(text, /Board:|orchestrate/);
  assert.equal(hook(r, { hook_event_name: "SubagentStart", agent_type: "Explore", session_id: "s", cwd: r.main }), null);
  assert.ok(!fs.existsSync(r.store), "a subagent is not registered as a session");
});

test("agent-works session: where the person turned the plugins off it says nothing and touches nothing", (t) => {
  const r = repoWithWorktree(t, { answer: "off" });
  card(r.kanban, "0001", "Cards", "status: backlog\norder: 1\n");
  assert.equal(hook(r, start(r.main)), null);
  assert.ok(!fs.existsSync(r.store));
});

test("agent-works session: the hub line is for a repo set up for agent work", (t) => {
  const bare = repoWithWorktree(t);
  assert.doesNotMatch(context(hook(bare, start(bare.main))), /Hubs:/);
  const set = repoWithWorktree(t, { config: SETTLED });
  assert.match(context(hook(set, start(set.main))), /- Hubs: a directory with an AGENTS\.md holds no source files/);
});

test("agent-works session: generated twins are healed, and a session that started without the root one is told to read AGENTS.md", (t) => {
  const r = repoWithWorktree(t, { config: { ...SETTLED, claude: { twins: "generated" } } });
  write(r.main, "AGENTS.md", "# fixture\n");
  write(r.main, "src/AGENTS.md", "# src\n");
  const first = briefing(hook(r, start(r.main)));
  assert.match(first, /^This checkout had no CLAUDE\.md, so the project's guidance was not loaded: read AGENTS\.md at the repository root now/);
  assert.equal(fs.readFileSync(path.join(r.main, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(fs.readFileSync(path.join(r.main, "src", "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
  assert.equal(briefing(hook(r, start(r.main))), "", "the second session loaded it by itself");
});

test("agent-works session: twins of any other form are left to `aw twins`", (t) => {
  for (const twins of ["link", "committed", "off"]) {
    const r = repoWithWorktree(t, { config: { ...SETTLED, claude: { twins } } });
    write(r.main, "AGENTS.md", "# fixture\n");
    assert.equal(briefing(hook(r, start(r.main))), "", twins);
    assert.ok(!fs.existsSync(path.join(r.main, "CLAUDE.md")), twins);
  }
});

test("agent-works session: a repo with the config registers the session as running; one without it leaves the store alone", (t) => {
  const r = repoWithWorktree(t, { config: SETTLED });
  hook(r, start(r.main, { session_id: "session-one" }));
  const rows = fs.readFileSync(path.join(r.store, "agents.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session, "session-one");
  assert.equal(fs.realpathSync.native(rows[0].root), fs.realpathSync.native(r.main));
  hook(r, start(r.main, { session_id: "session-one" }));
  assert.equal(fs.readFileSync(path.join(r.store, "agents.jsonl"), "utf8").trim().split("\n").length, 1, "the same session is one entry");

  const bare = repoWithWorktree(t);
  card(bare.kanban, "0001", "Cards", "status: backlog\norder: 1\n");
  hook(bare, start(bare.main));
  assert.ok(!fs.existsSync(bare.store));
});

test("agent-works session: a store that cannot be written costs the session nothing", (t) => {
  const r = repoWithWorktree(t, { config: SETTLED });
  card(r.kanban, "0001", "Cards", "status: backlog\norder: 1\n");
  const blocked = write(r.home, "not-a-folder", "x");
  assert.match(briefing(hook(r, start(r.main), { env: { AW_HOME: blocked } })), /^Board: /);
});

test("agent-works session: the briefing stays a few lines however full the board is", (t) => {
  const r = repoWithWorktree(t, { config: { ...SETTLED, claude: { twins: "generated" } } });
  write(r.worktree, "AGENTS.md", "# fixture\n");
  for (let i = 1; i <= 40; i++) card(r.kanban, String(i).padStart(4, "0"), `Card number ${i}`, `status: in-progress\norder: ${i}\nsession: card-session-${i}\nmr: ${1000 + i}\n`);
  const boardLine = briefing(hook(r, start(r.main)));
  assert.match(boardLine, /^Board: 40 in progress \(0001 card-session-1 !1001; .*\.\.\. The board is the record/);
  assert.ok(boardLine.length <= 302, `${boardLine.length} characters`);

  const long = "a criterion that goes on and on ".repeat(20);
  card(r.kanban, "0041", `A title ${"so long ".repeat(20)}`, "status: in-progress\norder: 41\nbranch: feat/child\n", `\n## Done when\n- ${long}\n`);
  // The worst case: a fresh worktree of a card, so the twin was just written too.
  const worst = briefing(hook(r, start(r.worktree), { cwd: r.worktree }));
  assert.match(worst, /^This checkout had no CLAUDE\.md.* You are working card 0041 "A title so long .*\.\.\."\. Done when: a criterion .*\.\.\.\. Its brief: /);
  assert.ok(worst.length - AW.length <= 500, `${worst.length - AW.length} characters besides the plugin's own path`);
});

test("agent-works session: the hook reads its own location, never a plugin root variable", () => {
  assert.doesNotMatch(fs.readFileSync(HOOK, "utf8"), /CLAUDE_PLUGIN_ROOT/);
});

test("agent-works session: alone in a repo nobody answered for, it asks the question and says nothing else", (t) => {
  const r = repoWithWorktree(t, { answer: null });
  card(r.kanban, "0001", "Cards", "status: backlog\norder: 1\n");
  const text = context(hook(r, start(r.main)));
  assert.match(text, /ask the person once whether to use the agentic-engineering plugins/);
  assert.doesNotMatch(text, /Board:|Critical/);
});
