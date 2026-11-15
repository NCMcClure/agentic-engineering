// gen-guide.mjs writes three kinds of file from data: each area's SKILL.md
// (its frontmatter and `## Route` block, from door.json and each route's own
// frontmatter), the entry skill's table, and the plugin guide. An area is a
// skill directory that holds `routes/`; the committed tree's own files are the
// generator's output. The fixture's plugins are ones no catalog here carries,
// so the addresses below are not addresses to this checkout's own validate.
// door-plugin: leave
// (The line above keeps the conversion script from rewriting this file's own strings.)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ENTRY_PLUGIN, GUIDE, ROUTE_END, ROUTE_TABLE_HEAD, areaData, areaFile, areas, generate, generated, guide, readArea, readEntry, routeFile, routeNames } from "../../gen-guide.mjs";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const AREA = areaFile("one", "demo");
const AREA_DATA = areaData("one", "demo");
const ALPHA = routeFile("one", "demo", "alpha");
const ROUTES = {
  lead: "Does demo work in two steps.",
  default: "alpha",
  routes: {
    alpha: { cue: "start the alpha thing" },
    beta: { cue: "set beta up", starts: "person" },
  },
};

const skill = (name, description, extra = "") =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${extra}---\n\n# ${name}\n\nWhat ${name} does.\n`;

// A two-plugin marketplace: `one` holds an area, `plain` a skill.
function fixture(t, door = ROUTES) {
  const dir = tempDir(t, "gen-guide-");
  write(dir, ".claude-plugin/marketplace.json", JSON.stringify({ name: "fixture-market", owner: { name: "test" }, plugins: [
    { name: "one", source: "./plugins/one", description: "Every area in one plugin.", category: "testing" },
    { name: "plain", source: "./plugins/plain", description: "A plugin of skills.", category: "testing" },
  ] }));
  for (const p of ["one", "plain"]) write(dir, `plugins/${p}/.claude-plugin/plugin.json`, JSON.stringify({ name: p, version: "0.1.0", description: `The ${p} plugin.` }));
  write(dir, ALPHA, skill("alpha", "Starts the alpha thing from a card. Use when a card is ready to start. Reads the board first.", 'argument-hint: "<card id> [--now|--later]"\n'));
  write(dir, routeFile("one", "demo", "beta"), skill("beta", "Sets beta up in a project. Use when CLAUDE.md is missing or the .agents/ tree is stale."));
  write(dir, "plugins/plain/skills/gamma/SKILL.md", skill("gamma", "Does gamma. Use when gamma is wanted."));
  if (door) write(dir, AREA_DATA, `${JSON.stringify(door, null, 2)}\n`);
  return dir;
}
const gen = (dir, ...flags) => runNode("scripts/gen-guide.mjs", ["--root", dir, ...flags]);
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const written = (t, door) => { const dir = fixture(t, door); const result = gen(dir, "--write"); return { dir, result, text: read(dir, AREA) }; };
const routeSection = (text) => text.slice(text.indexOf("\n## Route\n"));
const count = (text, part) => text.split(part).length - 1;
const recue = (dir) => write(dir, AREA_DATA, JSON.stringify({ ...ROUTES, default: "beta" }));

// ---- the committed tree ----------------------------------------------------

test("every file the generator writes in this checkout is its output", () => {
  const results = generate(REPO);
  assert.ok(results.some((r) => r.rel === GUIDE));
  assert.deepEqual(results.filter((r) => r.state !== "current").map(generated), []);
});

test("every catalog plugin and every one of its skills is in the committed guide", () => {
  const text = fs.readFileSync(path.join(REPO, GUIDE), "utf8");
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "marketplace.json"), "utf8"));
  for (const { name } of catalog.plugins.filter((p) => typeof p.source === "string")) {
    assert.ok(text.includes(`\n## ${name}\n`), name);
    const skills = path.join(REPO, "plugins", name, "skills");
    for (const s of fs.existsSync(skills) ? fs.readdirSync(skills).filter((d) => fs.existsSync(path.join(skills, d, "SKILL.md"))) : []) assert.ok(text.includes(`\`/${name}:${s}`), `${name}:${s}`);
  }
});

