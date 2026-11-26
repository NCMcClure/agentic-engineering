// The harness area's routes as text an agent will follow: each ROUTE.md is
// held to a route's frontmatter, says when to take it, and points only at
// files the area ships. It holds three kinds of route, once three areas: the
// plugin routes, whose rubric has to list exactly the checks the scorer knows
// or a grader is sent looking for a section that is not there; the context
// routes, which read a transcript and change nothing; and the workflow route,
// beside the area's own page that opens the studio, whose launch command is
// checked word by word since the agent runs it exactly as written. A fourth
// kind came from agent-works: the routes for a repo's agent-facing setup,
// which run on the agents area's `aw` command line.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { pluginRootPaths, walk } from "../../lib.mjs";
import { runScan, runScore } from "../../../plugins/agentic-engineering/skills/harness/core/scripts/plugin-scan.mjs";
import { AGENTCRAFT, area, code, routeBasics } from "./area-routes.mjs";
import { REPO, runNode } from "./helpers.mjs";

const AREA = area("harness");
const PLUGIN = AREA.dir;
// The plugin routes, by the prefix they share, and the marketplace's.
const ROUTES = AREA.routes.map((r) => r.name).filter((name) => /^(plugin|marketplace)-/.test(name));
const text = (...rel) => fs.readFileSync(path.join(PLUGIN, ...rel), "utf8");
const shipped = walk(PLUGIN).map((f) => f.split(path.sep).join("/"));

// The routes that came from agent-works, for a repo's agent-facing setup.
const SETUP = ["decisions", "doctor", "guard", "hubs", "memory", "setup"];

test("harness routes: the area ships its thirteen, in four kinds, and a bare call diagnoses", () => {
  assert.deepEqual(AREA.routes.map((r) => r.name), ["decisions", "diagnose", "doctor", "guard", "hubs", "lens", "marketplace-refresh", "memory", "plugin-create", "plugin-evaluate", "plugin-improve", "setup", "workflow"]);
  assert.deepEqual(Object.keys(AREA.door.routes), ["plugin-improve", "plugin-create", "plugin-evaluate", "marketplace-refresh", "diagnose", "lens", "workflow", "memory", "decisions", "hubs", "guard", "doctor", "setup"]);
  assert.equal(AREA.door.default, "diagnose", "the question that brings someone here is what went wrong, and the lens is what answers how");
  assert.deepEqual(fs.readdirSync(path.join(AREA.dir, "hooks")), ["critical.json"], "the hubs line, and no hook of its own");
});

routeBasics(test, AREA, { when: /\bUse\s+when\b/, cap: 1024, only: AREA.routes.map((r) => r.name).filter((name) => !SETUP.includes(name)) });
routeBasics(test, AREA, { cap: 300, heading: true, only: SETUP, door: false });

