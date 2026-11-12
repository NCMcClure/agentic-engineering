// marvelous-miro's skills, read as an agent's listing reads them: a name that
// matches its folder, a description that says when to reach for it, the four
// frontmatter keys and no others, and no path, script, flag, or skill named
// in a body that does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "marvelous-miro");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];
// Run by a person, once per machine or once per repo: never picked by the model on its own.
const BY_HAND = ["browser-setup", "diagrams-init"];

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const file = path.join(SKILLS, name, "SKILL.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { name, dir: path.join(SKILLS, name), text, frontmatter: parseFrontmatter(text), body: text.replace(/^---\n[\s\S]*?\n---\n/, "") };
});
/** Every Markdown file a skill ships: its SKILL.md and its references. */
const pages = (skill) => [path.join(skill.dir, "SKILL.md"), ...(fs.existsSync(path.join(skill.dir, "references"))
  ? fs.readdirSync(path.join(skill.dir, "references")).filter((f) => f.endsWith(".md")).map((f) => path.join(skill.dir, "references", f)) : [])];
/** The flags a script takes, read from its own source. */
const flagsOf = (script) => new Set([...fs.readFileSync(path.join(PLUGIN, script), "utf8").matchAll(/"(--[a-z][a-z-]*)"/g)].map((m) => m[1]));

