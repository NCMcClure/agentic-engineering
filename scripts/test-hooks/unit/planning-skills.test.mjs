// The planning area's routes, read as an agent reads them: a name
// that matches its folder, a description that says when to take it and stays
// short (eighteen of them share one table), a route's frontmatter keys and no
// others, and no link, script or route named in a body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { area, routeBasics } from "./area-routes.mjs";

const AREA = area("planning");
const EXPECTED = [
  "autopilot", "build-assess-drift", "build-audit", "build-improve-architecture", "build-next-issue", "build-rubber-duck",
  "build-sprint", "build-tdd", "build-user-docs", "grill", "plan-decompose", "plan-publish", "spec-architect", "spec-edit",
  "spec-grill", "spec-init", "spec-open", "spec-write",
];
// Started by a person: a one-time setup, a local server, and the two runs big enough to be a decision.
const BY_HAND = ["autopilot", "build-audit", "spec-init", "spec-open"];
// Routes of other areas a file may point at, and only as something the repo may not have adopted.
const ELSEWHERE = ["delivery tdd", "delivery init-project", "code ladder", "docs-parity docs-sync", "docs-parity docs-shots", "docs-parity docs-init"];
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

test("planning routes: the area ships exactly its eighteen", () => {
  assert.deepEqual(names, EXPECTED);
  assert.deepEqual(names.filter((name) => AREA.starts(name) === "person"), BY_HAND, "started by hand, or picked by the model");
});

routeBasics(test, AREA, { when: /\b(Use|Run) (when|once|after|before|for)\b/, cap: DESCRIPTION_MAX });

for (const route of routes) {
  test(`planning routes: ${route.name} is picked for a reason, and runs an area script from the area's directory`, () => {
    const description = route.fields.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this route from its neighbours");
    assert.doesNotMatch(description, /\b(phase|step \d)\b/i, "a position in a sequence is not a reason to pick a route");
    // An area script is run through the directory the route named, never by a bare or relative path.
    for (const m of route.body.matchAll(/^.*\bnode\s+([^\s`]*(?:scaffold|spec-open|install)\.mjs[^\s`]*).*$/gm)) {
      assert.match(m[1], /^"W\/[a-z/-]+\.mjs"$/, m[0].trim());
    }
  });
}

test("planning routes: the descriptions the model picks from fit the table's budget", () => {
  const listed = routes.filter((r) => !BY_HAND.includes(r.name));
  const total = listed.reduce((n, r) => n + r.fields.description.length, 0);
  assert.ok(total <= LISTING_MAX, `${total} characters across ${listed.length} descriptions`);
});

test("planning routes: every relative link in a route, a reference or WORKFLOWS.md resolves", () => {
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

test("planning routes: every workspace script a file tells an agent to run is one the scaffold copies", () => {
  const scaffolded = new Set(["plan/plan-status.mjs", "plan/publish-issues.mjs", "plan/verify-plan-tree.mjs", "spec/scripts/verify-spec-tree.mjs", "spec/scripts/comments-server.py", "progress/drift-status.mjs"]);
  for (const doc of docs) {
    // A route writes `P` for the workspace; the project's own pages (spec-init, spec-open) write its path out.
    for (const m of doc.text.matchAll(/(?:\.agents\/plan|\bP)\/((?:plan|spec\/scripts|progress)\/[a-z-]+\.(?:mjs|py))\b/g)) {
      assert.ok(scaffolded.has(m[1]), `${doc.rel}: ${m[0]}`);
    }
  }
});

test("planning routes: no file names a route or a script by a name it no longer has", () => {
  const gone = /\b(spec-0-init|spec-1-specify|spec-2-grill|spec-3-architect|spec-4-edit|plan-0-decompose|plan-1-publish-issues|plan-publish-issues)\b|\b(plan-status|verify-plan-tree|verify-spec-tree|publish-issues|drift-status|plan-gate|verify-agents-tree)\.py\b|spec-open\.sh|install\.sh/;
  for (const doc of docs) {
    assert.doesNotMatch(doc.text, gone, doc.rel);
    assert.doesNotMatch(doc.text, /(?<![\w/.-])\/but-first-planning:[a-z]/, `${doc.rel}: an address under the plugin's old name`);
  }
});

test("planning routes: a route of this area named anywhere exists, and one only a person starts is asked for", () => {
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\/agentic-engineering:planning ([a-z-]+)/g)) {
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
test("planning routes: another area is named only by a route it has, and only the ones planning hands on to", () => {
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\/agentic-engineering:([a-z-]+) ([a-z-]+)/g)) {
      if (m[1] === "planning") continue;
      assert.ok(ELSEWHERE.includes(`${m[1]} ${m[2]}`), `${doc.rel}: ${m[0]}`);
      assert.ok(area(m[1]).route(m[2]), `${doc.rel}: ${m[0]} is not a route of that area`);
    }
  }
});

