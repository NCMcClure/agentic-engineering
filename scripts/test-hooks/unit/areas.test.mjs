// The one plugin's skills, as a host lists them: the entry skill a person
// types, and the eight areas a model calls. A ninth area, or a skill
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
  "agents", "code", "delivery", "design", "docs", "harness", "planning", "writing",
];
const SKILLS = path.join(AGENTCRAFT, "skills");
const dirs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

test("agentic-engineering: its only skills are start-here and the eight areas", () => {
  assert.equal(path.basename(AGENTCRAFT), AREA_PLUGIN);
  assert.deepEqual(dirs(SKILLS), [...AREAS, ENTRY_SKILL].sort());
  for (const name of AREAS) assert.ok(fs.existsSync(path.join(SKILLS, name, "routes")), `${name} holds routes/, which is what makes a skill an area`);
  assert.equal(fs.existsSync(path.join(SKILLS, ENTRY_SKILL, "routes")), false, "the entry skill is not an area");
});

test("agentic-engineering: a person can type the entry skill and nothing else", () => {
  const entry = parseFrontmatter(fs.readFileSync(path.join(SKILLS, ENTRY_SKILL, "SKILL.md"), "utf8"));
  assert.equal(entry.name, ENTRY_SKILL);
  assert.notEqual(entry["user-invocable"], "false");
  assert.notEqual(entry["disable-model-invocation"], "true", "a model may send a person's question here too");
  for (const name of AREAS) assert.equal(area(name).skill.fields["user-invocable"], "false", `${name} is in the slash menu`);
});

test("agentic-engineering: the entry skill asks about every area once, and names each to an agent", () => {
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

test("agentic-engineering: it is the only directory under plugins/, and the only plugin the catalog lists", () => {
  assert.deepEqual(dirs(path.join(REPO, "plugins")), [AREA_PLUGIN]);
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.deepEqual(catalog.plugins.map((p) => p.name), [AREA_PLUGIN]);
});

// The root README's figure of the plugin draws one page per route, to the
// real counts, and says how many there are. Its numbers are in its model, so
// a route added or removed fails here until the figure is retaken:
//   pt still routes-behind-names --gif --dark --out docs/assets
test("the routes-behind-names figure draws each area's routes to the count its door holds", () => {
  const model = JSON.parse(fs.readFileSync(path.join(REPO, ".agents", "picture-this", "figures", "routes-behind-names", "model.json"), "utf8"));
  const doors = Object.fromEntries(AREAS.map((name) => [name, Object.keys(area(name).door.routes).length]));
  assert.deepEqual(Object.fromEntries(model.data.areas.map((a) => [a.id, a.routes])), doors, "edit the figure's model.json to the doors, then retake its GIFs");
  const total = Object.values(doors).reduce((n, c) => n + c, 0);
  for (const text of [model.title, model.claim, model.beats[0].plain]) assert.ok(text.includes(`${total} routes`), `"${text}" should say ${total} routes`);
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  assert.ok(readme.includes(`keeps ${total} routes behind nine names`), "the README's alt text for the figure");
  assert.equal(AREAS.length + 1, 9, "nine names: the entry skill and the areas");
});
