// docs-parity's two hooks, run the way the host runs them: one payload on
// stdin, stdout read back. session-start.mjs carries the docs rule into a repo
// that has .agents/docs-parity.json and moves an older layout; stop-check.mjs
// tells the agent, once, when a turn leaves the docs behind.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { hookCommand } from "../../lib.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "docs-parity");
const SESSION = path.join(PLUGIN, "hooks", "session-start.mjs");
const STOP = path.join(PLUGIN, "hooks", "stop-check.mjs");
const CONFIG = ".agents/docs-parity.json";
const MARKETPLACE = "agentic-engineering";
const SHARED = "Nothing is done until it's checked";
const DOCS_LINE = "User docs move in the same change";
const line = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "critical.json"), "utf8")).lines[0];

const suite = { after };
// The Stop hook keeps what it has told a session in the temp folder; the suite gets its own.
const TMP = tempDir(suite, "docs-parity-tmp-");
let sessions = 0;
const session = () => `unit-${process.pid}-${++sessions}`;

/** A settings folder enabling exactly these plugins, so a developer's own never reach a test. */
function settings(t, enabled = []) {
  const dir = tempDir(t, "docs-parity-settings-");
  write(dir, "settings.json", JSON.stringify({ enabledPlugins: Object.fromEntries(enabled.map((n) => [`${n}@${MARKETPLACE}`, true])) }));
  return dir;
}

/** Run a hook in `cwd` with a payload (an object, or raw text); returns { status, stdout, stderr, out }. */
function hook(t, script, cwd, payload = {}, { enabled = [], project = cwd } = {}) {
  const config = settings(t, enabled);
  const env = { ...process.env, HOME: config, USERPROFILE: config, CLAUDE_CONFIG_DIR: config, CLAUDE_PROJECT_DIR: project, TMPDIR: TMP, TEMP: TMP, TMP };
  delete env.CLAUDE_PLUGIN_DATA;
  const input = typeof payload === "string" ? payload : JSON.stringify({ cwd, ...payload });
  const r = runNode(script, [], { cwd, input, env });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* no output, or not JSON */ }
  return { ...r, out, context: out?.hookSpecificOutput?.additionalContext ?? "" };
}

const SURFACES = {
  docsRoot: "docs", nav: "none",
  surfaces: [{ name: "export", code: ["src/export/**"], pages: ["docs/export.md"], shots: ["docs/images/export/**"], group: "export" }],
};

/** A committed repo with one mapped surface and its page; `config` null leaves the docs config out. */
function repo(t, { config = SURFACES, files = {}, answer } = {}) {
  const { dir, git } = tempRepo(t, "docs-parity-hooks-");
  write(dir, "src/export/menu.py", "a = 1\n");
  write(dir, "docs/export.md", "# Export\n\nHow to export.\n");
  if (config) write(dir, CONFIG, typeof config === "string" ? config : JSON.stringify(config));
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  if (answer) git("config", "--local", `${MARKETPLACE}.plugins`, `${answer} test 2026-01-01T00:00Z`);
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  return { dir, git };
}

// ---- the critical line --------------------------------------------------------

test("the rule is one line, for every agent that acts, in any mode, only where the config is", () => {
  const data = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "critical.json"), "utf8"));
  assert.deepEqual([data.plugin, data.lines.length, data.chains], ["docs-parity", 1, []]);
  assert.deepEqual([line.for, line.mode, line.when], ["all", "any", CONFIG]);
  assert.ok(!line.text.includes("\n"));
});

test("the line says what the rule asks: same change, the harness, the Docs: line, the skill, the contract", () => {
  for (const part of ["same change", "capture harness", "never by hand", "`Docs: <pages>`", "`Docs: none, <why>`", "/docs-parity:docs-sync", ".agents/docs-contract.md"]) {
    assert.ok(line.text.includes(part), part);
  }
});

test("the line as printed fits the plugin's cap", () => {
  const { cap } = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "plugins", "docs-parity.json"), "utf8")).critical;
  const printed = "Critical, from docs-parity:".length + line.text.length + 3;
  assert.ok(printed <= cap, `${printed} characters, cap ${cap}`);
});

test("the long form ships beside it, under fifty lines", () => {
  const rule = fs.readFileSync(path.join(PLUGIN, "skills", "docs-parity", "references", "rule.md"), "utf8");
  assert.ok(rule.split("\n").length < 50);
  assert.match(rule, /Docs: none, <why>/);
});

