// The card-sync hook, run the way a host runs it: a real repo with a child
// worktree, the hook spawned with one payload on stdin and its ledger in a
// temp dir of its own. The rules themselves are covered by the sync suite;
// this is the wiring a refactor could break, and what must reach the model.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const HOOK = path.join(REPO, "plugins", "agent-works", "hooks", "card-sync.mjs");
const AW = path.join(REPO, "plugins", "agent-works", "scripts", "aw.mjs");
const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function repoWithWorktree(t, { answer = "on" } = {}) {
  const main = tempRepo(t, "aw-card-sync-");
  if (answer) main.git("config", "--local", "agentic-engineering.plugins", `${answer} Test 2026-01-01T00:00Z`);
  write(main.dir, "README.md", "fixture\n");
  write(main.dir, ".gitignore", ".claude/\n");
  main.git("add", "-A");
  main.git("commit", "-m", "fixture");
  const worktree = path.join(main.dir, ".claude", "worktrees", "child");
  main.git("worktree", "add", "-b", "feat/child", worktree);
  return { main: main.dir, git: main.git, worktree, kanban: path.join(main.dir, ".agents", "kanban"), tmp: tempDir(t, "aw-card-sync-ledger-") };
}

function card(kanban, id, title, fields = "") {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  write(kanban, `${id}-${slug}.md`, `---\nid: ${id}\ntitle: ${title}\n${fields}created: ${HOUR_AGO}\nupdated: ${HOUR_AGO}\n---\n\n## Done when\n- it works\n\n## Notes\n`);
}

/** Run the hook as a host does; null for no output. */
function hook(r, payload, { cwd = r.worktree } = {}) {
  const out = runNode(HOOK, [], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: r.main, TMPDIR: r.tmp }, input: typeof payload === "string" ? payload : JSON.stringify(payload) });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  return out.stdout.trim() ? JSON.parse(out.stdout) : null;
}
const bash = (r, command, stdout = "", extra = {}) => ({
  hook_event_name: "PostToolUse", session_id: "s1", cwd: r.worktree, tool_name: "Bash", tool_input: { command }, tool_response: { stdout, stderr: "" }, ...extra,
});
const stop = (r, extra = {}) => ({ hook_event_name: "Stop", session_id: "s1", cwd: r.worktree, stop_hook_active: false, ...extra });
const board = (cwd, ...args) => runNode(AW, ["board", ...args], { cwd });
const context = (out) => out?.hookSpecificOutput?.additionalContext;
const IN_PROGRESS = "status: in-progress\norder: 1\nbranch: feat/child\n";

test("agent-works card-sync: a merge request opened with glab on a card's branch is told to the model at once, and only once", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  const created = bash(r, "glab mr create --fill --remove-source-branch", "https://gitlab.example/g/p/-/merge_requests/12\n");
  const out = hook(r, created);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(context(out), /^Card 0007 "Sync the cards" is in in-progress, and .*12 opened: move it now, node ".*aw\.mjs" board move 0007 review --mr 12$/);
  assert.equal(hook(r, created), null, "the same move is not told twice");
  assert.deepEqual(fs.readdirSync(r.tmp), ["agent-works-cards-s1.json"], "the ledger lives in the temp dir");
});

test("agent-works card-sync: a pull request opened with gh is seen the same way", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  const said = context(hook(r, bash(r, 'gh pr create --title "feat: sync" --body x', "https://github.com/someone/thing/pull/31\n")));
  assert.match(said, /node ".*aw\.mjs" board move 0007 review --mr 31$/);
});

test("agent-works card-sync: a merge with either forge's CLI owes the card its done", (t) => {
  const sha = "f".repeat(40);
  for (const [command, stdout] of [
    ["gh pr merge 12 --merge", `Merged pull request #12\n{"sha":"${sha}"}`],
    ["glab mr merge 12 --yes", `!12 merged at ${sha}\n`],
  ]) {
    const r = repoWithWorktree(t);
    card(r.kanban, "0007", "Sync the cards", "status: review\norder: 1\nbranch: feat/child\nmr: 12\n");
    // Run from the main checkout: the card is found by the number it carries, not by the branch.
    const out = hook(r, bash(r, command, stdout, { cwd: r.main }), { cwd: r.main });
    assert.match(context(out), new RegExp(`move it now, node ".*aw\\.mjs" board done 0007 --merged ${sha}$`), command);
  }
});

test("agent-works card-sync: a stop is held for the move it is owed, once, and is quiet after the move", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  hook(r, bash(r, "glab mr create --fill", "https://g.example/p/-/merge_requests/12"));
  assert.equal(hook(r, stop(r, { stop_hook_active: true })), null, "never re-enters its own continuation");
  const held = hook(r, stop(r));
  assert.equal(held.decision, "block");
  assert.match(held.reason, /^Before you stop, check the cards this session worked on:\n- 0007 "Sync the cards" is in in-progress, and .*12 opened\. node ".*aw\.mjs" board move 0007 review --mr 12/);
  const moved = board(r.worktree, "move", "0007", "review", "--mr", "12");
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(hook(r, stop(r)), null);
});

