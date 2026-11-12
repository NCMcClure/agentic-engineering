// plugin-workbench's scaffolder: a confirmed spec in, a plugin skeleton out.
// What comes out has to be a plugin this marketplace would accept as it
// stands, so the skeleton is put through the structural gate and through the
// workbench's own scanner, not only compared against expected text.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter, walk } from "../../lib.mjs";
import { runScan } from "../../../plugins/plugin-workbench/core/scripts/plugin-scan.mjs";
import { REPO, runNode, tempDir, tree, write } from "./helpers.mjs";

const SCAFFOLD = path.join(REPO, "plugins", "plugin-workbench", "skills", "create-plugin", "scripts", "plugin-scaffold.mjs");
const CATALOG = ".claude-plugin/marketplace.json";
const NAME = "fresh-kit2go";

const SPEC = {
  name: NAME,
  description: "Keeps a kit fresh: counts what is stale and says so.",
  author: { name: "Sam Example", email: "sam@example.com" },
  keywords: ["kit", "fresh"],
  skills: [
    { name: "check-kit", mode: "model", withScripts: true, withReferences: true, withWorkflow: true },
    { name: "restock", mode: "user", argumentHint: "<shelf> [--dry-run]" },
  ],
};

/** Run the scaffolder for `spec` into a fresh parent directory; returns { dir, result, out }. */
function scaffold(t, spec = SPEC, { args = [], dirName = spec?.name ?? "plugin", parent = tempDir(t, "plugin-scaffold-") } = {}) {
  const dir = path.join(parent, dirName);
  const specFile = write(parent, "spec.json", typeof spec === "string" ? spec : JSON.stringify(spec));
  const result = runNode(SCAFFOLD, [dir, "--spec", specFile, ...args]);
  let out = null;
  try { out = JSON.parse(result.stdout); } catch { /* the caller asserts on it */ }
  return { dir, parent, specFile, result, out };
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const files = (dir) => walk(dir).map((f) => f.split(path.sep).join("/")).sort();

test("a spec becomes a skeleton: the files it lists, in the order it wrote them, each present", (t) => {
  const { dir, result, out } = scaffold(t);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.stderr, "");
  assert.deepEqual(out, {
    ok: true,
    target: dir,
    created: [
      ".claude-plugin/plugin.json",
      "skills/check-kit/SKILL.md",
      "skills/check-kit/workflows/check-kit.js",
      "skills/check-kit/scripts/check-kit.mjs",
      "skills/check-kit/references/notes.md",
      "skills/restock/SKILL.md",
      "README.md",
      "CHANGELOG.md",
    ],
    skipped: [],
  });
  assert.deepEqual(files(dir), [...out.created].sort());
});

// Byte for byte: a manifest is the one file with no TODO left in it, so its
// shape is what every plugin scaffolded so far already carries.
test("the manifest is written whole, with the display name and the version defaulted", (t) => {
  const { dir } = scaffold(t);
  assert.equal(read(dir, ".claude-plugin/plugin.json"), [
    "{",
    "  \"$schema\": \"https://json.schemastore.org/claude-code-plugin-manifest.json\",",
    `  "name": "${NAME}",`,
    "  \"displayName\": \"Fresh Kit2Go\",",
    "  \"version\": \"0.1.0\",",
    "  \"description\": \"Keeps a kit fresh: counts what is stale and says so.\",",
    "  \"author\": {",
    "    \"name\": \"Sam Example\",",
    "    \"email\": \"sam@example.com\"",
    "  },",
    "  \"keywords\": [\"kit\", \"fresh\"]",
    "}",
    "",
  ].join("\n"));
  const plain = scaffold(t, { ...SPEC, name: "solo", displayName: "Solo!", version: "2.0.1", keywords: [], skills: [{ name: "only" }] });
  const manifest = JSON.parse(read(plain.dir, ".claude-plugin/plugin.json"));
  assert.deepEqual([manifest.displayName, manifest.version, manifest.keywords], ["Solo!", "2.0.1", ["solo"]]);
});

