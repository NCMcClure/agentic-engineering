// door-plugin.mjs moves one plugin into the one plugin as an area: the
// directory to skills/<area>/, its skills to routes/ as ROUTE.md documents,
// its hook maps, agents, and MCP servers to the one plugin's own, and every
// address and path that named it to where it is now. Each behavior and its
// edge, on a fixture marketplace whose plugins no catalog here carries, so
// the addresses below are not addresses to this checkout's own validate.
// door-plugin: leave
// (The line above keeps the script from rewriting this file's own strings:
// they build scratch marketplaces, some under a real plugin's name.)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { AREA_PLUGIN, areaPlugin, areaSummary } from "../../door-plugin.mjs";
import { hookCommand, namedDirs, namedPaths, parseFrontmatter, readJson, walk } from "../../lib.mjs";
import { execFileSync } from "node:child_process";
import { REPO, runNode, tempRepo, write } from "./helpers.mjs";

// One cleanup for every fixture: several cases read what a single run left.
const cleanups = [];
after(() => { for (const fn of cleanups) fn(); });
const keep = { after: (fn) => cleanups.push(fn) };

const runGit = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const SCRIPT = path.join(REPO, "scripts", "door-plugin.mjs");
const GEN = path.join(REPO, "scripts", "gen-guide.mjs");
const ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";
// The one plugin the fixture moves into. Not the real one's name: this file is
// tracked, and an address under a plugin this checkout lists would be read
// as one by its own validate.
const INTO = "single";
const ONE = `plugins/${INTO}`;
const AREA = `${ONE}/skills/demo`;
const ALPHA = `${AREA}/routes/alpha/ROUTE.md`;
const BETA = `${AREA}/routes/beta/ROUTE.md`;

const DOOR_DATA = { lead: "Does demo work in two steps.", default: "alpha", routes: { alpha: { cue: "start the alpha thing" }, beta: { cue: "set beta up", starts: "person" } } };

const ONE_FILES = {
  [`${ONE}/.claude-plugin/plugin.json`]: `${JSON.stringify({ name: INTO, version: "0.1.0", description: "The one plugin." }, null, 2)}\n`,
  [`${ONE}/skills/start-here/SKILL.md`]: "---\nname: start-here\ndescription: \"Use when a person asks where to begin.\"\n---\n\n# start-here\n",
};

const FILES = {
  ...ONE_FILES,
  "plugins/demo/.claude-plugin/plugin.json": `${JSON.stringify({ name: "demo", version: "0.3.0", description: "The demo plugin." }, null, 2)}\n`,
  "plugins/demo/README.md": `# demo

Start with [alpha](skills/alpha/SKILL.md), whose rules are in \`skills/alpha/references/rules.md\`. The shared guide is [here](references/guide.md), and the repo's own page is \`../../docs/guide.md\`.
`,
  "plugins/demo/AGENTS.md": `# demo

## Layout

- \`skills/\` - \`alpha\` and \`beta\`, and the door, \`skills/demo/SKILL.md\`.
- \`hooks/\` - \`hooks/hooks.json\` runs \`hooks/start.mjs\`.
`,
  "plugins/demo/CHANGELOG.md": "# Changelog\n\n- 0.3.0: added /demo:alpha, under plugins/demo/skills/alpha.\n",
  // The door: generated frontmatter and block around hand-written text.
  "plugins/demo/skills/demo/SKILL.md": `---
name: demo
description: "Does demo work in two steps. Routes are its arguments, not skills: alpha (start the alpha thing); beta (set beta up)."
argument-hint: "[route] [the route's arguments]"
---

# demo

What every route shares is in \`${ROOT_VAR}/references/guide.md\`, and [alpha](../alpha/SKILL.md) is where most work starts.

## Route

Plugin root: \`${ROOT_VAR}\` (the old block, which the generator replaces).

| Route | Use when | Arguments | Starts it |
| --- | --- | --- | --- |

<!-- end of the generated Route section -->
`,
  "plugins/demo/skills/demo/door.json": `${JSON.stringify(DOOR_DATA, null, 2)}\n`,
  "plugins/demo/skills/alpha/SKILL.md": `---
name: alpha
description: "Starts the alpha thing from a card. Use when a card is ready to start."
disable-model-invocation: true
argument-hint: "<card id>"
---

# alpha

\`\`\`bash
node "${ROOT_VAR}/scripts/run.mjs" --json
node "${ROOT_VAR}/skills/alpha/scripts/check.mjs"
\`\`\`

The rules are in [rules](references/rules.md) and \`${ROOT_VAR}/references/guide.md\`. Then read [beta](../beta/SKILL.md), or the door, \`../demo/SKILL.md\`.

Hand over with /demo:beta, and send pictures to the demo:critic agent.
`,
  "plugins/demo/skills/alpha/references/rules.md": "# Rules\n\nBack to [the skill](../SKILL.md). The engine is `../../../scripts/run.mjs`.\n",
  "plugins/demo/skills/alpha/scripts/check.mjs": 'import { run } from "../../../scripts/run.mjs";\nimport { help } from "./lib/help.mjs";\nexport const check = () => run() + help();\n',
  "plugins/demo/skills/alpha/scripts/lib/help.mjs": "export const help = () => 0;\n",
  "plugins/demo/skills/beta/SKILL.md": `---
name: beta
description: "Sets beta up in a project. Use when the person asks for beta."
disable-model-invocation: true
---

# beta

Nothing here names the root.
`,
  "plugins/demo/scripts/run.mjs": 'import { x } from "../lib/x.mjs";\nimport { check } from "../skills/alpha/scripts/check.mjs";\nimport fs from "node:fs";\nexport const run = () => x + (check ? 0 : 1);\nexport const skill = (name) => fs.readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");\nexport const hint = `node "\\${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" --json`;\n',
  "plugins/demo/lib/x.mjs": "export const x = 1;\n",
  "plugins/demo/references/guide.md": `# Guide\n\nStart with /demo:alpha, which runs \`${ROOT_VAR}/scripts/run.mjs\`. The host fills in \`${ROOT_VAR}\` only in a file it loads.\n`,
  "plugins/demo/hooks/hooks.json": `${JSON.stringify({
    hooks: {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: `node "${ROOT_VAR}/hooks/start.mjs"`, timeout: 5 }, { type: "command", command: `node "${ROOT_VAR}/skills/alpha/scripts/check.mjs" --hook` }] }],
      Stop: [{ hooks: [{ type: "command", command: `node "${ROOT_VAR}/hooks/start.mjs" --stop` }] }],
    },
    modules: ["./mod/register.mjs"],
  }, null, 2)}\n`,
  "plugins/demo/hooks/start.mjs": 'import { check } from "../skills/alpha/scripts/check.mjs";\ncheck();\n',
  "plugins/demo/hooks/mod/register.mjs": "export default () => {};\n",
  "plugins/demo/hooks/critical.json": `${JSON.stringify({ plugin: "demo", lines: [{ text: "A card starts with /demo:alpha, and the door is /demo:demo.", for: "main", mode: "any" }] }, null, 2)}\n`,
  "plugins/demo/agents/critic.md": "---\nname: critic\ndescription: Judges pictures.\n---\n\nJudge.\n",
  "plugins/demo/.mcp.json": `${JSON.stringify({ mcpServers: { browser: { command: "node", args: [`${ROOT_VAR}/skills/alpha/scripts/check.mjs`] } } }, null, 2)}\n`,
  "plugins/other/.claude-plugin/plugin.json": `${JSON.stringify({ name: "other", version: "0.1.0", description: "Another plugin." }, null, 2)}\n`,
  "plugins/other/skills/delta/SKILL.md": `---
name: delta
description: "Does delta. Use when delta is wanted."
---

# delta

Start a card with \`/demo:alpha 0042 --now\`, or through its door, \`/demo:demo alpha 0042\`. The door alone is \`/demo:demo\`.
The critic is demo:critic, the server is demo:browser, and /demo:nothing is no skill. /other:delta is this skill.
`,
  "plugins/other/hooks/hooks.json": `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node "${ROOT_VAR}/hooks/go.mjs"` }] }] } }, null, 2)}\n`,
  "plugins/other/hooks/go.mjs": "export {};\n",
  "docs/guide.md": `# Guide