test("hooks.json registers both hooks behind the guards, the session hook for every way a session starts", () => {
  const { hooks } = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(hooks), ["SessionStart", "SubagentStart", "Stop"]);
  assert.equal(hooks.SessionStart[0].matcher, "startup|resume|clear|compact");
  assert.equal(hooks.SessionStart[0].hooks[0].command, hookCommand("docs-parity", "hooks/session-start.mjs", { loud: true }));
  assert.ok(hooks.SessionStart[0].hooks[0].statusMessage);
  assert.equal(hooks.SubagentStart[0].hooks[0].command, hookCommand("docs-parity", "hooks/session-start.mjs"));
  assert.equal(hooks.Stop[0].hooks[0].command, hookCommand("docs-parity", "hooks/stop-check.mjs"));
});

// ---- session-start.mjs: who hears the rule --------------------------------------

test("a repo with the config hears the rule at session start, and again after a compaction or a clear", (t) => {
  const { dir } = repo(t);
  for (const source of ["startup", "resume", "clear", "compact"]) {
    const r = hook(t, SESSION, dir, { hook_event_name: "SessionStart", source });
    assert.deepEqual([r.status, r.stderr, r.out.hookSpecificOutput.hookEventName], [0, "", "SessionStart"], source);
    assert.ok(r.context.includes(line.text), source);
  }
});

test("a sub-agent that acts hears it under its own event name", (t) => {
  const r = hook(t, SESSION, repo(t).dir, { hook_event_name: "SubagentStart", agent_type: "general-purpose" });
  assert.equal(r.out.hookSpecificOutput.hookEventName, "SubagentStart");
  assert.ok(r.context.includes(line.text));
});

test("a read-only agent type hears nothing", (t) => {
  const { dir } = repo(t);
  for (const agent_type of ["Explore", "Plan", "claude-code-guide"]) {
    const r = hook(t, SESSION, dir, { hook_event_name: "SubagentStart", agent_type });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], agent_type);
  }
});

test("a repo without the config never hears the docs line, whatever the person answered", (t) => {
  const on = hook(t, SESSION, repo(t, { config: null, answer: "on" }).dir, { hook_event_name: "SessionStart" });
  assert.ok(on.context.includes(SHARED), "the first enabled plugin still prints the line every plugin shares");
  assert.ok(!on.context.includes(DOCS_LINE));
  const unanswered = hook(t, SESSION, repo(t, { config: null }).dir, { hook_event_name: "SessionStart" });
  assert.ok(!unanswered.context.includes(DOCS_LINE));
  const off = hook(t, SESSION, repo(t, { config: null, answer: "off" }).dir, { hook_event_name: "SessionStart" });
  assert.deepEqual([off.status, off.stdout, off.stderr], [0, "", ""]);
});

test("behind another enabled plugin, a repo without the config hears nothing from this one at all", (t) => {
  const { dir } = repo(t, { config: null, answer: "on" });
  for (const hook_event_name of ["SessionStart", "SubagentStart"]) {
    const r = hook(t, SESSION, dir, { hook_event_name, agent_type: "general-purpose" }, { enabled: ["code-diet"] });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], hook_event_name);
  }
  const withConfig = hook(t, SESSION, repo(t).dir, { hook_event_name: "SessionStart" }, { enabled: ["code-diet"] });
  assert.ok(withConfig.context.includes(line.text));
  assert.ok(!withConfig.context.includes(SHARED));
});

test("the committed config outranks a personal off", (t) => {
  const r = hook(t, SESSION, repo(t, { answer: "off" }).dir, { hook_event_name: "SessionStart" });
  assert.ok(r.context.includes(line.text));
});

test("the session hook judges the work tree of the payload's cwd, not the project dir", (t) => {
  const adopted = repo(t).dir, plain = repo(t, { config: null, answer: "off" }).dir;
  assert.ok(hook(t, SESSION, adopted, { hook_event_name: "SessionStart" }, { project: plain }).context.includes(line.text));
  assert.equal(hook(t, SESSION, plain, { hook_event_name: "SessionStart" }, { project: adopted }).stdout, "");
});

