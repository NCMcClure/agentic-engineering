// Every route of the agent-works area, read as the model reads it: a
// description that says when, a route's keys and no more, and nothing in the
// body that is not there to be run. A route that names a file the plugin does
// not ship, or a command the dispatcher does not know, sends an agent down a
// dead end at the moment it most needs the instruction to be right.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { area, code, routeBasics } from "./area-routes.mjs";
import { runNode } from "./helpers.mjs";

const AREA = area("agent-works");
const EXPECTED = [
  "board", "coordinate", "decisions", "dispatch", "doctor", "guard", "hubs", "memory", "orchestrate", "resource-locks", "review-card",
  "setup", "sync-cards", "work-card",
];
// How a route calls the command line: by a path under the directory it named.
const CALL = 'node "W/scripts/aw.mjs"';

const { MODULES } = await import(pathToFileURL(path.join(AREA.dir, "scripts", "aw.mjs")).href);
const COMMANDS = new Set(MODULES.flatMap((m) => m.commands));
const routes = AREA.routes;

/** Each `aw <command> [<word>]` a piece of code runs, whichever way `aw` is spelled. */
const calls = (text) => [...text.matchAll(/(?:^|[\s(|;&])(?:aw|node "W\/scripts\/aw\.mjs")\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/gm)].map((m) => ({ command: m[1], action: m[2] ?? null }));

test("agent-works routes: the set is the board's and the loop's routes, and the homes' routes", () => {
  assert.deepEqual(routes.map((r) => r.name), EXPECTED);
  assert.equal(AREA.door.default, "doctor");
});

routeBasics(test, AREA, { cap: 300, heading: true });

for (const route of routes) {
  test(`agent-works routes: every aw command ${route.name} names is one the dispatcher knows, called by its path`, () => {
    const found = code(route.body).flatMap(calls);
    for (const { command } of found) assert.ok(COMMANDS.has(command), `aw ${command}`);
    assert.ok(!found.some((c) => c.command === "kanban"), "the board's command is `aw board`");
    if (found.length) assert.ok(route.body.includes(CALL), `names aw and never says how to call it: ${CALL}`);
  });
}

test("agent-works routes: the area's own page says how to call aw where the host fills the plugin's root in", () => {
  assert.ok(AREA.skill.body.includes('node "${CLAUDE_PLUGIN_ROOT}/skills/agent-works/scripts/aw.mjs"'));
  for (const { command } of code(AREA.skill.body).flatMap(calls)) assert.ok(COMMANDS.has(command), `aw ${command}`);
});

test("agent-works routes: every board action a route names is one `aw board` has", () => {
  const help = runNode(path.join(AREA.dir, "scripts", "aw.mjs"), ["board", "--help"]).stdout;
  const known = new Set([...help.matchAll(/(?:^ {2}|\s{3,}|\| )([a-z]+)(?= |$)/gm)].map((m) => m[1]));
  for (const action of ["list", "show", "status", "ready", "epics", "lint", "add", "epic", "edit", "move", "reorder", "plan", "note", "owe", "settle", "sprint", "config", "remote", "propose", "grant", "brief", "bind", "claim", "done", "abandon", "wait", "evidence"]) {
    assert.ok(known.has(action), `the help no longer lists ${action}`);
  }
  for (const route of routes) {
    for (const { command, action } of code(route.body).flatMap(calls)) {
      if (command === "board" && action) assert.ok(known.has(action), `${route.name}: aw board ${action}`);
    }
  }
});

test("agent-works routes: nothing points at what 1.0 took away", () => {
  for (const { name, text } of [AREA.skill, ...routes]) {
    assert.doesNotMatch(text, /core\/references|\bcli\/|\.py\b|python|kanban-cards|board\.mjs|lock\.mjs/, name);
    assert.doesNotMatch(text, /—/, `${name}: an em-dash`);
    // A gate is closed by its evidence, never by a move.
    assert.doesNotMatch(text, /board move \S+ done\b.*gate|gate.*board move \S+ done\b/, name);
  }
});

test("agent-works routes: a command under a lock or a lease is a program with arguments, a shell line wrapped", () => {
  for (const { name, body } of routes) {
    for (const piece of code(body)) {
      for (const m of piece.matchAll(/\b(?:lock run|lease)\b[^\n]*? -- (\S+)/g)) assert.doesNotMatch(m[1], /^["']/, `${name}: ${m[0]}`);
    }
  }
  const wrapped = routes.filter((r) => /-- bash -c "/.test(r.body)).map((r) => r.name);
  assert.deepEqual(wrapped, ["coordinate", "resource-locks"]);
});

test("agent-works routes: only setup is the person's to start, and a route that names it has the model ask", () => {
  assert.deepEqual(routes.map((r) => r.name).filter((name) => AREA.starts(name) === "person"), ["setup"]);
  for (const { name, text } of routes) {
    if (name === "setup") continue;
    assert.doesNotMatch(text, /`setup` skill/, name);
    for (const m of text.matchAll(/[^.\n]*\/agentic-engineering:agent-works setup[^\n]*/g)) assert.match(m[0], /ask (the person|them)/, `${name}: ${m[0]}`);
  }
});

test("agent-works routes: the routes that fan out say what to do where the host cannot", () => {
  const fallback = "W/routes/orchestrate/references/subagent-fallback.md";
  for (const name of ["orchestrate", "dispatch", "sync-cards"]) assert.ok(AREA.route(name).text.includes(fallback), name);
  const text = fs.readFileSync(path.join(AREA.dir, "routes", "orchestrate", "references", "subagent-fallback.md"), "utf8");
  for (const head of ["## No child sessions", "## No Workflow tool", "## No second reader"]) assert.ok(text.includes(head), head);
  assert.match(AREA.route("sync-cards").text, /W\/routes\/sync-cards\/workflows\/sync\.js/);
});

test("agent-works routes: the area's listing stays small", () => {
  const listed = AREA.skill.fields.description.length;
  assert.ok(listed <= 1536, `${listed} characters of description: past the cap, the host cuts the routes at the end off`);
});

test("agent-works routes: the templates a card is written from name the section the board reads", () => {
  const templates = path.join(AREA.dir, "assets", "templates");
  for (const file of ["card.md", "epic-card.md"]) assert.match(fs.readFileSync(path.join(templates, file), "utf8"), /^## Done when$/m, file);
  for (const file of fs.readdirSync(templates)) assert.doesNotMatch(fs.readFileSync(path.join(templates, file), "utf8"), /aw kanban|Done looks like|core\/references/, file);
});