The engine is \`plugins/demo/scripts/run.mjs\`, alpha is \`plugins/demo/skills/alpha/SKILL.md\`, the door is plugins/demo/skills/demo/SKILL.md,
and the whole of it is under \`plugins/demo/\`. Its manifest stays at \`plugins/demo/.claude-plugin/plugin.json\`. Skills are \`plugins/demo/skills/<skill>/SKILL.md\`.
Not this plugin: plugins/demonstration/x.md and myplugins/demo/x.md. Run /demo:alpha.
`,
  "scripts/tool.mjs": 'import { x } from "../plugins/demo/lib/x.mjs";\nimport path from "node:path";\nexport const CRITICAL = "plugins/demo/hooks/critical.json";\nexport const start = (run) => run({ command: "demo:alpha", args: "0042" });\nexport const built = (root) => path.join(root, "plugins", "demo", "skills", "alpha", "SKILL.md");\nexport const hooks = (root, name) => path.join(root, "plugins", name, "hooks");\nexport const route = (root, name) => path.join(root, \'plugins\', \'demo\', \'skills\', name, \'SKILL.md\');\nexport const manifest = (root) => path.join(root, "plugins", "demo", ".claude-plugin", "plugin.json");\nexport default x;\n',
  "plugins/agentic-teamwork/templates/common/.agents/AGENTS.md": "# .agents\n\nRun `/demo:alpha` to adopt it; the script is plugins/demo/scripts/run.mjs.\n",
  "scripts/test-hooks/live/baseline.json": `${JSON.stringify({ skills: { triggers: [{ skill: "demo:alpha" }] } })}\n`,
};

const CATALOG = { name: "fixture-market", owner: { name: "test" }, plugins: [
  { name: INTO, source: `./plugins/${INTO}`, description: "The one plugin." },
  { name: "demo", source: "./plugins/demo", description: "The demo plugin." },
  { name: "other", source: "./plugins/other", description: "Another plugin." },
] };
function fixture({ files = {}, remove = [] } = {}) {
  const { dir, git } = tempRepo(keep, "area-plugin-");
  write(dir, ".claude-plugin/marketplace.json", `${JSON.stringify(CATALOG, null, 2)}\n`);
  for (const [rel, content] of Object.entries({ ...FILES, ...files })) if (!remove.includes(rel)) write(dir, rel, content);
  git("add", "-A");
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const snapshot = (dir) => Object.fromEntries(walk(dir).sort().map((rel) => {
  const full = path.join(dir, rel);
  return [rel, fs.lstatSync(full).isSymbolicLink() ? `-> ${fs.readlinkSync(full)}` : read(dir, rel)];
}));

// The one plugin as it is once an earlier plugin has moved in: it holds an area.
const EARLIER = { [`${ONE}/skills/earlier/routes/first/ROUTE.md`]: "---\nname: first\ndescription: \"Does first. Use when first is wanted.\"\n---\n\n# first\n", [`${ONE}/skills/earlier/door.json`]: `${JSON.stringify({ lead: "Earlier work.", default: "first", routes: { first: { cue: "do first" } } })}\n` };

// One written fixture for the cases that only read what a run leaves behind.
let ranOnce;
const ran = () => (ranOnce ??= (() => { const dir = fixture(); return { dir, report: areaPlugin(dir, "demo", { write: true, into: INTO }) }; })());

// ---- the moves -------------------------------------------------------------

test("the plugin's directory becomes skills/<area>/ of the one plugin, and only its manifest stays behind", () => {
  const { dir, report } = ran();
  for (const rel of ["README.md", "AGENTS.md", "CHANGELOG.md", "scripts/run.mjs", "lib/x.mjs", "references/guide.md", "hooks/start.mjs", "hooks/mod/register.mjs", "hooks/critical.json"]) {
    assert.ok(has(dir, `${AREA}/${rel}`), rel);
    assert.equal(has(dir, `plugins/demo/${rel}`), false, rel);
  }
  assert.deepEqual(walk(path.join(dir, "plugins/demo")).sort(), [".claude-plugin/plugin.json"]);
  assert.equal(report.moved.length, 16);
  assert.deepEqual(report.stays, ["plugins/demo/.claude-plugin/plugin.json"]);
});

test("skills/ becomes routes/, and each SKILL.md a ROUTE.md with what sat beside it", () => {
  const { dir } = ran();
  assert.equal(has(dir, `${AREA}/skills`), false);
  for (const rel of ["alpha/ROUTE.md", "alpha/references/rules.md", "alpha/scripts/check.mjs", "alpha/scripts/lib/help.mjs", "beta/ROUTE.md"]) assert.ok(has(dir, `${AREA}/routes/${rel}`), rel);
  assert.deepEqual(walk(path.join(dir, AREA)).filter((f) => path.basename(f) === "SKILL.md"), ["SKILL.md"], "no SKILL.md below the area");
});

test("a route is a document: its frontmatter keeps name, description, and argument-hint, and loses the flip", () => {
  const { dir } = ran();
  assert.deepEqual(parseFrontmatter(read(dir, ALPHA)), { name: "alpha", description: "Starts the alpha thing from a card. Use when a card is ready to start.", "argument-hint": "<card id>" });
  assert.deepEqual(Object.keys(parseFrontmatter(read(dir, BETA))), ["name", "description"]);
});

test("the door's own directory is the area's: its SKILL.md and door.json sit at the area's root, the data untouched", () => {
  const { dir, report } = ran();
  assert.equal(read(dir, `${AREA}/door.json`), FILES["plugins/demo/skills/demo/door.json"]);
  assert.equal(report.scaffolded, false);
  const area = read(dir, `${AREA}/SKILL.md`);
  const fm = parseFrontmatter(area);
  assert.equal(fm.description, "Does demo work in two steps. Routes are its arguments, not skills: alpha (start the alpha thing); beta (set beta up).");
  assert.equal(fm["user-invocable"], "false");
  assert.match(area, /^\| `alpha` \| start the alpha thing \| Use when a card is ready to start\. \| `<card id>` \| agent \|$/m);
  assert.match(area, /^\| `beta` \| .* \| person \|$/m);
  assert.doesNotMatch(area, /the old block/);
  assert.match(area, /What every route shares is in /, "the hand-written text is kept");
});

test("a plugin with no door gets its area's data scaffolded: every skill a route, blanks for a hand, and one out of the listing the person's", () => {
  const dir = fixture({ remove: ["plugins/demo/skills/demo/SKILL.md", "plugins/demo/skills/demo/door.json"] });
  const report = areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.equal(report.scaffolded, true);
  assert.deepEqual(readJson(path.join(dir, AREA, "door.json")), { lead: "", default: "", routes: { alpha: { cue: "", starts: "person" }, beta: { cue: "", starts: "person" } } });
  assert.equal(parseFrontmatter(read(dir, `${AREA}/SKILL.md`))["user-invocable"], "false");
});

test("the skill a person types is the one plugin's own: a plugin that brings one stops the run before anything is written", () => {
  const dir = fixture({ files: { "plugins/demo/skills/start-here/SKILL.md": "---\nname: start-here\ndescription: \"Use when nobody knows which skill fits.\"\n---\n\n# start-here\n" } });
  const before = snapshot(dir);
  assert.throws(() => areaPlugin(dir, "demo", { write: true, into: INTO }), /plugins\/single\/skills\/start-here\/SKILL\.md is already there/);
  assert.deepEqual(snapshot(dir), before);
});

// ---- what the one plugin holds once ---------------------------------------

test("the plugin's hook map is merged into the one plugin's, each command under the area and each module by its new relative path", () => {
  const { dir, report } = ran();
  assert.equal(has(dir, `${AREA}/hooks/hooks.json`), false);
  const map = readJson(path.join(dir, ONE, "hooks/hooks.json"));
  assert.deepEqual(map.hooks.SessionStart[0].hooks.map((h) => h.command), [`node "${ROOT_VAR}/skills/demo/hooks/start.mjs"`, `node "${ROOT_VAR}/skills/demo/routes/alpha/scripts/check.mjs" --hook`]);
  assert.equal(map.hooks.SessionStart[0].hooks[0].timeout, 5);
  assert.deepEqual(map.modules, ["../skills/demo/hooks/mod/register.mjs"]);
  for (const m of map.modules) assert.ok(has(dir, path.join(ONE, "hooks", m)), m);
  for (const command of JSON.stringify(map).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/[A-Za-z0-9_./-]+/g)) assert.ok(has(dir, path.join(ONE, command.slice(ROOT_VAR.length + 1))), command);
  assert.deepEqual(report.merged, { hooks: 3, modules: 1, servers: 1, agents: 1 });
});