test("empty and malformed stdin fall back to the project dir and never fail", (t) => {
  const { dir } = repo(t);
  for (const input of ["", "{\"hook_event_name\": \"SessionStart\","]) {
    const r = hook(t, SESSION, dir, input);
    assert.deepEqual([r.status, r.stderr], [0, ""], JSON.stringify(input));
    assert.ok(r.context.includes(line.text));
  }
});

// ---- session-start.mjs: the briefing and the migration --------------------------

test("a readable config adds no briefing; one that cannot be read says the checks are off", (t) => {
  const fine = hook(t, SESSION, repo(t).dir, { hook_event_name: "SessionStart" });
  assert.ok(fine.context.startsWith("Critical, from docs-parity:"), fine.context);
  for (const config of ["{nope", "[]"]) {
    const r = hook(t, SESSION, repo(t, { config }).dir, { hook_event_name: "SessionStart" });
    assert.match(r.context, /^\.agents\/docs-parity\.json (does not parse|is not a JSON object).*the Stop check are off in this repo/s, config);
    assert.ok(r.context.includes(line.text), "the rule still arrives");
    const sub = hook(t, SESSION, repo(t, { config }).dir, { hook_event_name: "SubagentStart", agent_type: "general-purpose" });
    assert.ok(!sub.context.includes("are off in this repo"), "a sub-agent gets the line and no briefing");
  }
});

const OLD = ".agents/contracts/docs.md", NEW = ".agents/docs-contract.md";
const CONTRACT = "# Writing the user docs\n\nThe contract for every author of `docs/`, human or agent. docs-parity's `docs_check.py` checks what a\nscript can.\n";

test("a repo on the first layout has its writer contract moved beside the config, once, and is told what a script cannot fix", (t) => {
  const { dir } = repo(t, { files: { [OLD]: CONTRACT } });
  const first = hook(t, SESSION, dir, { hook_event_name: "SessionStart" });
  assert.deepEqual([fs.existsSync(path.join(dir, OLD)), fs.readFileSync(path.join(dir, NEW), "utf8")], [false, CONTRACT]);
  assert.match(first.context, /^docs-parity moved this repo to its current layout: \.agents\/contracts\/docs\.md -> \.agents\/docs-contract\.md\./);
  assert.match(first.context, /where it names docs_check\.py, the checker is docs-check\.mjs/);
  assert.match(first.context, /root AGENTS\.md .* delete it, or, where people work without the plugin, keep it/);
  assert.match(first.out.systemMessage, /^docs-parity moved 1 path\(s\)/);
  assert.ok(first.context.includes(line.text));

  const second = hook(t, SESSION, dir, { hook_event_name: "SessionStart" });
  assert.ok(second.context.startsWith("Critical, from docs-parity:"));
  assert.equal(second.out.systemMessage, undefined);
});

test("the migration touches only the contract this plugin wrote, in a repo that carries the config", (t) => {
  const other = repo(t, { files: { [OLD]: "# The export protocol\n\nSomebody else's page.\n" } }).dir;
  const bare = repo(t, { config: null, answer: "on", files: { [OLD]: CONTRACT } }).dir;
  for (const dir of [other, bare]) {
    const r = hook(t, SESSION, dir, { hook_event_name: "SessionStart" });
    assert.deepEqual([fs.existsSync(path.join(dir, OLD)), fs.existsSync(path.join(dir, NEW))], [true, false]);
    assert.ok(!r.context.includes("moved"));
  }
});

test("the migration never overwrites: with both files present it leaves both and says so", (t) => {
  const { dir } = repo(t, { files: { [OLD]: CONTRACT, [NEW]: "# Writing the user docs\n\nThe newer one.\n" } });
  const r = hook(t, SESSION, dir, { hook_event_name: "SessionStart" });
  assert.deepEqual([fs.readFileSync(path.join(dir, OLD), "utf8"), fs.readFileSync(path.join(dir, NEW), "utf8")], [CONTRACT, "# Writing the user docs\n\nThe newer one.\n"]);
  assert.match(r.context, /left these in place because the new path already exists: \.agents\/contracts\/docs\.md/);
  assert.ok(!r.context.includes("docs_check.py"), "the note explains a move, and nothing moved");
});

test("a sub-agent never migrates", (t) => {
  const { dir } = repo(t, { files: { [OLD]: CONTRACT } });
  hook(t, SESSION, dir, { hook_event_name: "SubagentStart", agent_type: "general-purpose" });
  assert.ok(fs.existsSync(path.join(dir, OLD)));
});

