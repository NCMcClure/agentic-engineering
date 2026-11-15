// picture-this's skills, read as an agent's listing reads them: a name that
// matches its folder, a description that says when to reach for it, the four
// frontmatter keys and no others, and nothing named in a body that does not
// exist: no path, no command, no reference, no agent.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { COMMANDS } from "../../../plugins/agentcraft/skills/picture-this/scripts/pt.mjs";
import { STATEMENT, studies } from "../../../plugins/agentcraft/skills/picture-this/scripts/commands/draft.mjs";
import { LENSES } from "../../../plugins/agentcraft/skills/picture-this/scripts/lib/model-check.mjs";
import { THREE_PACKAGES } from "../../../plugins/agentcraft/skills/picture-this/scripts/lib/owned.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentcraft", "skills", "picture-this");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const text = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
  return { name, text, frontmatter: parseFrontmatter(text) };
});
const files = fs.readdirSync(PLUGIN, { recursive: true }).map(String).map((f) => f.split(path.sep).join("/"));
const markdown = files.filter((f) => f.endsWith(".md") && !f.startsWith("app/"));
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), "utf8");
const visualize = skills.find((s) => s.name === "visualize");
const references = fs.readdirSync(path.join(SKILLS, "visualize", "references")).sort();

test("the plugin ships exactly its two skills, and no hooks", () => {
  assert.deepEqual(names, ["export-stills", "visualize"]);
  assert.equal(fs.existsSync(path.join(PLUGIN, "hooks")), false);
});

