// plugins/agentic-engineering/hooks/critical-context.mjs and the two session commands
// built on it, run the way the plugin runs them: a throwaway plugin directory
// with the real helper, session-start.mjs and briefing.mjs in hooks/, and an
// area folder per name in AREAS holding lines and a briefing this suite wrote.
// Each command gets one payload on stdin, with an empty home so a developer's
// own plugin cache never leaks into a fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";
import * as helper from "../../../plugins/agentic-engineering/hooks/critical-context.mjs";

const {
  AREAS, BRIEFING_CHARS, CATALOG_CHARS, CONFIG_KEY, DENYLIST, MARKERS, MARKETPLACE, MIGRATION_CHARS, OLD_MANIFESTS, OLD_MARKERS, PLUGIN, SHARED_LINE,
  answer, clip, criticalBlocks, modeOf, moveOnce, questionFor,
} = helper;

const HOOKS = path.join(REPO, "plugins", PLUGIN, "hooks");
const suite = { after };
const BRIEFED = Object.keys(BRIEFING_CHARS);

// Every area gets the same shape of lines, so a test can name the line it
// expects without a table: one per audience and mode, and one gated on a file.
const LINE = {
  all: (a) => `${a}: every agent`,
  main: (a) => `${a}: the main session`,
  full: (a) => `${a}: a repo with the marker`,
  portable: (a) => `${a}: a repo without it`,
  planned: (a) => `${a}: where a plan exists`,
};
const linesOf = (a) => [
  { for: "all", mode: "any", text: LINE.all(a) },
  { for: "main", mode: "any", text: LINE.main(a) },
  { for: "main", mode: "full", text: LINE.full(a) },
  { for: "main", mode: "portable", text: LINE.portable(a) },
  { for: "all", mode: "any", when: [".plan/old-script.py", ".agents/plan"], text: LINE.planned(a) },
];
// An area's part of the briefing, steered by the environment: what it says,
// and the migration it carries.
const partOf = (a) => `const AREA = ${JSON.stringify(a)};
const says = {
  short: (state) => \`\${AREA} briefing in \${state.mode} mode.\`,
  long: () => \`\${AREA} \${"b".repeat(6000)}\`,
  throws: () => { if (AREA === "agent-works") throw new Error("no board"); return \`\${AREA} still speaks.\`; },
};
const moves = {
  move: AREA === "perceptual-loop" ? ({ move, write }) => { move(".old/config.json", ".agents/perceptual/config.json"); write(".agents/perceptual/opt-in.json", "{}\\n", { mode: 0o755 }); return "Strict mode stays on."; } : undefined,
  throw: AREA === "perceptual-loop" ? () => { throw new Error("disk says no"); } : undefined,
  wordy: ({ write }) => { write(\`.moved/\${AREA}\`, "x\\n"); return "n".repeat(3000); },
};
export const briefing = (payload, state) => says[process.env.FIXTURE_BRIEFING]?.(state) ?? "";
export const migrate = moves[process.env.FIXTURE_MIGRATE];
`;

/** A plugin directory: the real helper and commands, and each area's lines and briefing as given. */
function plugin(t, { data = (a) => ({ area: a, lines: linesOf(a) }), part = partOf } = {}) {
  const dir = tempDir(t, "helper-plugin-");
  for (const f of ["critical-context.mjs", "session-start.mjs", "briefing.mjs"]) {
    fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
    fs.copyFileSync(path.join(HOOKS, f), path.join(dir, "hooks", f));
  }
  for (const a of AREAS) {
    const d = data(a);
    if (d != null) write(dir, `skills/${a}/hooks/critical.json`, typeof d === "string" ? d : JSON.stringify(d));
  }
  for (const a of BRIEFED) {
    const p = part(a);
    if (p != null) write(dir, `skills/${a}/hooks/briefing.mjs`, p);
  }
  return dir;
}
const PLUGIN_DIR = plugin(suite);

