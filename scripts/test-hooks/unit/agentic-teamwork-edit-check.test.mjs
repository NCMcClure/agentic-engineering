// agentic-teamwork's edit-check.mjs: lint feedback and the coupled-files
// reminder, both opt-in through the manifest's `teamwork` block, both handed
// to the model as PostToolUse additionalContext and never as a block.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const HOOK = path.join(REPO, "plugins", "agentic-teamwork", "hooks", "edit-check.mjs");
const suite = { after };
const HOME = tempDir(suite, "tw-edit-home-");

const MANIFEST = { standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", lanes: { unit: "npm test" }, owned: {} };
// A linter any shell can run: it fails a file that contains the word BAD.
const LINTER = "tools/lint.cjs";
const LINTER_SOURCE = "const text = require('fs').readFileSync(process.argv[2], 'utf8');\nif (text.includes('BAD')) { console.log(process.argv[2] + ': line 1: BAD is not allowed'); process.exit(1); }\n";
const lint = (file = "{file}") => `"${process.execPath}" ${LINTER} ${file}`;
const COUPLED = [{ files: ["api/schema.json", "web/src/types.ts", "docs/api/*.md"], message: "The schema, its types and its pages describe one API." }];

function repo(t, { manifest = true, teamwork, choice, old, prefix = "tw-edit-" } = {}) {
  const { dir, git } = tempRepo(t, prefix);
  if (manifest) write(dir, ".agents/manifest.json", JSON.stringify({ ...MANIFEST, ...(teamwork ? { teamwork } : {}) }, null, 2));
  if (old) write(dir, ".claude/teamwork.json", JSON.stringify(old, null, 2));
  if (choice) git("config", "--local", "agentic-engineering.plugins", `${choice} Test 2026-01-01T00:00Z`);
  write(dir, LINTER, LINTER_SOURCE);
  write(dir, "README.md", "# fixture\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  git("switch", "-q", "-c", "feat/topic");
  return dir;
}

/** Write a file as an edit would, then run the hook on it. */
function edit(dir, rel, content = "export const a = 1;\n", { tool = "Write", exists = true } = {}) {
  const file = path.join(dir, rel);
  if (exists) write(dir, rel, content);
  const input = JSON.stringify({ hook_event_name: "PostToolUse", session_id: "edit", cwd: dir, tool_name: tool, tool_input: { file_path: file, content } });
  const env = { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CLAUDE_PROJECT_DIR: dir };
  const result = runNode(HOOK, [], { cwd: dir, env, input });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const json = result.stdout.trim() ? JSON.parse(result.stdout) : null;
  if (json) assert.deepEqual(Object.keys(json), ["hookSpecificOutput"], "feedback, never a block");
  if (json) assert.equal(json.hookSpecificOutput.hookEventName, "PostToolUse");
  return json?.hookSpecificOutput.additionalContext ?? null;
}

test("a repo that opted into neither check hears nothing", (t) => {
  assert.equal(edit(repo(t), "src/a.mjs", "BAD\n"), null);
});

// ---- lint ----------------------------------------------------------------

test("lint: a failure goes back to the model with the linter's own lines", (t) => {
  const dir = repo(t, { teamwork: { lint: { command: lint(), filePatterns: ["^src/.*\\.mjs$"] } } });
  const note = edit(dir, "src/a.mjs", "export const BAD = 1;\n");
  assert.match(note, /^Lint fails on src\/a\.mjs \(`.*lint\.cjs .*a\.mjs.*`\):\n/);
  assert.match(note, /line 1: BAD is not allowed/);
  assert.match(note, /Fix it before you commit\.$/);
});

test("lint: a clean file, a file no pattern matches, and a file that is gone say nothing", (t) => {
  const dir = repo(t, { teamwork: { lint: { command: lint(), filePatterns: ["^src/.*\\.mjs$"] } } });
  assert.equal(edit(dir, "src/a.mjs", "export const good = 1;\n"), null);
  assert.equal(edit(dir, "docs/a.md", "BAD\n"), null);
  assert.equal(edit(dir, "src/gone.mjs", "BAD\n", { exists: false }), null);
});

test("lint: no filePatterns means no file is linted", (t) => {
  assert.equal(edit(repo(t, { teamwork: { lint: { command: lint() } } }), "src/a.mjs", "BAD\n"), null);
});

test("lint: a path with a space in it reaches the linter whole, quoted by the command or not", (t) => {
  for (const command of [lint(), lint('"{file}"')]) {
    const dir = repo(t, { prefix: "tw edit space-", teamwork: { lint: { command, filePatterns: ["\\.mjs$"] } } });
    assert.match(edit(dir, "my src/a b.mjs", "BAD\n"), /a b\.mjs: line 1: BAD is not allowed/, command);
    assert.equal(edit(dir, "my src/a b.mjs", "fine\n"), null, command);
  }
});

test("lint: a linter that is not installed is reported, not swallowed", (t) => {
  const dir = repo(t, { teamwork: { lint: { command: "no-such-linter-anywhere {file}", filePatterns: ["\\.mjs$"] } } });
  assert.match(edit(dir, "src/a.mjs"), /^Lint fails on src\/a\.mjs \(`no-such-linter-anywhere /);
});

// ---- coupled files -------------------------------------------------------

test("coupled files: editing one names the others and the group's reason", (t) => {
  const dir = repo(t, { teamwork: { coupledFiles: COUPLED } });
  const note = edit(dir, "api/schema.json", "{}\n");
  assert.equal(note, "api/schema.json is one of a group of files that change together (also: web/src/types.ts, docs/api/*.md). The schema, its types and its pages describe one API. If you changed a name, a path, or an identifier, update the whole group in this change.");
});

test("coupled files: a glob member matches, and a file outside every group does not", (t) => {
  const dir = repo(t, { teamwork: { coupledFiles: COUPLED } });
  assert.match(edit(dir, "docs/api/users.md", "# Users\n"), /^docs\/api\/users\.md is one of a group .*\(also: api\/schema\.json, web\/src\/types\.ts, docs\/api\/\*\.md\)/);
  assert.equal(edit(dir, "docs/guide.md", "# Guide\n"), null);
  assert.equal(edit(dir, "web/src/types.tsx", "export {};\n"), null, "a longer name is another file");
});

test("coupled files: a group without a message gets the plain one", (t) => {
  const dir = repo(t, { teamwork: { coupledFiles: [{ files: ["a.txt", "b.txt"] }] } });
  assert.match(edit(dir, "a.txt", "a\n"), /\(also: b\.txt\)\. These files change together\. /);
});

test("a file that fails lint and belongs to a group gets both notes, lint first", (t) => {
  const dir = repo(t, { teamwork: { lint: { command: lint(), filePatterns: ["\\.ts$"] }, coupledFiles: COUPLED } });
  const note = edit(dir, "web/src/types.ts", "export const BAD = 1;\n");
  assert.match(note, /^Lint fails on web\/src\/types\.ts /);
  assert.match(note, /\n\nweb\/src\/types\.ts is one of a group of files that change together/);
});

// ---- where it speaks -----------------------------------------------------

test("a file outside the repo is none of this repo's business", (t) => {
  const dir = repo(t, { teamwork: { lint: { command: lint(), filePatterns: ["."] }, coupledFiles: [{ files: ["*"] }] } });
  const outside = tempDir(t, "tw-edit-outside-");
  write(outside, "scratch.mjs", "BAD\n");
  const input = JSON.stringify({ hook_event_name: "PostToolUse", cwd: dir, tool_input: { file_path: path.join(outside, "scratch.mjs") } });
  const result = runNode(HOOK, [], { cwd: dir, env: { ...process.env, HOME, CLAUDE_PROJECT_DIR: dir }, input });
  assert.equal(result.stdout.trim(), "");
});

test("mode none: a repo that answered off hears nothing, whatever its manifest would say elsewhere", (t) => {
  const dir = repo(t, { manifest: false, choice: "off" });
  assert.equal(edit(dir, "src/a.mjs", "BAD\n"), null);
});

test("a repo still on the first layout keeps its lint and its coupled files", (t) => {
  const old = { version: 1, lint: { command: lint(), filePatterns: ["^src/"] }, coupledFiles: COUPLED };
  const dir = repo(t, { manifest: false, old });
  assert.match(edit(dir, "src/a.mjs", "BAD\n"), /^Lint fails on src\/a\.mjs/);
  assert.match(edit(dir, "api/schema.json", "{}\n"), /change together/);
});

test("empty, malformed and unexpected stdin are silent no-ops", (t) => {
  const dir = repo(t, { teamwork: { coupledFiles: [{ files: ["*"] }] } });
  for (const input of ["", "{\"tool_input\": {\"file_path\":", "null", '{"tool_input":{}}', '{"tool_input":{"file_path":7}}']) {
    const result = runNode(HOOK, [], { cwd: dir, env: { ...process.env, HOME, CLAUDE_PROJECT_DIR: dir }, input });
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout.trim(), "", input);
    assert.equal(result.stderr, "", input);
  }
  assert.ok(fs.existsSync(path.join(dir, LINTER)));
});
