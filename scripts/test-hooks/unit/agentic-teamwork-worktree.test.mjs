// Every agentic-teamwork hook judges the work tree the session is in. A
// worktree session hands its hooks CLAUDE_PROJECT_DIR set to the checkout the
// app started from, while the session itself works in a worktree nested under
// that checkout's .claude/worktrees/. A hook that trusted the project dir
// would read the main checkout's branch and untracked files for work
// happening in the worktree, and refuse a worktree's commit as a commit to main.
import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const HOOKS = path.join(REPO, "plugins", "agentic-teamwork", "hooks");
const suite = { after };
const HOME = tempDir(suite, "tw-worktree-home-");
const TMP = tempDir(suite, "tw-worktree-tmp-");
write(HOME, ".claude/settings.json", "{}\n");

const COUPLED = [{ files: ["api/schema.json", "web/types.ts"], message: "One API." }];
const MANIFEST = { standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", lanes: { unit: "npm test" }, owned: {}, teamwork: { coupledFiles: COUPLED } };

/** A main checkout on main, and a worktree on feat/x where the app puts one. */
function checkoutWithWorktree(t) {
  const main = tempRepo(t, "tw-worktree-");
  write(main.dir, ".agents/manifest.json", JSON.stringify(MANIFEST, null, 2));
  write(main.dir, ".gitignore", ".claude/worktrees/\n");
  write(main.dir, "README.md", "# fixture\n");
  main.git("add", "-A");
  main.git("commit", "-q", "-m", "first");
  const worktree = path.join(main.dir, ".claude", "worktrees", "feat-x");
  main.git("worktree", "add", "-q", "-b", "feat/x", worktree);
  return { main: main.dir, git: main.git, worktree };
}

let sessions = 0;
/** Run a hook the way a worktree session does: the cwd in the payload, the main checkout in the environment. */
function hook(script, payload, { main, cwd = main }) {
  const result = runNode(path.join(HOOKS, script), [], {
    cwd,
    env: { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CLAUDE_PROJECT_DIR: main, CLAUDE_PLUGIN_DATA: "", TMPDIR: TMP },
    input: JSON.stringify({ session_id: `worktree-${process.pid}-${sessions += 1}`, ...payload }),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

const bash = (command, cwd) => ({ hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command } });

test("session start briefs the worktree's branch, not the main checkout's", (t) => {
  const { main, worktree } = checkoutWithWorktree(t);
  const context = hook("session-start.mjs", { hook_event_name: "SessionStart", source: "startup", cwd: worktree }, { main }).hookSpecificOutput.additionalContext;
  assert.match(context, /Branch: feat\/x\./);
  assert.doesNotMatch(context, /You are on main/);
  const inMain = hook("session-start.mjs", { hook_event_name: "SessionStart", source: "startup", cwd: main }, { main }).hookSpecificOutput.additionalContext;
  assert.match(inMain, /You are on main/);
});

test("the guard lets a worktree commit on its own branch, from the worktree or a folder inside it", (t) => {
  const { main, worktree } = checkoutWithWorktree(t);
  write(worktree, "src/a.mjs", "export const a = 1;\n");
  assert.equal(hook("git-guard.mjs", bash("git add src/a.mjs && git commit -m a", worktree), { main }), null);
  assert.equal(hook("git-guard.mjs", bash("git add a.mjs && git commit -m a", path.join(worktree, "src")), { main }), null);
});

test("the guard still refuses a commit in the main checkout on main", (t) => {
  const { main, worktree } = checkoutWithWorktree(t);
  const out = hook("git-guard.mjs", bash("git commit -m a", main), { main });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Committing to main/);
  const fromWorktree = hook("git-guard.mjs", bash(`cd ${main} && git commit -m a`, worktree), { main });
  assert.equal(fromWorktree.hookSpecificOutput.permissionDecision, "deny", "a cd back into the main checkout is judged there");
});

test("the guard reads a worktree branch's push grant from the shared config", (t) => {
  const { main, git, worktree } = checkoutWithWorktree(t);
  git("remote", "add", "origin", "https://github.com/someone/x.git");
  git("config", "branch.feat/x.agentic-engineering-push", "Pat 2026-10-28: push and open the request");
  const out = hook("git-guard.mjs", bash('git push -u origin "$(git branch --show-current)"', worktree), { main, cwd: worktree });
  assert.equal(out.hookSpecificOutput.permissionDecision, "allow", JSON.stringify(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Pat 2026-10-28/);
});

test("the stop gate reports the worktree's files, not the main checkout's", (t) => {
  const { main, worktree } = checkoutWithWorktree(t);
  write(main, "main-scratch.txt", "left in the main checkout\n");
  write(worktree, "wt-scratch.txt", "left in the worktree\n");
  const context = hook("stop-gate.mjs", { hook_event_name: "Stop", stop_hook_active: false, cwd: worktree }, { main }).hookSpecificOutput.additionalContext;
  assert.match(context, /wt-scratch\.txt/);
  assert.doesNotMatch(context, /main-scratch\.txt/);
});

test("the stop gate falls back to the project dir when the payload names no folder", (t) => {
  const { main } = checkoutWithWorktree(t);
  write(main, "main-scratch.txt", "left in the main checkout\n");
  const context = hook("stop-gate.mjs", { hook_event_name: "Stop", stop_hook_active: false }, { main, cwd: tempDir(t, "tw-worktree-elsewhere-") }).hookSpecificOutput.additionalContext;
  assert.match(context, /main-scratch\.txt/);
});

test("the edit check names paths relative to the worktree", (t) => {
  const { main, worktree } = checkoutWithWorktree(t);
  const file = write(worktree, "api/schema.json", "{}\n");
  const out = hook("edit-check.mjs", { hook_event_name: "PostToolUse", cwd: worktree, tool_input: { file_path: file, content: "{}\n" } }, { main });
  assert.match(out.hookSpecificOutput.additionalContext, /^api\/schema\.json is one of a group of files that change together \(also: web\/types\.ts\)/);
});