const ANSWER = { team: "team Test 2026-01-01T00:00Z", on: "on Test 2026-01-01T00:00Z", off: "off Test 2026-01-01T00:00Z" };
function repo(t, kind) {
  const { dir, git } = tempRepo(t, `helper-${kind}-`);
  if (kind === "manifest") write(dir, ".agents/manifest.json", "{}\n");
  if (kind === "marker") write(dir, ".agents/agent-works.json", "{}\n");
  if (kind === "marker-off") { write(dir, ".agents/docs-parity.json", "{}\n"); git("config", "--local", CONFIG_KEY, ANSWER.off); }
  if (kind in ANSWER) git("config", "--local", CONFIG_KEY, ANSWER[kind]);
  if (kind === "remote") git("remote", "add", "origin", "https://github.com/someone/thing.git");
  return dir;
}

/** One command of a plugin directory, given one payload; what it told the model, by block and by area. */
function hook(t, script, dir, { event = "SessionStart", agentType, config, env = {}, from = PLUGIN_DIR, input } = {}) {
  const payload = { hook_event_name: event, source: "startup", session_id: "s", cwd: dir, ...(agentType ? { agent_type: agentType } : {}) };
  const cfg = config ?? tempDir(t, "helper-home-");
  const out = runNode(path.join(from, "hooks", script), [], {
    cwd: dir,
    input: input ?? JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOME: cfg, USERPROFILE: cfg, CLAUDE_PROJECT_DIR: "", CLAUDE_PLUGIN_DATA: "", CLAUDE_CODE_PLUGIN_CACHE_DIR: "", FIXTURE_BRIEFING: "", FIXTURE_MIGRATE: "", ...env },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  const parsed = out.stdout.trim() ? JSON.parse(out.stdout) : {};
  const context = parsed.hookSpecificOutput?.additionalContext ?? "";
  const blocks = context ? context.split("\n\n") : [];
  const of = (area) => (blocks.find((b) => b.startsWith(`Critical, from ${area}:`)) ?? "").split("\n").slice(1).map((l) => l.replace(/^- /, ""));
  return { context, parsed, blocks, of, message: parsed.systemMessage ?? "", raw: out.stdout, areas: blocks.map((b) => /^Critical, from ([^:]+):/.exec(b)?.[1]).filter(Boolean) };
}
const lines = (t, dir, options) => hook(t, "session-start.mjs", dir, options);
const briefing = (t, dir, options) => hook(t, "briefing.mjs", dir, options);

// ---- what the helper is ---------------------------------------------------

test("one helper: the areas in the order they print, and nothing left of the several-plugin kernel", () => {
  assert.deepEqual(AREAS, ["agentic-teamwork", "agent-works", "code-diet", "docs-parity", "but-first-planning", "perceptual-loop", "system-map"]);
  for (const gone of ["ORDER", "isAsker", "enabledPlugins", "catalogNews"]) assert.ok(!(gone in helper), `${gone} is still exported`);
  for (const a of BRIEFED) assert.ok(AREAS.includes(a), `${a} has a briefing allowance and is no area`);
  assert.equal(CONFIG_KEY, `${MARKETPLACE}.plugins`, "an answer recorded before the plugins became areas is still read");
});

// ---- the mode ---------------------------------------------------------------

test("mode: the manifest or a team answer is full, a marker or on is portable, off and unanswered are none", (t) => {
  assert.equal(modeOf(repo(t, "manifest")), "full");
  assert.equal(modeOf(repo(t, "team")), "full");
  assert.equal(modeOf(repo(t, "on")), "portable");
  assert.equal(modeOf(repo(t, "marker")), "portable");
  assert.equal(modeOf(repo(t, "off")), "none");
  assert.equal(modeOf(repo(t, "plain")), "none");
  assert.equal(modeOf(null), "none");
});

test("mode: a committed marker outranks a personal off, and every marker counts", (t) => {
  assert.equal(modeOf(repo(t, "marker-off")), "portable");
  for (const marker of MARKERS) {
    const dir = repo(t, "plain");
    write(dir, path.extname(marker) ? marker : `${marker}/keep`, "{}\n");
    assert.equal(modeOf(dir), "portable", marker);
  }
});

test("mode: a repo still on an older layout's marker is read so before the briefing command has moved it", (t) => {
  for (const marker of OLD_MANIFESTS) {
    const dir = repo(t, "off");
    write(dir, marker, "{}\n");
    assert.equal(modeOf(dir), "full", marker);
  }
  for (const marker of OLD_MARKERS) {
    const dir = repo(t, "off");
    write(dir, path.extname(marker) ? marker : `${marker}/config.json`, "{}\n");
    assert.equal(modeOf(dir), "portable", marker);
  }
  const bare = repo(t, "plain");
  write(bare, ".plan/notes.md", "somebody's own folder\n");
  assert.equal(modeOf(bare), "none", "a .plan folder the planning area never wrote is not a marker");
});

// ---- the lines command ------------------------------------------------------

test("the shared line is printed once, first, and each area's block follows in AREAS order", (t) => {
  const out = lines(t, repo(t, "manifest"));
  assert.equal(out.blocks[0], SHARED_LINE);
  assert.equal(out.context.split(SHARED_LINE).length - 1, 1, "once");
  assert.deepEqual(out.areas, AREAS);
});

test("the real plugin's lines: one shared line, every area that speaks once and in order", (t) => {
  const out = lines(t, repo(t, "manifest"), { from: path.join(REPO, "plugins", PLUGIN) });
  assert.equal(out.blocks[0], SHARED_LINE);
  assert.equal(out.context.split(SHARED_LINE).length - 1, 1);
  assert.deepEqual(out.areas, AREAS.filter((a) => out.areas.includes(a)), "in AREAS order, none twice");
  assert.ok(out.areas.length >= 4, `only ${out.areas.join(", ")} spoke in a repo on the conventions`);
});

test("a repo with the manifest gets the full lines and none of the portable ones", (t) => {
  for (const kind of ["manifest", "team"]) {
    const out = lines(t, repo(t, kind));
    for (const a of AREAS) assert.deepEqual(out.of(a), [LINE.all(a), LINE.main(a), LINE.full(a)], `${a} in ${kind}`);
  }
});

test("on, or an area's own marker, gets the portable lines and none of the full ones", (t) => {
  for (const kind of ["on", "marker", "marker-off"]) {
    const out = lines(t, repo(t, kind));
    for (const a of AREAS) assert.deepEqual(out.of(a), [LINE.all(a), LINE.main(a), LINE.portable(a)], `${a} in ${kind}`);
  }
});

test("off prints nothing from either command", (t) => {
  const dir = repo(t, "off");
  assert.equal(lines(t, dir).raw, "");
  assert.equal(briefing(t, dir, { env: { FIXTURE_BRIEFING: "short" } }).raw, "");
});

test("a line behind a when prints where the repo has any path it names", (t) => {
  const dir = repo(t, "manifest");
  assert.ok(!lines(t, dir).of("but-first-planning").includes(LINE.planned("but-first-planning")));
  write(dir, ".agents/plan/README.md", "plan\n");
  assert.ok(lines(t, dir).of("but-first-planning").includes(LINE.planned("but-first-planning")));
  const old = repo(t, "manifest");
  write(old, ".plan/old-script.py", "# the older layout\n");
  assert.ok(lines(t, old).of("perceptual-loop").includes(LINE.planned("perceptual-loop")), "the first path of a list counts too");
});

test("every area is present, so a chains block is never read and a line waits on nothing but its when", (t) => {
  const from = plugin(t, { data: (a) => ({ area: a, lines: [{ for: "main", mode: "any", text: LINE.main(a) }], chains: [{ partner: "agent-works", for: "main", mode: "any", text: `${a} waits on agent-works` }] }) });
  const out = lines(t, repo(t, "manifest"), { from });
  assert.ok(!/waits on/.test(out.context), out.context);
  for (const a of AREAS) assert.deepEqual(out.of(a), [LINE.main(a)]);
});

test("an area whose lines are missing or do not parse costs only its own block", (t) => {
  const from = plugin(t, { data: (a) => (a === "code-diet" ? null : a === "docs-parity" ? "{ not json" : { area: a, lines: linesOf(a) }) });
  const out = lines(t, repo(t, "manifest"), { from });
  assert.deepEqual(out.areas, AREAS.filter((a) => a !== "code-diet" && a !== "docs-parity"));
});

test("criticalBlocks: the shared line stands alone where no area has a line, and nothing prints in mode none", () => {
  const state = { mode: "full", subagent: false, denied: false, root: null };
  assert.deepEqual(criticalBlocks(state, [{ area: "code-diet", data: { lines: [] } }, { area: "system-map", data: null }]), [SHARED_LINE]);
  assert.deepEqual(criticalBlocks({ ...state, mode: "none" }, [{ area: "code-diet", data: { lines: linesOf("code-diet") } }]), []);
  assert.deepEqual(criticalBlocks({ ...state, subagent: true, denied: true }, [{ area: "code-diet", data: { lines: linesOf("code-diet") } }]), []);
});

test("the work tree of the payload's cwd is judged, not the project dir", (t) => {
  const project = repo(t, "off"), worktree = repo(t, "manifest");
  assert.ok(lines(t, worktree, { env: { CLAUDE_PROJECT_DIR: project } }).of("code-diet").includes(LINE.full("code-diet")));
  assert.equal(lines(t, project, { env: { CLAUDE_PROJECT_DIR: worktree } }).raw, "");
  assert.equal(answer({ cwd: worktree }, { CLAUDE_PROJECT_DIR: project }).mode, "full");
});

// ---- the question -----------------------------------------------------------

const QUESTION = new RegExp(`whether to use the ${PLUGIN} plugin in this repo`);

test("an unanswered repo: one question with three answers, the team conventions always among them, and no lines", (t) => {
  for (const kind of ["plain", "remote"]) {
    const out = lines(t, repo(t, kind));
    assert.match(out.context, QUESTION);
    assert.ok(out.context.includes(`the team conventions (on their yes, /${PLUGIN}:agentic-teamwork bootstrap)`), out.context);
    assert.match(out.context, /the plugin only/);
    assert.ok(out.context.includes(`git config --local ${CONFIG_KEY} "<team|on|off> <who> <iso date>"`), out.context);
    assert.match(out.context, /never ask again/);
    assert.deepEqual(out.areas, []);
    assert.ok(!out.context.includes(SHARED_LINE), "nothing is said before the person has answered");
    assert.equal(out.context.split("Before other work").length - 1, 1, "asked once, by the one command");
    assert.ok(out.context.length <= 800, `the question is ${out.context.length} characters, over the gate's allowance`);
  }
});

test("the briefing command never asks", (t) => {
  assert.equal(briefing(t, repo(t, "plain"), { env: { FIXTURE_BRIEFING: "short" } }).raw, "");
});

test("an empty folder with no git yet is asked, and told the answer keeps after git init", (t) => {
  const dir = tempDir(t, "helper-empty-");
  write(dir, ".DS_Store", "");
  const out = lines(t, dir);
  assert.match(out.context, QUESTION);
  assert.match(out.context, /git init/);
});

test("a folder with files and no git, someone's notes, is not asked", (t) => {
  const dir = tempDir(t, "helper-notes-");
  write(dir, "notes.txt", "mine\n");
  assert.equal(lines(t, dir).raw, "");
});

test("no question where the answer is known: the manifest, a marker, or any recorded answer", (t) => {
  for (const kind of ["manifest", "marker", "marker-off", "team", "on", "off"]) assert.ok(!QUESTION.test(lines(t, repo(t, kind)).context), `asked in ${kind}`);
  assert.equal(questionFor({ subagent: false, mode: "none", choice: "off", root: repo(t, "plain") }), "");
});

// ---- subagents --------------------------------------------------------------

test("a general-purpose subagent gets only the lines marked all, and is never asked or briefed", (t) => {
  const dir = repo(t, "manifest");
  write(dir, ".agents/plan/README.md", "plan\n");
  const options = { event: "SubagentStart", agentType: "general-purpose" };
  const out = lines(t, dir, options);
  assert.equal(out.parsed.hookSpecificOutput.hookEventName, "SubagentStart");
  assert.equal(out.blocks[0], SHARED_LINE);
  for (const a of AREAS) assert.deepEqual(out.of(a), [LINE.all(a), LINE.planned(a)], a);
  assert.equal(lines(t, repo(t, "plain"), options).raw, "", "a subagent is never asked");
  assert.equal(briefing(t, dir, { ...options, env: { FIXTURE_BRIEFING: "short" } }).raw, "", "nor briefed, should the command ever be registered there");
});

test("a denied agent type gets nothing at all: no lines, no briefing, no migration", (t) => {
  const dir = repo(t, "manifest");
  write(dir, ".old/config.json", "{}\n");
  assert.ok(DENYLIST.has("Explore") && DENYLIST.has("Plan") && DENYLIST.has(`${PLUGIN}:vision-critic`));
  for (const agentType of DENYLIST) {
    const options = { event: "SubagentStart", agentType, env: { FIXTURE_BRIEFING: "short", FIXTURE_MIGRATE: "move" } };
    assert.equal(lines(t, dir, options).raw + briefing(t, dir, options).raw, "", `spoke to ${agentType}`);
  }
  assert.ok(fs.existsSync(path.join(dir, ".old", "config.json")), "a subagent's start moves nothing");
});

// ---- the briefing command ---------------------------------------------------

test("the briefing: each area's part in turn, in the main session, and no critical lines", (t) => {
  const out = briefing(t, repo(t, "on"), { env: { FIXTURE_BRIEFING: "short" } });
  assert.deepEqual(out.blocks, BRIEFED.map((a) => `${a} briefing in portable mode.`));
  assert.ok(!out.context.includes("Critical, from"), "the lines are the other command's");
  assert.ok(!out.context.includes(SHARED_LINE));
  assert.equal(briefing(t, repo(t, "on")).raw, "", "areas with nothing to say print nothing");
});

test("each part of the briefing is cut to its allowance, so the whole stays under what a host shows in full", (t) => {
  const dir = repo(t, "manifest");
  const out = briefing(t, dir, { env: { FIXTURE_BRIEFING: "long", FIXTURE_MIGRATE: "wordy" } });
  const parts = out.blocks.filter((b) => BRIEFED.some((a) => b.startsWith(`${a} b`)));
  assert.equal(parts.length, BRIEFED.length);
  for (const [i, a] of BRIEFED.entries()) {
    assert.equal(parts[i].length, BRIEFING_CHARS[a], `${a}'s part`);
    assert.ok(parts[i].endsWith("…"), "a cut part says it was cut");
  }
  const reports = out.blocks.filter((b) => !parts.includes(b));
  assert.ok(reports.length >= 1 && reports.reduce((n, b) => n + b.length, 0) <= MIGRATION_CHARS, "every area's migration report shares one allowance");
  assert.ok(out.raw.length <= 10000, `the command printed ${out.raw.length} characters`);
  assert.equal(out.message.split(" moved 1 path(s) to its current layout.").length - 1, BRIEFED.length, "the person still hears of every move");
});

test("clip leaves a text that fits alone and marks one it cut", () => {
  assert.equal(clip("short", 10), "short");
  assert.equal(clip("exactly ten", 11), "exactly ten");
  assert.equal(clip("a long line of words", 10), "a long li…");
  assert.equal(clip("a long line of words", 10).length, 10);
});

test("an area's briefing that throws, or does not load, costs only its own part", (t) => {
  const thrown = briefing(t, repo(t, "on"), { env: { FIXTURE_BRIEFING: "throws" } });
  assert.deepEqual(thrown.blocks, BRIEFED.filter((a) => a !== "agent-works").map((a) => `${a} still speaks.`));
  const from = plugin(t, { part: (a) => (a === "agent-works" ? "export const briefing = (" : a === "system-map" ? null : partOf(a)) });
  const broken = briefing(t, repo(t, "on"), { from, env: { FIXTURE_BRIEFING: "short" } });
  assert.deepEqual(broken.blocks, BRIEFED.filter((a) => a !== "agent-works" && a !== "system-map").map((a) => `${a} briefing in portable mode.`));
});

// ---- migration --------------------------------------------------------------

test("moveOnce moves a path once and never onto one that exists", (t) => {
  const dir = tempDir(t, "helper-move-");
  assert.equal(moveOnce(dir, "old/a.json", "new/deep/a.json"), "absent");
  write(dir, "old/a.json", "old\n");
  assert.equal(moveOnce(dir, "old/a.json", "new/deep/a.json"), "moved");
  assert.equal(fs.readFileSync(path.join(dir, "new/deep/a.json"), "utf8"), "old\n");
  write(dir, "old/a.json", "older\n");
  assert.equal(moveOnce(dir, "old/a.json", "new/deep/a.json"), "kept");
  assert.equal(fs.readFileSync(path.join(dir, "new/deep/a.json"), "utf8"), "old\n", "the target is untouched");
  assert.equal(fs.readFileSync(path.join(dir, "old/a.json"), "utf8"), "older\n", "so is the source");
});

test("a migration runs first, in a repo nobody has answered for, tells the model and the person, and is silent the second time", (t) => {
  const dir = repo(t, "plain");
  write(dir, ".old/config.json", '{"strict":true}\n');
  const env = { FIXTURE_MIGRATE: "move", FIXTURE_BRIEFING: "short" };
  const first = briefing(t, dir, { env });
  assert.match(first.blocks[0], /^perceptual-loop moved this repo to its current layout: \.old\/config\.json -> \.agents\/perceptual\/config\.json; wrote \.agents\/perceptual\/opt-in\.json\./);
  assert.match(first.blocks[0], /Strict mode stays on\./);
  assert.equal(first.message, "perceptual-loop moved 2 path(s) to its current layout.");
  assert.deepEqual(first.blocks.slice(1), BRIEFED.map((a) => `${a} briefing in portable mode.`), "the marker it created turns the mode on in the same run");
  assert.equal(fs.readFileSync(path.join(dir, ".agents/perceptual/config.json"), "utf8"), '{"strict":true}\n');
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, ".agents/perceptual/opt-in.json")).mode & 0o111, 0o111, "a write can make a file executable");
  assert.ok(lines(t, dir).of("perceptual-loop").includes(LINE.portable("perceptual-loop")), "and the lines command reads the new marker");

  const second = briefing(t, dir, { env });
  assert.deepEqual(second.blocks, BRIEFED.map((a) => `${a} briefing in portable mode.`));
  assert.equal(second.message, "");
});

