// One area, read as a model reads it: its own SKILL.md, the door the gate
// generates that file's frontmatter from, and each route's ROUTE.md. The
// `*-skills` suites pin an area's route list and what its routes say through
// this, so none of them walks the plugin's directories its own way.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, skillBody } from "../../lib.mjs";
import { REPO } from "../fixtures.mjs";

export const AGENTCRAFT = path.join(REPO, "plugins", "agentic-engineering");

/** What a route's frontmatter may carry. Who may start it is its door's to say, never the route's. */
export const ROUTE_KEYS = ["name", "description", "argument-hint"];

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/** A document's frontmatter keys, and the body under them. */
export function frontmatter(text) {
  const fields = parseFrontmatter(text);
  assert.ok(fields, "no frontmatter");
  return { fields, body: skillBody(text) };
}

/** The code of a document: its fenced blocks, and its code spans. */
export const code = (body) =>
  [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g), ...body.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

/**
 * An area: `{ name, dir, door, skill, routes, route(name), starts(name) }`.
 * `skill` and each route are `{ name, dir, file, text, fields, body }`.
 * `starts` is who may start a route: "person" where its door says so.
 */
export function area(name) {
  const dir = path.join(AGENTCRAFT, "skills", name);
  const doc = (file, docName) => {
    const text = read(file);
    return { name: docName, dir: path.dirname(file), file, text, ...frontmatter(text) };
  };
  const door = JSON.parse(read(path.join(dir, "door.json")));
  const routes = fs.readdirSync(path.join(dir, "routes")).sort().map((route) => doc(path.join(dir, "routes", route, "ROUTE.md"), route));
  return {
    name, dir, door, routes,
    skill: doc(path.join(dir, "SKILL.md"), name),
    route: (route) => routes.find((r) => r.name === route),
    starts: (route) => door.routes[route]?.starts ?? "anyone",
  };
}

/**
 * What every area's routes are held to, whatever the area: one test each,
 * named for the area. The gate already resolves each path a route writes
 * under a directory it named, and fails a route that writes the root
 * variable; these are the checks it does not make. An area made of several
 * holds each kind of route to its own words: `only` names the routes a call
 * covers, and the door is checked by the call that leaves `door` on.
 */
export function routeBasics(test, a, { when = /^(Use (when|for|before|to|after|at|on)|Run to) /, cap = 400, heading = false, only = null, door = true } = {}) {
  if (door) test(`${a.name} routes: the door lists exactly the routes the area ships, and its default is one of them`, () => {
    assert.deepEqual(Object.keys(a.door.routes).sort(), a.routes.map((r) => r.name));
    if (a.door.default) assert.ok(a.door.routes[a.door.default], `default ${a.door.default}`);
    assert.equal(a.skill.fields.name, a.name);
    assert.equal(a.skill.fields["user-invocable"], "false", "an area is the model's to call; a person comes in through the entry skill");
  });
  if (only) for (const name of only) assert.ok(a.route(name), `${a.name} has no route ${name}`);
  for (const r of a.routes.filter((route) => !only || only.includes(route.name))) {
    test(`${a.name} routes: ${r.name} has a matching name, a route's keys only, and a description that says when`, () => {
      assert.equal(r.fields.name, r.name);
      for (const key of Object.keys(r.fields)) assert.ok(ROUTE_KEYS.includes(key), `frontmatter key "${key}"`);
      const description = r.fields.description ?? "";
      assert.match(description, when, description);
      assert.ok(description.length <= cap, `${description.length} characters`);
      if (heading) assert.match(r.body, new RegExp(`^# ${r.name}$`, "m"));
      assert.doesNotMatch(r.text, /\$\{CLAUDE_PLUGIN_DATA\}/, "a route is read by path, so the host fills no variable in: the area's SKILL.md names the data directory");
      // A fenced block or a double-backtick span holds a template for a project's own file, whose links are not the plugin's.
      const prose = r.text.replace(/^\s*```[\s\S]*?^\s*```/gm, "").replace(/``[^\n]*?``/g, "");
      for (const m of prose.matchAll(/\]\((?!https?:|#|mailto:|<)([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/[<{]|NN[_-]|EE-SS/.test(m[1]) || !/[./]/.test(m[1])) continue; // a placeholder in running text
        assert.ok(fs.existsSync(path.join(r.dir, m[1])), `link ${m[1]}`);
      }
    });
  }
}