test("a second plugin's hook map is appended to the first's, event by event", () => {
  const dir = fixture();
  areaPlugin(dir, "demo", { write: true, into: INTO });
  areaPlugin(dir, "other", { write: true, into: INTO });
  const map = readJson(path.join(dir, ONE, "hooks/hooks.json"));
  assert.equal(map.hooks.SessionStart.length, 2);
  assert.equal(map.hooks.SessionStart[1].hooks[0].command, `node "${ROOT_VAR}/skills/other/hooks/go.mjs"`);
  assert.equal(map.hooks.Stop.length, 1);
  assert.deepEqual(map.modules, ["../skills/demo/hooks/mod/register.mjs"]);
});

test("its agents and MCP servers become the one plugin's, and a name already taken there stops the run before anything is written", () => {
  const { dir } = ran();
  assert.ok(has(dir, `${ONE}/agents/critic.md`));
  assert.deepEqual(readJson(path.join(dir, ONE, ".mcp.json")), { mcpServers: { browser: { command: "node", args: [`${ROOT_VAR}/skills/demo/routes/alpha/scripts/check.mjs`] } } });
  for (const [rel, content] of [[`${ONE}/agents/critic.md`, "taken\n"], [`${ONE}/.mcp.json`, '{ "mcpServers": { "browser": {} } }\n']]) {
    const clash = fixture({ files: { [rel]: content, ...EARLIER } });
    const before = snapshot(clash);
    assert.throws(() => areaPlugin(clash, "demo", { write: true, into: INTO }), /already (there|has)/);
    assert.deepEqual(snapshot(clash), before);
  }
});

test("the one plugin is there already: its manifest and the catalog are left as they are, and a run makes neither", () => {
  const { dir, report } = ran();
  assert.equal(read(dir, `${ONE}/.claude-plugin/plugin.json`), FILES[`${ONE}/.claude-plugin/plugin.json`]);
  assert.deepEqual(readJson(path.join(dir, ".claude-plugin/marketplace.json")), CATALOG);
  assert.deepEqual(report.created, []);
  // With no such plugin to move into, nothing is written.
  const none = fixture({ remove: Object.keys(ONE_FILES) });
  const before = snapshot(none);
  assert.throws(() => areaPlugin(none, "demo", { write: true, into: INTO }), /plugins\/single is not the one plugin the areas go into/);
  assert.deepEqual(snapshot(none), before);
});

// A Node hook's command is a guard, then the call, and the guard names the
// plugin whose hooks are off on a machine without Node: the one plugin now.
test("a guarded Node command is written again for the one plugin, loud or quiet, over the path the move gave it", () => {
  const map = { hooks: {
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: hookCommand("demo", "hooks/start.mjs", { loud: true }), statusMessage: "starting" }] }],
    Stop: [{ hooks: [{ type: "command", command: hookCommand("demo", "skills/alpha/scripts/check.mjs", { args: ["--stop"] }) }] }],
  } };
  const dir = fixture({ files: { "plugins/demo/hooks/hooks.json": `${JSON.stringify(map, null, 2)}\n` } });
  areaPlugin(dir, "demo", { write: true, into: INTO });
  const merged = readJson(path.join(dir, ONE, "hooks/hooks.json")).hooks;
  assert.equal(merged.SessionStart[0].hooks[0].command, hookCommand(INTO, "skills/demo/hooks/start.mjs", { loud: true }));
  assert.equal(merged.SessionStart[0].hooks[0].statusMessage, "starting");
  assert.equal(merged.Stop[0].hooks[0].command, hookCommand(INTO, "skills/demo/routes/alpha/scripts/check.mjs", { args: ["--stop"] }));
});