test("planning routes: the ten bundled workflow scripts parse, and each is one a route points at", () => {
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

test("planning routes: build-tdd names delivery's loop and carries its own, with no references of its own", () => {
  const tdd = AREA.route("build-tdd");
  assert.match(tdd.body, /\*\*The loop is the delivery area's `tdd` route\*\*\s+\(`\/agentic-engineering:delivery tdd`\)/);
  // Both areas ship together, so the loop here is a short form of the other's, not a fallback for when it is missing.
  assert.match(tdd.body, /\*\*The loop in short, for the contract below:\*\*/);
  for (const step of ["**Red.**", "**Green.**", "**Refactor.**"]) assert.ok(tdd.body.includes(step), step);
  assert.deepEqual(fs.readdirSync(tdd.dir), ["ROUTE.md"]);
});

test("planning routes: the docs checker is named as docs-parity's, and nothing runs it unconditionally", () => {
  for (const doc of docs.filter((d) => d.text.includes("docs-check"))) {
    for (const p of doc.text.split(/\n\s*\n|\\n/).filter((x) => x.includes("docs-check"))) {
      assert.match(p, /docs-parity/, `${doc.rel}: ${p.slice(0, 120).replace(/\s+/g, " ")}`);
      assert.match(p, /\b(if|when|where)\b/i, `${doc.rel}: the checker is optional`);
    }
  }
});

// ---- the workspace -----------------------------------------------------------
// A repo holds a project workspace and any number of named ones, so no route
// may assume which it is in: it writes `P`, the area's SKILL.md settles it, and
// the literal path is left only where the project's own is meant.

const P_ROUTE = "`P` below is the workspace this run works in, `.agents/plan` or `.agents/plans/<name>`: the area's `SKILL.md` says how it is settled. Write it out wherever a path says `P`.";
const usesP = (text) => /(?<![A-Za-z0-9_./-])P\/[a-z]/.test(text);

test("planning routes: the area's SKILL.md settles the workspace before a route runs, by four rules in order", () => {
  const skill = fs.readFileSync(path.join(AREA.dir, "SKILL.md"), "utf8");
  const section = /^## Workspace\n([\s\S]*?)^## Route$/m.exec(skill)?.[1] ?? "";
  assert.match(section, /one project workspace, `\.agents\/plan\/`, and any number of named ones, `\.agents\/plans\/<name>\/`/);
  assert.match(section, /Settle `P` before the first read or command, and say which it is in your first line/);
  const rules = [...section.matchAll(/^(\d)\. (.*)$/gm)].map((m) => m[2]);
  assert.equal(rules.length, 4);
  assert.match(rules[0], /^the arguments name it: `--plan <name>`/);
  assert.match(rules[1], /^else what is at hand sits in one/);
  assert.match(rules[2], /^else the repo has exactly one;$/);
  assert.match(rules[3], /^else ask, listing them\. Never fall back to `\.agents\/plan\/`/);
  assert.match(section, /Write nothing in another workspace through `P`, and hand on to another route with `--plan <name>`\./);
});

test("planning routes: a file that writes a path under P says what P is, in the one sentence", () => {
  for (const doc of docs.filter((d) => d.rel.endsWith(".md") && usesP(d.text))) {
    if (doc.rel.endsWith("/ROUTE.md")) assert.ok(doc.text.includes(P_ROUTE), `${doc.rel} writes P and does not declare it`);
    else assert.match(doc.text, /`P` (below is )?the workspace this run works in/, `${doc.rel} writes P and does not say what it is`);
  }
  // The two routes that are the project workspace's own write its path out and bind no P.
  for (const own of ["spec-init", "spec-open"]) assert.ok(!AREA.route(own).text.includes(P_ROUTE), own);
});

test("planning routes: the literal project path is written only where the project workspace is meant", () => {
  // Whole files that are about the project workspace, or about how the two differ.
  const WHOLE = ["routes/spec-init/ROUTE.md", "routes/spec-init/NAMED.md", "routes/spec-open/ROUTE.md"];
  // Elsewhere a line may name it for one of these reasons: the sentence that binds P, what a named workspace
  // reads from the project's, the project's site and its comment queue, the gate's config, and a workflow's own default.
  const MEANT = [
    /`\.agents\/plan` or `\.agents\/plans\/<name>`/, /reference\/|tracker\.md|--plan project|named workspace|project workspace|the project's/,
    /mkdocs\.yml|spec-comments\.json|config\.json/, /WSREL|ONE_WORKSPACE|args\.workspace|default \.agents\/plan\)|leave it out when P is|\.agents\/plan\/ and \.agents\/plans\//,
    /^`\.agents\/plan`, then every directory|in each \(`\.agents\/plan`/,
    /any number of named ones|^  `\.agents\/plan`\), refuses any other shape/,
  ];
  for (const doc of docs.filter((d) => !WHOLE.includes(d.rel))) {
    doc.text.split("\n").forEach((line, i) => {
      if (!/\.agents\/plan(?!s)/.test(line)) return;
      assert.ok(MEANT.some((re) => re.test(line)), `${doc.rel}:${i + 1} writes the project workspace's path where P belongs: ${line.trim().slice(0, 140)}`);
    });
  }
});

test("planning routes: every workflow takes the workspace, refuses any other shape, and opens its context with the one-workspace rule", () => {
  for (const doc of docs.filter((d) => d.rel.endsWith(".js"))) {
    assert.match(doc.text, /^const WSREL = String\(A\.workspace \|\| '\.agents\/plan'\)/m, doc.rel);
    assert.match(doc.text, /\^\\\.agents\\\/\(plan\|plans\\\/\[a-z\]\[a-z0-9-\]\*\)\$/, `${doc.rel}: the shape it accepts`);
    assert.match(doc.text, /^const (CTX|CONTEXT) = `\n\$\{ONE_WORKSPACE\}\n/m, doc.rel);
    assert.match(doc.text, /Args: \{[^}]*workspace\?\}/, `${doc.rel}: the signature in meta`);
    assert.doesNotMatch(doc.text.replace(/^const ONE_WORKSPACE = .*$/m, ""), /\$\{ROOT\}\/\.agents\/plan/, `${doc.rel}: a path built from the literal`);
    const route = doc.rel.split("/")[1];
    if (route !== "spec-edit") assert.match(AREA.route(route).text, /workspace: "P", \/\/ repo-relative; leave it out when P is \.agents\/plan/, `${route}/ROUTE.md shows the argument`);
  }
});

test("planning routes: a named workspace is made by spec-write itself, and the project's is still the person's", () => {
  const write = AREA.route("spec-write").body;
  assert.match(write, /\*\*A named workspace\*\*.*Make it yourself, saying its name and what it is for in one line first: `node "W\/routes\/spec-init\/scaffold\.mjs" --workspace <name> --title/s);
  assert.match(write, /\*\*The project workspace\*\*.*is the person's to start\. Ask them, and take it on their yes first\./s);
  const named = fs.readFileSync(path.join(ROUTES, "spec-init", "NAMED.md"), "utf8");
  assert.match(named, /node "W\/routes\/spec-init\/scaffold\.mjs" --workspace <name> --title/);
  assert.match(AREA.route("spec-init").body, /follow \[NAMED\.md\]\(NAMED\.md\)/);
  assert.equal(AREA.route("spec-init").fields["argument-hint"], "[--plan <name>] [--refresh]");
  assert.match(AREA.route("spec-open").body, /\*\*A named workspace has no site\.\*\*/);
});
