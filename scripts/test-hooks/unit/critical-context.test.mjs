// scripts/shared/critical-context.mjs, run the way a plugin runs it: one
// plugin directory per name in ORDER, each with a copy of the kernel, its own
// critical.json, and a session hook that calls run(). The hooks get one
// payload on stdin, with the person's settings in a temp CLAUDE_CONFIG_DIR so
// a developer's own enabledPlugins never leak into a fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";
import { CONFIG_KEY, DENYLIST, MARKERS, MARKETPLACE, OLD_MANIFESTS, ORDER, SHARED_LINE, enabledPlugins, isAsker, modeOf, moveOnce } from "../../shared/critical-context.mjs";

const KERNEL = path.join(REPO, "scripts", "shared", "critical-context.mjs");
const suite = { after };
const PLUGINS = tempDir(suite, "kernel-plugins-");

// Every plugin gets the same shape of lines, so a test can name the line it
// expects without a table: one per audience and mode, one gated on a file,
// and a chain to the next plugin in ORDER.
const partnerOf = (p) => ORDER[(ORDER.indexOf(p) + 1) % ORDER.length];
const LINE = {
  all: (p) => `${p}: every agent`,
  main: (p) => `${p}: the main session`,
  full: (p) => `${p}: a repo with the marker`,
  portable: (p) => `${p}: a repo without it`,
  planned: (p) => `${p}: where a plan exists`,
  chain: (p) => `${p} hands off to ${partnerOf(p)}`,
};
const HOOK = `import { run } from "./critical-context.mjs";
const migrations = {
  move: ({ move, write }) => { move(".old/config.json", ".agents/perceptual/config.json"); write(".agents/perceptual/opt-in.json", "{}\\n", { mode: 0o755 }); return "Strict mode stays on."; },
  throw: () => { throw new Error("disk says no"); },
};
await run(
  (payload, state) => (process.env.FIXTURE_BRIEFING ? \`Briefing in \${state.mode} mode.\` : ""),
  { migrate: migrations[process.env.FIXTURE_MIGRATE] },
);
`;
for (const p of ORDER) {
  fs.mkdirSync(path.join(PLUGINS, p, "hooks"), { recursive: true });
  fs.copyFileSync(KERNEL, path.join(PLUGINS, p, "hooks", "critical-context.mjs"));
  write(PLUGINS, `${p}/hooks/session-start.mjs`, HOOK);
  write(PLUGINS, `${p}/hooks/critical.json`, JSON.stringify({
    plugin: p,
    lines: [
      { for: "all", mode: "any", text: LINE.all(p) },
      { for: "main", mode: "any", text: LINE.main(p) },
      { for: "main", mode: "full", text: LINE.full(p) },
      { for: "main", mode: "portable", text: LINE.portable(p) },
      { for: "all", mode: "any", when: ".agents/plan", text: LINE.planned(p) },
    ],
    chains: [{ partner: partnerOf(p), for: "main", mode: "any", text: LINE.chain(p) }],
  }));
}

/** A settings dir enabling exactly these plugins. */
function settings(t, enabled, extra = {}) {
  const dir = tempDir(t, "kernel-settings-");
  write(dir, "settings.json", JSON.stringify({ enabledPlugins: Object.fromEntries(enabled.map((n) => [`${n}@${MARKETPLACE}`, true])), ...extra }));
  return dir;
}

const ANSWER = { team: "team Test 2026-01-01T00:00Z", on: "on Test 2026-01-01T00:00Z", off: "off Test 2026-01-01T00:00Z" };
function repo(t, kind) {
  const { dir, git } = tempRepo(t, `kernel-${kind}-`);
  if (kind === "manifest") write(dir, ".agents/manifest.json", "{}\n");
  if (kind === "marker") write(dir, ".agents/agent-works.json", "{}\n");
  if (kind === "marker-off") { write(dir, ".agents/docs-parity.json", "{}\n"); git("config", "--local", CONFIG_KEY, ANSWER.off); }
  if (kind in ANSWER) git("config", "--local", CONFIG_KEY, ANSWER[kind]);
  if (kind === "remote") git("remote", "add", "origin", "https://github.com/someone/thing.git");
  return dir;
}

