// The plugin-workbench area's routes as text an agent will follow: each
// ROUTE.md is held to a route's frontmatter, says when to take it, and points
// only at files the area ships. The rubric the routes grade by has to list exactly
// the checks the scorer knows, or a grader is sent looking for a section that
// is not there.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { walk } from "../../lib.mjs";
import { runScan, runScore } from "../../../plugins/agentcraft/skills/plugin-workbench/core/scripts/plugin-scan.mjs";
import { area, routeBasics } from "./area-routes.mjs";
import { REPO } from "./helpers.mjs";

const AREA = area("plugin-workbench");
const PLUGIN = AREA.dir;
const ROUTES = AREA.routes.map((r) => r.name);
const text = (...rel) => fs.readFileSync(path.join(PLUGIN, ...rel), "utf8");
const shipped = walk(PLUGIN).map((f) => f.split(path.sep).join("/"));

test("plugin-workbench routes: the area ships its four, and the lens is the context-doctor area's", () => {
  assert.deepEqual(ROUTES, ["create-plugin", "evaluate-plugin", "improve-plugin", "refresh-marketplace"]);
  // What that area ships is its own suite's to pin; here, only that the lens is there and not here.
  assert.ok(area("context-doctor").route("lens"));
  assert.equal(AREA.route("lens"), undefined);
});

routeBasics(test, AREA, { when: /\bUse when\b/, cap: 1024 });

