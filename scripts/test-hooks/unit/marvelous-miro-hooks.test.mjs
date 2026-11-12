// marvelous-miro's session hook: the two lines it prints from critical.json,
// each only in a repo that carries what the line is about, and the one-line
// note for a machine the live check cannot run on. The hook runs as a host
// runs it, one payload on stdin, with the person's settings in a temp
// CLAUDE_CONFIG_DIR so a developer's own enabledPlugins never reach a test.
// The hook cases cover the fixtures that carry no Miro project and no system
// map; the repos that do are built here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hookCommand } from "../../lib.mjs";
import { CONFIG_KEY, MARKERS, ORDER, SHARED_LINE } from "../../shared/critical-context.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "marvelous-miro");
const CRITICAL = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "critical.json"), "utf8"));
const HOOKS = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks;
const [BOARD_LINE, MAP_LINE] = CRITICAL.lines.map((l) => l.text);
const MIRO_CONFIG = "export default { board: \"https://miro.com/app/board/uXjTEST=/\", views: [] };\n";

/** A repo with the given files committed to nothing, and the person's answer when one is given. */
function repo(t, files = {}, answer = null) {
  const { dir, git } = tempRepo(t, "miro-hook-");
  if (answer) git("config", "--local", CONFIG_KEY, `${answer} Test 2026-01-01T00:00Z`);
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  return dir;
}
const SYSTEM_MAP = { ".agents/system-map.json": "{}\n" };
const ROOT_PROJECT = { "miro.config.mjs": MIRO_CONFIG };
const NESTED_PROJECT = { "diagrams/miro.config.mjs": MIRO_CONFIG };

function hook(t, payload, env = {}) {
  const config = tempDir(t, "miro-settings-");
  const out = runNode(path.join(PLUGIN, "hooks", "session-start.mjs"), [], {
    cwd: payload?.cwd ?? config,
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: {
      ...process.env, CLAUDE_CONFIG_DIR: config, HOME: config, USERPROFILE: config, CLAUDE_PROJECT_DIR: "", CLAUDE_PLUGIN_DATA: "", CLAUDE_CODE_PLUGIN_CACHE_DIR: "",
      // A Chrome that is there, and a Desktop config that is not: the machine is ready unless a test says otherwise.
      MARVELOUS_MIRO_CHROME: process.execPath, MARVELOUS_MIRO_DESKTOP_CONFIG: path.join(config, "claude_desktop_config.json"), ...env,
    },
  });
  const parsed = out.stdout.trim() ? JSON.parse(out.stdout) : null;
  return { ...out, parsed, context: parsed?.hookSpecificOutput?.additionalContext ?? "" };
}
const session = (t, dir, extra = {}, env = {}) => hook(t, { hook_event_name: "SessionStart", source: "startup", session_id: "s", cwd: dir, ...extra }, env);
const subagent = (t, dir, agentType) => hook(t, { hook_event_name: "SubagentStart", agent_type: agentType, session_id: "s", cwd: dir });
const NO_CHROME = (t) => ({ MARVELOUS_MIRO_CHROME: path.join(tempDir(t, "miro-none-"), "no-chrome") });

// ---- what is registered -----------------------------------------------------

test("hooks.json registers the session hook for every session start and every subagent, and nothing else", () => {
  assert.deepEqual(Object.keys(HOOKS).sort(), ["SessionStart", "SubagentStart"]);
  assert.equal(HOOKS.SessionStart.length, 1);
  const [start] = HOOKS.SessionStart;
  assert.equal(start.matcher, "startup|resume|clear|compact");
  assert.equal(start.hooks[0].command, hookCommand("marvelous-miro", "hooks/session-start.mjs", { loud: true }));
  assert.ok(start.hooks[0].statusMessage);
  assert.equal(HOOKS.SubagentStart[0].hooks[0].command, hookCommand("marvelous-miro", "hooks/session-start.mjs"));
});

test("critical.json is two lines, each gated on what it is about, inside the cap, with no chain yet", () => {
  assert.equal(CRITICAL.plugin, "marvelous-miro");
  assert.ok(ORDER.includes("marvelous-miro"));
  assert.deepEqual(CRITICAL.chains, []);
  assert.deepEqual(CRITICAL.lines.map((l) => [l.for, l.mode, l.when]), [
    ["all", "any", ["miro.config.mjs", "diagrams/miro.config.mjs", ".agents/system-map.json"]],
    ["all", "any", ".agents/system-map.json"],
  ]);
  const cap = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "plugins", "marvelous-miro.json"), "utf8")).critical.cap;
  assert.equal(cap, 800);
  const printed = "Critical, from marvelous-miro:".length + CRITICAL.lines.reduce((n, l) => n + l.text.length + 3, 0);
  assert.ok(printed <= cap, `the block prints ${printed} characters, over the ${cap} cap`);
});