function hook(t, plugin, dir, { enabled = ORDER, event = "SessionStart", agentType, config, env = {} } = {}) {
  const payload = { hook_event_name: event, source: "startup", session_id: "s", cwd: dir, ...(agentType ? { agent_type: agentType } : {}) };
  const cfg = config ?? settings(t, enabled);
  const out = runNode(path.join(PLUGINS, plugin, "hooks", "session-start.mjs"), [], {
    cwd: dir,
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOME: cfg, USERPROFILE: cfg, CLAUDE_PROJECT_DIR: "", CLAUDE_PLUGIN_DATA: "", CLAUDE_CODE_PLUGIN_CACHE_DIR: "", ...env },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, "");
  if (!out.stdout.trim()) return { context: "", lines: [], message: "" };
  const parsed = JSON.parse(out.stdout);
  const context = parsed.hookSpecificOutput?.additionalContext ?? "";
  const block = context.split("\n\n").find((b) => b.startsWith(`Critical, from ${plugin}:`)) ?? "";
  return { context, parsed, message: parsed.systemMessage ?? "", lines: block.split("\n").slice(1).map((l) => l.replace(/^- /, "")) };
}

// ---- the helper's answers ------------------------------------------------

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

test("mode: a repo still on an older layout's marker is full before its plugin has moved it", (t) => {
  for (const marker of OLD_MANIFESTS) {
    const dir = repo(t, "off");
    write(dir, marker, "{}\n");
    assert.equal(modeOf(dir), "full", marker);
  }
});

test("enabled: project and local settings override the user's", (t) => {
  const env = { CLAUDE_CONFIG_DIR: settings(t, ["agentic-teamwork", "agent-works"]) };
  const dir = repo(t, "plain");
  const none = path.join(tempDir(t), "absent.json");
  const on = (extra) => [...enabledPlugins(dir, env, extra ?? none)];
  assert.deepEqual(on(), ["agentic-teamwork", "agent-works"]);
  write(dir, ".claude/settings.json", JSON.stringify({ enabledPlugins: { [`agent-works@${MARKETPLACE}`]: false, [`but-first-planning@${MARKETPLACE}`]: true } }));
  assert.deepEqual(on(), ["agentic-teamwork", "but-first-planning"]);
  write(dir, ".claude/settings.local.json", JSON.stringify({ enabledPlugins: { [`agent-works@${MARKETPLACE}`]: true, [`agentic-teamwork@${MARKETPLACE}`]: false } }));
  assert.deepEqual(on(), ["agent-works", "but-first-planning"]);
  write(dir, ".claude/settings.local.json", "{ not json");
  assert.deepEqual(on(), ["agentic-teamwork", "but-first-planning"], "an unreadable file is skipped, not fatal");
  const managed = write(tempDir(t), "managed-settings.json", JSON.stringify({ enabledPlugins: { [`code-diet@${MARKETPLACE}`]: true, [`agentic-teamwork@${MARKETPLACE}`]: false } }));
  assert.deepEqual(on(managed), ["code-diet", "but-first-planning"], "the managed file wins over every other");
  assert.deepEqual([...enabledPlugins(dir, { ...env, CLAUDE_CONFIG_DIR: tempDir(t) }, none)], ["but-first-planning"], "a plugin from another marketplace never counts");
});

test("enabled: a worktree session reads the main checkout's local settings", (t) => {
  const main = repo(t, "plain"), worktree = repo(t, "plain");
  write(main, ".claude/settings.local.json", JSON.stringify({ enabledPlugins: { [`code-diet@${MARKETPLACE}`]: true } }));
  const env = { CLAUDE_CONFIG_DIR: settings(t, []), CLAUDE_PROJECT_DIR: main };
  assert.deepEqual([...enabledPlugins(worktree, env, path.join(tempDir(t), "absent.json"))], ["code-diet"]);
});

test("asker: the first enabled plugin in ORDER", () => {
  assert.deepEqual(ORDER, ["agentic-teamwork", "agent-works", "code-diet", "docs-parity", "but-first-planning", "perceptual-loop", "marvelous-miro"]);
  const all = new Set(ORDER);
  assert.equal(isAsker("agentic-teamwork", all), true);
  assert.equal(isAsker("agent-works", all), false);
  assert.equal(isAsker("code-diet", new Set(["code-diet", "perceptual-loop"])), true);
  assert.equal(isAsker("perceptual-loop", new Set(["code-diet", "perceptual-loop"])), false);
  assert.equal(isAsker("marvelous-miro", new Set(["marvelous-miro"])), true);
  assert.equal(isAsker("docs-parity", new Set()), false, "nothing enabled, nobody asks");
});

