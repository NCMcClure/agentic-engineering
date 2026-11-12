// animated-storytelling's one skill, read as an agent's listing reads it: a
// name that matches its folder, a description that says when to reach for it,
// the four frontmatter keys and no others, and no reference or script named
// in the skill or its references that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "animated-storytelling");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];
const SECTIONS = ["creative-recipes", "motion-api", "motion-design", "narrative", "visual-design"];

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skill = (() => {
  const dir = path.join(SKILLS, "animated-storytelling");
  const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  return { dir, text, frontmatter: parseFrontmatter(text) };
})();
const markdown = fs.readdirSync(PLUGIN, { recursive: true }).map(String).filter((f) => f.endsWith(".md")).map((f) => ({ file: f.split(path.sep).join("/"), text: fs.readFileSync(path.join(PLUGIN, f), "utf8") }));

test("the plugin ships exactly one skill, and no hooks", () => {
  assert.deepEqual(names, ["animated-storytelling"]);
  assert.equal(fs.existsSync(path.join(PLUGIN, "hooks")), false);
});

test("the frontmatter names the skill and carries only the allowed keys", () => {
  assert.ok(skill.frontmatter, "SKILL.md starts with a frontmatter block");
  assert.equal(skill.frontmatter.name, "animated-storytelling", "the name is the folder's");
  for (const key of Object.keys(skill.frontmatter)) assert.ok(ALLOWED_KEYS.includes(key), `frontmatter key "${key}"`);
  assert.notEqual(skill.frontmatter["disable-model-invocation"], "true", "the model reaches for it on its own");
});

test("the description says when to trigger", () => {
  const description = skill.frontmatter?.description ?? "";
  assert.ok(description.length >= 80, "long enough to tell this skill from any other");
  assert.ok(description.length <= 700, `${description.length} characters: a listing pays for every one`);
  assert.match(description, /\bUse when\b/, "it says when to use it, not only what it is");
});

test("every plugin-root path named in the skill or a reference exists", () => {
  let seen = 0;
  for (const { file, text } of markdown) {
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      seen += 1;
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `${file}: \${CLAUDE_PLUGIN_ROOT}/${m[1]}`);
    }
  }
  assert.ok(seen >= 2, "the references run the contrast checker through the plugin root");
});

test("every reference the skill routes to exists, and every reference file is on its map", () => {
  for (const m of skill.text.matchAll(/(?:references\/)?((?:creative-recipes|motion-api|motion-design|narrative|visual-design)\/[a-z-]+\.md)/g)) {
    assert.ok(fs.existsSync(path.join(skill.dir, "references", m[1])), `references/${m[1]}`);
  }
  for (const m of skill.text.matchAll(/`(scripts\/[A-Za-z0-9_.-]+)`/g)) assert.ok(fs.existsSync(path.join(skill.dir, m[1])), m[1]);
  assert.deepEqual(fs.readdirSync(path.join(skill.dir, "references")).sort(), SECTIONS);
  const map = skill.text.slice(skill.text.indexOf("## Reference map"));
  for (const section of SECTIONS) {
    const row = map.split("\n").find((l) => l.includes(`${section}/`)) ?? "";
    for (const file of fs.readdirSync(path.join(skill.dir, "references", section))) assert.ok(row.includes(path.basename(file, ".md")), `${section}/${file} is not on the reference map`);
  }
});

test("the plugin ships no Python and no shell, and no document names either", () => {
  const stray = fs.readdirSync(PLUGIN, { recursive: true }).map(String).filter((f) => /\.(py|pyc|sh|bash)$/.test(f));
  assert.deepEqual(stray, []);
  for (const { file, text } of markdown) {
    if (file === "CHANGELOG.md") continue;
    assert.doesNotMatch(text, /\bpython3?\b|[\w-]+\.py\b|[\w-]+\.sh\b/i, file);
  }
});

test("the contrast checker is run with node wherever a document shows the command", () => {
  const commands = markdown.flatMap(({ file, text }) => [...text.matchAll(/`([^`\n]*contrast-check\.mjs"[^`\n]*)`/g)].map((m) => ({ file, command: m[1] })));
  assert.ok(commands.length >= 2);
  for (const { file, command } of commands) assert.match(command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/animated-storytelling\/scripts\/contrast-check\.mjs" '/, file);
});