test("the lines name what the plugin really offers, and nothing about a workspace or a label", () => {
  const shipped = fs.readdirSync(path.join(PLUGIN, "skills"));
  for (const text of [BOARD_LINE, MAP_LINE]) {
    for (const m of text.matchAll(/\/marvelous-miro:([a-z-]+)/g)) {
      assert.ok(shipped.includes(m[1]), `/marvelous-miro:${m[1]} is not a skill`);
      const frontmatter = fs.readFileSync(path.join(PLUGIN, "skills", m[1], "SKILL.md"), "utf8").split("---")[1];
      assert.doesNotMatch(frontmatter, /disable-model-invocation:\s*true/, `a line sends the model to /marvelous-miro:${m[1]}, which only a person can run`);
    }
    assert.doesNotMatch(text, /\bspace\b|\bteam\b|workspace|confidential|classif/i);
    assert.doesNotMatch(text, /\.agents\/scripts/, "the checker lives in the plugin, not in the repo");
  }
  for (const phrase of ["`@system node`", "`@system calls`", "in the same commit", "--write", "`Diagram: none, <why>`", "/marvelous-miro:diagrams-sync"]) {
    assert.ok(MAP_LINE.includes(phrase), `the map line does not say: ${phrase}`);
  }
  for (const phrase of ["linted before it is published", "checked live after", "pulled back", "/marvelous-miro:miro-board"]) {
    assert.ok(BOARD_LINE.includes(phrase), `the board line does not say: ${phrase}`);
  }
  assert.ok(fs.existsSync(path.join(PLUGIN, "scripts", "system-map.mjs")));
});

// ---- which repo hears which line ---------------------------------------------