test("the shared first line is printed once, by the asker, across every plugin's hook", (t) => {
  const dir = repo(t, "manifest");
  for (const [enabled, asker] of [[ORDER, "agentic-teamwork"], [["agent-works", "docs-parity", "perceptual-loop"], "agent-works"], [["perceptual-loop", "marvelous-miro"], "perceptual-loop"]]) {
    const config = settings(t, enabled);
    const seen = enabled.filter((p) => hook(t, p, dir, { config }).lines.includes(SHARED_LINE));
    assert.deepEqual(seen, [asker], `enabled ${enabled.join(",")}`);
    assert.equal(hook(t, asker, dir, { config }).lines[0], SHARED_LINE, "the shared line comes first in the asker's block");
  }
});

test("a plugin with no settings entry still counts itself enabled", (t) => {
  const out = hook(t, "docs-parity", repo(t, "manifest"), { enabled: [] });
  assert.equal(out.lines[0], SHARED_LINE, "alone, it is the asker");
  assert.ok(out.lines.includes(LINE.all("docs-parity")));
});

// ---- repo states ---------------------------------------------------------

test("a repo with the manifest gets the full lines and none of the portable ones", (t) => {
  for (const kind of ["manifest", "team"]) {
    const out = hook(t, "code-diet", repo(t, kind));
    assert.deepEqual(out.lines, [LINE.all("code-diet"), LINE.main("code-diet"), LINE.full("code-diet"), LINE.chain("code-diet")], kind);
  }
});

test("on, or a plugin's own marker, gets the portable lines and none of the full ones", (t) => {
  for (const kind of ["on", "marker", "marker-off"]) {
    const out = hook(t, "code-diet", repo(t, kind));
    assert.deepEqual(out.lines, [LINE.all("code-diet"), LINE.main("code-diet"), LINE.portable("code-diet"), LINE.chain("code-diet")], kind);
  }
});

test("off prints nothing from any plugin, briefing included", (t) => {
  const dir = repo(t, "off");
  for (const p of ORDER) assert.equal(hook(t, p, dir, { env: { FIXTURE_BRIEFING: "1" } }).context, "", p);
});

test("a line gated on a file prints only where the repo has it", (t) => {
  const dir = repo(t, "manifest");
  assert.ok(!hook(t, "but-first-planning", dir).lines.includes(LINE.planned("but-first-planning")));
  write(dir, ".agents/plan/README.md", "plan\n");
  assert.ok(hook(t, "but-first-planning", dir).lines.includes(LINE.planned("but-first-planning")));
});

test("each chain line prints only when its partner is enabled", (t) => {
  const dir = repo(t, "manifest");
  for (const owner of ORDER) {
    const text = LINE.chain(owner);
    assert.ok(hook(t, owner, dir, { enabled: [owner, partnerOf(owner)] }).lines.includes(text), `${owner} with ${partnerOf(owner)}`);
    assert.ok(!hook(t, owner, dir, { enabled: [owner] }).lines.includes(text), `${owner} without ${partnerOf(owner)}`);
  }
});

test("the work tree of the payload's cwd is judged, not the project dir", (t) => {
  const project = repo(t, "off"), worktree = repo(t, "manifest");
  assert.ok(hook(t, "code-diet", worktree, { env: { CLAUDE_PROJECT_DIR: project } }).lines.includes(LINE.full("code-diet")));
  assert.equal(hook(t, "code-diet", project, { env: { CLAUDE_PROJECT_DIR: worktree } }).context, "");
});

// ---- the briefing --------------------------------------------------------

test("a briefing comes first, in the main session only", (t) => {
  const dir = repo(t, "on");
  const env = { FIXTURE_BRIEFING: "1" };
  const main = hook(t, "agent-works", dir, { env });
  assert.ok(main.context.startsWith("Briefing in portable mode.\n\nCritical, from agent-works:"), main.context);
  const sub = hook(t, "agent-works", dir, { env, event: "SubagentStart", agentType: "general-purpose" });
  assert.ok(sub.context.startsWith("Critical, from agent-works:"), sub.context);
});

