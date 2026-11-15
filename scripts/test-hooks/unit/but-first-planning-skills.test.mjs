// The but-first-planning area's routes, read as an agent reads them: a name
// that matches its folder, a description that says when to take it and stays
// short (eighteen of them share one table), a route's frontmatter keys and no
// others, and no link, script or route named in a body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { area, routeBasics } from "./area-routes.mjs";

const AREA = area("but-first-planning");
const EXPECTED = [
  "autopilot", "build-assess-drift", "build-audit", "build-improve-architecture", "build-next-issue", "build-rubber-duck",
  "build-sprint", "build-tdd", "build-user-docs", "grill", "plan-decompose", "plan-publish", "spec-architect", "spec-edit",
  "spec-grill", "spec-init", "spec-open", "spec-write",
];
// Started by a person: a one-time setup, a local server, and the two runs big enough to be a decision.
const BY_HAND = ["autopilot", "build-audit", "spec-init", "spec-open"];
// Routes of other areas a file may point at, and only as something the repo may not have adopted.
const ELSEWHERE = ["agentic-teamwork tdd", "agentic-teamwork init-project", "code-diet ladder", "docs-parity docs-sync", "docs-parity docs-shots", "docs-parity docs-init"];
const DESCRIPTION_MAX = 300;
// What the same eighteen-route table may cost in total.
const LISTING_MAX = 3200;

const routes = AREA.routes;
const names = routes.map((r) => r.name);
const ROUTES = path.join(AREA.dir, "routes");
/** Every text file the area's routes and references ship, as { rel, dir, text }. */
const docs = [ROUTES, path.join(AREA.dir, "references")].flatMap((root) => fs.readdirSync(root, { recursive: true }).map(String)
  .filter((f) => /\.(md|js)$/.test(f) && !f.includes(`assets${path.sep}`))
  .map((f) => ({ rel: path.relative(AREA.dir, path.join(root, f)).split(path.sep).join("/"), dir: path.dirname(path.join(root, f)), text: fs.readFileSync(path.join(root, f), "utf8") })))
  .concat([{ rel: "WORKFLOWS.md", dir: AREA.dir, text: fs.readFileSync(path.join(AREA.dir, "WORKFLOWS.md"), "utf8") }]);

test("but-first-planning routes: the area ships exactly its eighteen", () => {
  assert.deepEqual(names, EXPECTED);
  assert.deepEqual(names.filter((name) => AREA.starts(name) === "person"), BY_HAND, "started by hand, or picked by the model");
});

routeBasics(test, AREA, { when: /\b(Use|Run) (when|once|after|before|for)\b/, cap: DESCRIPTION_MAX });

for (const route of routes) {
  test(`but-first-planning routes: ${route.name} is picked for a reason, and runs an area script from the area's directory`, () => {
    const description = route.fields.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this route from its neighbours");
    assert.doesNotMatch(description, /\b(phase|step \d)\b/i, "a position in a sequence is not a reason to pick a route");
    // An area script is run through the directory the route named, never by a bare or relative path.
    for (const m of route.body.matchAll(/^.*\bnode\s+([^\s`]*(?:scaffold|spec-open|install)\.mjs[^\s`]*).*$/gm)) {
      assert.match(m[1], /^"W\/[a-z/-]+\.mjs"$/, m[0].trim());
    }
  });
}

test("but-first-planning routes: the descriptions the model picks from fit the table's budget", () => {
  const listed = routes.filter((r) => !BY_HAND.includes(r.name));
  const total = listed.reduce((n, r) => n + r.fields.description.length, 0);
  assert.ok(total <= LISTING_MAX, `${total} characters across ${listed.length} descriptions`);
});

test("but-first-planning routes: every relative link in a route, a reference or WORKFLOWS.md resolves", () => {
  for (const doc of docs.filter((d) => d.rel.endsWith(".md"))) {
    // Fenced blocks and double-backtick spans hold templates for a project's own files, whose links are not this plugin's.
    const prose = doc.text.replace(/^\s*```[\s\S]*?^\s*```/gm, "").replace(/``[^\n]*?``/g, "");
    for (const m of prose.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/.test(target) || target.startsWith("<") || target.includes("{{")) continue;
      // A placeholder path in running text (`[title](./NN_issue_OTHER.md)`), not a link to follow.
      if (/NN_|NN-|<|EE-SS/.test(target) || !/[./]/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(doc.dir, target)), `${doc.rel}: ${target}`);
    }
  }
});

