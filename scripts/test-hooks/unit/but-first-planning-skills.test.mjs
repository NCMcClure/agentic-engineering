// but-first-planning's skills, read as an agent's listing reads them: a name
// that matches its folder, a description that says when to reach for it and
// stays short (eighteen of them share one listing), the four frontmatter keys
// and no others, and no path, link, script or skill named in a body that does
// not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "but-first-planning");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];
const EXPECTED = [
  "autopilot", "build-assess-drift", "build-audit", "build-improve-architecture", "build-next-issue", "build-rubber-duck",
  "build-sprint", "build-tdd", "build-user-docs", "grill", "plan-decompose", "plan-publish", "spec-architect", "spec-edit",
  "spec-grill", "spec-init", "spec-open", "spec-write",
];
// Started by a person: a one-time setup, a local server, and the two runs big enough to be a decision.
const BY_HAND = ["autopilot", "build-audit", "spec-init", "spec-open"];
// Skills of other plugins a file may point at, and only as something optional.
const ELSEWHERE = ["agentic-teamwork:tdd", "agentic-teamwork:init-project", "code-diet:ladder", "docs-parity:docs-sync", "docs-parity:docs-shots", "docs-parity:docs-init"];
const OTHER_PLUGINS = ["agentic-teamwork", "agent-works", "code-diet", "docs-parity", "perceptual-loop"];
const DESCRIPTION_MAX = 300;
// What the same eighteen-skill listing may cost in total.
const LISTING_MAX = 3200;

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const file = path.join(SKILLS, name, "SKILL.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { name, dir: path.join(SKILLS, name), text, frontmatter: parseFrontmatter(text), body: text.replace(/^---\n[\s\S]*?\n---\n/, "") };
});
/** Every text file the plugin's skills and references ship, as { rel, dir, text }. */
const docs = [SKILLS, path.join(PLUGIN, "references")].flatMap((root) => fs.readdirSync(root, { recursive: true }).map(String)
  .filter((f) => /\.(md|js)$/.test(f) && !f.includes(`assets${path.sep}`))
  .map((f) => ({ rel: path.relative(PLUGIN, path.join(root, f)).split(path.sep).join("/"), dir: path.dirname(path.join(root, f)), text: fs.readFileSync(path.join(root, f), "utf8") })))
  .concat([{ rel: "WORKFLOWS.md", dir: PLUGIN, text: fs.readFileSync(path.join(PLUGIN, "WORKFLOWS.md"), "utf8") }]);

test("the plugin ships exactly its eighteen skills", () => {
  assert.deepEqual(names, EXPECTED);
});

for (const skill of skills) {
  test(`${skill.name}: the frontmatter names the skill and carries only the allowed keys`, () => {
    assert.ok(skill.frontmatter, "SKILL.md starts with a frontmatter block");
    assert.equal(skill.frontmatter.name, skill.name, "the name is the folder's");
    for (const key of Object.keys(skill.frontmatter)) assert.ok(ALLOWED_KEYS.includes(key), `frontmatter key "${key}"`);
    assert.equal(skill.frontmatter["disable-model-invocation"] === "true", BY_HAND.includes(skill.name), "started by hand, or picked by the model");
  });

  test(`${skill.name}: the description says when to trigger, in few enough characters`, () => {
    const description = skill.frontmatter?.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this skill from its neighbours");
    assert.ok(description.length <= DESCRIPTION_MAX, `${description.length} characters: a listing pays for every one`);
    assert.match(description, /\b(Use|Run) (when|once|after|before|for)\b/, "it says when to use it, not only what it is");
    assert.doesNotMatch(description, /\b(phase|step \d)\b/i, "a position in a sequence is not a reason to pick a skill");
  });

  test(`${skill.name}: every plugin path it names exists`, () => {
    for (const m of skill.text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `\${CLAUDE_PLUGIN_ROOT}/${m[1]}`);
    }
    // A plugin script is run through the plugin root, never by a bare or relative path.
    for (const m of skill.body.matchAll(/^.*\bnode\s+([^\s`]*(?:scaffold|spec-open|install)\.mjs[^\s`]*).*$/gm)) {
      assert.match(m[1], /^"\$\{CLAUDE_PLUGIN_ROOT\}\/[a-z/-]+\.mjs"$/, m[0].trim());
    }
  });
}

test("the model-invoked descriptions fit the listing budget", () => {
  const listed = skills.filter((s) => !BY_HAND.includes(s.name));
  const total = listed.reduce((n, s) => n + s.frontmatter.description.length, 0);
  assert.ok(total <= LISTING_MAX, `${total} characters across ${listed.length} descriptions`);
});

test("every relative link in a skill, a reference or WORKFLOWS.md resolves", () => {
  for (const doc of docs.filter((d) => d.rel.endsWith(".md"))) {
    // Fenced blocks and double-backtick spans hold templates for a project's own files, whose links are not this plugin's.
    const prose = doc.text.replace(/^\s*```[\s\S]*?^\s*```/gm, "").replace(/``[^\n]*?``/g, "");
    for (const m of prose.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/.test(target) || target.startsWith("<") || target.includes("{{")) continue;
      // A placeholder path in running text (`[title](./NN_issue_OTHER.md)`), not a link to follow.
      if (/NN_|NN-|<|EE-SS/.test(target) || !/[./]/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(doc.dir, target)), `${doc.rel}: ${target}`);
    }
  }
});