// ---- the question --------------------------------------------------------

const QUESTION = new RegExp(`whether to use the ${MARKETPLACE} plugins`);

test("an unanswered repo: the asker asks with three answers, and no critical lines go out", (t) => {
  for (const kind of ["plain", "remote"]) {
    const out = hook(t, "agentic-teamwork", repo(t, kind));
    assert.match(out.context, QUESTION);
    assert.match(out.context, /team conventions \(then run \/agentic-teamwork:bootstrap\)/);
    assert.match(out.context, /plugins only/);
    assert.ok(out.context.includes(`git config --local ${CONFIG_KEY} "<team|on|off> <who> <iso date>"`), out.context);
    assert.match(out.context, /never ask again/);
    assert.deepEqual(out.lines, []);
    assert.ok(out.context.length < 1200, `the question is ${out.context.length} characters`);
  }
});

test("without agentic-teamwork enabled, the team conventions are not offered", (t) => {
  const out = hook(t, "agent-works", repo(t, "plain"), { enabled: ["agent-works", "code-diet"] });
  assert.match(out.context, QUESTION);
  assert.ok(!/team conventions|bootstrap|team\|/.test(out.context), out.context);
  assert.ok(out.context.includes(`git config --local ${CONFIG_KEY} "<on|off> <who> <iso date>"`), out.context);
});

test("an empty folder with no git yet is asked, and told the answer keeps after git init", (t) => {
  const dir = tempDir(t, "kernel-empty-");
  write(dir, ".DS_Store", "");
  const out = hook(t, "agentic-teamwork", dir);
  assert.match(out.context, QUESTION);
  assert.match(out.context, /git init/);
});

test("a folder with files and no git, someone's notes, is not asked", (t) => {
  const dir = tempDir(t, "kernel-notes-");
  write(dir, "notes.txt", "mine\n");
  assert.equal(hook(t, "agentic-teamwork", dir).context, "");
});

test("no question where the answer is known: the manifest, a marker, or any recorded answer", (t) => {
  for (const kind of ["manifest", "marker", "marker-off", "team", "on", "off"]) {
    const dir = repo(t, kind);
    for (const p of ORDER) assert.ok(!QUESTION.test(hook(t, p, dir).context), `${p} asked in ${kind}`);
  }
});

test("exactly one plugin asks: the first enabled in ORDER", (t) => {
  const dir = repo(t, "plain");
  for (const [enabled, asker] of [[ORDER, "agentic-teamwork"], [["code-diet", "docs-parity", "perceptual-loop"], "code-diet"], [["marvelous-miro"], "marvelous-miro"]]) {
    const config = settings(t, enabled);
    assert.deepEqual(enabled.filter((p) => QUESTION.test(hook(t, p, dir, { config }).context)), [asker], `enabled ${enabled.join(",")}`);
  }
});

// ---- subagents -----------------------------------------------------------

test("a general-purpose subagent gets only the lines marked all, and is never asked", (t) => {
  const dir = repo(t, "manifest");
  write(dir, ".agents/plan/README.md", "plan\n");
  for (const p of ORDER) {
    const out = hook(t, p, dir, { event: "SubagentStart", agentType: "general-purpose" });
    assert.equal(out.parsed.hookSpecificOutput.hookEventName, "SubagentStart");
    assert.deepEqual(out.lines.filter((l) => l !== SHARED_LINE), [LINE.all(p), LINE.planned(p)], p);
  }
  assert.ok(hook(t, "agentic-teamwork", dir, { event: "SubagentStart", agentType: "general-purpose" }).lines.includes(SHARED_LINE));
  for (const p of ORDER) assert.equal(hook(t, p, repo(t, "plain"), { event: "SubagentStart", agentType: "general-purpose" }).context, "", `${p} asked a subagent`);
});

test("a denied agent type gets nothing at all from any plugin: no lines, no briefing, no migration", (t) => {
  const dir = repo(t, "manifest");
  write(dir, ".old/config.json", "{}\n");
  assert.ok(DENYLIST.has("Explore") && DENYLIST.has("Plan") && DENYLIST.has("perceptual-loop:vision-critic"));
  for (const agentType of DENYLIST) {
    for (const p of ORDER) {
      const out = hook(t, p, dir, { event: "SubagentStart", agentType, env: { FIXTURE_BRIEFING: "1", FIXTURE_MIGRATE: "move" } });
      assert.equal(out.context + out.message, "", `${p} spoke to ${agentType}`);
    }
  }
  assert.ok(fs.existsSync(path.join(dir, ".old", "config.json")), "a subagent's start moves nothing");
});

