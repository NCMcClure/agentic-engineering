// picture-this's skills, read as an agent's listing reads them: a name that
// matches its folder, a description that says when to reach for it, the four
// frontmatter keys and no others, and no path in a body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "picture-this");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const text = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
  return { name, text, frontmatter: parseFrontmatter(text) };
});
const files = fs.readdirSync(PLUGIN, { recursive: true }).map(String).map((f) => f.split(path.sep).join("/"));
const markdown = files.filter((f) => f.endsWith(".md") && !f.startsWith("app/"));

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
}

test("every plugin-root path named in a document exists", () => {
  for (const file of markdown) {
    const text = fs.readFileSync(path.join(PLUGIN, file), "utf8");
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      const rel = m[1].replace(/\.$/, "");
      assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `${file}: \${CLAUDE_PLUGIN_ROOT}/${rel}`);
    }
  }
});

test("the plugin ships no Python or shell outside the studio app, and no document names one", () => {
  const own = files.filter((f) => !f.startsWith("app/"));
  assert.deepEqual(own.filter((f) => /\.(py|pyc|sh|bash)$/.test(f)), []);
  for (const file of markdown.filter((f) => f !== "CHANGELOG.md")) {
    assert.doesNotMatch(fs.readFileSync(path.join(PLUGIN, file), "utf8"), /\bbash "|\bpython3?\b/, file);
  }
});