test("a migration never overwrites: where both layouts exist the old one is left and named", (t) => {
  const dir = repo(t, "plain");
  write(dir, ".old/config.json", "old\n");
  write(dir, ".agents/perceptual/config.json", "new\n");
  write(dir, ".agents/perceptual/opt-in.json", "mine\n");
  const out = briefing(t, dir, { env: { FIXTURE_MIGRATE: "move" } });
  assert.match(out.context, /left these in place because the new path already exists: \.old\/config\.json/);
  assert.match(out.message, /left 1 old path\(s\) to merge by hand/);
  assert.equal(fs.readFileSync(path.join(dir, ".agents/perceptual/config.json"), "utf8"), "new\n");
  assert.equal(fs.readFileSync(path.join(dir, ".agents/perceptual/opt-in.json"), "utf8"), "mine\n");
  assert.equal(fs.readFileSync(path.join(dir, ".old/config.json"), "utf8"), "old\n");
});

test("a migration that throws says so, and the briefing still goes out", (t) => {
  const out = briefing(t, repo(t, "on"), { env: { FIXTURE_MIGRATE: "throw", FIXTURE_BRIEFING: "short" } });
  assert.match(out.blocks[0], /perceptual-loop could not finish moving to its current layout \(disk says no\)/);
  assert.match(out.message, /could not finish a layout move/);
  assert.deepEqual(out.blocks.slice(1), BRIEFED.map((a) => `${a} briefing in portable mode.`));
});

