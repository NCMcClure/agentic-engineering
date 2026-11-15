// The parts door-plugin.mjs moves a plugin with, each on its own: the data an
// area starts from, a route's frontmatter, the plugin-root paths a route names
// from its own file, and the pass that rewrites addresses. The move itself is
// area-plugin.test.mjs. The plugins below are a fixture's, which no catalog
// here carries, so their addresses are not addresses to this checkout's own
// validate.
// door-plugin: leave
// (The line above keeps the script from rewriting this file's own strings.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { declaration, placeRootPaths, rewriteAddresses, rewriteLine, scaffold, unflip } from "../../door-plugin.mjs";
import { addressFinder, namedDirs, namedPaths } from "../../lib.mjs";
import { tempDir, write } from "./helpers.mjs";

const ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";
const TEMPLATE = "plugins/agentic-teamwork/templates/common/.agents/AGENTS.md";
const skill = (name, extra = "") => `---\nname: ${name}\ndescription: "Does ${name}. Use when ${name} is wanted."\n${extra}---\n\n# ${name}\n`;
const body = (...lines) => `---\nname: x\ndescription: "X."\n---\n\n# x\n\n${lines.join("\n")}\n`;

// ---- the area's data -------------------------------------------------------

test("a plugin with no data gets every skill as a route, in directory order, each blank a person's to fill", (t) => {
  const dir = tempDir(t, "door-parts-");
  for (const name of ["gamma", "alpha", "beta"]) write(dir, `plugins/demo/skills/${name}/SKILL.md`, skill(name));
  write(dir, "plugins/demo/skills/notes/README.md", "No SKILL.md, so no skill.\n");
  assert.deepEqual(scaffold(dir, "demo"), { lead: "", default: "", routes: { alpha: { cue: "" }, beta: { cue: "" }, gamma: { cue: "" } } });
});

test("a skill that was out of the listing is scaffolded as the person's to start, since a route carries no such key", (t) => {
  const dir = tempDir(t, "door-parts-");
  write(dir, "plugins/demo/skills/alpha/SKILL.md", skill("alpha"));
  write(dir, "plugins/demo/skills/beta/SKILL.md", skill("beta", "disable-model-invocation: true\n"));
  assert.deepEqual(scaffold(dir, "demo").routes, { alpha: { cue: "" }, beta: { cue: "", starts: "person" } });
});

test("the skill named after the plugin is the area's own text, and one that leaves for another area is that area's: neither is a route", (t) => {
  const dir = tempDir(t, "door-parts-");
  // Built, never written out: this checkout's catalog lists the plugin.
  const WB = ["plugin", "workbench"].join("-"), LENS = ["context", "lens"].join("-");
  for (const name of [WB, LENS, "make"]) write(dir, `plugins/${WB}/skills/${name}/SKILL.md`, skill(name));
  assert.deepEqual(Object.keys(scaffold(dir, WB).routes), ["make"]);
});

test("a route loses the key that kept a skill out of the listing, and nothing else of its frontmatter", () => {
  assert.equal(unflip(skill("alpha", "disable-model-invocation: true\nargument-hint: \"<card>\"\n")), skill("alpha", "argument-hint: \"<card>\"\n"));
  assert.equal(unflip(skill("alpha")), skill("alpha"));
  // The key in the body is prose, and a file with no frontmatter has none to lose.
  const prose = "# x\n\ndisable-model-invocation: true is what kept it out.\n";
  assert.equal(unflip(prose), prose);
  assert.equal(unflip(`${skill("alpha")}\ndisable-model-invocation: true\n`), `${skill("alpha")}\ndisable-model-invocation: true\n`);
});

// ---- the paths -------------------------------------------------------------

test("a token in a command becomes a quoted path under the named directory, quoted before or not, and the root alone its letter", () => {
  const out = placeRootPaths(body(
    "```bash",
    `node "${ROOT_VAR}/scripts/run.mjs" --json`,
    `node ${ROOT_VAR}/scripts/run.mjs --again`,
    `cd ${ROOT_VAR} && node "${ROOT_VAR}/scripts/run.mjs" --root "${ROOT_VAR}"`,
    "```",
    `Run \`ls ${ROOT_VAR}\` first.`,
  ));
  assert.match(out.text, /^node "W\/scripts\/run\.mjs" --json$/m);
  assert.match(out.text, /^node "W\/scripts\/run\.mjs" --again$/m);
  assert.match(out.text, /^cd "W" && node "W\/scripts\/run\.mjs" --root "W"$/m);
  assert.match(out.text, /^Run `ls "W"` first\.$/m);
  assert.equal(out.placed, 6);
  assert.deepEqual(out.left, []);
});

