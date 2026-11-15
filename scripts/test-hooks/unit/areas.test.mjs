// The one plugin's skills, as a host lists them: the entry skill a person
// types, and the thirteen areas a model calls. A fourteenth area, or a skill
// that is neither, changes what every session's listing costs and what a
// person can type, so the set is pinned here and each area's suite pins its
// own routes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { AREA_PLUGIN, ENTRY_SKILL, parseFrontmatter } from "../../lib.mjs";
import { AGENTCRAFT, area } from "./area-routes.mjs";
import { REPO } from "./helpers.mjs";

const AREAS = [
  "agent-works", "agentic-teamwork", "but-first-planning", "code-diet", "codebase-optimizer", "context-doctor", "docs-parity",
  "perceptual-loop", "picture-this", "plugin-workbench", "system-map", "workflow-studio", "write-like-me",
];
const SKILLS = path.join(AGENTCRAFT, "skills");
const dirs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

test("agentcraft: its only skills are start-here and the thirteen areas", () => {
  assert.equal(path.basename(AGENTCRAFT), AREA_PLUGIN);
  assert.deepEqual(dirs(SKILLS), [...AREAS, ENTRY_SKILL].sort());
  for (const name of AREAS) assert.ok(fs.existsSync(path.join(SKILLS, name, "routes")), `${name} holds routes/, which is what makes a skill an area`);
  assert.equal(fs.existsSync(path.join(SKILLS, ENTRY_SKILL, "routes")), false, "the entry skill is not an area");
});

test("agentcraft: a person can type the entry skill and nothing else", () => {
  const entry = parseFrontmatter(fs.readFileSync(path.join(SKILLS, ENTRY_SKILL, "SKILL.md"), "utf8"));
  assert.equal(entry.name, ENTRY_SKILL);
  assert.notEqual(entry["user-invocable"], "false");
  assert.notEqual(entry["disable-model-invocation"], "true", "a model may send a person's question here too");
  for (const name of AREAS) assert.equal(area(name).skill.fields["user-invocable"], "false", `${name} is in the slash menu`);
});

test("agentcraft: the entry skill asks about every area once, and names each to an agent", () => {
  const entry = JSON.parse(fs.readFileSync(path.join(SKILLS, ENTRY_SKILL, "start-here.json"), "utf8"));
  assert.deepEqual(entry.groups.flatMap((g) => g.areas).sort(), AREAS, "each area is in exactly one group");
  assert.deepEqual(Object.keys(entry.areas).sort(), AREAS);
  for (const [name, said] of Object.entries(entry.areas)) {
    const a = area(name);
    // A use hands off to a route, or to the area's own page where the job is the area's and no route's.
    for (const use of said.uses ?? []) if (use.to && use.to !== name) assert.ok(a.route(use.to), `${name}: "${use.want}" hands off to ${use.to}, which is not a route`);
  }
  const description = parseFrontmatter(fs.readFileSync(path.join(SKILLS, ENTRY_SKILL, "SKILL.md"), "utf8")).description;
  for (const name of AREAS) assert.ok(description.includes(name), `the entry skill's description does not name ${name}`);
});

test("agentcraft: every other plugin directory is a stub that depends on it, and ships no skill of an area's name", () => {
  const plugins = path.join(REPO, "plugins");
  const others = dirs(plugins).filter((name) => name !== AREA_PLUGIN);
  assert.ok(others.length >= 12, "the twelve old names are still there to update from");
  for (const name of others) {
    const manifest = JSON.parse(fs.readFileSync(path.join(plugins, name, ".claude-plugin", "plugin.json"), "utf8"));
    assert.ok((manifest.dependencies ?? []).some((d) => (typeof d === "string" ? d : d.name) === AREA_PLUGIN), `${name} does not depend on ${AREA_PLUGIN}`);
    for (const dir of ["hooks", "agents", "bin", "lib", "scripts"]) assert.equal(fs.existsSync(path.join(plugins, name, dir)), false, `${name}/${dir}: a stub runs nothing`);
  }
});
