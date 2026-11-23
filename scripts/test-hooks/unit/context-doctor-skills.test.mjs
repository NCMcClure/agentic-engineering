// The context-doctor area's routes, read as an agent reads them: a name that
// matches its folder, a route's frontmatter keys and no others, a description
// that says when to take it, and no script or subcommand in a body that the
// area does not ship. What the scripts do is pinned in the lens and diagnose
// suites.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { area, routeBasics } from "./area-routes.mjs";
import { runNode } from "./helpers.mjs";

const AREA = area("context-doctor");
const CLI = path.join(AREA.dir, "scripts", "context-lens.mjs");

test("context-doctor routes: the area ships exactly its two, and a bare call diagnoses", () => {
  assert.deepEqual(AREA.routes.map((r) => r.name), ["diagnose", "lens"]);
  assert.equal(AREA.door.default, "diagnose", "the question that brings someone here is what went wrong, and the lens is what answers how");
  assert.deepEqual(AREA.routes.filter((r) => AREA.starts(r.name) === "person"), [], "both read and change nothing, so a model may start either");
});

routeBasics(test, AREA, { when: /\bUse when\b/, cap: 700, heading: true });

test("context-doctor routes: every script a route runs is one the area ships, under the directory the route named", () => {
  for (const route of AREA.routes) {
    assert.match(route.body, /^`S` below is `\.\.\/\.\.\/scripts` from the directory this file is in/m, route.name);
    const scripts = [...route.text.matchAll(/"S\/([A-Za-z0-9_.-]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, `${route.name} runs the area's script`);
    for (const script of scripts) assert.ok(fs.existsSync(path.join(AREA.dir, "scripts", script)), `S/${script}`);
  }
});

test("context-doctor routes: every subcommand a route runs is one the script takes", () => {
  const usage = runNode(CLI, ["no-such-command"]);
  assert.equal(usage.status, 2);
  const takes = new Set([...usage.stderr.matchAll(/(?:^usage: context-lens\.mjs |\| )([a-z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...takes].sort(), ["diagnose", "list", "report", "serve"]);
  for (const route of AREA.routes) {
    for (const m of route.text.matchAll(/"S\/context-lens\.mjs" ([a-z]+)/g)) assert.ok(takes.has(m[1]), `${route.name}: ${m[1]}`);
  }
});

test("context-doctor routes: each sends the other's question to the other, by address", () => {
  assert.match(AREA.route("lens").body, /\/agentic-engineering:context-doctor diagnose/);
  assert.match(AREA.route("diagnose").body, /\/agentic-engineering:context-doctor lens/);
  // The boundary with the doctor that reads a repo's files, not a session.
  assert.match(AREA.route("diagnose").body, /\/agentic-engineering:agent-works doctor/);
});

test("context-doctor: the area's own text says a fix is made only when asked, and never by a script", () => {
  assert.match(AREA.skill.body, /No script here edits a plugin, a hook, or a transcript/);
  assert.match(AREA.route("diagnose").body, /fix only if asked/);
  for (const script of fs.readdirSync(path.join(AREA.dir, "scripts"))) {
    const text = fs.readFileSync(path.join(AREA.dir, "scripts", script), "utf8");
    assert.doesNotMatch(text, /writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync/, `${script} writes nothing`);
  }
});