test("a token in prose becomes a code span of its own, and a sentence's full stop stays outside it", () => {
  const out = placeRootPaths(body(`The rules are in \`${ROOT_VAR}/references/guide.md\`, and the long form is ${ROOT_VAR}/references/guide.md. Run \`node ${ROOT_VAR}/scripts/run.mjs\` when unsure.`));
  assert.match(out.text, /^The rules are in `W\/references\/guide\.md`, and the long form is `W\/references\/guide\.md`\. Run `node "W\/scripts\/run\.mjs"` when unsure\.$/m);
  assert.equal(out.text.includes(ROOT_VAR), false);
});

test("the named directory is declared once, below the heading, in the sentence validate reads, and every path written is quoted", () => {
  const out = placeRootPaths(body("Scan first:", "", "```bash", `node "${ROOT_VAR}/scripts/run.mjs" --json`, "```", `Then read \`${ROOT_VAR}/references/guide.md\`.`), { what: "the area's own directory" });
  assert.deepEqual(namedDirs(out.text), [{ name: "W", rel: "../.." }]);
  assert.match(out.text, /^# x\n\n`W` below is `\.\.\/\.\.` from the directory this file is in: the area's own directory\. .*\n\nScan first:$/m);
  const written = out.text.split("\n").flatMap((line) => namedPaths(line, ["W"]));
  assert.equal(written.length, 2);
  assert.deepEqual(written.filter((p) => !p.quoted), []);
});

test("the tokens that cannot be placed: single-quoted, run into a longer word, and the variable named in prose", () => {
  const text = body(
    `Run \`node '${ROOT_VAR}/scripts/run.mjs'\`.`,
    `The cache is ${ROOT_VAR}-cache, and file://${ROOT_VAR}/x is a URL.`,
    `The string "${ROOT_VAR}" is filled in by the host, and so is ${ROOT_VAR} alone.`,
    `Then \`${ROOT_VAR}/scripts/run.mjs\` runs.`,
  );
  const out = placeRootPaths(text);
  assert.equal(out.placed, 1);
  assert.deepEqual(out.left.map((l) => l.line), [10, 11, 11, 12, 12]);
  assert.match(out.text, /^Run `node '\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/run\.mjs'`\.$/m);
  assert.match(out.text, /^Then `W\/scripts\/run\.mjs` runs\.$/m);
  // The declaration went in above them, and each line number is the file's as written.
  const lines = out.text.split("\n");
  for (const l of out.left) assert.ok(lines[l.line - 1].includes(ROOT_VAR), `line ${l.line}`);
});

// A token inside a double-quoted string, anywhere but right after its opening
// quote, cannot be quoted without closing that string, and an unquoted glob
// stops expanding once it is quoted. Neither has a form validate accepts and a
// shell still runs, so each is left.
test("a token inside a quoted string, and an unquoted glob, in a command is left and reported", () => {
  const text = body(
    "```json",
    `{ "command": "node ${ROOT_VAR}/hooks/stop.mjs --flag" }`,
    "```",
    "```bash",
    `cp ${ROOT_VAR}/assets/* ./out/`,
    `echo "done"${ROOT_VAR}/scripts/run.mjs`,
    "```",
    `Or \`sh -c "node ${ROOT_VAR}/scripts/run.mjs"\` and \`ls ${ROOT_VAR}/skills/*/SKILL.md\`.`,
  );
  const out = placeRootPaths(text);
  assert.equal(out.placed, 0);
  assert.equal(out.text, text, "nothing placed, so nothing declared and nothing changed");
  assert.deepEqual(out.left.map((l) => l.line), [9, 12, 13, 15, 15]);
  assert.match(out.left[0].why, /inside a double-quoted string/);
  assert.match(out.left[1].why, /glob/);
  assert.match(out.left[2].why, /runs on from a quoted string/);
  assert.match(out.left[3].why, /inside a double-quoted string/);
  assert.match(out.left[4].why, /glob/);
});

test("a path after an escaped quote, a quoted glob, and a glob in prose keep the quoting their author gave them", () => {
  const out = placeRootPaths(body(
    "```json",
    `{ "command": "node \\"${ROOT_VAR}/hooks/stop.mjs\\" --flag" }`,
    "```",
    "```bash",
    `ls "${ROOT_VAR}/assets/*"`,
    "```",
    `Every route is ${ROOT_VAR}/skills/*/SKILL.md, and one is \`${ROOT_VAR}/skills/<route>/SKILL.md\`.`,
  ));
  assert.match(out.text, /^\{ "command": "node \\"W\/hooks\/stop\.mjs\\" --flag" \}$/m);
  assert.match(out.text, /^ls "W\/assets\/\*"$/m);
  assert.match(out.text, /^Every route is `W\/skills\/\*\/SKILL\.md`, and one is `W\/skills\/<route>\/SKILL\.md`\.$/m);
  assert.equal(out.placed, 4);
  assert.deepEqual(out.left, []);
});

// The declaration goes below the heading, so a token above that line would
// name a letter nothing has declared yet: in the frontmatter, between it and
// the heading, and on the heading's own line.
test("a token above where the directory is declared is left: the frontmatter, the lines before the heading, and the heading", () => {
  const text = `---\nname: x\ndescription: "Runs ${ROOT_VAR}/scripts/run.mjs for you."\n---\n\nSee \`${ROOT_VAR}/references/guide.md\` first.\n\n# x at \`${ROOT_VAR}/scripts/run.mjs\`\n\nRun \`node "${ROOT_VAR}/scripts/run.mjs"\`.\n`;
  const out = placeRootPaths(text);
  assert.equal(out.placed, 1);
  assert.deepEqual(out.left.map((l) => l.line), [3, 6, 8]);
  for (const l of out.left) assert.match(l.why, /above where the directory is declared/);
  const lines = out.text.split("\n");
  assert.equal(lines[2], `description: "Runs ${ROOT_VAR}/scripts/run.mjs for you."`);
  assert.equal(lines[9], declaration("W"));
  assert.equal(lines[11], 'Run `node "W/scripts/run.mjs"`.');
});

test("a token above a declaration the file already has is left too, and one on or below that line is placed", () => {
  const out = placeRootPaths(body(
    `Start at \`${ROOT_VAR}/references/guide.md\`.`,
    "",
    `\`P\` below is \`../..\` from the directory this file is in. The scan is \`node "${ROOT_VAR}/scripts/run.mjs"\`.`,
    "",
    `Then read \`${ROOT_VAR}/references/guide.md\`.`,
  ));
  assert.equal(out.placed, 2);
  assert.deepEqual(out.left.map((l) => l.line), [8]);
  assert.match(out.text, /^Start at `\$\{CLAUDE_PLUGIN_ROOT\}\/references\/guide\.md`\.$/m);
  assert.match(out.text, /The scan is `node "P\/scripts\/run\.mjs"`\.$/m);
  assert.match(out.text, /^Then read `P\/references\/guide\.md`\.$/m);
});

test("the letter is one the file does not already use, and a directory it already declares is reused", () => {
  const taken = placeRootPaths(body("`W` below is the wide run, and `R` the reference.", `Read \`${ROOT_VAR}/references/guide.md\`.`));
  assert.deepEqual(namedDirs(taken.text), [{ name: "D", rel: "../.." }]);
  assert.match(taken.text, /^Read `D\/references\/guide\.md`\.$/m);

  const declared = body("`P` below is `../..` from the directory this file is in: the plugin.", `Run \`node "${ROOT_VAR}/scripts/run.mjs"\`.`);
  const reused = placeRootPaths(declared);
  assert.deepEqual(namedDirs(reused.text), [{ name: "P", rel: "../.." }]);
  assert.match(reused.text, /^Run `node "P\/scripts\/run\.mjs"`\.$/m);
  assert.equal(reused.text.split("\n").length, declared.split("\n").length);
});

test("a file with no heading gets its declaration below the frontmatter", () => {
  const out = placeRootPaths(`---\nname: x\ndescription: "X."\n---\nRead \`${ROOT_VAR}/references/guide.md\`.\n`);
  assert.equal(out.text, `---\nname: x\ndescription: "X."\n---\n\n${declaration("W")}\n\nRead \`W/references/guide.md\`.\n`);
});

test("a full stop is part of a path that exists with it, and the end of the sentence when it does not", () => {
  const out = placeRootPaths(body(`Read ${ROOT_VAR}/notes.v2. Then read ${ROOT_VAR}/notes.`), { exists: (p) => p === "notes.v2" || p === "notes" });
  assert.match(out.text, /^Read `W\/notes\.v2`\. Then read `W\/notes`\.$/m);
});

// ---- the addresses ---------------------------------------------------------

const find = addressFinder(["demo", "other"]);
// A skill of the plugin becomes a route of its area, and the skill named
// after the plugin the area itself: what the move writes.
const moved = (a) => (a.plugin !== "demo" ? null : a.name === "demo" ? "/single:demo" : `/single:demo ${a.name}`);

test("one line: each address with an answer is replaced and what followed kept, with the slash, bare, in a code span, and twice on a line", () => {
  const line = (text) => rewriteLine(text, find, moved);
  assert.deepEqual(line("With the slash: /demo:alpha. Bare: demo:alpha starts a card."), { line: "With the slash: /single:demo alpha. Bare: /single:demo alpha starts a card.", count: 2 });
  assert.deepEqual(line("With arguments: `/demo:alpha 0042 --now`, then /demo:beta; and /other:delta stays."), { line: "With arguments: `/single:demo alpha 0042 --now`, then /single:demo beta; and /other:delta stays.", count: 2 });
  assert.deepEqual(line("A path is left alone: plugins/demo:alpha."), { line: "A path is left alone: plugins/demo:alpha.", count: 0 });
});

test("the pass sorts the files by what each is: markdown and JSON rewritten, code for a hand, a template copy staying, history and recordings counted", () => {
  const texts = {
    "docs/a.md": "Start with `/demo:alpha 0042`, or ask /other:delta first.\n",
    "plugins/demo/hooks/critical.json": "{ \"text\": \"Ship with /demo:beta.\" }\n",
    "plugins/demo/lib/run.mjs": "run({ command: \"demo:alpha\", args: \"0042\" });\n",
    "plugins/demo/CHANGELOG.md": "- 0.2.0: /demo:alpha added.\n",
    [TEMPLATE]: "Run `/demo:alpha`.\n",
    "scripts/test-hooks/live/baseline.json": "{ \"skill\": \"demo:alpha\" }\n",
    "docs/notes.txt": "see /demo:alpha\n",
    "docs/skip.md": "Never read: /demo:alpha.\n",
  };
  const pass = rewriteAddresses({ files: Object.keys(texts), read: (file) => (file === "docs/skip.md" ? null : texts[file]), find, to: moved });
  assert.deepEqual(Object.fromEntries(pass.edits), {
    "docs/a.md": "Start with `/single:demo alpha 0042`, or ask /other:delta first.\n",
    "plugins/demo/hooks/critical.json": "{ \"text\": \"Ship with /single:demo beta.\" }\n",
  });
  assert.equal(pass.rewritten, 2);
  assert.deepEqual(pass.files, [{ file: "docs/a.md", count: 1 }, { file: "plugins/demo/hooks/critical.json", count: 1 }]);
  assert.deepEqual(pass.hand.map((h) => `${h.file}:${h.line}: ${h.text} -> ${h.becomes}`), ["docs/notes.txt:1: /demo:alpha -> /single:demo alpha", "plugins/demo/lib/run.mjs:1: demo:alpha -> /single:demo alpha"]);
  assert.match(pass.hand[0].why, /neither markdown nor JSON/);
  assert.match(pass.hand[1].why, /^code: /);
  assert.deepEqual(pass.stay.map((h) => `${h.file}:${h.line}: ${h.text}`), [`${TEMPLATE}:1: /demo:alpha`]);
  assert.deepEqual(pass.left, { history: 1, recordings: 1 });
});

test("a file that says its strings are fixtures is rewritten by no pass, whatever it is, and each address in it is listed", () => {
  const texts = { "docs/fixtures.md": "<!--\n// door-plugin: leave\n-->\nRun /demo:alpha.\n" };
  const pass = rewriteAddresses({ files: Object.keys(texts), read: (file) => texts[file], find, to: moved });
  assert.equal(pass.edits.size, 0);
  assert.deepEqual(pass.hand.map((h) => [h.file, h.line, h.text]), [["docs/fixtures.md", 4, "/demo:alpha"]]);
  assert.match(pass.hand[0].why, /fixtures/);
});

test("the pass judges a file by the name it is given, and says which kinds it rewrites", () => {
  const texts = { "plugins/demo/README.md": "Run /demo:alpha.\n", "plugins/demo/lib/run.mjs": "// then /demo:beta\n" };
  const pass = rewriteAddresses({
    files: Object.keys(texts), read: (file) => texts[file], find, to: moved,
    rewrites: (kind) => kind === "rewrite" || kind === "code",
    name: (file) => file.replace("plugins/demo/", "plugins/single/skills/demo/"),
  });
  assert.deepEqual([...pass.edits.keys()], ["plugins/demo/README.md", "plugins/demo/lib/run.mjs"]);
  assert.deepEqual(pass.files.map((f) => f.file), ["plugins/single/skills/demo/README.md", "plugins/single/skills/demo/lib/run.mjs"]);
  assert.deepEqual(pass.hand, []);
});