// ---- stop-check.mjs --------------------------------------------------------------

const stop = (t, dir, payload = {}, options) => hook(t, STOP, dir, { hook_event_name: "Stop", session_id: session(), stop_hook_active: false, ...payload }, options);
const silent = (r, what) => assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], what);

test("a turn that changed nothing, or kept the docs level, ends in silence", (t) => {
  const { dir } = repo(t);
  silent(stop(t, dir), "nothing changed");
  write(dir, "src/export/menu.py", "a = 2\n");
  write(dir, "docs/export.md", "# Export\n\nHow to export, now with formats.\n");
  silent(stop(t, dir), "the page moved with the code; the reminder to retake shots is info");
  write(dir, "src/other.py", "b = 1\n");
  silent(stop(t, dir), "code no surface covers");
});

test("a surface's code changed without its docs: the agent is told, and the person gets one short line", (t) => {
  const { dir } = repo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  const r = stop(t, dir);
  assert.deepEqual([r.status, r.stderr], [0, ""]);
  assert.deepEqual(Object.keys(r.out).sort(), ["hookSpecificOutput", "systemMessage"]);
  assert.equal(r.out.hookSpecificOutput.hookEventName, "Stop");
  assert.equal(r.context, [
    "Docs parity, before you finish:",
    "- surface export changed (1 file(s)) but none of its pages (docs/export.md) or shots changed (capture group export).",
    "Update the pages and retake the shots in this change (/docs-parity:docs-sync), or write `Docs: none, <why>` in the commit message.",
  ].join("\n"));
  assert.equal(r.out.systemMessage, "docs-parity told the agent the docs fell behind this turn: 1 surface changed without its docs.");
  assert.equal(r.out.decision, undefined, "a warning, never a refusal");
});

test("it never re-enters on the continuation it caused", (t) => {
  const { dir } = repo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  silent(stop(t, dir, { stop_hook_active: true }));
});

test("the same findings reach the agent once a session; after that the person alone sees them", (t) => {
  const { dir } = repo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  const session_id = session();
  assert.ok(stop(t, dir, { session_id }).context.includes("surface export changed"));
  const again = stop(t, dir, { session_id });
  assert.deepEqual(Object.keys(again.out), ["systemMessage"]);
  assert.equal(again.out.systemMessage, "docs-parity: the docs are still behind this session's changes (1 surface changed without its docs); the agent was told once.");

  write(dir, "docs/new.md", "## A page with no summary\n");
  const more = stop(t, dir, { session_id });
  assert.match(more.context, /SUMMARY_MISSING docs\/new\.md:1/, "new findings are news");
  assert.ok(stop(t, dir).context.includes("surface export changed"), "and another session has not been told");
  assert.ok(stop(t, dir, { session_id: undefined }).context, "with no session to remember, it says it again");
});

test("tree findings are reported only on files this turn changed", (t) => {
  const { dir } = repo(t, { files: { "docs/old.md": "# Old\n\nSee [gone](gone.md).\n" } });
  write(dir, "docs/export.md", "# Export\n\nHow to export. See [missing](missing.md).\n");
  const r = stop(t, dir);
  assert.equal(r.context, [
    "Docs parity, before you finish:",
    "- LINK_BROKEN docs/export.md:3: missing.md resolves to no page.",
    "Update the pages and retake the shots in this change (/docs-parity:docs-sync), or write `Docs: none, <why>` in the commit message.",
  ].join("\n"));
  assert.equal(r.out.systemMessage, "docs-parity told the agent the docs fell behind this turn: 1 finding on changed pages.");
});

test("past four of a kind, the rest are counted and the command that lists them is named", (t) => {
  const surfaces = ["a", "b", "c", "d", "e", "f"].map((n) => ({ name: n, code: [`src/${n}/**`], pages: [`docs/${n}.md`] }));
  const { dir } = repo(t, { config: { docsRoot: "docs", nav: "none", surfaces } });
  for (const s of surfaces) write(dir, `src/${s.name}/x.py`, "1\n");
  const r = stop(t, dir);
  const lines = r.context.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("- surface ")).length, 4);
  assert.match(lines.at(-2), /^- and 2 more: node ".*docs-check\.mjs" --changed HEAD lists them\.$/);
  assert.ok(fs.existsSync(/node "(.*)" --changed/.exec(lines.at(-2))[1]), "the command names the script where it is installed");
  assert.equal(r.out.systemMessage, "docs-parity told the agent the docs fell behind this turn: 6 surfaces changed without their docs.");
});