// ---- areas -----------------------------------------------------------------

test("an area is a skill directory that holds routes/, found under any plugin, and a route a directory there with a ROUTE.md", (t) => {
  const dir = fixture(t);
  write(dir, "plugins/one/skills/demo/routes/empty/notes.md", "No ROUTE.md, so no route.\n");
  assert.deepEqual(areas(dir), [{ plugin: "one", area: "demo" }]);
  assert.deepEqual(routeNames(dir, "one", "demo"), ["alpha", "beta"]);
});

test("--write gives an area a skill whose description is the lead, then each route as an argument with its cue, callable by a model and out of the slash menu", (t) => {
  const { result, text } = written(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^wrote plugins\/one\/skills\/demo\/SKILL\.md$/m);
  const fm = parseFrontmatter(text);
  assert.equal(fm.name, "demo");
  assert.equal(fm.description, "Does demo work in two steps. Routes are its arguments, not skills: alpha (start the alpha thing); beta (set beta up).");
  assert.equal(fm["user-invocable"], "false");
  assert.equal(fm["disable-model-invocation"], undefined, "an area stays callable: a hidden one is refused");
  assert.equal(fm["argument-hint"], "[route] [the route's arguments]");
  assert.deepEqual(Object.keys(fm), ["name", "description", "user-invocable", "argument-hint"]);
});

test("an area's table has a row per route: its cue, its use-when sentence, its arguments, who starts it", (t) => {
  const { text } = written(t);
  assert.ok(text.includes(`\n${ROUTE_TABLE_HEAD}\n`));
  assert.match(text, /^\| `alpha` \| start the alpha thing \| Use when a card is ready to start\. \| `<card id> \[--now\\\|--later\]` \| agent \|$/m);
  assert.match(text, /^\| `beta` \| set beta up \| Use when CLAUDE\.md is missing or the \.agents\/ tree is stale\. \|  \| person \|$/m);
  assert.equal(count(text, ROUTE_END), 1);
  assert.ok(text.endsWith(`${ROUTE_END}\n`), text.slice(-120));
});

