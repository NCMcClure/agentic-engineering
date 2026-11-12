// plugin-workbench's skills as text an agent will follow: each SKILL.md is
// held to the frontmatter rule, says when to trigger, and points only at
// files the plugin ships. The rubric the skills grade by has to list exactly
// the checks the scorer knows, or a grader is sent looking for a section that
// is not there.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter, walk } from "../../lib.mjs";
import { runScan, runScore } from "../../../plugins/plugin-workbench/core/scripts/plugin-scan.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "plugin-workbench");
const SKILLS = fs.readdirSync(path.join(PLUGIN, "skills"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const FOUR = ["name", "description", "disable-model-invocation", "argument-hint"];
const text = (...rel) => fs.readFileSync(path.join(PLUGIN, ...rel), "utf8");
const shipped = walk(PLUGIN).map((f) => f.split(path.sep).join("/"));

test("the plugin ships the five skills its README lists", () => {
  assert.deepEqual(SKILLS, ["context-lens", "create-plugin", "evaluate-plugin", "improve-plugin", "refresh-marketplace"]);
  const rows = [...text("README.md").matchAll(/^\| `([a-z-]+)` \| /gm)].map((m) => m[1]).sort();
  assert.deepEqual(rows, SKILLS);
});

for (const skill of SKILLS) {
  const md = text("skills", skill, "SKILL.md");
  const fm = parseFrontmatter(md);

  test(`${skill}: frontmatter is the directory's name, a description, and nothing beyond the four keys`, () => {
    assert.ok(fm, "no frontmatter");
    assert.equal(fm.name, skill);
    assert.deepEqual(Object.keys(fm).filter((k) => !FOUR.includes(k)), []);
    assert.ok(fm.description.length >= 80 && fm.description.length <= 1024, `${fm.description.length} characters`);
  });

  test(`${skill}: the description says when to trigger, not only what the skill is`, () => {
    assert.match(fm.description, /\bUse when\b/);
  });

  test(`${skill}: every \${CLAUDE_PLUGIN_ROOT} path and every relative link is a file the plugin ships`, () => {
    // A path with a placeholder in it (<file>, <name>) is a pattern, not a file.
    const rooted = [...md.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_.\/<>-]+)/g)].map((m) => m[1].replace(/[.)]+$/, "")).filter((p) => !/[<>]/.test(p));
    for (const rel of rooted) assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `\${CLAUDE_PLUGIN_ROOT}/${rel}`);
    const links = [...md.matchAll(/\[[^\]]*\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^(https?:|mailto:)/.test(l));
    for (const link of links) assert.ok(fs.existsSync(path.join(PLUGIN, "skills", skill, link)), link);
    // A script named anywhere in the skill is there to run. refresh-marketplace
    // alone names scripts that belong to the checkout it works on.
    const theirs = skill === "refresh-marketplace" ? ["refresh.mjs", "validate.mjs", "install.mjs"] : [];
    for (const [, script] of md.matchAll(/\b([a-z][a-z-]*\.mjs)\b/g)) {
      if (!theirs.includes(script)) assert.ok(shipped.some((f) => f.endsWith(`/scripts/${script}`)), script);
    }
  });
}

test("only the two hand-run skills are kept out of the model's listing", () => {
  const handRun = SKILLS.filter((s) => parseFrontmatter(text("skills", s, "SKILL.md"))["disable-model-invocation"] === "true");
  assert.deepEqual(handRun, ["evaluate-plugin", "refresh-marketplace"]);
});

test("every skill that calls Workflow() points at the subagent fallback, and the fallback is there to read", () => {
  const calling = SKILLS.filter((s) => text("skills", s, "SKILL.md").includes("Workflow({"));
  assert.deepEqual(calling, ["create-plugin", "evaluate-plugin"]);
  for (const skill of calling) assert.match(text("skills", skill, "SKILL.md"), /\[\.\.\/\.\.\/core\/references\/subagent-fallback\.md\]\(\.\.\/\.\.\/core\/references\/subagent-fallback\.md\)/);
  assert.match(text("core", "references", "subagent-fallback.md"), /^## The fallback$/m);
});

test("the rubric has a section for every check the scorer knows, and marks the mechanical ones", () => {
  const scan = runScan(PLUGIN);
  const grades = scan.applicable_judgment_checks.map((check) => ({ check, grade: 3, evidence: "e", ...(scan.per_skill_checks.includes(check) ? { skill: "s" } : {}) }));
  const known = runScore(scan, { grades }).dimensions.flatMap((d) => d.checks.map((c) => [c.id, c.kind]));
  const sections = [...text("core", "references", "rubric.md").matchAll(/^### ([A-Z]{2}\d) · (.*)$/gm)].map((m) => [m[1], /\(mechanical/.test(m[2]) ? "m" : "j"]);
  assert.deepEqual(sections, known);
  assert.equal(known.filter(([, kind]) => kind === "m").length, 15, "the README counts them");
  assert.match(text("README.md"), /^Fifteen of the rubric's checks are mechanical/m);
});

test("the workflows send their graders to rubric sections that exist", () => {
  const rubric = text("core", "references", "rubric.md");
  const named = ["create-plugin/workflows/create.js", "evaluate-plugin/workflows/evaluate.js"]
    .flatMap((f) => [...text("skills", f).matchAll(/section \\?"([^"\\]+)\\?" in full/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(named)], ["SQ: Skill quality"]);
  for (const heading of named) assert.ok(rubric.includes(`\n## ${heading}\n`), heading);
});

test("nothing in the plugin is anything but Node, and no skill still reaches for a script that is gone", () => {
  assert.deepEqual(shipped.filter((f) => /\.(py|sh|bash|zsh|ps1|rb|pl)$/.test(f)), []);
  const stale = shipped.filter((f) => /\.(md|js|mjs|html|stub|json)$/.test(f) && f !== "CHANGELOG.md" && /python3?\b|plugin_scan|plugin_scaffold|script-py/.test(text(f)));
  assert.deepEqual(stale, []);
  for (const f of shipped.filter((f) => f.endsWith(".mjs"))) assert.doesNotMatch(text(f), /process\.exit\(/, f);
});

test("every stub is one the scaffolder reads, and every stub it reads is shipped", () => {
  const stubs = shipped.filter((f) => f.startsWith("skills/create-plugin/assets/stubs/")).map((f) => path.posix.basename(f)).sort();
  const read = [...text("skills", "create-plugin", "scripts", "plugin-scaffold.mjs").matchAll(/readStub\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(read)].sort(), stubs);
  const notes = text("skills", "create-plugin", "references", "authoring-notes.md");
  for (const stub of stubs) assert.ok(notes.includes(`\`${stub}\``), `authoring-notes.md does not explain ${stub}`);
});

test("refresh-marketplace names the dev-loop scripts this marketplace has, with the flags they take", () => {
  const md = text("skills", "refresh-marketplace", "SKILL.md");
  for (const script of ["scripts/refresh.mjs", "scripts/validate.mjs", "scripts/install.mjs"]) {
    assert.ok(md.includes(script), script);
    assert.ok(fs.existsSync(path.join(REPO, script)), `${script} is gone from this checkout`);
  }
  const installer = fs.readFileSync(path.join(REPO, "scripts", "install.mjs"), "utf8");
  for (const flag of ["--plugins", "--dry-run", "--force", "--uninstall"]) {
    assert.ok(md.includes(flag), `${flag} is not in the skill`);
    assert.ok(installer.includes(`"${flag}"`), `${flag} is not a flag of scripts/install.mjs`);
  }
});