test("agent-works card-sync: plain work is asked about at a stop, and a later stop within the window is not held", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  const nudge = context(hook(r, { hook_event_name: "PostToolUse", session_id: "s1", cwd: r.worktree, tool_name: "Edit", tool_input: { file_path: path.join(r.worktree, "a.mjs") } }));
  assert.match(nudge, /has said in-progress for 60 min while this session kept working on it \(an edit\)/, "the card is an hour old, so the timer is due");
  assert.match(hook(r, stop(r)).reason, /0007 "Sync the cards" is in in-progress, after an edit since it last changed\./);
  hook(r, bash(r, 'git commit -m "feat: more"', "[feat/child abc1234] feat: more"));
  assert.equal(hook(r, stop(r)), null);
});

test("agent-works card-sync: a CARD line the board does not show holds the stop, with no ledger at all", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  const held = hook(r, stop(r, { last_assistant_message: "CARD 0007 review !12 lanes=unit:pass owed=-\n\nDone." }));
  assert.match(held.reason, /your CARD line says review !12, and the board has it in in-progress/);
});

test("agent-works card-sync: a subagent is asked about its own commit, not another agent's", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  hook(r, bash(r, 'git commit -m "feat: x"', "[feat/child abc1234] feat: x", { agent_id: "agent-a", agent_type: "general-purpose" }));
  const sub = (agent) => ({ hook_event_name: "SubagentStop", session_id: "s1", cwd: r.worktree, agent_id: agent, agent_type: "general-purpose", stop_hook_active: false });
  assert.equal(hook(r, sub("agent-b")), null);
  const held = hook(r, sub("agent-a"));
  assert.equal(held.decision, "block");
  assert.match(held.reason, /^Before you finish: your work touched cards the board tracks\.\n- 0007 "Sync the cards" is in in-progress, after a commit since it last changed\./);
});

test("agent-works card-sync: a board command and a pane tool are recorded, and neither is answered", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0009", "Loose", "status: backlog\norder: 1\n");
  assert.equal(hook(r, bash(r, `node "${AW}" board move 0009 in-progress`, "moved")), null);
  assert.equal(hook(r, { hook_event_name: "PostToolUse", session_id: "s1", cwd: r.worktree, tool_name: "mcp__agent-works__move_task", tool_input: { id: "0009", status: "in-progress" }, tool_response: "ok" }), null);
  const ledger = JSON.parse(fs.readFileSync(path.join(r.tmp, "agent-works-cards-s1.json"), "utf8"));
  assert.deepEqual(ledger.events.map((e) => [e.kind, e.verb, e.ids, e.column]), [["board", "move", ["0009"], "in-progress"], ["board", "move", ["0009"], "in-progress"]]);
  assert.equal(ledger.focus, "0009", "a card this session moved into progress is the one it works");
});

test("agent-works card-sync: silent with no board, for a call that touches no card, and for a card it cannot bind", (t) => {
  const r = repoWithWorktree(t);
  assert.equal(hook(r, bash(r, "glab mr create --fill", "https://g.example/p/-/merge_requests/1")), null);
  card(r.kanban, "0007", "Elsewhere", "status: in-progress\norder: 1\nbranch: feat/other\n");
  assert.equal(hook(r, bash(r, "npm test", "ok")), null);
  assert.equal(hook(r, bash(r, "glab mr create --fill", "https://g.example/p/-/merge_requests/1")), null, "no card on this branch");
  assert.equal(hook(r, stop(r)), null);
  assert.deepEqual(fs.readdirSync(r.tmp), [], "nothing recorded, nothing written");
});

test("agent-works card-sync: where the plugins are off, or nobody answered, it says and records nothing", (t) => {
  for (const answer of ["off", null]) {
    const r = repoWithWorktree(t, { answer });
    card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
    assert.equal(hook(r, bash(r, "gh pr create --fill", "https://github.com/someone/thing/pull/3")), null);
    assert.equal(hook(r, stop(r, { last_assistant_message: "CARD 0007 review !3 lanes=- owed=-" })), null);
    assert.deepEqual(fs.readdirSync(r.tmp), []);
  }
});

test("agent-works card-sync: a committed config turns it on without an answer", (t) => {
  const r = repoWithWorktree(t, { answer: null });
  write(r.main, ".agents/agent-works.json", "{}\n");
  write(r.worktree, ".agents/agent-works.json", "{}\n");
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  assert.match(context(hook(r, bash(r, "gh pr create --fill", "https://github.com/someone/thing/pull/3"))), /board move 0007 review --mr 3$/);
});

test("agent-works card-sync: empty, malformed and foreign payloads end in silence", (t) => {
  const r = repoWithWorktree(t);
  card(r.kanban, "0007", "Sync the cards", IN_PROGRESS);
  for (const payload of ["", "{\"hook_event_name\": \"Stop\",", "[]", "null", { hook_event_name: "PreToolUse", cwd: r.worktree }, { cwd: r.worktree }]) {
    assert.equal(hook(r, payload), null, JSON.stringify(payload));
  }
});

test("agent-works card-sync: the hook reads its own location, never a plugin root variable", () => {
  assert.doesNotMatch(fs.readFileSync(HOOK, "utf8"), /CLAUDE_PLUGIN_ROOT/);
});