// ---- migration -----------------------------------------------------------

test("moveOnce moves a path once and never onto one that exists", (t) => {
  const dir = tempDir(t, "kernel-move-");
  assert.equal(moveOnce(dir, "old/a.json", "new/deep/a.json"), "absent");
  write(dir, "old/a.json", "old\n");
  assert.equal(moveOnce(dir, "old/a.json", "new/deep/a.json"), "moved");
  assert.equal(fs.readFileSync(path.join(dir, "new/deep/a.json"), "utf8"), "old\n");
  write(dir, "old/a.json", "older\n");
  assert.equal(moveOnce(dir, "old/a.json", "new/deep/a.json"), "kept");
  assert.equal(fs.readFileSync(path.join(dir, "new/deep/a.json"), "utf8"), "old\n", "the target is untouched");
  assert.equal(fs.readFileSync(path.join(dir, "old/a.json"), "utf8"), "older\n", "so is the source");
});

test("a migration runs first, tells the model and the person, turns the mode on, and is silent the second time", (t) => {
  const dir = repo(t, "plain");
  write(dir, ".old/config.json", '{"strict":true}\n');
  const env = { FIXTURE_MIGRATE: "move" };
  const first = hook(t, "perceptual-loop", dir, { env });
  assert.match(first.context, /^perceptual-loop moved this repo to its current layout: \.old\/config\.json -> \.agents\/perceptual\/config\.json; wrote \.agents\/perceptual\/opt-in\.json\./);
  assert.match(first.context, /Strict mode stays on\./);
  assert.equal(first.message, "perceptual-loop moved 2 path(s) to its current layout.");
  assert.ok(first.lines.includes(LINE.portable("perceptual-loop")), "the marker it created counts in the same session");
  assert.ok(!QUESTION.test(first.context));
  assert.equal(fs.readFileSync(path.join(dir, ".agents/perceptual/config.json"), "utf8"), '{"strict":true}\n');
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, ".agents/perceptual/opt-in.json")).mode & 0o111, 0o111, "a write can make a file executable");

  const second = hook(t, "perceptual-loop", dir, { env });
  assert.ok(second.context.startsWith("Critical, from perceptual-loop:"), second.context);
  assert.equal(second.message, "");
});

test("a migration never overwrites: where both layouts exist the old one is left and named", (t) => {
  const dir = repo(t, "plain");
  write(dir, ".old/config.json", "old\n");
  write(dir, ".agents/perceptual/config.json", "new\n");
  write(dir, ".agents/perceptual/opt-in.json", "mine\n");
  const out = hook(t, "perceptual-loop", dir, { env: { FIXTURE_MIGRATE: "move" } });
  assert.match(out.context, /left these in place because the new path already exists: \.old\/config\.json/);
  assert.match(out.message, /left 1 old path\(s\) to merge by hand/);
  assert.equal(fs.readFileSync(path.join(dir, ".agents/perceptual/config.json"), "utf8"), "new\n");
  assert.equal(fs.readFileSync(path.join(dir, ".agents/perceptual/opt-in.json"), "utf8"), "mine\n");
  assert.equal(fs.readFileSync(path.join(dir, ".old/config.json"), "utf8"), "old\n");
});

test("a migration that throws says so, and the lines still go out", (t) => {
  const out = hook(t, "perceptual-loop", repo(t, "on"), { env: { FIXTURE_MIGRATE: "throw" } });
  assert.match(out.context, /could not finish moving to its current layout \(disk says no\)/);
  assert.match(out.message, /could not finish a layout move/);
  assert.ok(out.lines.includes(LINE.all("perceptual-loop")));
});

// ---- the catalog ---------------------------------------------------------

