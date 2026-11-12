// agentic-teamwork's skills, read as an agent's listing reads them: a name
// that matches its folder, a description that says when to reach for it, the
// four frontmatter keys and no others, and no path, script flag, or skill
// named in a body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-teamwork");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];
// Run by a person, once, to set a repo up: never picked by the model on its own.
const BY_HAND = ["bootstrap", "init-project"];
// Skills of other plugins a body may point at, and only as something optional.
const ELSEWHERE = ["code-diet:ladder", "code-diet:reuse-first", "docs-parity:docs-sync", "agent-works:orchestrate"];

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const file = path.join(SKILLS, name, "SKILL.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { name, dir: path.join(SKILLS, name), text, frontmatter: parseFrontmatter(text), body: text.replace(/^---\n[\s\S]*?\n---\n/, "") };
});

test("the plugin ships exactly its six skills", () => {
  assert.deepEqual(names, ["audit-project", "bootstrap", "init-project", "land", "ship", "tdd"]);
});

for (const skill of skills) {
  test(`${skill.name}: the frontmatter names the skill and carries only the allowed keys`, () => {
    assert.ok(skill.frontmatter, "SKILL.md starts with a frontmatter block");
    assert.equal(skill.frontmatter.name, skill.name, "the name is the folder's");
    for (const key of Object.keys(skill.frontmatter)) assert.ok(ALLOWED_KEYS.includes(key), `frontmatter key "${key}"`);
    assert.equal(skill.frontmatter["disable-model-invocation"] === "true", BY_HAND.includes(skill.name), "set up by hand, everything else by the model");
  });

  test(`${skill.name}: the description says when to trigger`, () => {
    const description = skill.frontmatter?.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this skill from its neighbours");
    assert.ok(description.length <= 700, `${description.length} characters: a listing pays for every one`);
    assert.match(description, /\bUse (when|on)\b/, "it says when to use it, not only what it is");
  });

  test(`${skill.name}: every path, reference and script it names exists`, () => {
    for (const m of skill.text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `\${CLAUDE_PLUGIN_ROOT}/${m[1]}`);
    }
    for (const m of skill.text.matchAll(/\breferences\/([A-Za-z0-9_-]+\.md)/g)) {
      assert.ok(fs.existsSync(path.join(SKILLS, "tdd", "references", m[1])) || fs.existsSync(path.join(skill.dir, "references", m[1])), `references/${m[1]}`);
    }
    // A plugin script is always run through the plugin root, never by a bare or relative path.
    for (const m of skill.body.matchAll(/^.*\bnode\s+(\S*(?:init-project|audit-project|render|mr)\.mjs\S*).*$/gm)) {
      assert.match(m[1], /^"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[a-z-]+\.mjs"$/, m[0].trim());
    }
  });

  test(`${skill.name}: every flag it passes a script is one the script takes`, () => {
    for (const script of ["init-project", "mr"]) {
      const source = fs.readFileSync(path.join(PLUGIN, "scripts", `${script}.mjs`), "utf8");
      const known = new Set([...source.matchAll(/(?:"([a-z-]+)"|\b([a-z]+)): \{ type: "(?:string|boolean)"/g)].map((m) => m[1] ?? m[2]));
      assert.ok(known.size > 5, `${script}.mjs declares its options`);
      const lines = skill.text.split("\n").filter((l) => l.includes(`${script}.mjs`));
      for (const line of lines) {
        for (const flag of line.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) assert.ok(known.has(flag[1]), `${script}.mjs has no --${flag[1]}: ${line.trim()}`);
      }
    }
  });

  test(`${skill.name}: every skill it points at exists, and another plugin's is optional`, () => {
    for (const m of skill.text.matchAll(/(?<![\w/.-])\/([a-z][a-z-]*):([a-z][a-z-]*)\b/g)) {
      const [, plugin, name] = m;
      if (plugin === "agentic-teamwork") assert.ok(names.includes(name), `/agentic-teamwork:${name}`);
      else {
        assert.ok(ELSEWHERE.includes(`${plugin}:${name}`), `/${plugin}:${name} is not a skill this plugin may name`);
        const sentence = skill.text.split(/(?<=[.!?])\s+/).find((s) => s.includes(m[0])) ?? "";
        assert.match(sentence, new RegExp(`\\bif ${plugin} is installed\\b`, "i"), `/${plugin}:${name} is offered, not assumed`);
      }
    }
  });
}

test("ship and land reach the forge only through mr.mjs", () => {
  for (const skill of skills.filter((s) => ["ship", "land"].includes(s.name))) {
    assert.match(skill.body, /scripts\/mr\.mjs"/, `${skill.name} runs mr.mjs`);
    assert.doesNotMatch(skill.body, /(^|[\s`(])(gh|glab)\s+(pr|mr|api|auth|run|repo|issue)\b/m, `${skill.name} names a forge CLI call`);
  }
});

test("every reference file is linked from the skill it sits under", () => {
  for (const skill of skills) {
    const dir = path.join(skill.dir, "references");
    for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) assert.ok(skill.text.includes(`references/${file}`), `${skill.name}/references/${file} is not linked from SKILL.md`);
    assert.deepEqual(fs.readdirSync(skill.dir).filter((f) => !["SKILL.md", "references"].includes(f)), [], `${skill.name} holds only SKILL.md and references/`);
  }
});