test("every workspace script a file tells an agent to run is one the scaffold copies", () => {
  const scaffolded = new Set(["plan/plan-status.mjs", "plan/publish-issues.mjs", "plan/verify-plan-tree.mjs", "spec/scripts/verify-spec-tree.mjs", "spec/scripts/comments-server.py", "progress/drift-status.mjs"]);
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\.agents\/plan\/((?:plan|spec\/scripts|progress)\/[a-z-]+\.(?:mjs|py))\b/g)) {
      assert.ok(scaffolded.has(m[1]), `${doc.rel}: .agents/plan/${m[1]}`);
    }
  }
});

test("no file names a skill or a script by a name it no longer has", () => {
  const gone = /\b(spec-0-init|spec-1-specify|spec-2-grill|spec-3-architect|spec-4-edit|plan-0-decompose|plan-1-publish-issues|plan-publish-issues)\b|\b(plan-status|verify-plan-tree|verify-spec-tree|publish-issues|drift-status|plan-gate|verify-agents-tree)\.py\b|spec-open\.sh|install\.sh/;
  for (const doc of docs) assert.doesNotMatch(doc.text, gone, doc.rel);
});

test("a skill of this plugin named anywhere exists, and one named as a slash command to a model can be invoked by it", () => {
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\/but-first-planning:([a-z-]+)/g)) {
      assert.ok(names.includes(m[1]), `${doc.rel}: /but-first-planning:${m[1]}`);
      if (!BY_HAND.includes(m[1])) continue;
      const line = doc.text.split("\n").find((l) => l.includes(m[0])) ?? "";
      const around = doc.text.slice(Math.max(0, doc.text.indexOf(m[0]) - 160), doc.text.indexOf(m[0]) + 80);
      assert.match(around, /ask the person to run|the person runs it|give them|the user/i, `${doc.rel}: ${line.trim()}`);
    }
  }
});

test("another plugin is only ever named as optional, and only by a skill that exists there", () => {
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/\/([a-z-]+):([a-z-]+)/g)) {
      if (m[1] === "but-first-planning" || !OTHER_PLUGINS.includes(m[1])) continue;
      assert.ok(ELSEWHERE.includes(`${m[1]}:${m[2]}`), `${doc.rel}: /${m[1]}:${m[2]}`);
    }
    const paragraphs = doc.text.split(/\n\s*\n/);
    for (const plugin of OTHER_PLUGINS) {
      for (const p of paragraphs.filter((x) => x.includes(plugin))) {
        assert.match(p, /\b(if|when|where|with|without|only if)\b[^.]*\b(installed|available|adopted)\b|is installed|plugin's|not this plugin's|optional/i, `${doc.rel} names ${plugin} as if it were always there: ${p.slice(0, 140).replace(/\s+/g, " ")}`);
      }
    }
  }
});

test("the ten bundled workflow scripts parse, and each is one a skill points at", () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const scripts = names.flatMap((n) => (fs.existsSync(path.join(SKILLS, n, "workflows")) ? fs.readdirSync(path.join(SKILLS, n, "workflows")).map((f) => `${n}/workflows/${f}`) : []));
  assert.equal(scripts.length, 10);
  const inventory = fs.readFileSync(path.join(PLUGIN, "WORKFLOWS.md"), "utf8");
  for (const rel of scripts) {
    // A workflow script is the body of an async function the Workflow tool supplies, with one export for its metadata.
    const source = fs.readFileSync(path.join(SKILLS, rel), "utf8").replace(/^export const meta\b/m, "const meta");
    assert.doesNotThrow(() => new AsyncFunction(source), rel);
    const skill = rel.split("/")[0];
    assert.ok(fs.readFileSync(path.join(SKILLS, skill, "SKILL.md"), "utf8").includes(`\${CLAUDE_PLUGIN_ROOT}/skills/${rel}`), `${skill}/SKILL.md does not point at ${rel}`);
    assert.ok(inventory.includes(`\`${rel}\``), `WORKFLOWS.md does not list ${rel}`);
  }
});

test("build-tdd carries the loop for a repo without agentic-teamwork, and no references of its own", () => {
  const tdd = skills.find((s) => s.name === "build-tdd");
  assert.match(tdd.body, /If agentic-teamwork is installed, the loop is its `tdd` skill/);
  assert.match(tdd.body, /If it is not, this is the loop/);
  for (const step of ["**Red.**", "**Green.**", "**Refactor.**"]) assert.ok(tdd.body.includes(step), step);
  assert.deepEqual(fs.readdirSync(tdd.dir), ["SKILL.md"]);
});

test("the docs checker is named as docs-parity's, and nothing runs it unconditionally", () => {
  for (const doc of docs.filter((d) => d.text.includes("docs-check"))) {
    for (const p of doc.text.split(/\n\s*\n|\\n/).filter((x) => x.includes("docs-check"))) {
      assert.match(p, /docs-parity/, `${doc.rel}: ${p.slice(0, 120).replace(/\s+/g, " ")}`);
      assert.match(p, /\b(if|when)\b/i, `${doc.rel}: the checker is optional`);
    }
  }
});