test("history is seeded in CHANGELOG.md at the spec's version, and the README carries none", (t) => {
  const { dir } = scaffold(t, { ...SPEC, version: "0.4.0" });
  assert.equal(read(dir, "CHANGELOG.md"), "# Changelog\n\n- **0.4.0**: initial release.\n");
  const readme = read(dir, "README.md");
  assert.doesNotMatch(readme, /changelog/i);
  assert.deepEqual(readme.match(/^## .*$/gm), ["## How it works", "## Install", "## Skills"]);
  assert.match(readme, new RegExp(`\`\`\`text\\n/plugin marketplace add <path-or-repo>\\n/plugin install ${NAME}@<marketplace-name>\\n\`\`\``));
  assert.match(readme, /^\| `check-kit` \| model-invoked \| TODO\(author\) \|$/m);
  assert.match(readme, new RegExp(`^\\| \`restock\` \\| \`/${NAME}:restock <shelf> \\[--dry-run\\]\` \\| TODO\\(author\\) \\|$`, "m"));
  const custom = scaffold(t, { ...SPEC, install: "/plugin install fresh-kit2go@mine" });
  assert.match(read(custom.dir, "README.md"), /```text\n\/plugin install fresh-kit2go@mine\n```/);
});

test("each SKILL.md carries the four keys at most, by mode, and names every file scaffolded beside it", (t) => {
  const { dir } = scaffold(t);
  const model = read(dir, "skills/check-kit/SKILL.md");
  assert.deepEqual(parseFrontmatter(model), { name: "check-kit", description: "TODO(author), what this skill does AND when to trigger it. This sits in context every turn and must earn it." });
  for (const mention of ["scripts/check-kit.mjs", "[references/notes.md](references/notes.md)", "/skills/check-kit/workflows/check-kit.js", "Workflow({", "subagents"]) assert.ok(model.includes(mention), mention);
  assert.ok(model.endsWith("which files only the parent writes.\n"), "one newline at the end, no blank tail");

  const user = read(dir, "skills/restock/SKILL.md");
  assert.deepEqual(parseFrontmatter(user), {
    name: "restock",
    description: "TODO(author), what this skill does. It loads only when invoked, so spend words on the contract, not triggers.",
    "disable-model-invocation": "true",
    "argument-hint": "<shelf> [--dry-run]",
  });
  assert.ok(user.endsWith("*Done when: TODO(author), an observable completion criterion.*\n"), "a skill with no sibling files gets no extra section");
  assert.doesNotMatch(user, /Workflow\(|## The script|## Reference/);
});

test("the script stub is a Node script that runs as written", (t) => {
  const { dir } = scaffold(t);
  const script = path.join(dir, "skills", "check-kit", "scripts", "check-kit.mjs");
  assert.match(fs.readFileSync(script, "utf8"), /^#!\/usr\/bin\/env node\n\/\/ TODO\(author\)/);
  assert.doesNotMatch(fs.readFileSync(script, "utf8"), /process\.exit\(/);
  const result = runNode(script);
  assert.deepEqual([result.status, result.stdout.trim(), result.stderr], [0, "{\"ok\":true}", ""]);
});

// The structural gate, on a copy of this checkout with the skeleton added and
// a catalog entry for it: exactly what adding a new plugin here means.
const added = (dir, extra = {}) => ({
  json: { [CATALOG]: (m) => ({ ...m, plugins: [...m.plugins, { name: NAME, source: `./plugins/${NAME}`, description: SPEC.description, category: "testing" }] }) },
  write: { ...Object.fromEntries(files(dir).map((rel) => [`plugins/${NAME}/${rel}`, read(dir, rel)])), ...extra },
});
const failures = (stdout) => stdout.split("\n").filter((line) => line.startsWith("FAIL:"));

test("the skeleton, added to this marketplace with a catalog entry, passes the structural gate", (t) => {
  const { dir } = scaffold(t);
  const result = runNode("scripts/validate.mjs", ["--root", tree(t, added(dir))]);
  const fails = failures(result.stdout);
  assert.deepEqual(fails.filter((line) => line.includes(NAME)), [], result.stdout);
  // Whatever else the tree fails on is not the skeleton's doing; with nothing else failing, the gate is green.
  assert.equal(result.status, fails.length ? 1 : 0, result.stdout);
  if (!fails.length) assert.match(result.stdout, /^validate: all green$/m);
});

test("the gate does name the skeleton when it is broken, so the test above is not passing by silence", (t) => {
  const { dir } = scaffold(t);
  fs.rmSync(path.join(dir, "CHANGELOG.md"));
  const result = runNode("scripts/validate.mjs", ["--root", tree(t, added(dir, { [`plugins/${NAME}/skills/restock/SKILL.md`]: read(dir, "skills/restock/SKILL.md").replace("name: restock\n", "name: restock\nlicense: MIT\n") }))]);
  assert.equal(result.status, 1);
  const mine = failures(result.stdout).filter((line) => line.includes(NAME));
  assert.ok(mine.some((line) => line.startsWith(`FAIL: ${NAME}: missing CHANGELOG.md`)), result.stdout);
  assert.ok(mine.some((line) => line.startsWith(`FAIL: ${NAME}/restock: frontmatter key "license" is not one of the four allowed`)), result.stdout);
});

test("the skeleton scores clean on every mechanical check of the workbench's own scanner", (t) => {
  const { dir } = scaffold(t);
  const scan = runScan(dir);
  assert.deepEqual(Object.entries(scan.mechanical_grades).filter(([, g]) => g.grade !== 4), []);
  assert.deepEqual(Object.keys(scan.mechanical_grades).sort(), ["AN2", "AN5", "CF1", "CF2", "CF4", "CS3", "MH1", "MH3", "MH5", "SQ7", "SQ8", "WQ1", "WQ2", "WQ7"]);
  assert.deepEqual([scan.gates, scan.orphans, scan.components.non_node_scripts], [[], [], []]);
  assert.deepEqual(scan.skills.map((s) => [s.name, s.model_invoked, s.broken_links, s.sibling_files_unlinked]), [["check-kit", true, [], []], ["restock", false, [], []]]);
  assert.deepEqual(scan.changelog, { present: true, top_version: "0.1.0", matches_manifest: true });
});

test("a second run rewrites what still holds a TODO and leaves authored files alone, unless forced", (t) => {
  const first = scaffold(t);
  write(first.dir, "README.md", "# fresh-kit2go\n\nWritten by a person now.\n");
  write(first.dir, "CHANGELOG.md", "# Changelog\n\n- **0.2.0**: a release.\n- **0.1.0**: initial release.\n");
  write(first.dir, "skills/restock/SKILL.md", `${read(first.dir, "skills/restock/SKILL.md")}\nA half-finished edit.\n`);

  const again = runNode(SCAFFOLD, [first.dir, "--spec", first.specFile]);
  const out = JSON.parse(again.stdout);
  assert.equal(again.status, 0);
  assert.deepEqual(out.skipped, [".claude-plugin/plugin.json", "README.md", "CHANGELOG.md"]);
  assert.equal(out.note, "skipped files were authored already (no TODO(author) marker); pass --force to overwrite");
  assert.ok(out.created.includes("skills/restock/SKILL.md"));
  assert.equal(read(first.dir, "README.md"), "# fresh-kit2go\n\nWritten by a person now.\n");
  assert.match(read(first.dir, "CHANGELOG.md"), /0\.2\.0/);
  assert.doesNotMatch(read(first.dir, "skills/restock/SKILL.md"), /half-finished/);

  const forced = JSON.parse(runNode(SCAFFOLD, [first.dir, "--spec", first.specFile, "--force"]).stdout);
  assert.deepEqual([forced.skipped, forced.created.length, "note" in forced], [[], 8, false]);
  assert.match(read(first.dir, "README.md"), /TODO\(author\)/);
});

test("quotes, backslashes and pipes in a spec come out as valid JSON, YAML and table cells", (t) => {
  const { dir, result } = scaffold(t, {
    ...SPEC,
    description: "Says \"fresh\" or C:\\stale, {{VERSION}} and all.",
    author: { name: "Sam \"Kit\" Example", email: "sam@example.com" },
    skills: [{ name: "restock", mode: "user", argumentHint: "<a|b> \"quoted\"" }],
  });
  assert.equal(result.status, 0, result.stdout);
  const manifest = JSON.parse(read(dir, ".claude-plugin/plugin.json"));
  assert.equal(manifest.description, "Says \"fresh\" or C:\\stale, {{VERSION}} and all.", "a value is never re-read as a template");
  assert.equal(manifest.author.name, "Sam \"Kit\" Example");
  assert.match(read(dir, "skills/restock/SKILL.md"), /^argument-hint: "<a\|b> \\"quoted\\""$/m);
  assert.match(read(dir, "README.md"), /^\| `restock` \| `\/fresh-kit2go:restock <a\\\|b> "quoted"` \| TODO\(author\) \|$/m);
});

test("a spec that cannot be scaffolded is refused with one JSON line and exit 1, and nothing is written", (t) => {
  const refused = (spec, options) => {
    const run = scaffold(t, spec, options);
    assert.equal(run.result.status, 1, run.result.stdout);
    assert.equal(run.out?.ok, false, run.result.stdout);
    assert.ok(!fs.existsSync(run.dir), "a refused run leaves no directory behind");
    return run.out.error;
  };
  assert.equal(refused({ ...SPEC, description: "" }), "spec missing required key: description");
  assert.equal(refused({ ...SPEC, author: { name: "Sam" } }), "spec.author needs name and email");
  assert.equal(refused({ ...SPEC, skills: [] }), "spec.skills must list at least one skill");
  assert.equal(refused({ ...SPEC, name: "Fresh_Kit" }, { dirName: "Fresh_Kit" }), "name 'Fresh_Kit' is not a lowercase-hyphen slug");
  assert.equal(refused(SPEC, { dirName: "somewhere-else" }), `spec name '${NAME}' != target dir basename 'somewhere-else'`);
  assert.equal(refused({ ...SPEC, version: "1.0" }), "version '1.0' is not semver");
  assert.equal(refused({ ...SPEC, skills: [{ name: "Bad Name" }] }), "skill name 'Bad Name' is not a lowercase-hyphen slug");
  assert.equal(refused({ ...SPEC, skills: [{ name: "ok", mode: "auto" }] }), "skill ok: mode must be model or user");
  assert.equal(refused("[1, 2]", { dirName: "x" }), "spec must be a JSON object");
  assert.match(refused("{ not json", { dirName: "x" }), /^spec unreadable: /);
});

test("a call with no spec or no target says how to call it", (t) => {
  const parent = tempDir(t, "plugin-scaffold-");
  for (const args of [[], [path.join(parent, NAME)], ["--spec", path.join(parent, "spec.json")], [path.join(parent, NAME), "--spec", "s.json", "--overwrite"]]) {
    const result = runNode(SCAFFOLD, args);
    assert.equal(result.status, 1, JSON.stringify(args));
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /usage: node plugin-scaffold\.mjs <target-dir> --spec <spec\.json> \[--force\]/);
  }
});