test("an area says where a route is from its own directory, that a route is read and never called, and names no plugin-root variable", (t) => {
  const section = routeSection(written(t).text);
  assert.match(section, /`routes\/<route>\/ROUTE\.md`/);
  assert.match(section, /directory this file is in/);
  assert.match(section, /Their first word is the route: read that route's `ROUTE\.md` and follow it, with the rest as its arguments\./);
  assert.match(section, /when none plainly does, the default, `alpha`/);
  assert.match(section, /never a skill to call/);
  assert.match(section, /After a compaction, read your route's `ROUTE\.md` again/);
  assert.doesNotMatch(section, /CLAUDE_PLUGIN_ROOT/);
  assert.doesNotMatch(section, /SKILL\.md/);
});

test("an area with a person-started route says what that means, and one without does not", (t) => {
  assert.match(routeSection(written(t).text), /A `person` route runs when the person asks for it/);
  const agents = { ...ROUTES, routes: { alpha: ROUTES.routes.alpha, beta: { cue: "set beta up" } } };
  assert.doesNotMatch(routeSection(written(t, agents).text), /`person` route/);
});

test("a missing area, and one a route's description or a cue has left behind, exits 1 until --write repairs it", (t) => {
  const dir = fixture(t);
  const missing = gen(dir);
  assert.equal(missing.status, 1, "no area yet");
  assert.match(missing.stdout, /^plugins\/one\/skills\/demo\/SKILL\.md is missing: node scripts\/gen-guide\.mjs --write$/m);
  gen(dir, "--write");
  assert.equal(gen(dir).status, 0);
  write(dir, ALPHA, skill("alpha", "Starts alpha. Use when the board says alpha is next."));
  const stale = gen(dir);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /^plugins\/one\/skills\/demo\/SKILL\.md is stale: node scripts\/gen-guide\.mjs --write$/m);
  gen(dir, "--write");
  assert.equal(gen(dir).status, 0);
  assert.match(read(dir, AREA), /^\| `alpha` \| start the alpha thing \| Use when the board says alpha is next\. \|/m);
  write(dir, AREA_DATA, JSON.stringify({ ...ROUTES, routes: { ...ROUTES.routes, beta: { cue: "first-time beta setup", starts: "person" } } }));
  assert.equal(gen(dir).status, 1, "a cue changed");
  gen(dir, "--write");
  assert.match(parseFrontmatter(read(dir, AREA)).description, /beta \(first-time beta setup\)\.$/);
});

test("the generator takes the areas, then the entry skill, then the guide, and says of each what it did", (t) => {
  const dir = fixture(t);
  assert.deepEqual(generate(dir).map((r) => [r.label, r.rel, r.state]), [["area one/demo", AREA, "missing"], ["the guide", GUIDE, "missing"]]);
  assert.equal(fs.existsSync(path.join(dir, AREA)), false, "without write nothing is written");
  assert.deepEqual(generate(dir, { write: true }).map((r) => r.state), ["wrote", "wrote"]);
  assert.deepEqual(generate(dir, { write: true }).map((r) => r.state), ["current", "current"]);
  assert.equal(generated({ rel: AREA, state: "current" }), `${AREA} is current`);
});

// ---- what a person wrote is kept --------------------------------------------

test("hand-written text on either side of the Route section survives a regeneration", (t) => {
  const { dir, text } = written(t);
  const intro = "Demo work fails one way: nobody starts it. This area starts it.\n";
  const doctrine = "\n## Doctrine\n\nEvery route reads the board before it writes to it.\n";
  fs.writeFileSync(path.join(dir, AREA), text.replace("\n## Route\n", `\n${intro}\n## Route\n`) + doctrine);
  recue(dir);
  assert.equal(gen(dir).status, 1, "the default route changed");
  gen(dir, "--write");
  const after = read(dir, AREA);
  assert.ok(after.includes(intro) && after.endsWith(doctrine), after);
  assert.match(after, /the default, `beta`/);
  assert.equal(gen(dir).status, 0);
});

test("a `## Route` line inside a code fence or an HTML comment is not the section, and the text after it is kept", (t) => {
  for (const own of ["```md\n## Route\n```\n\nA sentence after the fence.\n", "<!--\n## Route\n-->\n\nA sentence after the comment.\n", "## Route\n\nMy own notes under my own Route heading.\n"]) {
    const { dir, text } = written(t);
    fs.writeFileSync(path.join(dir, AREA), text.replace("\n## Route\n", () => `\n${own}\n## Route\n`));
    recue(dir);
    gen(dir, "--write");
    const after = read(dir, AREA);
    assert.ok(after.includes(`\n${own}\n## Route\n`), after);
    assert.equal(count(after, ROUTE_END), 1, "one generated block");
    assert.match(after, /the default, `beta`/);
    assert.equal(gen(dir).status, 0);
  }
});

test("a hand-written Route section with no end marker is kept below the generated block", (t) => {
  const dir = fixture(t);
  const old = "\n| The situation | Route |\n| --- | --- |\n| A card is ready | `alpha` |\n\n## Working beside other sessions\n\nTake the lock first.\n";
  write(dir, AREA, `---\nname: demo\ndescription: "Use at the start of demo work."\n---\n\n# demo\n\nWhat demo is for.\n\n## Route\n${old}`);
  gen(dir, "--write");
  const after = read(dir, AREA);
  assert.ok(after.endsWith(`${ROUTE_END}\n${old}`), after.slice(-400));
  assert.ok(after.includes(`\n${ROUTE_TABLE_HEAD}\n`));
  assert.equal(gen(dir).status, 0);
});

// A fence that never closes hides everything below it, the block included, so
// a block would be appended on every run. The area is refused instead.
test("an area with a code fence that never closes is refused, with the line it opens on, and nothing is written", (t) => {
  const { dir, text } = written(t);
  const broken = text.replace("\n## Route\n", () => "\n```md\nAn example that never closes.\n\n## Route\n");
  fs.writeFileSync(path.join(dir, AREA), broken);
  recue(dir);
  for (const flags of [["--write"], ["--write"], []]) {
    const result = gen(dir, ...flags);
    assert.equal(result.status, 1, flags.join(" "));
    assert.match(result.stdout, /^plugins\/one\/skills\/demo\/SKILL\.md could not be generated: plugins\/one\/skills\/demo\/SKILL\.md has a code fence, opened on line 12, that is never closed/m);
    assert.equal(read(dir, AREA), broken, "the area is as it was");
  }
});

// ---- the data, read as it is -------------------------------------------------

test("an area with no door.json, or one that does not parse, is refused with the reason and no stack trace, and nothing is written", (t) => {
  for (const data of [null, "{ not json"]) {
    const dir = fixture(t, null);
    if (data) write(dir, AREA_DATA, data);
    for (const flags of [[], ["--write"]]) {
      const result = gen(dir, ...flags);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /^plugins\/one\/skills\/demo\/SKILL\.md could not be generated: /m);
      assert.doesNotMatch(result.stdout + result.stderr, /\n\s+at /);
      assert.equal(fs.existsSync(path.join(dir, AREA)), false);
    }
  }
});