test("a repo with a system map is opted in by the map itself and gets both lines", (t) => {
  assert.ok(MARKERS.includes(".agents/system-map.json"));
  const out = session(t, repo(t, SYSTEM_MAP));
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  assert.equal(out.parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(out.context, `Critical, from marvelous-miro:\n- ${SHARED_LINE}\n- ${BOARD_LINE}\n- ${MAP_LINE}`);
  assert.ok(!out.parsed.systemMessage, "nothing to tell the person");
});

test("a repo with a Miro project at its root is opted in by it and gets the board line alone", (t) => {
  assert.ok(MARKERS.includes("miro.config.mjs"));
  const out = session(t, repo(t, ROOT_PROJECT));
  assert.ok(out.context.includes(BOARD_LINE));
  assert.ok(!out.context.includes(MAP_LINE), "the map line went to a repo with no system map");
});

test("a Miro project kept in diagrams/, where the plugin's own setup puts it, opts the repo in like one at the root", (t) => {
  for (const answer of ["on", "team", undefined, "off"]) {
    const out = session(t, repo(t, NESTED_PROJECT, answer));
    assert.ok(out.context.includes(BOARD_LINE), `answer ${answer}`);
    assert.doesNotMatch(out.context, /ask the person once/, `answer ${answer}`);
  }
});

test("an opted-in repo with neither a Miro project nor a map gets neither line", (t) => {
  const out = session(t, repo(t, {}, "on"));
  assert.equal(out.context, `Critical, from marvelous-miro:\n- ${SHARED_LINE}`, "alone, the plugin still prints the line every plugin shares");
  const beside = repo(t, { ".agents/plan/index.md": "# Plan\n" });
  assert.ok(!session(t, beside).context.includes("Miro"));
});

test("the lines come back after a compaction, a /clear, and a resume", (t) => {
  const dir = repo(t, SYSTEM_MAP);
  for (const source of ["compact", "clear", "resume"]) {
    const { context } = session(t, dir, { source });
    assert.ok(context.includes(BOARD_LINE) && context.includes(MAP_LINE), source);
  }
});

test("a repo the person answered off for gets nothing, and one nobody answered for is only asked", (t) => {
  const off = session(t, repo(t, {}, "off"));
  assert.deepEqual([off.status, off.stdout, off.stderr], [0, "", ""]);
  const unanswered = session(t, repo(t));
  assert.ok(!unanswered.context.includes("Critical, from"));
  assert.match(unanswered.context, /ask the person once/);
});

test("a committed system map outranks a personal off", (t) => {
  assert.ok(session(t, repo(t, SYSTEM_MAP, "off")).context.includes(MAP_LINE));
});

test("a subagent that writes code gets both lines and no briefing; a read-only agent type gets nothing", (t) => {
  const dir = repo(t, { ...SYSTEM_MAP, ...ROOT_PROJECT });
  const builder = subagent(t, dir, "general-purpose");
  assert.equal(builder.parsed.hookSpecificOutput.hookEventName, "SubagentStart");
  assert.ok(builder.context.includes(BOARD_LINE) && builder.context.includes(MAP_LINE));
  for (const type of ["Explore", "Plan", "claude-code-guide"]) {
    const out = subagent(t, dir, type);
    assert.deepEqual([out.status, out.stdout], [0, ""], `${type} was given the build rules`);
  }
  for (const kind of [repo(t, {}, "off"), repo(t)]) assert.equal(subagent(t, kind, "general-purpose").stdout, "");
});

// ---- the briefing -------------------------------------------------------------

test("in a Miro project on a machine with no Chrome, the session says one line and asks for the person", (t) => {
  for (const files of [ROOT_PROJECT, { ...SYSTEM_MAP, ...NESTED_PROJECT }]) {
    const out = session(t, repo(t, files), {}, NO_CHROME(t));
    const note = out.context.split("\n\n").find((part) => part.startsWith("marvelous-miro: "));
    assert.ok(note, out.context);
    assert.equal(note.split("\n").length, 1);
    assert.match(note, /Google Chrome is not installed/);
    assert.match(note, /Ask the person to run \/marvelous-miro:browser-setup/);
    assert.ok(note.length <= 400, `the note is ${note.length} characters`);
    assert.ok(out.context.indexOf(note) < out.context.indexOf("Critical, from marvelous-miro:"), "the note comes before the lines");
  }
});

test("the note is kept to machines that need it and repos that draw boards", (t) => {
  const ready = session(t, repo(t, ROOT_PROJECT));
  assert.ok(!ready.context.includes("Google Chrome"), "a machine with Chrome was told to install it");
  const mapOnly = session(t, repo(t, SYSTEM_MAP), {}, NO_CHROME(t));
  assert.ok(!mapOnly.context.includes("browser-setup"), "a repo with a map and no Miro project needs no browser");
  const child = hook(t, { hook_event_name: "SubagentStart", agent_type: "general-purpose", session_id: "s", cwd: repo(t, ROOT_PROJECT) }, NO_CHROME(t));
  assert.ok(child.context.includes(BOARD_LINE) && !child.context.includes("browser-setup"), "a subagent never gets the briefing");
  const off = session(t, repo(t, {}, "off"), {}, NO_CHROME(t));
  assert.equal(off.stdout, "", "a repo that opted out hears nothing, whatever the machine lacks");
});

test("browser-setup, which the note points at, is a skill only a person runs", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "skills", "browser-setup", "SKILL.md"), "utf8");
  assert.match(text.split("---")[1], /disable-model-invocation:\s*true/);
});

// ---- what the hook never does -------------------------------------------------

test("the hook judges the work tree of the payload's cwd, not the project dir", (t) => {
  const elsewhere = repo(t, {}, "off");
  const here = repo(t, SYSTEM_MAP);
  const out = hook(t, { hook_event_name: "SessionStart", source: "startup", session_id: "s", cwd: path.join(here, ".agents") }, { CLAUDE_PROJECT_DIR: elsewhere });
  assert.ok(out.context.includes(MAP_LINE));
});

test("the hook writes nothing in the repo and starts no browser", (t) => {
  const dir = repo(t, { ...SYSTEM_MAP, ...ROOT_PROJECT, "src/app.mjs": "// @system node app \"App\" layer=service\n" });
  const listing = () => fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith(".git")).sort();
  const before = listing();
  const out = session(t, dir, {}, NO_CHROME(t));
  assert.equal(out.status, 0);
  assert.deepEqual(listing(), before);
  const source = fs.readFileSync(path.join(PLUGIN, "hooks", "session-start.mjs"), "utf8");
  assert.doesNotMatch(source, /child_process|spawn|fetch\(/);
});

test("empty stdin, malformed JSON, and a folder that is not a repo all exit 0 with nothing on stderr", (t) => {
  for (const input of ["", "{not json", "[]", "null"]) {
    const out = hook(t, input);
    assert.deepEqual([out.status, out.stderr], [0, ""], JSON.stringify(input));
  }
  const folder = tempDir(t, "miro-folder-");
  write(folder, "notes.txt", "not a repo\n");
  const out = session(t, folder);
  assert.deepEqual([out.status, out.stdout, out.stderr], [0, "", ""]);
});