test("it judges the work tree of the payload's cwd, from a subfolder too, not the project dir", (t) => {
  const dirty = repo(t).dir, clean = repo(t).dir;
  write(dirty, "src/export/menu.py", "a = 2\n");
  assert.ok(stop(t, dirty, {}, { project: clean }).context.includes("surface export changed"));
  silent(stop(t, clean, {}, { project: dirty }));
  const sub = hook(t, STOP, path.join(dirty, "src", "export"), { hook_event_name: "Stop", session_id: session(), cwd: path.join(dirty, "src", "export") }, { project: clean });
  assert.ok(sub.context.includes("surface export changed"));
});

test("a repo without the config is left alone, whatever changed in it", (t) => {
  const { dir } = repo(t, { config: null, answer: "on" });
  write(dir, "src/export/menu.py", "a = 2\n");
  silent(stop(t, dir));
});

test("it fails open: no git, no commit yet, a config that does not parse, empty or malformed stdin", (t) => {
  const plain = tempDir(t, "docs-parity-plain-");
  write(plain, CONFIG, JSON.stringify(SURFACES));
  write(plain, "src/export/menu.py", "a = 1\n");
  silent(stop(t, plain), "no git");

  const { dir: unborn } = tempRepo(t, "docs-parity-unborn-");
  write(unborn, CONFIG, JSON.stringify(SURFACES));
  write(unborn, "src/export/menu.py", "a = 1\n");
  silent(stop(t, unborn), "no commit yet");

  const { dir: broken } = repo(t, { config: "{nope" });
  write(broken, "src/export/menu.py", "a = 2\n");
  silent(stop(t, broken), "a config that does not parse");

  const { dir } = repo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  silent(hook(t, STOP, dir, ""), "empty stdin");
  silent(hook(t, STOP, dir, "{\"stop_hook_active\": fals"), "malformed stdin");
  silent(hook(t, STOP, dir, "[]"), "a payload that is no object");
});

// ---- stop-check.mjs: the README check --------------------------------------------

const README = "# widget\n\nTurns raw sensor logs into tidy CSV files.\n\nField teams export logs in three formats; widget reads all three.\n\n## Install\n\nnpm install widget\n\n## Usage\n\nRun widget.\n\n## Contributing\n\nSee CONTRIBUTING.md.\n";

test("a changed README is checked only in a repo whose config carries a readme block", (t) => {
  const plain = repo(t, { files: { "README.md": README } }).dir;
  write(plain, "README.md", README.replace("## Install", "## Installation"));
  silent(stop(t, plain), "no readme block");

  const opted = repo(t, { config: { ...SURFACES, readme: { name: "widget" } }, files: { "README.md": README } }).dir;
  silent(stop(t, opted), "the README did not change");
  write(opted, "README.md", README.replace("## Install", "## Installation"));
  const r = stop(t, opted);
  assert.match(r.context, /^A README this turn changed does not pass readme-check:\n- readme-sections: README\.md: no `## Install` section/);
  assert.match(r.context, /\/docs-parity:readme/);
  assert.equal(r.out.systemMessage, "docs-parity told the agent the docs fell behind this turn: 2 README findings.");
});

test("README warnings are passed on as warnings, and both checks speak in one message", (t) => {
  const { dir } = repo(t, { config: { ...SURFACES, readme: { name: "widget" } }, files: { "README.md": README } });
  write(dir, "README.md", README.replace("Run widget.", "Then walk me through it."));
  write(dir, "src/export/menu.py", "a = 2\n");
  const r = stop(t, dir);
  const [docs, readme] = r.context.split("\n\n");
  assert.match(docs, /^Docs parity, before you finish:\n- surface export changed/);
  assert.match(readme, /^A README this turn changed passes readme-check, with warnings:\n- readme-agent-prose \(a warning, yours to judge\): README\.md:13: /);
  assert.equal(r.out.systemMessage, "docs-parity told the agent the docs fell behind this turn: 1 surface changed without its docs, 1 README warning.");
});