test("a route the data names and no ROUTE.md backs is read as no route, and one the data leaves out as unrouted", (t) => {
  const dir = fixture(t, { ...ROUTES, routes: { alpha: ROUTES.routes.alpha, ghost: { cue: "not there" }, "../../../../plain/skills/gamma": { cue: "reach into another plugin" } } });
  const area = readArea(dir, "one", "demo");
  assert.deepEqual(area.routes.map((r) => [r.name, r.fm === null]), [["alpha", false], ["ghost", true], ["../../../../plain/skills/gamma", true]]);
  assert.deepEqual(area.unrouted, ["beta"]);
});

// A description or a cue is read as the host reads it, so an escape in the
// YAML never reaches a table cell, the guide, or the character count.
test("quotes in a route's description or a cue reach the area and the guide as the host reads them", (t) => {
  const dir = fixture(t, { ...ROUTES, routes: { ...ROUTES.routes, alpha: { cue: 'the user says "start it"' } } });
  write(dir, ALPHA, skill("alpha", 'Starts "the alpha thing" from a card. Use when the user says "start it".'));
  write(dir, routeFile("one", "demo", "beta"), "---\nname: beta\ndescription: 'Sets beta up. Use when it''s never run here.'\n---\n\n# beta\n");
  gen(dir, "--write");
  const area = read(dir, AREA);
  assert.match(area, /^\| `alpha` \| the user says "start it" \| Use when the user says "start it"\. \|/m);
  assert.match(area, /^\| `beta` \| set beta up \| Use when it's never run here\. \|/m);
  assert.equal(parseFrontmatter(area).description, 'Does demo work in two steps. Routes are its arguments, not skills: alpha (the user says "start it"); beta (set beta up).');
  assert.match(read(dir, GUIDE), /^\| `\/one:demo alpha` \| by the agent \| Starts "the alpha thing" from a card\. Use when the user says "start it"\. \|$/m);
});

test("a missing, blank, or non-string lead reads as no lead, and the description does not open with a space", (t) => {
  for (const lead of [undefined, "   ", 5, ["Does demo work."]]) {
    const dir = fixture(t, { ...ROUTES, lead });
    assert.equal(readArea(dir, "one", "demo").lead, "", JSON.stringify(lead));
    gen(dir, "--write");
    assert.match(parseFrontmatter(read(dir, AREA)).description, /^Routes are its arguments, not skills: alpha \(/);
  }
});

test("an abbreviation's dot does not end the use-when sentence", (t) => {
  const dir = fixture(t);
  write(dir, ALPHA, skill("alpha", "Starts things, e.g. a card. Use when a card, i.e. a ready one, should start. Reads the board."));
  gen(dir, "--write");
  assert.match(read(dir, AREA), /^\| `alpha` \| start the alpha thing \| Use when a card, i\.e\. a ready one, should start\. \|/m);
});

// ---- the guide ---------------------------------------------------------------

test("the guide lists an area once, as a skill only the agent starts, and each route by the area's address", (t) => {
  const { dir } = written(t);
  const text = guide(dir);
  assert.equal(text, read(dir, GUIDE));
  assert.match(text, /^\| `\/one:demo \[route\] \[the route's arguments\]` \| by the agent \| Does demo work in two steps\. Routes are its arguments, not skills: .* \|$/m);
  assert.match(text, /^\| `\/one:demo alpha <card id> \[--now\\\|--later\]` \| by the agent \| Starts the alpha thing from a card\. .* \|$/m);
  assert.match(text, /^\| `\/one:demo beta` \| when you ask for it \| Sets beta up in a project\. .* \|$/m);
  assert.doesNotMatch(text, /`\/one:(alpha|beta)/);
  assert.match(text, /^\| `\/plain:gamma` \| by the agent, or by hand \| Does gamma\. Use when gamma is wanted\. \|$/m);
  assert.match(text, /^\| \[one\]\(#one\) \| 0\.1\.0 \| 1 \| testing \|$/m, "an area is one skill of its plugin");
});

// ---- the entry skill ----------------------------------------------------------

// The entry skill's plugin is the one the areas move into. Its name is built
// here, never written out, so an address under it is none to this checkout.
const entryFixture = (t, data) => {
  const dir = tempDir(t, "gen-entry-");
  const home = `plugins/${ENTRY_PLUGIN}`;
  write(dir, ".claude-plugin/marketplace.json", JSON.stringify({ name: "fixture-market", owner: { name: "test" }, plugins: [
    { name: ENTRY_PLUGIN, source: `./${home}`, description: "Every area in one plugin.", category: "testing" },
    { name: "plain", source: "./plugins/plain", description: "A plugin of skills.", category: "testing" },
  ] }));
  for (const p of [ENTRY_PLUGIN, "plain"]) write(dir, `plugins/${p}/.claude-plugin/plugin.json`, JSON.stringify({ name: p, version: "0.1.0", description: `The ${p} plugin.` }));
  write(dir, routeFile(ENTRY_PLUGIN, "demo", "alpha"), skill("alpha", "Starts alpha. Use when a card is ready."));
  write(dir, routeFile(ENTRY_PLUGIN, "demo", "beta"), skill("beta", "Sets beta up. Use when asked."));
  write(dir, areaData(ENTRY_PLUGIN, "demo"), JSON.stringify(ROUTES));
  write(dir, "plugins/plain/skills/gamma/SKILL.md", skill("gamma", "Does gamma. Use when gamma is wanted."));
  write(dir, "plugins/plain/skills/setup/SKILL.md", skill("setup", "Sets plain up. Use when asked.", "disable-model-invocation: true\n"));
  write(dir, `${home}/skills/start-here/start-here.json`, JSON.stringify(data));
  return dir;
};

test("a use is read against its area in either shape: a route of an area of the one plugin, or a skill of a plugin, each by the address that reaches it", (t) => {
  const dir = entryFixture(t, {
    groups: [{ title: "Work", header: "Work", areas: ["demo", "plain"] }],
    areas: {
      demo: { cue: "do demo work", how: "Two steps.", uses: [{ want: "start any demo work", to: "demo" }, { want: "start alpha", to: "alpha" }, { want: "set beta up", to: "beta" }, { want: "a route that is not there", to: "ghost" }] },
      plain: { cue: "do gamma", how: "Skills.", uses: [{ want: "run gamma", to: "gamma" }, { want: "set it up", to: "setup" }, { want: "a skill that is not there", to: "alpha" }] },
    },
  });
  const entry = readEntry(dir);
  assert.deepEqual(entry.areas.map((a) => a.name), ["demo", "plain"]);
  const one = `/${ENTRY_PLUGIN}:demo`;
  assert.deepEqual(entry.areas[0].uses.map((u) => [u.address, u.found, u.person]), [[one, true, false], [`${one} alpha`, true, false], [`${one} beta`, true, true], [`${one} ghost`, false, false]]);
  assert.deepEqual(entry.areas[1].uses.map((u) => [u.address, u.found, u.person]), [["/plain:gamma", true, false], ["/plain:setup", true, true], ["/plain:alpha", false, false]]);
  assert.deepEqual(entry.unknown, []);
});