for (const skill of skills) {
  test(`${skill.name}: the frontmatter names the skill and carries only the allowed keys`, () => {
    assert.ok(skill.frontmatter, "SKILL.md starts with a frontmatter block");
    assert.equal(skill.frontmatter.name, skill.name, "the name is the folder's");
    for (const key of Object.keys(skill.frontmatter)) assert.ok(ALLOWED_KEYS.includes(key), `frontmatter key "${key}"`);
    assert.notEqual(skill.frontmatter["disable-model-invocation"], "true", "the model reaches for it on its own");
  });

  test(`${skill.name}: the description says when to trigger`, () => {
    const description = skill.frontmatter?.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this skill from its neighbour");
    assert.ok(description.length <= 700, `${description.length} characters: a listing pays for every one`);
    assert.match(description, /\bUse\s+when\b/, "it says when to use it, not only what it is");
  });

  test(`${skill.name}: P is the CLI, and every command it runs is one the CLI has`, () => {
    assert.match(skill.text, /`P` below is `node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/pt\.mjs"`/);
    const used = [...skill.text.matchAll(/(?:^|[`\s])P ([a-z]+)\b/gm)].map((m) => m[1]);
    assert.ok(used.length >= 3, "a skill of this plugin runs the CLI");
    for (const command of used) assert.ok(COMMANDS[command], `P ${command}`);
  });

  test(`${skill.name}: the other skill it points at exists`, () => {
    for (const m of skill.text.matchAll(/\*\*([a-z][a-z-]+)\*\* skill/g)) assert.ok(names.includes(m[1]), m[1]);
  });
}

test("every plugin-root path named in a document exists", () => {
  let seen = 0;
  for (const file of markdown) {
    for (const m of read(file).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      seen += 1;
      const rel = m[1].replace(/\.$/, "");
      assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `${file}: \${CLAUDE_PLUGIN_ROOT}/${rel}`);
    }
  }
  assert.ok(seen >= 4);
});

test("every reference the skill routes to exists, and every reference is on its map", () => {
  for (const m of visualize.text.matchAll(/references\/([a-z-]+\.md)/g)) assert.ok(references.includes(m[1]), `references/${m[1]}`);
  const map = visualize.text.slice(visualize.text.indexOf("## References"));
  for (const file of references) assert.match(map, new RegExp(`\\b${file.replace(".", "\\.")}\\b`), `${file} is on the map`);
  for (const file of references) {
    for (const m of read(`skills/visualize/references/${file}`).matchAll(/`([a-z-]+\.md)`/g)) assert.ok(references.includes(m[1]), `${file} points at ${m[1]}`);
  }
});

test("the documents name the commands, studies, agent and limits that the code has", () => {
  const all = markdown.map(read).join("\n");
  for (const m of all.matchAll(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/pt\.mjs" ([a-z]+)/g)) assert.ok(COMMANDS[m[1]], `pt.mjs ${m[1]}`);
  const table = read("skills/visualize/references/archetypes.md");
  for (const a of studies()) assert.match(table, new RegExp(`\\| \`${a.name}\` \\|`), `${a.name} is in the table of studies`);
  assert.equal([...table.matchAll(/^\| `[a-z0-9-]+` \|/gm)].length, studies().length, "and the table names no study the plugin does not ship");

  assert.ok(fs.existsSync(path.join(PLUGIN, "agents", "cold-reader.md")));
  const agent = parseFrontmatter(read("agents/cold-reader.md"));
  assert.equal(agent.name, "cold-reader");
  assert.equal(agent.tools, "Read", "the reader opens the picture and nothing else");
  assert.match(visualize.text, /`picture-this:cold-reader`/);
  assert.match(read("skills/visualize/references/review.md"), /`picture-this:cold-reader`/);
  assert.match(read("skills/visualize/references/review.md"), /sheet\.nocap\.png/);

  const model = read("skills/visualize/references/model.md");
  const example = JSON.parse(model.slice(model.indexOf("```json") + 7, model.indexOf("```", model.indexOf("```json") + 7)));
  assert.equal(example.schema, 1, "the example in the reference is a model");
  assert.match(model, /two to nine/);
  const lenses = read("skills/visualize/references/lenses.md");
  for (const lens of LENSES) assert.match(lenses, new RegExp(`^\\| \\*\\*${lens}\\*\\* \\|`, "m"), `${lens} is a row of the lens table`);
  for (const lens of LENSES) assert.match(table, new RegExp(`^\\| ${lens} \\|`, "m"), `${lens} has views to think with`);
  // A study named in a lens row, or in the table of studies, is one the plugin ships.
  const named = [...lenses.matchAll(/^\| \*\*[a-z]+\*\* \|.*\|([^|]*)\|$/gm)].flatMap((row) => [...row[1].matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]));
  assert.ok(named.length >= 6, "the lens table points at studies");
  for (const name of named) assert.ok(studies().some((a) => a.name === name), `lenses.md names the study ${name}`);
  assert.match(visualize.text, /references\/lenses\.md/);
  assert.match(model, /at most 140\s+characters/);
});

test("the skill asks before it downloads, and waits for a yes on a model read from code", () => {
  assert.match(visualize.text, /Do not download without that yes/);
  assert.match(visualize.text, /\*\*wait for a yes\*\* before\s+drawing anything/);
  assert.match(visualize.text, /--require-source/);
  const stills = skills.find((s) => s.name === "export-stills");
  assert.match(stills.text, /only\s+on their yes/);
});

test("the skill asks before a 3D figure adds packages to a repo, and names the three the kit imports", () => {
  for (const name of THREE_PACKAGES) assert.match(visualize.text, new RegExp(`\`${name.replace("/", "\\/")}\``), name);
  assert.match(visualize.text, /Do not\s+add them without that yes/);
  assert.match(visualize.text, /stills only, which\s+need nothing/, "a no still leaves a way to finish");
  assert.match(visualize.text, /Use at most one in a round/);
  const delivery = read("skills/visualize/references/delivery.md");
  for (const name of THREE_PACKAGES) assert.match(delivery, new RegExp(`\`${name.replace("/", "\\/")}\``), name);
  assert.match(delivery, /kit install --three/);
  for (const file of ["archetypes.md", "house-style.md", "motion.md"]) assert.match(read(`skills/visualize/references/${file}`), /^## .*3D/m, `${file} has its section on 3D`);
  assert.match(read("kit/README.md"), /^## 3D$/m);
});

test("the plugin ships no Python or shell outside the studio app, and no document names one", () => {
  const own = files.filter((f) => !f.startsWith("app/"));
  assert.deepEqual(own.filter((f) => /\.(py|pyc|sh|bash)$/.test(f)), []);
  for (const file of markdown.filter((f) => f !== "CHANGELOG.md")) {
    assert.doesNotMatch(read(file), /\bbash "|\bpython3?\b/, file);
  }
});

test("the documents put the subject before the studies, and never call a study a template to fill", () => {
  const views = read("skills/visualize/references/archetypes.md");
  assert.match(views, /^# Views and studies$/m);
  assert.match(views, /a study is reached for only when its view is the\s+view/, "the plain rule");
  assert.match(views, /A round of three is rarely three studies/);
  for (const key of STATEMENT) assert.match(views, new RegExp(`^- \`${key}\`, of a `, "m"), `the view statement's ${key} is shown, from a subject of its own`);
  assert.doesNotMatch(views, /```json/, "no whole statement is given to borrow from: three fields from three subjects");
  // No one subject is the running example: nothing an agent reads leans on the figure this phase was built around.
  for (const file of markdown.filter((f) => f !== "CHANGELOG.md")) assert.doesNotMatch(read(file), /orchestrat|context window|transcript/i, file);
  assert.match(visualize.text, /--views /);
  assert.match(visualize.text, /states its view\*\* in its `view\.json`, before any drawing/);
  assert.match(visualize.text, /it does not\s+ship templates to fill in/);
  assert.match(visualize.text, /A round of three is rarely three studies/);
  const review = read("skills/visualize/references/review.md");
  assert.match(review, /^## Its own picture, or a template with new labels\?$/m);
  assert.match(review, /\*\*Swap the labels\.\*\*/);
  assert.match(review, /^12\. It fails the swap test/m, "the test is an item of the checklist");
  const lenses = read("skills/visualize/references/lenses.md");
  assert.match(lenses, /^## 3\. Two lenses in one picture$/m);
  for (const where of ["on the other axis", "inside each unit", "over it", "beside it"]) assert.match(lenses, new RegExp(`\\*\\*${where}\\*\\*`), `a second lens may sit ${where}`);
  assert.match(lenses, /Never three/);
  // Nothing an agent reads still speaks of starters or archetypes, but for the file's own name.
  for (const file of markdown.filter((f) => f !== "CHANGELOG.md")) {
    assert.doesNotMatch(read(file).replace(/archetypes\.md/g, ""), /\bstarters?\b|\barchetypes?\b/i, file);
  }
  for (const name of [...fs.readdirSync(path.join(PLUGIN, "studies")).map((n) => `studies/${n}`), "blank"]) {
    assert.doesNotMatch(read(`${name}/figure.tsx`), /\bstarters?\b|\barchetypes?\b/i, name);
  }
});

test("the kit's README names every flat shape with what it is for, and the model reference every new field", () => {
  const kit = read("kit/README.md");
  assert.match(kit, /^## Flat space$/m);
  for (const shape of ["Panel", "Bar", "Tile", "Elbow", "Line", "Token", "Queue", "Meter", "Axis", "Cells", "Lanes"]) {
    assert.match(kit, new RegExp(`^\\| \`${shape}\`[^|]*\\| \\S`, "m"), `${shape} has its line`);
    const source = ["panel", "connect", "chart"].map((f) => read(`kit/flat/${f}.tsx`)).join("\n");
    assert.match(source, new RegExp(`export function ${shape}\\(`), `${shape} is in the kit`);
  }
  for (const fn of ["elbow", "between", "slotIn", "cell", "spread", "tint", "mix"]) {
    assert.match(kit, new RegExp(`\`${fn}\\(`), `${fn} is documented`);
    assert.match(read("kit/flat/geometry.ts"), new RegExp(`export function ${fn}\\(`), `${fn} is in the kit`);
  }
  const model = read("skills/visualize/references/model.md");
  for (const field of ["parent", "born", "repeat", "quantities", "data"]) assert.match(model, new RegExp(`^- \\*\\*\`${field}\`\\*\\*`, "m"), `${field} is documented`);
});

test("every lens has a study, and every flat shape is drawn by a figure the plugin ships", () => {
  const lenses = read("skills/visualize/references/lenses.md");
  for (const lens of LENSES) {
    const row = lenses.match(new RegExp(`^\\| \\*\\*${lens}\\*\\* \\|.*$`, "m"))[0];
    const named = [...row.split("|").at(-2).matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
    assert.ok(named.length >= 1, `${lens} names a study`);
    for (const name of named) {
      const model = JSON.parse(read(`studies/${name}/model.json`));
      if (!["layer-stack", "split", "case-loop"].includes(name)) assert.ok(model.lens, `${name} says its lens`);
    }
  }
  // A shape nothing ships with is a shape nobody has looked at: each is used by a study.
  const figures = fs.readdirSync(path.join(PLUGIN, "studies")).map((name) => read(`studies/${name}/figure.tsx`)).join("\n");
  for (const shape of ["Panel", "Tile", "Elbow", "Line", "Token", "Queue", "Meter", "Axis", "Cells", "Lanes"]) {
    assert.match(figures, new RegExp(`<${shape}[\\s/>]`), `${shape} is drawn by a study`);
  }
});
