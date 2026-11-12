// Every skill of agent-works, read as the model reads it: a description that
// says when, the four frontmatter keys and no more, and nothing in the body
// that is not there to be run. A skill that names a file the plugin does not
// ship, or a command the dispatcher does not know, sends an agent down a dead
// end at the moment it most needs the instruction to be right.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agent-works");
const SKILLS = path.join(PLUGIN, "skills");
const EXPECTED = [
  "agent-works", "board", "coordinate", "decisions", "dispatch", "doctor", "guard", "hubs", "memory", "orchestrate", "resource-locks", "review-card",
  "setup", "sync-cards", "work-card",
];
const KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];
const CALL = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs"';

const { MODULES } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "aw.mjs")).href);
const COMMANDS = new Set(MODULES.flatMap((m) => m.commands));

function frontmatter(text) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(block, "no frontmatter");
  const fields = {};
  for (const line of block[1].split("\n")) {
    const m = /^([a-z-]+):\s*(.*)$/.exec(line);
    assert.ok(m, `not a one-line key: ${line}`);
    fields[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return { fields, body: text.slice(block[0].length) };
}
const skills = fs.readdirSync(SKILLS).sort().map((name) => {
  const text = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  return { name, text, ...frontmatter(text) };
});
/** The code of a skill: its fenced blocks and its code spans. */
const code = (body) => [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g), ...body.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
/** Each `aw <command> [<word>]` a piece of code runs, whichever way `aw` is spelled. */
const calls = (text) => [...text.matchAll(/(?:^|[\s(|;&])(?:aw|node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/aw\.mjs")\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/gm)].map((m) => ({ command: m[1], action: m[2] ?? null }));

test("agent-works skills: the set is the board's and the loop's skills, the homes' skills, and the router", () => {
  assert.deepEqual(skills.map((s) => s.name), EXPECTED);
});

for (const skill of skills) {
  test(`agent-works skills: ${skill.name} has a matching name, the four keys only, and a description that says when`, () => {
    assert.equal(skill.fields.name, skill.name);
    for (const key of Object.keys(skill.fields)) assert.ok(KEYS.includes(key), `frontmatter key "${key}"`);
    const description = skill.fields.description ?? "";
    assert.match(description, /^(Use (when|for|before|to)|Run to) /, description);
    assert.ok(description.length <= 300, `${description.length} characters`);
    assert.match(skill.body, new RegExp(`^# ${skill.name}$`, "m"));
  });

  test(`agent-works skills: every plugin path ${skill.name} names is shipped`, () => {
    const named = [...skill.text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]*[A-Za-z0-9_/-])/g)].map((m) => m[1]);
    for (const rel of new Set(named)) assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `${rel} is not in the plugin`);
    for (const m of skill.text.matchAll(/\]\((?!https?:)([^)#]+)\)/g)) assert.ok(fs.existsSync(path.join(SKILLS, skill.name, m[1])), `link ${m[1]}`);
  });

  test(`agent-works skills: every aw command ${skill.name} names is one the dispatcher knows, called by its path`, () => {
    const found = code(skill.body).flatMap(calls);
    for (const { command } of found) assert.ok(COMMANDS.has(command), `aw ${command}`);
    assert.ok(!found.some((c) => c.command === "kanban"), "the board's command is `aw board`");
    if (found.length) assert.ok(skill.body.includes(CALL), `names aw and never says how to call it: ${CALL}`);
  });
}

test("agent-works skills: every board action a skill names is one `aw board` has", () => {
  const help = runNode(path.join(PLUGIN, "scripts", "aw.mjs"), ["board", "--help"]).stdout;
  const known = new Set([...help.matchAll(/(?:^ {2}|\s{3,}|\| )([a-z]+)(?= |$)/gm)].map((m) => m[1]));
  for (const action of ["list", "show", "status", "ready", "epics", "lint", "add", "epic", "edit", "move", "reorder", "plan", "note", "owe", "settle", "sprint", "config", "remote", "propose", "grant", "brief", "bind", "claim", "done", "abandon", "wait", "evidence"]) {
    assert.ok(known.has(action), `the help no longer lists ${action}`);
  }
  for (const skill of skills) {
    for (const { command, action } of code(skill.body).flatMap(calls)) {
      if (command === "board" && action) assert.ok(known.has(action), `${skill.name}: aw board ${action}`);
    }
  }
});

test("agent-works skills: nothing points at what 1.0 took away", () => {
  for (const { name, text } of skills) {
    assert.doesNotMatch(text, /core\/references|\bcli\/|\.py\b|python|kanban-cards|board\.mjs|lock\.mjs/, name);
    assert.doesNotMatch(text, /—/, `${name}: an em-dash`);
    // A gate is closed by its evidence, never by a move.
    assert.doesNotMatch(text, /board move \S+ done\b.*gate|gate.*board move \S+ done\b/, name);
  }
});

test("agent-works skills: a command under a lock or a lease is a program with arguments, a shell line wrapped", () => {
  for (const { name, body } of skills) {
    for (const piece of code(body)) {
      for (const m of piece.matchAll(/\b(?:lock run|lease)\b[^\n]*? -- (\S+)/g)) assert.doesNotMatch(m[1], /^["']/, `${name}: ${m[0]}`);
    }
  }
  const wrapped = skills.filter((s) => /-- bash -c "/.test(s.body)).map((s) => s.name);
  assert.deepEqual(wrapped, ["coordinate", "resource-locks"]);
});

test("agent-works skills: only setup is the person's to start, and nobody sends the model to it as a skill of its own", () => {
  assert.deepEqual(skills.filter((s) => s.fields["disable-model-invocation"] !== undefined).map((s) => [s.name, s.fields["disable-model-invocation"]]), [["setup", "true"]]);
  for (const { name, text } of skills) {
    if (name === "setup") continue;
    assert.doesNotMatch(text, /`setup` skill/, name);
    for (const m of text.matchAll(/[^.\n]*\/agent-works:setup[^.\n]*/g)) assert.match(m[0], /ask (the person|them) to run/, `${name}: ${m[0]}`);
  }
});

test("agent-works skills: the skills that fan out say what to do where the host cannot", () => {
  const fallback = "${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/references/subagent-fallback.md";
  for (const name of ["orchestrate", "dispatch", "sync-cards"]) assert.ok(skills.find((s) => s.name === name).text.includes(fallback), name);
  const text = fs.readFileSync(path.join(SKILLS, "orchestrate", "references", "subagent-fallback.md"), "utf8");
  for (const head of ["## No child sessions", "## No Workflow tool", "## No second reader"]) assert.ok(text.includes(head), head);
  assert.match(skills.find((s) => s.name === "sync-cards").text, /skills\/sync-cards\/workflows\/sync\.js/);
});

test("agent-works skills: the listing stays small", () => {
  const listed = skills.filter((s) => s.fields["disable-model-invocation"] !== "true");
  const total = listed.reduce((n, s) => n + s.fields.description.length, 0);
  assert.ok(total <= 2400, `${total} characters of description across ${listed.length} listed skills`);
});

test("agent-works skills: the templates a card is written from name the section the board reads", () => {
  const templates = path.join(PLUGIN, "assets", "templates");
  for (const file of ["card.md", "epic-card.md"]) assert.match(fs.readFileSync(path.join(templates, file), "utf8"), /^## Done when$/m, file);
  for (const file of fs.readdirSync(templates)) assert.doesNotMatch(fs.readFileSync(path.join(templates, file), "utf8"), /aw kanban|Done looks like|core\/references/, file);
});