test("the lines command moves nothing: a migration is the briefing command's", (t) => {
  const dir = repo(t, "on");
  write(dir, ".old/config.json", "{}\n");
  lines(t, dir, { env: { FIXTURE_MIGRATE: "move" } });
  assert.ok(fs.existsSync(path.join(dir, ".old", "config.json")));
});

// ---- the catalog ------------------------------------------------------------

function catalogHome(t, { source = { source: "github", repo: "someone/catalog" }, plugins = [[PLUGIN, "2.0.0", "1.9.0"], ["agent-works", "5.0.0", "4.2.0"], ["code-diet", "1.0.0", "1.0.0"]] } = {}) {
  const config = tempDir(t, "helper-catalog-home-");
  const clone = tempDir(t, "helper-catalog-");
  write(clone, ".claude-plugin/marketplace.json", JSON.stringify({ name: MARKETPLACE, plugins: plugins.map(([name]) => ({ name, source: `./plugins/${name}`, description: `${name}.` })) }));
  for (const [name, version] of plugins) write(clone, `plugins/${name}/.claude-plugin/plugin.json`, JSON.stringify({ name, version }));
  write(config, "plugins/known_marketplaces.json", JSON.stringify({ [MARKETPLACE]: { source, installLocation: clone } }));
  write(config, "plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: Object.fromEntries(plugins.map(([name, , installed]) => [`${name}@${MARKETPLACE}`, [{ scope: "user", version: installed }]])) }));
  return config;
}

test("the briefing names what is installed behind the catalog: this plugin, and an older name still installed beside it", (t) => {
  const dir = repo(t, "on");
  const config = catalogHome(t);
  const out = briefing(t, dir, { config });
  assert.equal(out.blocks.length, 1);
  assert.ok(out.blocks[0].startsWith(`Behind the ${MARKETPLACE} catalog: ${PLUGIN} 1.9.0 (catalog 2.0.0), agent-works 4.2.0 (catalog 5.0.0).`), out.context);
  assert.ok(out.blocks[0].includes(`claude plugin update <name>@${MARKETPLACE}`));
  assert.ok(!/code-diet/.test(out.context), "a plugin level with the catalog is not named");
  assert.match(briefing(t, dir, { config }).context, /Behind the/, "every session, until it is updated");
  assert.equal(lines(t, dir, { config }).context.includes("catalog"), false, "the lines command carries no notice");
  assert.equal(briefing(t, dir, { config, event: "SubagentStart", agentType: "general-purpose" }).raw, "");
  assert.equal(briefing(t, repo(t, "off"), { config }).raw, "", "and never where the person said no");
});

test("a long list of plugins behind the catalog is cut to the notice's allowance", (t) => {
  const many = Array.from({ length: 40 }, (_, i) => [`an-older-plugin-name-${i}`, "2.0.0", "1.0.0"]);
  const out = briefing(t, repo(t, "on"), { config: catalogHome(t, { plugins: many }) });
  assert.equal(out.blocks.length, 1);
  assert.equal(out.blocks[0].length, CATALOG_CHARS);
});

test("a marketplace registered from a local checkout is never behind", (t) => {
  const config = catalogHome(t, { source: { source: "directory", path: "somewhere" } });
  assert.equal(briefing(t, repo(t, "on"), { config }).raw, "");
  assert.deepEqual(helper.behindCatalog({ CLAUDE_CONFIG_DIR: config }), []);
});

// ---- failure ----------------------------------------------------------------

test("fail open: empty and malformed stdin exit 0 with nothing on stderr, from both commands", (t) => {
  for (const script of ["session-start.mjs", "briefing.mjs"]) {
    for (const input of ["", "{\"hook_event_name\":", "null", "[]"]) {
      const out = hook(t, script, tempDir(t, "helper-fail-"), { input, env: { FIXTURE_BRIEFING: "short", FIXTURE_MIGRATE: "move" } });
      if (out.raw.trim()) assert.doesNotThrow(() => JSON.parse(out.raw), "whatever it prints is one JSON object");
    }
  }
});

test("a plugin with no area folders at all prints the shared line alone, and no briefing", (t) => {
  const from = plugin(t, { data: () => null, part: () => null });
  const dir = repo(t, "manifest");
  assert.deepEqual(lines(t, dir, { from }).blocks, [SHARED_LINE]);
  assert.equal(briefing(t, dir, { from, env: { FIXTURE_BRIEFING: "short" } }).raw, "");
});

// The route index: at a 200k window the host lists the plugin's skills by
// name alone, fourteen names and no route, so the lines command names each
// area's routes itself. It is read from the areas' own door.json files.
test("the route index names every area's routes, from each door.json, and says how a route is taken", () => {
  const areas = helper.readRoutes(path.join(REPO, "plugins", PLUGIN, "skills"));
  assert.equal(areas.length, 13, "every area, whether or not it keeps critical lines");
  assert.ok(!areas.some((a) => a.area === "start-here"), "the entry skill has no routes");
  const index = helper.routeIndex({ mode: "full", subagent: false }, areas);
  const [head, ...rows] = index.split("\n");
  assert.equal(head, helper.ROUTES_HEAD);
  assert.match(head, /call it with the Skill tool and the route as the first word of its arguments/);
  assert.equal(rows.length, 13);
  for (const { area, routes } of areas) {
    const door = JSON.parse(fs.readFileSync(path.join(REPO, "plugins", PLUGIN, "skills", area, "door.json"), "utf8"));
    assert.deepEqual(routes, Object.keys(door.routes), area);
    assert.ok(rows.includes(`- ${area}: ${routes.join(", ")}`), area);
  }
  // The two the first run on the one-plugin tree lost at 200k, where only names show.
  assert.match(index, /^- agentic-teamwork: .*\bship\b/m);
  assert.match(index, /^- system-map: .*\bmiro-board\b/m);
});

test("the route index is the main session's, where the plugin speaks: not a subagent's, and not a repo nobody answered for", () => {
  const areas = [{ area: "work", routes: ["build", "check"] }];
  assert.equal(helper.routeIndex({ mode: "portable", subagent: false }, areas), `${helper.ROUTES_HEAD}\n- work: build, check`);
  assert.equal(helper.routeIndex({ mode: "full", subagent: true }, areas), "");
  assert.equal(helper.routeIndex({ mode: "none", subagent: false }, areas), "");
  assert.equal(helper.routeIndex({ mode: "full", subagent: false }, []), "");
  // A skill directory with no door.json, or one with no routes, is no area.
  const dir = tempDir(suite, "routes-");
  write(dir, "work/door.json", JSON.stringify({ lead: "x", default: "build", routes: { build: { cue: "a" }, check: { cue: "b" } } }));
  write(dir, "start-here/SKILL.md", "---\nname: start-here\n---\n");
  write(dir, "empty/door.json", JSON.stringify({ routes: {} }));
  assert.deepEqual(helper.readRoutes(dir), areas);
  assert.deepEqual(helper.readRoutes(path.join(dir, "nowhere")), []);
});

test("the lines command prints the route index after the areas' blocks in the main session, and never to a subagent", (t) => {
  // The plugin as it ships: the throwaway one this suite builds has no door.json, and so no index.
  const from = path.join(REPO, "plugins", PLUGIN);
  const dir = repo(t, "manifest");
  const main = lines(t, dir, { from });
  const at = main.blocks.findIndex((b) => b.startsWith(helper.ROUTES_HEAD));
  assert.ok(at > 0, main.context.slice(0, 300));
  assert.ok(main.blocks.slice(at + 1).every((b) => !b.startsWith("Critical, from ")), "after the last area's block");
  assert.equal(main.blocks[at].split("\n").length, 14, "the heading and a row per area");
  assert.ok(!lines(t, dir, { from, event: "SubagentStart", agentType: "general-purpose" }).context.includes(helper.ROUTES_HEAD));
  assert.ok(!lines(t, dir).context.includes(helper.ROUTES_HEAD), "a plugin with no area data prints no index");
});