function catalogHome(t, { source = { source: "github", repo: "someone/catalog" } } = {}) {
  const config = settings(t, ["agent-works", "code-diet"]);
  const clone = tempDir(t, "kernel-catalog-");
  const plugins = [["agent-works", "2.0.0", "Runs the board."], ["code-diet", "1.0.0", "Keeps code small."], ["new-thing", "0.1.0", "Does a new thing. And more besides."]];
  write(clone, ".claude-plugin/marketplace.json", JSON.stringify({ name: MARKETPLACE, plugins: plugins.map(([name, , description]) => ({ name, source: `./plugins/${name}`, description })) }));
  for (const [name, version] of plugins) write(clone, `plugins/${name}/.claude-plugin/plugin.json`, JSON.stringify({ name, version }));
  write(config, "plugins/known_marketplaces.json", JSON.stringify({ [MARKETPLACE]: { source, installLocation: clone } }));
  write(config, "plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: {
    [`agent-works@${MARKETPLACE}`]: [{ scope: "user", version: "1.9.0" }],
    [`code-diet@${MARKETPLACE}`]: [{ scope: "user", version: "1.0.0" }],
  } }));
  return { config, env: { CLAUDE_PLUGIN_DATA: tempDir(t, "kernel-data-") } };
}

test("the asker names plugins behind the catalog every session and each new plugin once", (t) => {
  const dir = repo(t, "on");
  const { config, env } = catalogHome(t);
  const first = hook(t, "agent-works", dir, { config, env });
  assert.match(first.context, new RegExp(`Behind the ${MARKETPLACE} catalog: agent-works 1\\.9\\.0 \\(catalog 2\\.0\\.0\\)\\. Update: claude plugin update agent-works@${MARKETPLACE}`));
  assert.match(first.context, /New in the .* catalog: new-thing \(Does a new thing\.\)/);
  const second = hook(t, "agent-works", dir, { config, env });
  assert.match(second.context, /Behind the/);
  assert.ok(!/New in the/.test(second.context), "news is told once");
  assert.ok(!/catalog/.test(hook(t, "code-diet", dir, { config, env }).context), "only the asker carries the notices");
  assert.ok(!/catalog/.test(hook(t, "agent-works", dir, { config, env, event: "SubagentStart", agentType: "general-purpose" }).context));
  assert.ok(!/catalog:/.test(hook(t, "agent-works", repo(t, "off"), { config, env }).context), "and never where the person said no");
});

test("a marketplace registered from a local checkout is never behind", (t) => {
  const { config, env } = catalogHome(t, { source: { source: "directory", path: "somewhere" } });
  assert.ok(!/Behind the/.test(hook(t, "agent-works", repo(t, "on"), { config, env }).context));
});

// ---- failure -------------------------------------------------------------

test("a kernel with no critical.json beside it does nothing, migration included", (t) => {
  const plugin = tempDir(t, "kernel-nameless-");
  fs.copyFileSync(KERNEL, path.join(plugin, "critical-context.mjs"));
  write(plugin, "session-start.mjs", HOOK);
  const dir = repo(t, "manifest");
  write(dir, ".old/config.json", "{}\n");
  const cfg = settings(t, ORDER);
  const out = runNode(path.join(plugin, "session-start.mjs"), [], { cwd: dir, input: JSON.stringify({ hook_event_name: "SessionStart", cwd: dir }), env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOME: cfg, CLAUDE_PROJECT_DIR: "", FIXTURE_MIGRATE: "move", FIXTURE_BRIEFING: "1" } });
  assert.deepEqual([out.status, out.stdout, out.stderr], [0, "", ""]);
  assert.ok(fs.existsSync(path.join(dir, ".old", "config.json")));
});

test("fail open: empty and malformed stdin exit 0 with nothing on stderr", (t) => {
  const cfg = settings(t, []);
  for (const p of ORDER) {
    for (const input of ["", "{\"hook_event_name\":", "null", "[]"]) {
      const out = runNode(path.join(PLUGINS, p, "hooks", "session-start.mjs"), [], { cwd: tempDir(t, "kernel-fail-"), input, env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOME: cfg, USERPROFILE: cfg, CLAUDE_PROJECT_DIR: "" } });
      assert.equal(out.status, 0, `${p}: ${out.stderr}`);
      assert.equal(out.stderr, "");
      if (out.stdout.trim()) assert.doesNotThrow(() => JSON.parse(out.stdout), "whatever it prints is one JSON object");
    }
  }
});