test("the plugin ships exactly its four skills", () => {
  assert.deepEqual(names, ["browser-setup", "diagrams-init", "diagrams-sync", "miro-board"]);
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
    assert.match(description, /\bUse (it )?when\b/, "it says when to use it, not only what it is");
  });

  test(`${skill.name}: every path, reference, and script it names exists`, () => {
    for (const m of skill.text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `\${CLAUDE_PLUGIN_ROOT}/${m[1]}`);
    }
    for (const m of skill.text.matchAll(/\]\(((?:references|workflows|assets|scripts)\/[A-Za-z0-9_./-]+)\)/g)) {
      assert.ok(fs.existsSync(path.join(skill.dir, m[1])), `${skill.name} links ${m[1]}`);
    }
    // `S` stands for the skill's own scripts directory wherever a body uses it.
    for (const m of skill.body.matchAll(/\bnode S\/([a-z-]+\.mjs)/g)) {
      assert.ok(fs.existsSync(path.join(skill.dir, "scripts", m[1])), `${skill.name} runs S/${m[1]}`);
      assert.match(skill.body, /`S` below is `\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/[a-z-]+\/scripts`/, "S is defined before it is used");
    }
  });

  test(`${skill.name}: a path the host fills in appears only where the host fills it in`, () => {
    // The host substitutes the plugin root in a SKILL.md. A reference is read as a plain file, where it would stay a literal.
    for (const page of pages(skill).filter((p) => path.basename(p) !== "SKILL.md")) {
      assert.doesNotMatch(fs.readFileSync(page, "utf8"), /\$\{CLAUDE_PLUGIN_ROOT\}/, path.relative(PLUGIN, page));
    }
  });

  test(`${skill.name}: every flag it passes a script is one the script takes`, () => {
    const scripts = {
      "system-map.mjs": flagsOf("scripts/system-map.mjs"),
      "map-sweep.mjs": flagsOf("scripts/map-sweep.mjs"),
      "check-setup.mjs": flagsOf("skills/browser-setup/scripts/check-setup.mjs"),
      "build.mjs": flagsOf("skills/miro-board/scripts/build.mjs"),
      "init.mjs": flagsOf("skills/miro-board/scripts/init.mjs"),
      "pull.mjs": new Set([...flagsOf("skills/miro-board/scripts/pull.mjs"), ...flagsOf("skills/miro-board/scripts/project.mjs")]),
      "live.mjs": flagsOf("skills/miro-board/scripts/live.mjs"),
    };
    for (const [script, known] of Object.entries(scripts)) assert.ok(known.size >= 1, `${script} declares its flags`);
    const used = (line, name) => [...line.matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)].map((f) => [name, f[1]]);
    const passed = [];
    for (const page of pages(skill)) {
      const text = fs.readFileSync(page, "utf8");
      // A command in backticks or a code block that names the script, or the MAP and SWEEP shorthands for the two at the plugin root.
      for (const m of text.matchAll(/`([^`\n]*?(?<![\w-])([a-z-]+\.mjs)\b[^`\n]*)`/g)) if (scripts[m[2]]) passed.push(...used(m[1], m[2]));
      for (const m of text.matchAll(/^.*\bnode\s+\S*\/([a-z-]+\.mjs)\S*(.*)$/gm)) if (scripts[m[1]]) passed.push(...used(m[2], m[1]));
      for (const m of text.matchAll(/`MAP( [^`\n]*)`/g)) passed.push(...used(m[1], "system-map.mjs"));
      for (const m of text.matchAll(/`SWEEP( [^`\n]*)`/g)) passed.push(...used(m[1], "map-sweep.mjs"));
    }
    assert.ok(passed.length >= 2, "the skill's commands were found");
    for (const [script, flag] of passed) assert.ok(scripts[script].has(flag), `${script} has no ${flag}`);
  });

  test(`${skill.name}: every skill it points at is one the plugin ships, and a hand-run one is asked for`, () => {
    for (const page of pages(skill)) {
      const text = fs.readFileSync(page, "utf8");
      for (const m of text.matchAll(/(?<![\w/.-])\/([a-z][a-z-]*):([a-z][a-z-]*)\b/g)) {
        assert.equal(m[1], "marvelous-miro", `/${m[1]}:${m[2]} belongs to another plugin`);
        assert.ok(names.includes(m[2]), `/marvelous-miro:${m[2]}`);
      }
      // A skill only a person can run is never something the model is told to use or load.
      for (const hand of BY_HAND.filter((h) => h !== skill.name)) {
        assert.doesNotMatch(text, new RegExp(`\\b(use|run|load|invoke|follow) the ${hand} skill`, "i"), `${path.basename(page)} sends the model to ${hand}`);
      }
    }
  });

  test(`${skill.name}: nothing assumes whose Miro it is`, () => {
    for (const page of pages(skill)) {
      const text = fs.readFileSync(page, "utf8");
      assert.doesNotMatch(text, /parent_space_url\b.*\b[0-9A-Za-z]{20,}/, "a space id is baked in");
      assert.doesNotMatch(text, /\b\d{15,}\b/, "a Miro id is baked in");
      assert.doesNotMatch(text, /miro\.com\/app\/board\/[A-Za-z0-9]/, "a board URL is baked in");
    }
  });
}

test("the skills that touch a sign-in say whose it is", () => {
  for (const name of ["miro-board", "browser-setup"]) {
    const { body } = skills.find((s) => s.name === name);
    assert.match(body, /never type(s)? (a password|credentials)/i, `${name} says the agent types no credentials`);
  }
  const init = skills.find((s) => s.name === "diagrams-init").body;
  assert.match(init, /Ask the person which board/);
  assert.match(init, /on their yes call `board_create`/);
});

test("every file a skill tells a repo to copy is in the plugin, and the workflow it launches parses", () => {
  for (const asset of ["skills/diagrams-init/assets/system-map.json", "skills/diagrams-init/assets/gen-system.mjs", "skills/miro-board/assets/miro.config.mjs", "skills/miro-board/assets/gen-example.mjs", "skills/miro-board/assets/board-dump.js", "scripts/system-map.mjs"]) {
    assert.ok(fs.existsSync(path.join(PLUGIN, asset)), asset);
  }
  const workflow = fs.readFileSync(path.join(SKILLS, "diagrams-sync", "workflows", "sweep.js"), "utf8");
  const AsyncFunction = (async () => {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", "budget", workflow.replace(/^export const meta/m, "const meta")));
});