for (const route of AREA.routes) {
  const md = route.text;

  test(`plugin-workbench routes: every relative link and every script ${route.name} names is a file the area ships`, () => {
    assert.ok(route.fields.description.length >= 80, `${route.fields.description.length} characters`);
    const links = [...md.matchAll(/\[[^\]]*\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^(https?:|mailto:)/.test(l));
    for (const link of links) assert.ok(fs.existsSync(path.join(route.dir, link)), link);
    // A script named anywhere in the route is there to run. refresh-marketplace
    // alone names scripts that belong to the checkout it works on.
    const theirs = route.name === "refresh-marketplace" ? ["refresh.mjs", "validate.mjs", "install.mjs"] : [];
    for (const [, script] of md.matchAll(/\b([a-z][a-z-]*\.mjs)\b/g)) {
      if (!theirs.includes(script)) assert.ok(shipped.some((f) => f.endsWith(`/scripts/${script}`)), script);
    }
  });
}

test("plugin-workbench routes: only the two hand-run routes are the person's to start", () => {
  assert.deepEqual(ROUTES.filter((name) => AREA.starts(name) === "person"), ["evaluate-plugin", "refresh-marketplace"]);
});

test("plugin-workbench routes: every route that calls Workflow() points at the subagent fallback, and the fallback is there to read", () => {
  const calling = ROUTES.filter((r) => AREA.route(r).text.includes("Workflow({"));
  assert.deepEqual(calling, ["create-plugin", "evaluate-plugin"]);
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
  // improve-plugin applies those fixes, so it points at the file and names every check in it.
  const improve = AREA.route("improve-plugin").text;
  assert.ok(improve.includes("core/references/mechanical-checks.md"));
  for (const id of entries) assert.ok(improve.includes(id), `improve-plugin does not name ${id}`);
});

test("the workflows send their graders to rubric sections that exist", () => {
  const rubric = text("core", "references", "rubric.md");
  const named = ["create-plugin/workflows/create.js", "evaluate-plugin/workflows/evaluate.js"]
    .flatMap((f) => [...text("routes", f).matchAll(/section \\?"([^"\\]+)\\?" in full/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(named)], ["SQ: Skill quality"]);
  for (const heading of named) assert.ok(rubric.includes(`\n## ${heading}\n`), heading);
});

test("nothing in the area is anything but Node, and no route still reaches for a script that is gone", () => {
  assert.deepEqual(shipped.filter((f) => /\.(py|sh|bash|zsh|ps1|rb|pl)$/.test(f)), []);
  const stale = shipped.filter((f) => /\.(md|js|mjs|html|stub|json)$/.test(f) && f !== "CHANGELOG.md" && /python3?\b|plugin_scan|plugin_scaffold|script-py/.test(text(f)));
  assert.deepEqual(stale, []);
  for (const f of shipped.filter((f) => f.endsWith(".mjs"))) assert.doesNotMatch(text(f), /process\.exit\(/, f);
});

test("every stub is one the scaffolder reads, and every stub it reads is shipped", () => {
  const stubs = shipped.filter((f) => f.startsWith("routes/create-plugin/assets/stubs/")).map((f) => path.posix.basename(f)).sort();
  const read = [...text("routes", "create-plugin", "scripts", "plugin-scaffold.mjs").matchAll(/readStub\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(read)].sort(), stubs);
  const notes = text("routes", "create-plugin", "references", "authoring-notes.md");
  for (const stub of stubs) assert.ok(notes.includes(`\`${stub}\``), `authoring-notes.md does not explain ${stub}`);
});

test("refresh-marketplace names the dev-loop scripts this marketplace has, with the flags they take", () => {
  const md = AREA.route("refresh-marketplace").text;
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

test("plugin-workbench: the shape and measuring references are reached from the routes that need them, by a path under the area", () => {
  for (const ref of ["shapes.md", "measuring.md"]) assert.ok(fs.existsSync(path.join(AREA.dir, "core", "references", ref)), ref);
  const names = (route, ref) => AREA.route(route).text.includes(`\`W/core/references/${ref}\``);
  assert.ok(names("create-plugin", "shapes.md") && names("create-plugin", "measuring.md"));
  assert.ok(names("improve-plugin", "shapes.md") && names("improve-plugin", "measuring.md"));
  assert.ok(names("evaluate-plugin", "measuring.md"));
  assert.match(text("core", "references", "rubric.md"), /\[shapes\.md\]\(shapes\.md\).*\n.*\[measuring\.md\]\(measuring\.md\)/);
});

test("plugin-workbench: shapes.md teaches the rule of thumb, and its three kinds of skill are the scaffolder's three modes", () => {
  const shapes = text("core", "references", "shapes.md");
  assert.match(shapes, /\*\*Plain\*\* while the plugin is one body of work and lists about eight\n\s+skills or fewer/);
  assert.match(shapes, /\*\*Areas\*\* when the plugin holds several bodies of work/);
  assert.match(shapes, /\*\*Never for reach\.\*\*/);
  for (const key of ["`user-invocable: false`", "`disable-model-invocation: true`"]) assert.ok(shapes.includes(key), key);
  const scaffold = text("routes", "create-plugin", "scripts", "plugin-scaffold.mjs");
  assert.match(scaffold, /const MODES = \["model", "callable", "user"\];/);
  for (const mode of ["model", "callable", "user"]) assert.match(AREA.route("create-plugin").text, new RegExp(`mode: "${mode}"`), mode);
  // A person cannot type an area, and the reference says what that means for anything written for one.
  assert.match(shapes, /A person cannot type an area/);
  assert.ok(shapes.split("\n").length < 120, "a reference an agent reads whole");
});

test("plugin-workbench: measuring.md holds a lane to one prompt, two windows, three passes, and the bar of no worse", () => {
  const measuring = text("core", "references", "measuring.md");
  for (const rule of ["**One prompt per session.**", "**Two windows.**", "**Three passes.**", "**A failing recording writes nothing.**", "**The bar is \"no worse\".**", "Never run it yourself."]) assert.ok(measuring.includes(rule), rule);
  assert.match(measuring, /\/agentcraft:context-doctor diagnose/);
  assert.match(measuring, /--score <outdir>\/grades\.json --measured <outdir>\/diagnose\.json/);
});

test("plugin-workbench: no route runs sessions or a repo's live tests, and improve-plugin says what it did not measure", () => {
  assert.match(AREA.skill.body, /\*\*A score reads files\.\*\*/);
  const improve = AREA.route("improve-plugin").text;
  assert.match(improve, /\*\*A shape is not a fix\.\*\*/);
  assert.match(improve, /\*\*Never spend the person's quota\.\*\*/);
  assert.match(improve, /\*\*What was not measured:\*\*/);
  assert.match(improve, /leave the run to the person: never start it/);
  for (const route of AREA.routes) assert.doesNotMatch(route.text, /npm run test:live/, `${route.name} names no repo's lane by its command: it finds one in the target's docs`);
});

test("plugin-workbench: the scorecard has a slot for every measured field the report format names, and the listing at both windows", () => {
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
