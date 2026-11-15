// The agentic-teamwork area's routes, read as an agent reads them: a name
// that matches its folder, a description that says when to take it, a route's
// frontmatter keys and no others, and no reference, script flag, or route
// named in a body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { area, routeBasics } from "./area-routes.mjs";

const AREA = area("agentic-teamwork");
const routes = AREA.routes;
const names = routes.map((r) => r.name);
// Started by a person, once, to set a repo up: the door says so, and the model never picks one on its own.
const BY_HAND = ["bootstrap", "init-project"];

test("agentic-teamwork routes: the area ships exactly its six", () => {
  assert.deepEqual(names, ["audit-project", "bootstrap", "init-project", "land", "ship", "tdd"]);
  assert.equal(AREA.door.default, "tdd");
  assert.deepEqual(names.filter((name) => AREA.starts(name) === "person"), BY_HAND, "set up by hand, everything else by the model");
});

routeBasics(test, AREA, { when: /\bUse (when|on)\b/, cap: 700 });

for (const route of routes) {
  test(`agentic-teamwork routes: every reference and script ${route.name} names exists, and a script runs from the area's directory`, () => {
    for (const m of route.text.matchAll(/\breferences\/([A-Za-z0-9_-]+\.md)/g)) {
      assert.ok(fs.existsSync(path.join(AREA.dir, "routes", "tdd", "references", m[1])) || fs.existsSync(path.join(route.dir, "references", m[1])), `references/${m[1]}`);
    }
    // An area script is always run through the directory the route named, never by a bare or relative path.
    for (const m of route.body.matchAll(/^.*\bnode\s+(\S*(?:init-project|audit-project|render|mr)\.mjs\S*).*$/gm)) {
      assert.match(m[1], /^"W\/scripts\/[a-z-]+\.mjs"$/, m[0].trim());
    }
  });

  test(`agentic-teamwork routes: every flag ${route.name} passes a script is one the script takes`, () => {
    for (const script of ["init-project", "mr"]) {
      const source = fs.readFileSync(path.join(AREA.dir, "scripts", `${script}.mjs`), "utf8");
      const known = new Set([...source.matchAll(/(?:"([a-z-]+)"|\b([a-z]+)): \{ type: "(?:string|boolean)"/g)].map((m) => m[1] ?? m[2]));
      assert.ok(known.size > 5, `${script}.mjs declares its options`);
      const lines = route.text.split("\n").filter((l) => l.includes(`${script}.mjs`));
      for (const line of lines) {
        for (const flag of line.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) assert.ok(known.has(flag[1]), `${script}.mjs has no --${flag[1]}: ${line.trim()}`);
      }
    }
  });

  test(`agentic-teamwork routes: every route of this area ${route.name} hands on to exists`, () => {
    for (const m of route.text.matchAll(/(?<![\w/.-])\/agentcraft:agentic-teamwork ([a-z][a-z-]*)\b/g)) assert.ok(names.includes(m[1]), m[0]);
    assert.doesNotMatch(route.text, /(?<![\w/.-])\/agentic-teamwork:[a-z]/, "an address under the plugin's old name");
  });
}

test("agentic-teamwork routes: ship and land reach the forge only through mr.mjs", () => {
  for (const route of routes.filter((r) => ["ship", "land"].includes(r.name))) {
    assert.match(route.body, /scripts\/mr\.mjs"/, `${route.name} runs mr.mjs`);
    assert.doesNotMatch(route.body, /(^|[\s`(])(gh|glab)\s+(pr|mr|api|auth|run|repo|issue)\b/m, `${route.name} names a forge CLI call`);
  }
});

test("agentic-teamwork routes: every reference file is linked from the route it sits under", () => {
  for (const route of routes) {
    const dir = path.join(route.dir, "references");
    for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) assert.ok(route.text.includes(`references/${file}`), `${route.name}/references/${file} is not linked from ROUTE.md`);
    assert.deepEqual(fs.readdirSync(route.dir).filter((f) => !["ROUTE.md", "references"].includes(f)), [], `${route.name} holds only ROUTE.md and references/`);
  }
});
