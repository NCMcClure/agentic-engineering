// workflow-studio's skills, read as an agent's listing reads them: a name that
// matches its folder, a description that says when to reach for it, the four
// frontmatter keys and no others, and no path or command in a body that does
// not exist. The launch command is checked word by word, since the agent runs
// it exactly as written.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "workflow-studio");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const text = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
  return { name, text, frontmatter: parseFrontmatter(text) };
});
const launch = skills.find((s) => s.name === "workflow-studio");

test("the plugin ships exactly its two skills, and no hooks", () => {
  assert.deepEqual(names, ["author-workflow", "workflow-studio"]);
  assert.equal(fs.existsSync(path.join(PLUGIN, "hooks")), false);
});

for (const skill of skills) {
  test(`${skill.name}: the frontmatter names the skill and carries only the allowed keys`, () => {
    assert.ok(skill.frontmatter, "SKILL.md starts with a frontmatter block");
    assert.equal(skill.frontmatter.name, skill.name, "the name is the folder's");
    for (const key of Object.keys(skill.frontmatter)) assert.ok(ALLOWED_KEYS.includes(key), `frontmatter key "${key}"`);
  });

  test(`${skill.name}: the description says when to trigger`, () => {
    const description = skill.frontmatter?.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this skill from its neighbour");
    assert.ok(description.length <= 700, `${description.length} characters: a listing pays for every one`);
    assert.match(description, /\bUse\s+when\b/, "it says when to use it, not only what it is");
  });

  test(`${skill.name}: every plugin-root path it names exists`, () => {
    const paths = [...skill.text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1].replace(/\.$/, ""));
    assert.ok(paths.length >= 1, "a skill of this plugin points into the plugin");
    for (const rel of paths) assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `\${CLAUDE_PLUGIN_ROOT}/${rel}`);
  });

  test(`${skill.name}: the other skill it points at exists`, () => {
    for (const m of skill.text.matchAll(/\*\*([a-z][a-z-]+)\*\* skill/g)) assert.ok(names.includes(m[1]), m[1]);
  });
}

test("the launch command runs the launcher with node and hands it the three folders, in order", () => {
  const command = launch.text.split("\n").find((l) => l.includes("launch-studio"));
  assert.equal(command.trim(), 'node "${CLAUDE_PLUGIN_ROOT}/scripts/launch-studio.mjs" "${CLAUDE_PLUGIN_ROOT}" "$STUDIO_ROOT" "${CLAUDE_PLUGIN_DATA}"');
  const block = launch.text.slice(launch.text.indexOf("```bash"), launch.text.indexOf("```", launch.text.indexOf("```bash") + 7));
  assert.match(block, /STUDIO_ROOT="\$\{CLAUDE_PROJECT_DIR:-\$HOME\}\/\.claude\/workflow-studio"/, "the studio root is the project's, or the home's outside a project");
  assert.match(block, /WORKFLOW_EXPORT_ROOT="\$\{CLAUDE_PROJECT_DIR:-\$HOME\}" \\\n/, "Publish is confined to the same folder");
});

test("what the skill promises about a missing prerequisite is what the launcher prints", () => {
  const source = fs.readFileSync(path.join(PLUGIN, "scripts", "launch-studio.mjs"), "utf8");
  assert.match(launch.text, /`npm` is missing or Node is older\s+than 20/);
  assert.match(source, /'npm' was not found on PATH/);
  assert.match(source, /needs Node 20\+/);
  assert.match(launch.text, /https:\/\/nodejs\.org\//);
});

test("the plugin ships no shell script outside the bundled app, and no document names one", () => {
  const files = fs.readdirSync(PLUGIN, { recursive: true }).map(String).map((f) => f.split(path.sep).join("/")).filter((f) => !f.startsWith("app/"));
  assert.deepEqual(files.filter((f) => /\.(py|pyc|sh|bash)$/.test(f)), []);
  for (const file of files.filter((f) => f.endsWith(".md") && f !== "CHANGELOG.md")) {
    assert.doesNotMatch(fs.readFileSync(path.join(PLUGIN, file), "utf8"), /launch-studio\.sh|\bbash "|\bpython3?\b/, file);
  }
});
