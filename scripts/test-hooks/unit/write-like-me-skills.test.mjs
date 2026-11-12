// write-like-me's skills, read as an agent's listing reads them: a name that
// matches its folder, a description that says when to reach for it, the four
// frontmatter keys and no others, and no path, script or skill named in a
// body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "write-like-me");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];
// Run by the person: one rebuilds the profile, the other edits it.
const BY_HAND = ["calibrate", "review"];

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const dir = path.join(SKILLS, name);
  const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  return { name, dir, text, frontmatter: parseFrontmatter(text) };
});
// Everything an agent is sent to read: the skills, and the rules the Stop hook hands a subagent.
const REFINE = path.join(PLUGIN, "hooks", "refine-profile.md");
const docs = [...skills.map((s) => ({ file: path.join(s.dir, "SKILL.md"), text: s.text })), { file: REFINE, text: fs.readFileSync(REFINE, "utf8") }];

test("the plugin ships exactly its four skills", () => {
  assert.deepEqual(names, ["audit", "calibrate", "review", "write-like-me"]);
});

for (const skill of skills) {
  test(`${skill.name}: the frontmatter names the skill and carries only the allowed keys`, () => {
    assert.ok(skill.frontmatter, "SKILL.md starts with a frontmatter block");
    assert.equal(skill.frontmatter.name, skill.name, "the name is the folder's");
    for (const key of Object.keys(skill.frontmatter)) assert.ok(ALLOWED_KEYS.includes(key), `frontmatter key "${key}"`);
    assert.equal(skill.frontmatter["disable-model-invocation"] === "true", BY_HAND.includes(skill.name), "the profile is changed by hand, prose is written by the model");
  });

  test(`${skill.name}: the description says when to trigger`, () => {
    const description = skill.frontmatter?.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this skill from its neighbours");
    assert.ok(description.length <= 700, `${description.length} characters: a listing pays for every one`);
    assert.match(description, /\bUse (when|every time)\b/i, "it says when to use it, not only what it is");
  });

  test(`${skill.name}: every file it links or names exists`, () => {
    for (const m of skill.text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `\${CLAUDE_PLUGIN_ROOT}/${m[1]}`);
    }
    for (const m of skill.text.matchAll(/\]\((?!https?:)([^)#\s]+)\)/g)) {
      assert.ok(fs.existsSync(path.resolve(skill.dir, m[1])), `link ${m[1]}`);
    }
    for (const m of skill.text.matchAll(/(?<![\w/}])(scripts\/wlm\/[A-Za-z0-9_.-]+)/g)) {
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), m[1]);
    }
  });

  test(`${skill.name}: a script it runs is run with node, through the plugin root`, () => {
    for (const m of skill.text.matchAll(/`([^`\n]*\.mjs[^`\n]*)`/g)) {
      if (!/^\s*\w+ /.test(m[1])) continue; // a bare path names a file; a command starts with a program
      assert.match(m[1], /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/wlm\/[a-z-]+\.mjs"( <[a-z]+>)?$/, m[1]);
    }
  });
}

test("no skill, reference or rules file names Python or a shell script", () => {
  const files = fs.readdirSync(PLUGIN, { recursive: true }).map(String).filter((f) => f.endsWith(".md") && path.basename(f) !== "CHANGELOG.md");
  assert.ok(files.length >= 8);
  for (const file of files) {
    const text = fs.readFileSync(path.join(PLUGIN, file), "utf8");
    assert.doesNotMatch(text, /\bpython3?\b|[\w-]+\.py\b|[\w-]+\.sh\b/i, file);
  }
});

test("every skill a document points at is one the plugin ships", () => {
  for (const { file, text } of docs) {
    for (const m of text.matchAll(/(?<![\w/.-])\/write-like-me:([a-z][a-z-]*)\b/g)) assert.ok(names.includes(m[1]), `${path.basename(path.dirname(file))}: /write-like-me:${m[1]}`);
    for (const m of text.matchAll(/(?<![\w/.-])\/([a-z][a-z-]*):[a-z][a-z-]*\b/g)) assert.equal(m[1], "write-like-me", `${m[0]} is another plugin's skill`);
  }
});

test("the refinement rules name the budget script where it sits, relative to themselves", () => {
  const text = fs.readFileSync(REFINE, "utf8");
  const named = [...text.matchAll(/`(\.\.\/[A-Za-z0-9_./-]+\.mjs)`/g)].map((m) => m[1]);
  assert.deepEqual(named, ["../scripts/wlm/profile-budget.mjs"]);
  assert.ok(fs.existsSync(path.resolve(path.dirname(REFINE), named[0])));
});

test("every reference and asset is linked from the skill it sits under", () => {
  for (const skill of skills) {
    for (const folder of ["references", "assets"]) {
      const dir = path.join(skill.dir, folder);
      for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) assert.ok(skill.text.includes(`${folder}/${file}`), `${skill.name}/${folder}/${file} is not linked from SKILL.md`);
    }
  }
});