// ---- paths -----------------------------------------------------------------

test("a route's plugin-root tokens become paths under a directory it names from its own file, and each one resolves", () => {
  const { dir, report } = ran();
  const text = read(dir, ALPHA);
  assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT/);
  assert.match(text, /^node "W\/scripts\/run\.mjs" --json$/m);
  assert.match(text, /^node "W\/routes\/alpha\/scripts\/check\.mjs"$/m);
  const dirs = namedDirs(text);
  assert.deepEqual(dirs, [{ name: "W", rel: "../.." }]);
  const base = path.resolve(dir, path.dirname(ALPHA), "../..");
  assert.equal(base, path.join(dir, AREA));
  const paths = text.split("\n").flatMap((line) => namedPaths(line, ["W"]));
  assert.equal(paths.length, 3);
  for (const p of paths) assert.ok(fs.existsSync(path.join(base, p.path)), p.path);
  assert.equal(report.paths.placed, 3);
  assert.deepEqual(report.paths.left, []);
});

test("a token in any other file of the area is the same file under the one plugin's root, and the variable alone is left for a hand", () => {
  const { dir, report } = ran();
  assert.match(read(dir, `${AREA}/references/guide.md`), /runs `\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/demo\/scripts\/run\.mjs`\./);
  assert.match(read(dir, `${AREA}/SKILL.md`), /`\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/demo\/references\/guide\.md`/);
  assert.match(read(dir, `${AREA}/scripts/run.mjs`), /node "\\\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/demo\/scripts\/run\.mjs" --json/);
  assert.equal(report.tokens.rewritten, 3);
  assert.deepEqual(report.tokens.left.map((l) => [l.file, l.text]), [[`${AREA}/references/guide.md`, ROOT_VAR]]);
  assert.match(report.tokens.left[0].why, /skills\/demo/);
});