test("but-first-planning routes: every workspace script a file tells an agent to run is one the scaffold copies", () => {
  const scaffolded = new Set(["plan/plan-status.mjs", "plan/publish-issues.mjs", "plan/verify-plan-tree.mjs", "spec/scripts/verify-spec-tree.mjs", "spec/scripts/comments-server.py", "progress/drift-status.mjs"]);
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\.agents\/plan\/((?:plan|spec\/scripts|progress)\/[a-z-]+\.(?:mjs|py))\b/g)) {
      assert.ok(scaffolded.has(m[1]), `${doc.rel}: .agents/plan/${m[1]}`);
    }
  }
});

test("but-first-planning routes: no file names a route or a script by a name it no longer has", () => {
  const gone = /\b(spec-0-init|spec-1-specify|spec-2-grill|spec-3-architect|spec-4-edit|plan-0-decompose|plan-1-publish-issues|plan-publish-issues)\b|\b(plan-status|verify-plan-tree|verify-spec-tree|publish-issues|drift-status|plan-gate|verify-agents-tree)\.py\b|spec-open\.sh|install\.sh/;
  for (const doc of docs) {
    assert.doesNotMatch(doc.text, gone, doc.rel);
    assert.doesNotMatch(doc.text, /(?<![\w/.-])\/but-first-planning:[a-z]/, `${doc.rel}: an address under the plugin's old name`);
  }
});

test("but-first-planning routes: a route of this area named anywhere exists, and one only a person starts is asked for", () => {
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\/agentcraft:but-first-planning ([a-z-]+)/g)) {
      assert.ok(names.includes(m[1]), `${doc.rel}: ${m[0]}`);
      if (!BY_HAND.includes(m[1])) continue;
      const line = doc.text.split("\n").find((l) => l.includes(m[0])) ?? "";
      const around = doc.text.slice(Math.max(0, doc.text.indexOf(m[0]) - 160), doc.text.indexOf(m[0]) + 160);
      assert.match(around, /ask the person|the person's to start|the person runs it|ask them|give them|the user|offer the/i, `${doc.rel}: ${line.trim()}`);
    }
  }
});

// The areas ship together now, so a route of another one is always there to
// name. What stays pinned is which ones planning hands on to, and that each
// is a route its area has.
test("but-first-planning routes: another area is named only by a route it has, and only the ones planning hands on to", () => {
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\/agentcraft:([a-z-]+) ([a-z-]+)/g)) {
      if (m[1] === "but-first-planning") continue;
      assert.ok(ELSEWHERE.includes(`${m[1]} ${m[2]}`), `${doc.rel}: ${m[0]}`);
      assert.ok(area(m[1]).route(m[2]), `${doc.rel}: ${m[0]} is not a route of that area`);
    }
  }
});

test("but-first-planning routes: the ten bundled workflow scripts parse, and each is one a route points at", () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const scripts = names.flatMap((n) => (fs.existsSync(path.join(ROUTES, n, "workflows")) ? fs.readdirSync(path.join(ROUTES, n, "workflows")).map((f) => `${n}/workflows/${f}`) : []));
  assert.equal(scripts.length, 10);
  const inventory = fs.readFileSync(path.join(AREA.dir, "WORKFLOWS.md"), "utf8");
  for (const rel of scripts) {
    // A workflow script is the body of an async function the Workflow tool supplies, with one export for its metadata.
    const source = fs.readFileSync(path.join(ROUTES, rel), "utf8").replace(/^export const meta\b/m, "const meta");
    assert.doesNotThrow(() => new AsyncFunction(source), rel);
    const route = rel.split("/")[0];
    assert.ok(AREA.route(route).text.includes(`"W/routes/${rel}"`), `${route}/ROUTE.md does not point at ${rel}`);
    assert.ok(inventory.includes(`\`${rel}\``), `WORKFLOWS.md does not list ${rel}`);
  }
});

test("but-first-planning routes: build-tdd names agentic-teamwork's loop and carries its own, with no references of its own", () => {
  const tdd = AREA.route("build-tdd");
  assert.match(tdd.body, /\*\*The loop is the agentic-teamwork area's `tdd` route\*\*\s+\(`\/agentcraft:agentic-teamwork tdd`\)/);
  assert.match(tdd.body, /this is the loop/);
  for (const step of ["**Red.**", "**Green.**", "**Refactor.**"]) assert.ok(tdd.body.includes(step), step);
  assert.deepEqual(fs.readdirSync(tdd.dir), ["ROUTE.md"]);
});

test("but-first-planning routes: the docs checker is named as docs-parity's, and nothing runs it unconditionally", () => {
  for (const doc of docs.filter((d) => d.text.includes("docs-check"))) {
    for (const p of doc.text.split(/\n\s*\n|\\n/).filter((x) => x.includes("docs-check"))) {
      assert.match(p, /docs-parity/, `${doc.rel}: ${p.slice(0, 120).replace(/\s+/g, " ")}`);
      assert.match(p, /\b(if|when|where)\b/i, `${doc.rel}: the checker is optional`);
    }
  }
});