for (const route of AREA.routes.filter((r) => ROUTES.includes(r.name))) {
  const md = route.text;

  test(`harness routes: every relative link and every script ${route.name} names is a file the area ships`, () => {
    assert.ok(route.fields.description.length >= 80, `${route.fields.description.length} characters`);
    const links = [...md.matchAll(/\[[^\]]*\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^(https?:|mailto:)/.test(l));
    for (const link of links) assert.ok(fs.existsSync(path.join(route.dir, link)), link);
    // A script named anywhere in the route is there to run. marketplace-refresh
    // alone names scripts that belong to the checkout it works on.
    const theirs = route.name === "marketplace-refresh" ? ["refresh.mjs", "validate.mjs", "install.mjs"] : [];
    for (const [, script] of md.matchAll(/\b([a-z][a-z-]*\.mjs)\b/g)) {
      if (!theirs.includes(script)) assert.ok(shipped.some((f) => f.endsWith(`/scripts/${script}`)), script);
    }
  });
}

test("harness routes: only the three hand-run routes are the person's to start", () => {
  assert.deepEqual(AREA.routes.map((r) => r.name).filter((name) => AREA.starts(name) === "person"), ["marketplace-refresh", "plugin-evaluate", "setup"]);
});

test("harness routes: every route that calls Workflow() points at the subagent fallback, and the fallback is there to read", () => {
  const calling = ROUTES.filter((r) => AREA.route(r).text.includes("Workflow({"));
  assert.deepEqual(calling, ["plugin-create", "plugin-evaluate"]);
  for (const name of calling) assert.match(AREA.route(name).text, /\[\.\.\/\.\.\/core\/references\/subagent-fallback\.md\]\(\.\.\/\.\.\/core\/references\/subagent-fallback\.md\)/);
  assert.match(text("core", "references", "subagent-fallback.md"), /^## The fallback$/m);
});

test("the rubric has a section for every check the scorer knows, and marks the mechanical ones", () => {
  const scan = runScan(PLUGIN);
  const grades = scan.applicable_judgment_checks.map((check) => ({ check, grade: 3, evidence: "e", ...(scan.per_skill_checks.includes(check) ? { skill: "s" } : {}) }));
  const known = runScore(scan, { grades }).dimensions.flatMap((d) => d.checks.map((c) => [c.id, c.kind]));
  const sections = [...text("core", "references", "rubric.md").matchAll(/^### ([A-Z]{2}\d) · (.*)$/gm)].map((m) => [m[1], /\(mechanical/.test(m[2]) ? "m" : "j"]);
  assert.deepEqual(sections, known);
  assert.equal(known.filter(([, kind]) => kind === "m").length, 18, "the README counts them");
  assert.match(text("README.md"), /^Eighteen of the rubric's checks are mechanical/m);
});

test("each house check the rubric sends to mechanical-checks.md has its rule and its fix there", () => {
  const rubric = text("core", "references", "rubric.md");
  const house = text("core", "references", "mechanical-checks.md");
  const sent = [...rubric.matchAll(/\[mechanical-checks\.md\]\(mechanical-checks\.md#([a-z]{2}\d)\)/g)].map((m) => m[1].toUpperCase());
  assert.deepEqual(sent, ["SQ8", "SQ9", "CS7", "WQ7", "AN6", "CF6", "MH3", "MH5"]);
  // A heading that is the id alone, so the rubric's link lands on it.
  const entries = [...house.matchAll(/^## ([A-Z]{2}\d)$/gm)].map((m) => m[1]);
  assert.deepEqual(entries, sent);
  entries.forEach((id, i) => {
    const from = house.indexOf(`## ${id}\n`);
    const entry = house.slice(from, i + 1 < entries.length ? house.indexOf(`## ${entries[i + 1]}\n`) : undefined);
    assert.match(entry, /^\*\*Fix:\*\* /m, `${id} names no fix`);
  });
  // plugin-improve applies those fixes, so it points at the file and names every check in it.
  const improve = AREA.route("plugin-improve").text;
  assert.ok(improve.includes("core/references/mechanical-checks.md"));
  for (const id of entries) assert.ok(improve.includes(id), `plugin-improve does not name ${id}`);
});

test("the workflows send their graders to rubric sections that exist", () => {
  const rubric = text("core", "references", "rubric.md");
  const named = ["plugin-create/workflows/create.js", "plugin-evaluate/workflows/evaluate.js"]
    .flatMap((f) => [...text("routes", f).matchAll(/section \\?"([^"\\]+)\\?" in full/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(named)], ["SQ: Skill quality"]);
  for (const heading of named) assert.ok(rubric.includes(`\n## ${heading}\n`), heading);
});

test("nothing in the area is anything but Node, and no route still reaches for a script that is gone", () => {
  assert.deepEqual(shipped.filter((f) => /\.(py|sh|bash|zsh|ps1|rb|pl)$/.test(f)), []);
  const stale = shipped.filter((f) => /\.(md|js|mjs|html|stub|json)$/.test(f) && !f.startsWith("history/") && /python3?\b|plugin_scan|plugin_scaffold|script-py/.test(text(f)));
  assert.deepEqual(stale, []);
  for (const f of shipped.filter((f) => f.endsWith(".mjs"))) assert.doesNotMatch(text(f), /process\.exit\(/, f);
});

test("every stub is one the scaffolder reads, and every stub it reads is shipped", () => {
  const stubs = shipped.filter((f) => f.startsWith("routes/plugin-create/assets/stubs/")).map((f) => path.posix.basename(f)).sort();
  const read = [...text("routes", "plugin-create", "scripts", "plugin-scaffold.mjs").matchAll(/readStub\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(read)].sort(), stubs);
  const notes = text("routes", "plugin-create", "references", "authoring-notes.md");
  for (const stub of stubs) assert.ok(notes.includes(`\`${stub}\``), `authoring-notes.md does not explain ${stub}`);
});

test("marketplace-refresh names the dev-loop scripts this marketplace has, with the flags they take", () => {
  const md = AREA.route("marketplace-refresh").text;
  for (const script of ["scripts/refresh.mjs", "scripts/validate.mjs", "scripts/install.mjs"]) {
    assert.ok(md.includes(script), script);
    assert.ok(fs.existsSync(path.join(REPO, script)), `${script} is gone from this checkout`);
  }
  const installer = fs.readFileSync(path.join(REPO, "scripts", "install.mjs"), "utf8");
  for (const flag of ["--plugins", "--dry-run", "--force", "--uninstall"]) {
    assert.ok(md.includes(flag), `${flag} is not in the route`);
    assert.ok(installer.includes(`"${flag}"`), `${flag} is not a flag of scripts/install.mjs`);
  }
});

// ---- the two shapes, and what a score does not measure ------------------------

test("harness: the shape and measuring references are reached from the routes that need them, by a path under the area", () => {
  for (const ref of ["shapes.md", "measuring.md"]) assert.ok(fs.existsSync(path.join(AREA.dir, "core", "references", ref)), ref);
  const names = (route, ref) => AREA.route(route).text.includes(`\`W/core/references/${ref}\``);
  assert.ok(names("plugin-create", "shapes.md") && names("plugin-create", "measuring.md"));
  assert.ok(names("plugin-improve", "shapes.md") && names("plugin-improve", "measuring.md"));
  assert.ok(names("plugin-evaluate", "measuring.md"));
  assert.match(text("core", "references", "rubric.md"), /\[shapes\.md\]\(shapes\.md\).*\n.*\[measuring\.md\]\(measuring\.md\)/);
});

test("harness: shapes.md teaches the rule of thumb, and its three kinds of skill are the scaffolder's three modes", () => {
  const shapes = text("core", "references", "shapes.md");
  assert.match(shapes, /\*\*Plain\*\* while the plugin is one body of work and lists about eight\n\s+skills or fewer/);
  assert.match(shapes, /\*\*Areas\*\* when the plugin holds several bodies of work/);
  assert.match(shapes, /\*\*Never for reach\.\*\*/);
  for (const key of ["`user-invocable: false`", "`disable-model-invocation: true`"]) assert.ok(shapes.includes(key), key);
  const scaffold = text("routes", "plugin-create", "scripts", "plugin-scaffold.mjs");
  assert.match(scaffold, /const MODES = \["model", "callable", "user"\];/);
  for (const mode of ["model", "callable", "user"]) assert.match(AREA.route("plugin-create").text, new RegExp(`mode: "${mode}"`), mode);
  // A person cannot type an area, and the reference says what that means for anything written for one.
  assert.match(shapes, /A person cannot type an area/);
  assert.ok(shapes.split("\n").length < 120, "a reference an agent reads whole");
});

test("harness: measuring.md holds a lane to one prompt, two windows, three passes, and the bar of no worse", () => {
  const measuring = text("core", "references", "measuring.md");
  for (const rule of ["**One prompt per session.**", "**Two windows.**", "**Three passes.**", "**A failing recording writes nothing.**", "**The bar is \"no worse\".**", "Never run it yourself."]) assert.ok(measuring.includes(rule), rule);
  assert.match(measuring, /\/agentic-engineering:harness diagnose/);
  assert.match(measuring, /--score <outdir>\/grades\.json --measured <outdir>\/diagnose\.json/);
});

test("harness: no route runs sessions or a repo's live tests, and plugin-improve says what it did not measure", () => {
  assert.match(AREA.skill.body, /\*\*A score reads files\.\*\*/);
  const improve = AREA.route("plugin-improve").text;
  assert.match(improve, /\*\*A shape is not a fix\.\*\*/);
  assert.match(improve, /\*\*Never spend the person's quota\.\*\*/);
  assert.match(improve, /\*\*What was not measured:\*\*/);
  assert.match(improve, /leave the run to the person: never start it/);
  for (const route of AREA.routes.filter((r) => ROUTES.includes(r.name))) assert.doesNotMatch(route.text, /npm run test:live/, `${route.name} names no repo's lane by its command: it finds one in the target's docs`);
});

test("harness: the scorecard has a slot for every measured field the report format names, and the listing at both windows", () => {
  const template = text("core", "assets", "scorecard-template.html");
  const format = text("core", "references", "report-format.md");
  const slots = ["LISTING_ENTRIES", "LISTING_DESCRIBED_CHARS", "LISTING_NAMES_CHARS", "MEASURED_COUNTS", "MEASURED_SESSION", "MEASURED_CLASSES", "MEASURED_LEVEL", "MEASURED_CODE", "MEASURED_OWNER", "MEASURED_WHAT", "MEASURED_FIX"];
  for (const slot of slots) assert.ok(template.includes(`{{${slot}}}`), `template: ${slot}`);
  for (const slot of ["LISTING_ENTRIES", "LISTING_DESCRIBED_CHARS", "LISTING_NAMES_CHARS", "MEASURED_COUNTS", "MEASURED_SESSION"]) assert.ok(format.includes(`{{${slot}}}`), `report-format: ${slot}`);
  assert.match(template, /<section class="card measured" data-optional="measured">/);
  assert.match(template, /id="tpl-measured-item" data-fill-into="measured-list"/);
  assert.match(format, /no measured block/);
  assert.match(format, /## Measured in one session/);
});

// ---- the context routes: a transcript read back ------------------------------

const CONTEXT = ["diagnose", "lens"];
const CLI = path.join(AREA.dir, "scripts", "context-lens.mjs");
// The scripts the context routes run, which read and never write. The studio's launcher beside them installs an app, and is not one.
const READERS = fs.readdirSync(path.join(AREA.dir, "scripts")).filter((s) => s !== "launch-studio.mjs");

test("harness routes: a context route says its name as its heading, and either may be started by a model", () => {
  for (const name of CONTEXT) assert.match(AREA.route(name).body, new RegExp(`^# ${name}$`, "m"));
  assert.deepEqual(CONTEXT.filter((name) => AREA.starts(name) === "person"), [], "both read and change nothing, so a model may start either");
  for (const name of CONTEXT) assert.ok(AREA.route(name).fields.description.length <= 700);
});

test("harness routes: every script a context route runs is one the area ships, under the directory the route named", () => {
  for (const route of CONTEXT.map((name) => AREA.route(name))) {
    assert.match(route.body, /^\`S\` below is \`\.\.\/\.\.\/scripts\` from the directory this file is in/m, route.name);
    const scripts = [...route.text.matchAll(/"S\/([A-Za-z0-9_.-]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, `${route.name} runs the area's script`);
    for (const script of scripts) assert.ok(fs.existsSync(path.join(AREA.dir, "scripts", script)), `S/${script}`);
  }
});

test("harness routes: every subcommand a context route runs is one the script takes", () => {
  const usage = runNode(CLI, ["no-such-command"]);
  assert.equal(usage.status, 2);
  const takes = new Set([...usage.stderr.matchAll(/(?:^usage: context-lens\.mjs |\| )([a-z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...takes].sort(), ["diagnose", "list", "report", "serve"]);
  for (const route of CONTEXT.map((name) => AREA.route(name))) {
    for (const m of route.text.matchAll(/"S\/context-lens\.mjs" ([a-z]+)/g)) assert.ok(takes.has(m[1]), `${route.name}: ${m[1]}`);
  }
});

test("harness routes: each context route sends the other's question to the other, by address", () => {
  assert.match(AREA.route("lens").body, /\/agentic-engineering:harness diagnose/);
  assert.match(AREA.route("diagnose").body, /\/agentic-engineering:harness lens/);
  // The boundary with the doctor that reads a repo's files, not a session.
  assert.match(AREA.route("diagnose").body, /\/agentic-engineering:harness doctor/);
});

test("harness: the area's own text says a fix is made only when asked, and never by a script", () => {
  assert.match(AREA.skill.body, /No script here edits a plugin, a hook, or a transcript/);
  assert.match(AREA.route("diagnose").body, /fix only if asked/);
  for (const script of READERS) {
    const text = fs.readFileSync(path.join(AREA.dir, "scripts", script), "utf8");
    assert.doesNotMatch(text, /writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync/, `${script} writes nothing`);
  }
});

// ---- the workflow route, and the page that opens the studio ---------------------

const launch = AREA.skill;

test("harness routes: every plugin-root path the area's page names exists", () => {
  const paths = launch.text.split("\n").flatMap((line) => pluginRootPaths(line)).filter((p) => !p.placeholder).map((p) => p.path.replace(/\.$/, ""));
  assert.ok(paths.length >= 1, "the page that opens the studio points into the plugin");
  for (const rel of paths) assert.ok(fs.existsSync(path.join(AGENTCRAFT, rel)), `\${CLAUDE_PLUGIN_ROOT}/${rel}`);
});

test("harness routes: opening the studio is the area's own job, and its page says the route is the other one", () => {
  assert.match(launch.body, /^## Launch$/m);
  assert.match(launch.body, /is \`workflow\`/);
  assert.ok(AREA.route("workflow").fields.description.length <= 700);
});

test("harness routes: the launch command runs the launcher with node and hands it the three folders, in order", () => {
  const command = launch.text.split("\n").find((l) => l.includes("launch-studio"));
  assert.equal(command.trim(), 'node "${CLAUDE_PLUGIN_ROOT}/skills/harness/scripts/launch-studio.mjs" "${CLAUDE_PLUGIN_ROOT}/skills/harness" "$STUDIO_ROOT" "${CLAUDE_PLUGIN_DATA}"');
  const block = launch.text.slice(launch.text.indexOf("\`\`\`bash"), launch.text.indexOf("\`\`\`", launch.text.indexOf("\`\`\`bash") + 7));
  assert.match(block, /STUDIO_ROOT="\$\{CLAUDE_PROJECT_DIR:-\$HOME\}\/\.claude\/workflow-studio"/, "the studio root is the project's, or the home's outside a project");
  assert.match(block, /WORKFLOW_EXPORT_ROOT="\$\{CLAUDE_PROJECT_DIR:-\$HOME\}" \\\n/, "Publish is confined to the same folder");
});

test("harness routes: what the page promises about a missing prerequisite is what the launcher prints", () => {
  const source = fs.readFileSync(path.join(AREA.dir, "scripts", "launch-studio.mjs"), "utf8");
  assert.match(launch.text, /\`npm\` is missing or Node is older\s+than 20/);
  assert.match(source, /'npm' was not found on PATH/);
  assert.match(source, /needs Node 20\+/);
  assert.match(launch.text, /Node\.js 20 or newer/);
});

test("harness routes: the area ships no shell script outside the bundled app, and no document names one", () => {
  const files = fs.readdirSync(AREA.dir, { recursive: true }).map(String).map((f) => f.split(path.sep).join("/")).filter((f) => !f.startsWith("app/"));
  assert.deepEqual(files.filter((f) => /\.(py|pyc|sh|bash)$/.test(f)), []);
  for (const file of files.filter((f) => f.endsWith(".md") && !f.startsWith("history/"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(AREA.dir, file), "utf8"), /launch-studio\.sh|\bbash "|\bpython3?\b/, file);
  }
});

// ---- the setup routes: a repo's agent-facing setup, on the agents area's aw ----

const AGENTS = area("agents");
// How a route calls the command line: by a path under the agents area, which it names as W.
const CALL = 'node "W/scripts/aw.mjs"';
const { MODULES } = await import(pathToFileURL(path.join(AGENTS.dir, "scripts", "aw.mjs")).href);
const COMMANDS = new Set(MODULES.flatMap((m) => m.commands));
/** Each `aw <command>` a piece of code runs, whichever way `aw` is spelled. */
const calls = (body) => [...body.matchAll(/(?:^|[\s(|;&])(?:aw|node "W\/scripts\/aw\.mjs")\s+([a-z][a-z-]*)/gm)].map((m) => m[1]);

for (const name of SETUP) {
  const route = AREA.route(name);
  test(`harness routes: ${name} names the agents area as W, and every aw command it runs is one the dispatcher knows`, () => {
    assert.match(route.body, /^`W` below is `\.\.\/\.\.\/\.\.\/agents` from the directory this file is in/m);
    const found = code(route.body).flatMap(calls);
    for (const command of found) assert.ok(COMMANDS.has(command), `aw ${command}`);
    if (found.length) assert.ok(route.body.includes(CALL), `names aw and never says how to call it: ${CALL}`);
    assert.doesNotMatch(route.text, /core\/references|\bcli\/|\.py\b|python|kanban-cards|\u2014/, name);
  });
}

test("harness routes: a setup route that hands on to another names it through the area that has it now", () => {
  for (const name of SETUP) {
    for (const m of AREA.route(name).text.matchAll(/\/agentic-engineering:([a-z-]+) ([a-z-]+)/g)) {
      assert.ok(area(m[1]).route(m[2]), `${name}: ${m[0]}`);
    }
  }
  for (const { name, text } of [...AREA.routes, ...AGENTS.routes]) {
    if (name === "setup") continue;
    for (const m of text.matchAll(/[^.\n]*\/agentic-engineering:harness setup[^\n]*/g)) assert.match(m[0], /ask (the person|them)/, `${name}: ${m[0]}`);
  }
});