// Every relative import and every markdown link in the tree the run left,
// resolved from the file that writes it.
const relativeRefs = (dir, under) => walk(path.join(dir, under)).flatMap((rel) => {
  const file = path.join(under, rel), text = read(dir, file);
  const refs = /\.m?js$/.test(rel)
    ? [...text.matchAll(/(?:from|import)\s+"(\.[^"]+)"/g)].map((m) => m[1])
    : rel.endsWith(".md") ? [...text.matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((t) => !/^[a-z]+:/.test(t)) : [];
  return refs.map((ref) => ({ file, ref, target: path.join(path.dirname(file), ref) }));
});

test("every relative import and markdown link inside the converted area still resolves", () => {
  const { dir } = ran();
  const refs = relativeRefs(dir, AREA);
  assert.ok(refs.length >= 9, `${refs.length} references`);
  for (const r of refs) assert.ok(has(dir, r.target), `${r.file}: ${r.ref}`);
  assert.match(read(dir, `${AREA}/scripts/run.mjs`), /from "\.\.\/routes\/alpha\/scripts\/check\.mjs"/);
  assert.match(read(dir, `${AREA}/hooks/start.mjs`), /from "\.\.\/routes\/alpha\/scripts\/check\.mjs"/);
  assert.match(read(dir, `${AREA}/routes/alpha/scripts/check.mjs`), /from "\.\.\/\.\.\/\.\.\/scripts\/run\.mjs"/, "a path that moved with its file is as it was");
  assert.match(read(dir, ALPHA), /\[beta\]\(\.\.\/beta\/ROUTE\.md\), or the door, `\.\.\/\.\.\/SKILL\.md`/);
  assert.match(read(dir, `${AREA}/routes/alpha/references/rules.md`), /\[the skill\]\(\.\.\/ROUTE\.md\)/);
});

test("a path written from the plugin's root, in a link or a code span, is the same file from the area's, and one that leaves the plugin is two levels deeper", () => {
  const { dir, report } = ran();
  const readme = read(dir, `${AREA}/README.md`);
  assert.match(readme, /\[alpha\]\(routes\/alpha\/ROUTE\.md\), whose rules are in `routes\/alpha\/references\/rules\.md`/);
  assert.match(readme, /\[here\]\(references\/guide\.md\)/);
  assert.match(readme, /`\.\.\/\.\.\/\.\.\/\.\.\/docs\/guide\.md`/);
  assert.ok(has(dir, path.join(AREA, "../../../../docs/guide.md")));
  const hub = read(dir, `${AREA}/AGENTS.md`);
  // A directory's bare name is left: `skills/` may mean any plugin's. A file is not.
  assert.match(hub, /- `skills\/` - `alpha` and `beta`, and the door, `SKILL\.md`\./);
  assert.deepEqual(report.parts.filter((p) => p.file === `${AREA}/AGENTS.md`).map((p) => [p.line, p.text]), [[5, "skills/"]]);
  assert.match(hub, /`hooks\/start\.mjs`/);
  assert.ok(report.links.rewritten >= 8, `${report.links.rewritten} links`);
  // The area's own door, which moved up two levels.
  assert.match(read(dir, `${AREA}/SKILL.md`), /\[alpha\]\(routes\/alpha\/ROUTE\.md\)/);
});

test("a path built from string parts is rewritten part by part, and what a script cannot follow is listed for a hand", () => {
  const { dir, report } = ran();
  const tool = read(dir, "scripts/tool.mjs");
  assert.match(tool, /built = \(root\) => path\.join\(root, "plugins", "single", "skills", "demo", "routes", "alpha", "ROUTE\.md"\);/);
  assert.match(tool, /route = \(root, name\) => path\.join\(root, 'plugins', 'single', 'skills', 'demo', 'routes', name, 'SKILL\.md'\);/, "as far as the literals go");
  assert.match(tool, /manifest = \(root\) => path\.join\(root, "plugins", "demo", "\.claude-plugin", "plugin\.json"\);/, "the manifest stays");
  assert.equal(report.built.rewritten, 2);
  // In the area, a path to a skill from the file's own place; outside it, a
  // plugin named by a variable, a file's name after a variable, and the stub.
  assert.deepEqual(report.parts.map((p) => [p.file, p.line]), [[`${AREA}/AGENTS.md`, 5], [`${AREA}/scripts/run.mjs`, 5], ["scripts/tool.mjs", 6], ["scripts/tool.mjs", 7], ["scripts/tool.mjs", 8]]);
  assert.match(report.parts[1].why, /built from parts/);
});

test("a path that names the plugin from the repo's root is rewritten wherever it is text, code included, and the manifests' stay", () => {
  const { dir, report } = ran();
  const page = read(dir, "docs/guide.md");
  assert.match(page, /The engine is `plugins\/single\/skills\/demo\/scripts\/run\.mjs`, alpha is `plugins\/single\/skills\/demo\/routes\/alpha\/ROUTE\.md`, the door is plugins\/single\/skills\/demo\/SKILL\.md,/);
  assert.match(page, /under `plugins\/single\/skills\/demo\/`\. Its manifest stays at `plugins\/demo\/\.claude-plugin\/plugin\.json`\. Skills are `plugins\/single\/skills\/demo\/routes\/<skill>\/ROUTE\.md`\./);
  assert.match(page, /plugins\/demonstration\/x\.md and myplugins\/demo\/x\.md/);
  const tool = read(dir, "scripts/tool.mjs");
  assert.match(tool, /from "\.\.\/plugins\/single\/skills\/demo\/lib\/x\.mjs"/);
  assert.match(tool, /CRITICAL = "plugins\/single\/skills\/demo\/hooks\/critical\.json"/);
  assert.ok(has(dir, "plugins/single/skills/demo/lib/x.mjs"));
  assert.equal(report.repoPaths.rewritten, 7);
  assert.deepEqual(report.repoPaths.stay.map((s) => s.file), ["plugins/agentic-teamwork/templates/common/.agents/AGENTS.md"]);
  assert.equal(report.repoPaths.left.history, 1);
  // The catalog's own source is the stub's, not a path to rewrite.
  assert.equal(readJson(path.join(dir, ".claude-plugin/marketplace.json")).plugins.find((p) => p.name === "demo").source, "./plugins/demo");
});

// ---- addresses -------------------------------------------------------------

test("an address becomes the area's: a skill its route, the door the area, with what followed kept; an agent and a server the one plugin's", () => {
  const { dir } = ran();
  const delta = read(dir, "plugins/other/skills/delta/SKILL.md");
  assert.match(delta, /Start a card with `\/single:demo alpha 0042 --now`, or through its door, `\/single:demo alpha 0042`\. The door alone is `\/single:demo`\./);
  assert.match(delta, /The critic is single:critic, the server is single:browser, and \/demo:nothing is no skill\. \/other:delta is this skill\./);
  assert.match(read(dir, ALPHA), /Hand over with \/single:demo beta, and send pictures to the single:critic agent\./);
  assert.match(read(dir, `${AREA}/hooks/critical.json`), /A card starts with \/single:demo alpha, and the door is \/single:demo\./);
  assert.match(read(dir, "docs/guide.md"), /Run \/single:demo alpha\./);
});

test("an address in code is listed for a hand, one in a template copy as staying, and history and recordings are left", () => {
  const { dir, report } = ran();
  assert.match(read(dir, "scripts/tool.mjs"), /command: "demo:alpha"/);
  assert.deepEqual(report.addresses.hand.map((s) => [s.file, s.line, s.text]), [["scripts/tool.mjs", 4, "demo:alpha"]]);
  assert.deepEqual(report.addresses.stay.map((s) => [s.file, s.text]), [["plugins/agentic-teamwork/templates/common/.agents/AGENTS.md", "/demo:alpha"]]);
  assert.deepEqual(report.addresses.left, { history: 1, recordings: 1 });
  assert.match(read(dir, `${AREA}/CHANGELOG.md`), /added \/demo:alpha, under plugins\/demo\/skills\/alpha\./, "history is not rewritten");
});

// ---- the run ---------------------------------------------------------------

test("the run ends with the generator, and what it left passes the generator's own check", () => {
  const { dir, report } = ran();
  assert.ok(report.generated.some((r) => r.label === "area single/demo" && r.state === "wrote"));
  const check = runNode(GEN, ["--check", "--root", dir]);
  assert.equal(check.status, 0, check.stdout);
});

test("a second run changes nothing, and still lists what is left for a hand", () => {
  const dir = fixture();
  const first = areaPlugin(dir, "demo", { write: true, into: INTO });
  const before = snapshot(dir);
  const again = areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.deepEqual(snapshot(dir), before);
  assert.deepEqual(again.moved, []);
  assert.deepEqual(again.changed, []);
  assert.deepEqual(again.created, []);
  assert.equal(again.addresses.rewritten, 0);
  assert.equal(again.repoPaths.rewritten, 0);
  assert.deepEqual(again.addresses.hand, first.addresses.hand);
  assert.deepEqual(again.addresses.stay, first.addresses.stay);
  // What only the move itself can see (a path that reads as prose) is the first run's to list.
  assert.deepEqual(again.parts, first.parts.filter((p) => !/left as it is/.test(p.why)));
});

test("without write nothing is written, and the report is the one a write gives", () => {
  const dir = fixture();
  const before = snapshot(dir);
  const dry = areaPlugin(dir, "demo", { into: INTO });
  assert.deepEqual(snapshot(dir), before);
  const wet = areaPlugin(dir, "demo", { write: true, into: INTO });
  for (const key of ["moved", "stays", "merged", "routes", "paths", "tokens", "links", "addresses", "repoPaths", "parts", "created"]) assert.deepEqual(dry[key], wet[key], key);
  assert.equal(dry.generated, null);
  assert.ok(dry.changed.length > 20);
});

test("only a plugin the catalog lists as a directory here is taken, and never the one plugin itself", () => {
  const dir = fixture();
  const before = snapshot(dir);
  assert.throws(() => areaPlugin(dir, "../outside", { write: true, into: INTO }), /is not a plugin the catalog lists/);
  assert.throws(() => areaPlugin(dir, "nothing", { write: true, into: INTO }), /is not a plugin the catalog lists/);
  assert.throws(() => areaPlugin(dir, "demo", { write: true, into: "demo" }), /cannot be an area of itself/);
  assert.deepEqual(snapshot(dir), before);
});

test("a file already where one would land stops the run before anything is written", () => {
  const dir = fixture({ files: { [`${AREA}/scripts/run.mjs`]: "export {};\n", ...EARLIER } });
  const before = snapshot(dir);
  assert.throws(() => areaPlugin(dir, "demo", { write: true, into: INTO }), /plugins\/single\/skills\/demo\/scripts\/run\.mjs is already there/);
  assert.deepEqual(snapshot(dir), before);
});

test("a symbolic link is moved as the link it is, no pass reads or writes through it, and it is reported", () => {
  const dir = fixture();
  const outside = path.join(dir, "..", `${path.basename(dir)}-outside.md`);
  fs.writeFileSync(outside, `Run /demo:alpha with ${ROOT_VAR}/scripts/run.mjs.\n`);
  fs.symlinkSync(outside, path.join(dir, "plugins/demo/skills/beta/notes.md"));
  fs.symlinkSync("AGENTS.md", path.join(dir, "plugins/demo/CLAUDE.md"));
  const report = areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.equal(fs.readFileSync(outside, "utf8"), `Run /demo:alpha with ${ROOT_VAR}/scripts/run.mjs.\n`);
  assert.equal(fs.readlinkSync(path.join(dir, AREA, "routes/beta/notes.md")), outside);
  assert.equal(fs.readlinkSync(path.join(dir, AREA, "CLAUDE.md")), "AGENTS.md");
  assert.deepEqual(report.skipped.map((s) => s.file), [`${AREA}/CLAUDE.md`, `${AREA}/routes/beta/notes.md`]);
  fs.rmSync(outside);
});

test("the command: --check exits 1 while a run would change something and 0 once it has run, and the summary names each part", () => {
  const dir = fixture();
  const check = runNode(SCRIPT, ["demo", "--into", INTO, "--check", "--root", dir]);
  assert.equal(check.status, 1, check.stdout);
  assert.match(check.stdout, /^a write would change \d+ files; run it with --write$/m);
  const wrote = runNode(SCRIPT, ["demo", "--into", INTO, "--write", "--root", dir]);
  assert.equal(wrote.status, 0, wrote.stdout + wrote.stderr);
  assert.match(wrote.stdout, /^moves: \d+ files under plugins\/single\/skills; 1 stay in plugins\/demo \(its manifest\)$/m);
  assert.match(wrote.stdout, /^routes: 2 \(alpha, beta\), each a ROUTE\.md$/m);
  assert.match(wrote.stdout, /^merged into the one plugin: 3 hook entries, 1 module, 1 MCP server, 1 agent$/m);
  assert.match(wrote.stdout, /^addresses: \d+ rewritten in \d+ files; 1 left for a hand; 1 in template copies stay; left alone, 1 in a CHANGELOG\.md and 1 in a recording$/m);
  assert.match(wrote.stdout, /^ {2}scripts\/tool\.mjs:4: demo:alpha \(write \/single:demo alpha\): code: /m);
  assert.match(wrote.stdout, /^wrote plugins\/single\/skills\/demo\/SKILL\.md$/m);
  assert.equal(runNode(SCRIPT, ["demo", "--into", INTO, "--check", "--root", dir]).status, 0);
  const refused = runNode(SCRIPT, ["nothing", "--into", INTO, "--write", "--root", dir]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /^door-plugin: "nothing" is not a plugin the catalog lists$/m);
  assert.equal(typeof areaSummary, "function");
});

test("with no --into the one plugin is the one the plugins are becoming", () => {
  assert.equal(AREA_PLUGIN, ["agent", "craft"].join(""));
  const home = `plugins/${AREA_PLUGIN}`;
  const dir = fixture({ files: Object.fromEntries(Object.entries(ONE_FILES).map(([rel, text]) => [rel.replace(ONE, home), text])) });
  const report = areaPlugin(dir, "other", { write: true });
  assert.equal(report.into, AREA_PLUGIN);
  assert.ok(has(dir, `plugins/${AREA_PLUGIN}/skills/other/routes/delta/ROUTE.md`));
});

// The template tree is copied into team repos, where its scripts are held by
// hash: what a file there names is in the repo it lands in, never in this one.
test("a template copy moves with its plugin and no pass rewrites it: its text is the text it had", () => {
  // Built, never written out: the plugin is one this checkout's catalog lists.
  const TEAM = ["agentic", "teamwork"].join("-");
  const OLD = `/${TEAM}:alpha`;
  const TEMPLATE_TEXT = `# .agents\n\nRun \`node "${ROOT_VAR}/scripts/run.mjs"\`, read [the hub](../AGENTS.md) and \`skills/alpha/SKILL.md\`, then ${OLD}.\n`;
  const { dir, git } = tempRepo(keep, "area-template-");
  write(dir, ".claude-plugin/marketplace.json", `${JSON.stringify({ name: "fixture-market", owner: { name: "test" }, plugins: [{ name: TEAM, source: `./plugins/${TEAM}` }] }, null, 2)}\n`);
  for (const [rel, text] of Object.entries(ONE_FILES)) write(dir, rel, text);
  write(dir, `plugins/${TEAM}/.claude-plugin/plugin.json`, `${JSON.stringify({ name: TEAM, version: "0.1.0", description: "The standard." })}\n`);
  write(dir, `plugins/${TEAM}/skills/alpha/SKILL.md`, "---\nname: alpha\ndescription: \"Does alpha. Use when alpha is wanted.\"\n---\n\n# alpha\n");
  write(dir, `plugins/${TEAM}/scripts/run.mjs`, "export {};\n");
  write(dir, `plugins/${TEAM}/AGENTS.md`, `# ${TEAM}\n`);
  write(dir, `plugins/${TEAM}/templates/common/.agents/AGENTS.md`, TEMPLATE_TEXT);
  git("add", "-A");
  const report = areaPlugin(dir, TEAM, { write: true, into: INTO });
  assert.equal(read(dir, `${ONE}/skills/${TEAM}/templates/common/.agents/AGENTS.md`), TEMPLATE_TEXT);
  assert.deepEqual(report.addresses.stay.map((s) => s.text), [OLD]);
  assert.equal(report.tokens.rewritten, 0);
});

// The manifests stay with the old directory, which becomes a stub, and an
// installed copy of the one plugin holds nothing of it. So a path to one is
// not rewritten to climb out of the plugin: it is left, and listed.
test("code that reads the manifest of the plugin it was in is left as it is and listed for a hand", () => {
  const VERSION = 'import fs from "node:fs";\nimport path from "node:path";\nexport const version = JSON.parse(fs.readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version;\nexport const manifest = (root) => path.join(root, ".claude-plugin", "plugin.json");\n';
  const dir = fixture({ files: { "plugins/demo/scripts/version.mjs": VERSION } });
  const report = areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.equal(read(dir, `${AREA}/scripts/version.mjs`), VERSION);
  const listed = report.parts.filter((p) => p.file === `${AREA}/scripts/version.mjs`);
  assert.deepEqual(listed.map((p) => p.line), [3, 4]);
  for (const p of listed) assert.match(p.why, /stays in the old directory/);
});

// ---- what the review of the first copy run found --------------------------

test("--into is the one plugin's name: a path, an empty name, and another plugin are refused before a write", () => {
  const dir = fixture();
  const before = snapshot(dir);
  const outside = path.join(dir, "..", "escaped");
  for (const into of ["../../escaped", "a/b", "", ".", "plugins/x"]) assert.throws(() => areaPlugin(dir, "demo", { write: true, into }), /is not a plugin's name/, JSON.stringify(into));
  assert.throws(() => areaPlugin(dir, "demo", { write: true, into: "other" }), /plugins\/other is not the one plugin the areas go into/);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(fs.existsSync(outside), false);
  const refused = runNode(SCRIPT, ["demo", "--into", "../../escaped", "--write", "--root", dir]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /^door-plugin: "\.\.\/\.\.\/escaped" is not a plugin's name/m);
  assert.deepEqual(snapshot(dir), before);
  // One that already holds an area is the one plugin, and is taken.
  const second = fixture({ files: EARLIER });
  assert.equal(areaPlugin(second, "demo", { write: true, into: INTO }).moved.length, 16);
});

// Prose about another tree: how deep a target repo's plan tree is, and how
// to find any plugin's root. Both resolve here by accident.
test("a chain of ../ with no file after it, and a directory's bare name in a code span, are left as written and listed", () => {
  const ANCHORS = "# Anchors\n\n```\n[spec](../../../../spec/site/page.md)\n```\n\nThe `../../../../` prefix has to be right: `../../` from a sprint, `../../../` from an issue.\n";
  const ACQUIRE = "# Acquire\n\nTake the directory with a manifest, else the one containing `skills/`. This plugin's own rules are in `references/guide.md`.\n";
  const dir = fixture({ files: { "plugins/demo/skills/alpha/ANCHORS.md": ANCHORS, "plugins/demo/lib/acquire.md": ACQUIRE } });
  const report = areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.equal(read(dir, `${AREA}/routes/alpha/ANCHORS.md`), ANCHORS);
  assert.equal(read(dir, `${AREA}/lib/acquire.md`), ACQUIRE, "a file's path that is the same from the area is as it was");
  const listed = report.parts.filter((p) => /ANCHORS|acquire/.test(p.file)).map((p) => [path.basename(p.file), p.line, p.text]);
  // Listed where following it would have changed it: a hand says which it is.
  assert.deepEqual(listed, [["acquire.md", 3, "skills/"], ["ANCHORS.md", 7, "../../../../"], ["ANCHORS.md", 7, "../../../"]]);
  // The directory a route names from itself is a path, and is still followed.
  assert.match(read(dir, `${AREA}/SKILL.md`), /\[alpha\]\(routes\/alpha\/ROUTE\.md\)/);
});

test("a route's declaration says the area's directory, and an existing declaration is turned where its file moved", () => {
  const dir = fixture({ files: { "plugins/demo/skills/demo/SKILL.md": FILES["plugins/demo/skills/demo/SKILL.md"].replace("## Route", "`R` below is `../..` from the directory this file is in. Run `node \"R/scripts/run.mjs\"`, and `../..` is two up.\n\n## Route") } });
  areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.match(read(dir, ALPHA), /`W` below is `\.\.\/\.\.` from the directory this file is in: the area's own directory\./);
  // The old door moved up two levels: its declaration follows, and the bare chain beside it does not.
  assert.match(read(dir, `${AREA}/SKILL.md`), /`R` below is `\.` from the directory this file is in\. Run `node "R\/scripts\/run\.mjs"`, and `\.\.\/\.\.` is two up\./);
});

test("a path joined from a file's own directory, part by part, is followed as far as its literals are there", () => {
  const KERNEL = 'import path from "node:path";\nexport const RULES = path.join(import.meta.dirname, "..", "skills", "alpha", "references", "rules.md");\nexport const made = (name) => path.join(import.meta.dirname, "..", "skills", name, "SKILL.md");\nexport const own = path.join(import.meta.dirname, "lib", "x.mjs");\n';
  const dir = fixture({ files: { "plugins/demo/scripts/kernel.mjs": KERNEL } });
  const report = areaPlugin(dir, "demo", { write: true, into: INTO });
  const text = read(dir, `${AREA}/scripts/kernel.mjs`);
  assert.match(text, /RULES = path\.join\(import\.meta\.dirname, "\.\.", "routes", "alpha", "references", "rules\.md"\);/);
  assert.ok(has(dir, path.join(AREA, "scripts", "..", "routes", "alpha", "references", "rules.md")));
  assert.match(text, /made = \(name\) => path\.join\(import\.meta\.dirname, "\.\.", "routes", name, "SKILL\.md"\);/);
  assert.match(text, /own = path\.join\(import\.meta\.dirname, "lib", "x\.mjs"\);/);
  assert.deepEqual(report.parts.filter((p) => p.file.endsWith("kernel.mjs")).map((p) => p.line), [3], "the file's name after a variable is a hand's");
});

test("an address in code says what a hand writes there, by what it names: a route through its area, an agent the one plugin's own", () => {
  const dir = fixture({ files: { "scripts/deny.mjs": 'export const DENY = new Set(["demo:critic"]);\nexport const run = "demo:beta";\n' } });
  const report = areaPlugin(dir, "demo", { into: INTO });
  assert.deepEqual(report.addresses.hand.filter((h) => h.file === "scripts/deny.mjs").map((h) => [h.text, h.becomes]), [["demo:critic", "single:critic"], ["demo:beta", "/single:demo beta"]]);
  assert.match(areaSummary(report), /^ {2}scripts\/deny\.mjs:1: demo:critic \(write single:critic\): code: /m);
});

test("a test that says its strings are fixtures is rewritten by no pass, and each site in it is listed", () => {
  const FIXTURES = '// door-plugin: leave\nexport const CATALOG = { source: "./plugins/demo" };\nexport const FILE = "plugins/demo/skills/alpha/SKILL.md";\nexport const ADDRESS = "/demo:alpha";\n';
  const dir = fixture({ files: { "scripts/fixtures.test.mjs": FIXTURES, "scripts/catalog.mjs": 'export const entry = { name: "demo", source: "./plugins/demo" };\n' } });
  const report = areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.equal(read(dir, "scripts/fixtures.test.mjs"), FIXTURES);
  assert.deepEqual(report.repoPaths.hand.map((h) => [h.file, h.line]), [["scripts/fixtures.test.mjs", 3]]);
  assert.match(report.repoPaths.hand[0].why, /fixtures/);
  assert.ok(report.addresses.hand.some((h) => h.file === "scripts/fixtures.test.mjs" && h.line === 4));
  // A catalog entry's source is the stub's, wherever one is written.
  assert.match(read(dir, "scripts/catalog.mjs"), /source: "\.\/plugins\/demo"/);
});

test("the merged hook map is in the catalog's order of plugins, whichever is moved first", () => {
  // The second plugin brings events the first does not have, in each map.
  const more = {
    "plugins/other/hooks/hooks.json": `${JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `node "${ROOT_VAR}/hooks/go.mjs"` }] }], SessionStart: [{ hooks: [{ type: "command", command: `node "${ROOT_VAR}/hooks/go.mjs"` }] }] } }, null, 2)}\n`,
  };
  const both = ["demo other", "other demo"].map((order) => {
    const dir = fixture({ files: more });
    for (const plugin of order.split(" ")) areaPlugin(dir, plugin, { write: true, into: INTO });
    return read(dir, `${ONE}/hooks/hooks.json`);
  });
  assert.equal(both[0], both[1]);
  const maps = both;
  assert.deepEqual(readJson(path.join(fixture(), ".claude-plugin/marketplace.json")).plugins.map((p) => p.name), [INTO, "demo", "other"]);
  assert.match(JSON.parse(maps[0]).hooks.SessionStart[0].hooks[0].command, /skills\/demo\//);
});

test("edits no commit holds are moved all the same, and the report and the summary say so first", () => {
  const dir = fixture();
  const git = (...args) => runGit(dir, ...args);
  git("commit", "-q", "-m", "fixture");
  assert.deepEqual(areaPlugin(dir, "demo", { into: INTO }).dirty, []);
  fs.appendFileSync(path.join(dir, "plugins/demo/README.md"), "\nAn edit nobody committed.\n");
  const report = areaPlugin(dir, "demo", { into: INTO });
  assert.deepEqual(report.dirty, ["plugins/demo/README.md"]);
  assert.match(areaSummary(report).split("\n")[0], /^NOT COMMITTED: 1 file under plugins\/demo differs from the last commit/);
});

test("a move that stops part way says how to get back, and so does the run after it", () => {
  const dir = fixture();
  // A file where a directory has to be made stops the moves after they start.
  write(dir, `${ONE}/skills/earlier/routes/first/ROUTE.md`, EARLIER[`${ONE}/skills/earlier/routes/first/ROUTE.md`]);
  write(dir, `${AREA}/routes`, "a file where the routes go\n");
  assert.throws(() => areaPlugin(dir, "demo", { write: true, into: INTO }), /stopped part way .*Put the tree back as its last commit has it/s);
  fs.rmSync(path.join(dir, AREA, "routes"));
  fs.mkdirSync(path.join(dir, AREA, "routes", "left"), { recursive: true });
  assert.throws(() => areaPlugin(dir, "demo", { write: true, into: INTO }), /both there: a move was started and did not finish\. Put the tree back/);
});

// A join of nothing but steps up says how far above the file to look, not
// which file: critical-context.mjs finds its sibling plugins that way, and
// two more steps would point above the plugin's root in an installed copy.
test("a join from a file's own directory that is nothing but steps up is left as written and listed", () => {
  const CONTEXT = 'import path from "node:path";\nexport const siblings = () => path.join(import.meta.dirname, "..", "..");\nexport const root = path.join(import.meta.dirname, "..");\n';
  const dir = fixture({ files: { "plugins/demo/hooks/critical-context.mjs": CONTEXT } });
  const report = areaPlugin(dir, "demo", { write: true, into: INTO });
  assert.equal(read(dir, `${AREA}/hooks/critical-context.mjs`), CONTEXT);
  const listed = report.parts.filter((p) => p.file.endsWith("critical-context.mjs"));
  assert.deepEqual(listed.map((p) => [p.line, p.text]), [[2, '"..", ".."']]);
  assert.match(listed[0].why, /nothing but steps up, left as it is/);
});

test("a flag that takes a value and has none is an error, never its default: --into last writes nothing", () => {
  const dir = fixture();
  const before = snapshot(dir);
  for (const args of [["demo", "--write", "--root", dir, "--into"], ["demo", "--into", "--write", "--root", dir]]) {
    const result = runNode(SCRIPT, args);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^door-plugin: --into takes a value$/m);
  }
  assert.deepEqual(snapshot(dir), before);
});

// ---- a skill that leaves for an area of its own -----------------------------

// The plugin's name is built, never written out: this checkout's catalog
// lists it, and its addresses here would be read as this checkout's own.
test("a skill that leaves its plugin becomes the route of another area: its instructions the route, what sat beside it the area's own, its data started", () => {
  const WB = ["plugin", "workbench"].join("-"), LENS = ["context", "lens"].join("-");
  const { dir, git } = tempRepo(keep, "area-split-");
  write(dir, ".claude-plugin/marketplace.json", `${JSON.stringify({ name: "fixture-market", owner: { name: "test" }, plugins: [{ name: INTO, source: `./plugins/${INTO}` }, { name: WB, source: `./plugins/${WB}` }] }, null, 2)}\n`);
  for (const [rel, text] of Object.entries(ONE_FILES)) write(dir, rel, text);
  write(dir, `plugins/${WB}/.claude-plugin/plugin.json`, `${JSON.stringify({ name: WB, version: "0.1.0", description: "Makes plugins." })}\n`);
  write(dir, `plugins/${WB}/skills/make/SKILL.md`, `---\nname: make\ndescription: "Makes a plugin. Use when one is wanted."\n---\n\n# make\n\nThen look with /${WB}:${LENS}.\n`);
  write(dir, `plugins/${WB}/skills/${LENS}/SKILL.md`, `---\nname: ${LENS}\ndescription: "Shows what entered the context. Use when asked what the agent saw."\ndisable-model-invocation: true\n---\n\n# ${LENS}\n\n\`\`\`bash\nnode "${ROOT_VAR}/skills/${LENS}/scripts/lens.mjs"\n\`\`\`\n`);
  write(dir, `plugins/${WB}/skills/${LENS}/scripts/lens.mjs`, "export {};\n");
  git("add", "-A");
  const report = areaPlugin(dir, WB, { write: true, into: INTO });
  const route = `${ONE}/skills/context-doctor/routes/lens/ROUTE.md`;
  assert.deepEqual(parseFrontmatter(read(dir, route)), { name: "lens", description: "Shows what entered the context. Use when asked what the agent saw." });
  assert.ok(has(dir, `${ONE}/skills/context-doctor/scripts/lens.mjs`));
  assert.match(read(dir, route), /^node "W\/scripts\/lens\.mjs"$/m);
  assert.deepEqual(namedDirs(read(dir, route)), [{ name: "W", rel: "../.." }]);
  assert.deepEqual(report.routes, ["make"]);
  assert.deepEqual(report.created, [`${ONE}/skills/context-doctor/door.json`]);
  assert.deepEqual(readJson(path.join(dir, ONE, "skills/context-doctor/door.json")), { lead: "", default: "", routes: { lens: { cue: "" } } });
  assert.match(read(dir, `${ONE}/skills/${WB}/routes/make/ROUTE.md`), /Then look with \/single:context-doctor lens\./);
  assert.equal(has(dir, `${ONE}/skills/${WB}/routes/${LENS}`), false);
});
