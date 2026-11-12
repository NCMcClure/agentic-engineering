// docs-parity's readme-check.mjs: a README tells a person what a project is,
// why to use it, and how, in at most 800 words, in standard-readme's order,
// and never carries agent context. Each failing finding has a case that breaks
// exactly one thing in a README that otherwise passes; the warnings have
// theirs, and a case that they never change the exit code.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CONFIG, MANIFEST, PLUMBING, checkReadme, checkRepo, configFindings, oneLiner, optedIn, plumbingHits, readmeConfig, repoName } from "../../../plugins/docs-parity/scripts/readme-check.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const CHECK = path.join(REPO, "plugins", "docs-parity", "scripts", "readme-check.mjs");

const GOOD = [
  "# widget",
  "",
  "Turns raw sensor logs into tidy CSV files.",
  "",
  "Field teams export logs in three formats, and every analysis used to start with a hand-written parser. widget reads all three and writes one shape.",
  "",
  "## Install",
  "",
  "```bash",
  "npm install widget",
  "```",
  "",
  "## Usage",
  "",
  "`widget convert logs/ --out out.csv` reads every log under `logs/`.",
  "",
  "## Contributing",
  "",
  "Building, testing, and releasing are in CONTRIBUTING.md.",
  "",
].join("\n");

const check = (text, opts = {}) => checkReadme(text, { path: "README.md", name: "widget", ...opts });
const codes = (text, opts) => check(text, opts).findings.map((f) => f.finding);
const warns = (text, opts) => check(text, opts).warnings.map((w) => w.finding);
const swap = (from, to) => GOOD.replace(from, to);

test("a README in the skeleton passes with no findings and no warnings", () => {
  assert.deepEqual(check(GOOD), { findings: [], warnings: [] });
});

// ---- readme-length ----------------------------------------------------------

test("801 words is a readme-length finding, and 800 is not", () => {
  const words = GOOD.split(/\s+/).filter(Boolean).length;
  const pad = (n) => GOOD.replace("## Contributing", `${Array(n).fill("word").join(" ")}\n\n## Contributing`);
  assert.deepEqual(codes(pad(800 - words)), []);
  assert.deepEqual(codes(pad(801 - words)), ["readme-length"]);
});

test("words inside a fenced block count: a prompt pasted into a text block is still words", () => {
  const words = GOOD.split(/\s+/).filter(Boolean).length;
  const fenced = GOOD.replace("## Usage", `\`\`\`bash\n${Array(801 - words).fill("x").join(" ")}\n\`\`\`\n\n## Usage`);
  assert.deepEqual(codes(fenced), ["readme-length"]);
});

// ---- readme-title -----------------------------------------------------------

test("a title that is not the project name is a readme-title finding", () => {
  assert.deepEqual(codes(swap("# widget", "# Widget Tools")), ["readme-title"]);
});

test("a readable title followed by _(name)_ passes", () => {
  assert.deepEqual(codes(swap("# widget", "# Widget Tools _(widget)_")), []);
});

test("a first line that is not a single-hash heading is a readme-title finding", () => {
  // A `## ` line is a section, so the why and the order fail along with it.
  assert.ok(codes(swap("# widget", "## widget")).includes("readme-title"));
  assert.ok(codes(`widget\n\n${GOOD}`).includes("readme-title"));
});

// ---- readme-description -----------------------------------------------------

test("no one-liner after the title is a readme-description finding", () => {
  const twoLines = swap("Turns raw sensor logs into tidy CSV files.", "Turns raw sensor logs\ninto tidy CSV files.");
  assert.deepEqual(codes(twoLines), ["readme-description"]);
});

test("a one-liner over 120 characters is a readme-description finding", () => {
  assert.deepEqual(codes(swap("Turns raw sensor logs into tidy CSV files.", "x".repeat(121))), ["readme-description"]);
  assert.deepEqual(codes(swap("Turns raw sensor logs into tidy CSV files.", "x".repeat(120))), []);
});

test("a quote or a heading in the one-liner's place is a readme-description finding", () => {
  assert.ok(codes(swap("Turns raw", "> Turns raw")).includes("readme-description"));
  assert.ok(codes(swap("Turns raw", "### Turns raw")).includes("readme-description"));
});

test("badge lines may sit between the title and the one-liner", () => {
  const badges = "[![pipeline](https://example.invalid/badge.svg)](https://example.invalid) ![coverage](https://example.invalid/c.svg)";
  assert.deepEqual(codes(swap("# widget\n", `# widget\n\n${badges}\n`)), []);
});

// ---- readme-why -------------------------------------------------------------

test("no prose paragraph between the one-liner and the first section is a readme-why finding", () => {
  const noWhy = swap(/Field teams[^\n]*\n\n/, "");
  assert.deepEqual(codes(noWhy), ["readme-why"]);
});

test("a list or a code block in the why's place is not prose", () => {
  assert.deepEqual(codes(swap(/Field teams[^\n]*/, "- reads three formats\n- writes one")), ["readme-why"]);
  assert.deepEqual(codes(swap(/Field teams[^\n]*/, "```\nwhy\n```")), ["readme-why"]);
});

// ---- readme-sections --------------------------------------------------------

test("a missing required section is a readme-sections finding, one per section", () => {
  const noUsage = swap(/## Usage\n\n[^\n]*\n\n/, "");
  assert.deepEqual(codes(noUsage), ["readme-sections"]);
  assert.match(check(noUsage).findings[0].detail, /## Usage/);
  const bare = swap(/## Install[\s\S]*/, "## Notes\n\nSome notes.\n");
  assert.deepEqual(codes(bare), ["readme-sections", "readme-sections", "readme-sections"]);
});

test("section names are exact: Installation is not Install", () => {
  assert.ok(codes(swap("## Install", "## Installation")).includes("readme-sections"));
});

test("the repo's own section before Install is out of order; between Usage and API it is fine", () => {
  assert.deepEqual(codes(swap("## Install", "## Plugins\n\nThe table.\n\n## Install")), ["readme-sections"]);
  assert.deepEqual(codes(swap("## Contributing", "## Deploy\n\nPushes deploy.\n\n## API\n\nThe calls.\n\n## Contributing")), []);
  assert.deepEqual(codes(swap("## Contributing", "## API\n\nThe calls.\n\n## Deploy\n\nPushes deploy.\n\n## Contributing")), ["readme-sections"]);
});

test("the optional sections pass in their places: Security, Background, Maintainers, Thanks", () => {
  const full = swap("## Install", "## Security\n\nReport to the team.\n\n## Background\n\nHistory.\n\n## Install")
    .replace("## Contributing", "## Maintainers\n\nThe team.\n\n## Thanks\n\nEveryone.\n\n## Contributing");
  assert.deepEqual(codes(full), []);
  assert.deepEqual(codes(swap("## Install", "## Background\n\nHistory.\n\n## Security\n\nReport.\n\n## Install")), ["readme-sections"]);
});

test("License is required, and last, only when a LICENSE sits beside the README", () => {
  assert.deepEqual(codes(GOOD, { hasLicense: true }), ["readme-sections"]);
  const licensed = `${GOOD}\n## License\n\nMIT\n`;
  assert.deepEqual(codes(licensed, { hasLicense: true }), []);
  assert.deepEqual(codes(licensed.replace("## Contributing", "## License\n\nMIT\n\n## Contributing").replace(/\n## License\n\nMIT\n$/, ""), { hasLicense: true }), ["readme-sections"]);
});

test("a ## line inside a code fence is not a section", () => {
  assert.deepEqual(codes(swap("npm install widget", "npm install widget\n## not a heading")), []);
});

test("Security may also sit among the repo's own sections, between Usage and API", () => {
  assert.deepEqual(codes(swap("## Contributing", "## Security\n\nReport to the team.\n\n## API\n\nThe calls.\n\n## Contributing")), []);
  assert.deepEqual(codes(swap("## Contributing", "## API\n\nThe calls.\n\n## Security\n\nReport.\n\n## Contributing")), ["readme-sections"]);
});

test("a section that appears twice is a readme-sections finding", () => {
  const twice = swap("## Contributing", "## Usage\n\nMore usage.\n\n## Contributing");
  const found = check(twice).findings;
  assert.deepEqual(found.map((f) => f.finding), ["readme-sections"]);
  assert.match(found[0].detail, /## Usage` appears twice/);
});

// ---- readme-plumbing --------------------------------------------------------

test("the plumbing terms are the agent files and folders a repo carries", () => {
  assert.deepEqual(PLUMBING, [".agents", "AGENTS.md", "CLAUDE.md", ".claude"]);
});

test("the plumbing matcher catches a path, a backticked file, and a home-directory path", () => {
  assert.deepEqual(plumbingHits("edit ~/.claude/settings.json").map((h) => h.term), [".claude"]);
  assert.deepEqual(plumbingHits("read `AGENTS.md` first").map((h) => h.term), ["AGENTS.md"]);
  assert.deepEqual(plumbingHits(".agents/scripts holds them").map((h) => h.term), [".agents"]);
  assert.deepEqual(plumbingHits("the (.claude/) tree, and \".agents\", and CLAUDE.md.").map((h) => h.term), [".claude", ".agents", "CLAUDE.md"]);
});

test("the plumbing matcher takes any punctuation after a term, and brackets, emphasis, and angles before one", () => {
  const terms = (s) => plumbingHits(s).map((h) => h.term);
  assert.deepEqual(terms("[hub](AGENTS.md#rules)"), ["AGENTS.md"]);
  assert.deepEqual(terms("| AGENTS.md| the hub |"), ["AGENTS.md"]);
  assert.deepEqual(terms("**AGENTS.md** is the map"), ["AGENTS.md"]);
  assert.deepEqual(terms("see [CLAUDE.md][1]"), ["CLAUDE.md"]);
  assert.deepEqual(terms("open <.agents/x>"), [".agents"]);
  assert.deepEqual(terms("_.claude_ and .agents> and .claude& and .agents\u2014the tree"), [".claude", ".agents", ".claude", ".agents"]);
  assert.deepEqual(terms("the .claude* glob"), [".claude"]);
});

test("the plumbing matcher leaves a term that is part of a longer word alone", () => {
  assert.deepEqual(plumbingHits("node.claude and MY-AGENTS.md and .claude-plugin/ and .agentsrc and AGENTS.mdx"), []);
});

test("plumbing anywhere, code blocks included, is a readme-plumbing finding", () => {
  assert.deepEqual(codes(swap("npm install widget", "node .agents/scripts/setup.mjs")), ["readme-plumbing"]);
  const result = check(swap("Building, testing", "Read `AGENTS.md`. Building, testing"));
  assert.deepEqual(result.findings.map((f) => f.finding), ["readme-plumbing"]);
  assert.equal(result.findings[0].line, 19);
});

test("an accept entry with a why clears one term in one file", () => {
  const text = swap("Building, testing", "Personal settings stay in `~/.claude`. Building, testing");
  const accept = [{ path: "README.md", term: ".claude", why: "the install writes the person's own settings" }];
  assert.deepEqual(codes(text, { accept }), []);
  assert.deepEqual(codes(text, { accept: [{ ...accept[0], path: "docs/README.md" }] }), ["readme-plumbing"]);
  assert.deepEqual(codes(text, { accept: [{ ...accept[0], term: ".agents" }] }), ["readme-plumbing"]);
});

test("an accept entry without a why clears nothing", () => {
  const text = swap("Building, testing", "Personal settings stay in `~/.claude`. Building, testing");
  for (const why of [undefined, "", "   "]) {
    assert.deepEqual(codes(text, { accept: [{ path: "README.md", term: ".claude", why }] }), ["readme-plumbing"]);
  }
});

// ---- the readme block -------------------------------------------------------

test("an accept entry without a why is a readme-accept finding whatever its path, named for the file the block sits in", () => {
  const doc = { readme: { accept: [{ term: ".agents" }, { path: "Readme.md", term: ".claude" }, { path: "README.md", term: ".agents", why: " " }, { path: "README.md", term: ".agents", why: "kept" }] } };
  const found = configFindings(doc);
  assert.deepEqual(found.map((f) => f.finding), ["readme-accept", "readme-accept", "readme-accept"]);
  assert.equal(found[0].path, CONFIG);
  assert.match(found[1].detail, /Readme\.md/);
  assert.equal(configFindings(doc, MANIFEST)[0].path, MANIFEST);
});

test("a malformed readme block is a readme-config finding, never a crash", () => {
  assert.deepEqual(configFindings({ readme: { accept: {}, paths: "x" } }).map((f) => f.finding), ["readme-config", "readme-config"]);
  assert.deepEqual(configFindings({ readme: "on" }).map((f) => f.finding), ["readme-config"]);
  assert.deepEqual(configFindings({ readme: { accept: ["README.md"], paths: [3], name: 7 } }).map((f) => f.finding), ["readme-config", "readme-config", "readme-config"]);
  assert.deepEqual(configFindings({ readme: { name: "widget", paths: ["docs/*/README.md"], accept: [] } }), []);
  assert.deepEqual(configFindings({ readme: {} }), []);
  assert.deepEqual(configFindings(null), []);
});

test("the block's usable parts are kept beside the findings for the rest", () => {
  const read = readmeConfig({ readme: { name: " widget ", paths: ["a/*/README.md", ""], accept: [{ path: "README.md", term: ".claude", why: "kept" }, "x"] } });
  assert.deepEqual([read.name, read.paths, read.accept.length, read.findings.length], ["widget", ["a/*/README.md"], 1, 2]);
});

// ---- readme-agent-prose (warnings) -----------------------------------------

test("a text, prompt, or bare fence past 10 lines is a readme-agent-prose warning", () => {
  for (const info of ["text", "prompt", ""]) {
    const long = swap("## Usage\n", `## Usage\n\n\`\`\`${info}\n${Array(11).fill("step").join("\n")}\n\`\`\`\n`);
    assert.deepEqual(warns(long), ["readme-agent-prose"], info);
    assert.deepEqual(codes(long), [], "a warning never fails");
    const short = swap("## Usage\n", `## Usage\n\n\`\`\`${info}\n${Array(10).fill("step").join("\n")}\n\`\`\`\n`);
    assert.deepEqual(warns(short), [], info);
  }
});

test("a long code block in a real language is not a prompt", () => {
  const long = swap("npm install widget", Array(20).fill("npm install widget").join("\n"));
  assert.deepEqual(warns(long), []);
});

test("prose addressed to an agent is a readme-agent-prose warning, once per phrase", () => {
  for (const phrase of ["The agent", "your agent", "You are an", "walk me through"]) {
    const text = swap("Building, testing", `${phrase} reads this. Building, testing`);
    assert.deepEqual(warns(text), ["readme-agent-prose"], phrase);
  }
  const twice = swap("Building, testing", "the agent does it. Building, testing").replace("Field teams", "the agent knows. Field teams");
  assert.deepEqual(warns(twice), ["readme-agent-prose"]);
  assert.deepEqual(warns(swap("Field teams", "Teams on the agentic flow")), []);
});

// ---- the markdown the check reads ------------------------------------------

test("badge lines may sit right under the title with no blank line, in every badge form", () => {
  for (const badges of [
    "![ci](https://example.invalid/b.svg)",
    "[![ci][b]][l] [![cov][c]][l]",
    "[![ci](https://example.invalid/b.svg)][l]",
    '<img src="https://example.invalid/b.svg" alt="ci">',
    '<a href="https://example.invalid"><img src="https://example.invalid/b.svg"></a> <img src="c.svg">',
  ]) {
    const tight = swap("# widget\n\n", `# widget\n${badges}\n${badges}\n`);
    assert.deepEqual(codes(tight), [], badges);
    assert.equal(oneLiner(tight), "Turns raw sensor logs into tidy CSV files.", badges);
    const spaced = swap("# widget\n", `# widget\n\n${badges}\n`);
    assert.equal(oneLiner(spaced), "Turns raw sensor logs into tidy CSV files.", badges);
  }
});

test("oneLiner returns the line after the title and any badges, never badge markup, or null", () => {
  assert.equal(oneLiner(GOOD), "Turns raw sensor logs into tidy CSV files.");
  assert.equal(oneLiner("# widget\n\n![b](x.svg)\n\nA thing.\n"), "A thing.");
  assert.equal(oneLiner("# widget\n\n## Install\n"), null);
  assert.equal(oneLiner("# widget\n\n[![ci][b]][l]\n"), null);
  assert.equal(oneLiner('# widget\n<a href="x"><img src="b.svg"></a>\n\n## Install\n'), null);
  assert.equal(oneLiner(""), null);
});

test("HTML comments, multi-line ones included, are not headings, titles, or one-liners", () => {
  assert.deepEqual(codes(`<!-- generated, do not edit -->\n${GOOD}`), []);
  const comment = swap("# widget\n\n", "# widget\n\n<!--\nbadges go here\n## not a section\n-->\n\n");
  assert.deepEqual(codes(comment), []);
  assert.deepEqual(codes(swap("# widget\n", "# widget <!-- the name -->\n")), []);
});

test("a fence opens only on a fence line: inline triple backticks do not", () => {
  assert.deepEqual(codes(swap("`widget convert", "```foo``` is inline, and `widget convert")), []);
});

test("a byte-order mark and CRLF line endings read like any other README", () => {
  assert.deepEqual(check(`\uFEFF${GOOD}`), { findings: [], warnings: [] });
  assert.deepEqual(check(GOOD.replace(/\n/g, "\r\n")), { findings: [], warnings: [] });
  assert.equal(oneLiner(`\uFEFF${GOOD.replace(/\n/g, "\r\n")}`), "Turns raw sensor logs into tidy CSV files.");
});

test("a closing hash sequence counts only after a space, so # C# is C#", () => {
  assert.deepEqual(codes(swap("# widget", "# C#"), { name: "C#" }), []);
  assert.deepEqual(codes(swap("# widget", "# widget ##")), []);
});

// ---- the command, against a repo --------------------------------------------

/** A committed repo: a README, and whichever of the two config files the case gives. */
function repo(t, { readme = GOOD, config, manifest, files = {}, prefix = "readme-check-" } = {}) {
  const { dir, git } = tempRepo(t, prefix);
  if (readme !== null) write(dir, "README.md", readme);
  if (config) write(dir, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  if (manifest) write(dir, MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return { dir, git };
}
const NAMED = { readme: { name: "widget" } };

test("a repo whose README passes exits 0 and says so", (t) => {
  const r = runNode(CHECK, [], { cwd: repo(t, { config: NAMED }).dir });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, "readme ok\n");
});

test("with no config at all the root README is named for the origin remote's repository", (t) => {
  const { dir, git } = repo(t);
  git("remote", "add", "origin", "https://example.invalid/team/widget.git");
  for (const url of ["https://example.invalid/team/widget.git", "git@example.invalid:team/widget.git", "https://example.invalid/team/widget/", "git@example.invalid:widget"]) {
    git("remote", "set-url", "origin", url);
    assert.equal(repoName(dir), "widget", url);
  }
  const r = runNode(CHECK, [], { cwd: dir });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("with no config and no remote the root README is named for the checkout's folder, and a linked work tree for the main one", (t) => {
  const { dir, git } = repo(t, { prefix: "gizmo-" });
  const name = path.basename(dir);
  assert.equal(repoName(dir), name);
  const r = runNode(CHECK, [], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, new RegExp(`^readme-title: README\\.md:1: the first line must be \`# ${name}\``, "m"));
  const linked = path.join(tempDir(t, "linked-"), "feature-branch");
  git("worktree", "add", "-q", linked, "-b", "feature");
  assert.equal(repoName(linked), name);
});

test("a folder that is no git repo is still checked, named for itself", (t) => {
  const dir = tempDir(t, "plain-");
  write(dir, "README.md", GOOD.replace("# widget", `# ${path.basename(dir)}`));
  const r = runNode(CHECK, ["--root", dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the block's name wins, then the manifest's project, then the repository's own name", (t) => {
  const both = repo(t, { config: NAMED, manifest: { project: "gadget" } });
  assert.equal(runNode(CHECK, [], { cwd: both.dir }).status, 0);
  const project = runNode(CHECK, [], { cwd: repo(t, { manifest: { project: "gadget" } }).dir });
  assert.equal(project.status, 1);
  assert.match(project.stdout, /^readme-title: README\.md:1: .*# gadget/m);
});

test("a repo with no root README is a readme-missing finding", (t) => {
  const r = runNode(CHECK, [], { cwd: repo(t, { readme: null, config: NAMED, files: { "src/a.mjs": "export {};\n" } }).dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^readme-missing: README\.md: /m);
});

test("other READMEs are checked only when readme.paths opts them in, named for their directory", (t) => {
  const files = { "packages/sprocket/README.md": "# sprocket\n\nToo short.\n" };
  const quiet = runNode(CHECK, ["--json"], { cwd: repo(t, { config: NAMED, files }).dir });
  assert.equal(quiet.status, 0, quiet.stdout);
  assert.deepEqual(JSON.parse(quiet.stdout), { ok: true, files: ["README.md"], findings: [], warnings: [] });

  const config = { readme: { name: "widget", paths: ["packages/*/README.md"] } };
  const loud = runNode(CHECK, ["--json"], { cwd: repo(t, { config, files }).dir });
  assert.equal(loud.status, 1);
  const report = JSON.parse(loud.stdout);
  assert.deepEqual(report.files, ["README.md", "packages/sprocket/README.md"]);
  assert.deepEqual([...new Set(report.findings.map((f) => f.path))], ["packages/sprocket/README.md"]);
  assert.equal(report.findings.some((f) => f.finding === "readme-title"), false, "sprocket is the directory's name");
});

test("the block is read from the manifest too, and the two files' entries add up", (t) => {
  const readme = swap("Building, testing", "Settings live in `~/.claude`; the map is `AGENTS.md`. Building, testing");
  const config = { readme: { name: "widget", accept: [{ path: "README.md", term: ".claude", why: "the person's own settings" }] } };
  const manifest = { project: "gadget", readme: { accept: [{ path: "README.md", term: "AGENTS.md", why: "contributors start there" }] } };
  assert.equal(runNode(CHECK, [], { cwd: repo(t, { readme, config, manifest }).dir }).status, 0);
  const half = runNode(CHECK, [], { cwd: repo(t, { readme, config }).dir });
  assert.equal(half.status, 1);
  assert.match(half.stdout, /^readme-plumbing: README\.md:19: names `AGENTS\.md`/m);
});

test("a LICENSE, LICENSE.md or LICENSE.txt beside the README requires the section", (t) => {
  for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    const r = runNode(CHECK, [], { cwd: repo(t, { config: NAMED, files: { [file]: "MIT\n" } }).dir });
    assert.equal(r.status, 1, file);
    assert.match(r.stdout, /^readme-sections: README\.md: .*## License/m, file);
  }
});

test("accept entries are checked even when they name a file the check does not cover", (t) => {
  const manifest = { project: "widget", readme: { accept: [{ term: ".agents" }, { path: "Readme.md", term: ".claude" }] } };
  const r = runNode(CHECK, [], { cwd: repo(t, { manifest }).dir });
  assert.equal(r.status, 1, r.stdout);
  assert.equal((r.stdout.match(/^readme-accept: \.agents\/manifest\.json: /gm) ?? []).length, 2, r.stdout);
});

test("a malformed readme block fails with readme-config, and the README is still checked", (t) => {
  const r = runNode(CHECK, ["--json"], { cwd: repo(t, { readme: swap("# widget", "# other"), config: { readme: { accept: {}, paths: "x" } }, manifest: { project: "widget" } }).dir });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.findings.map((f) => [f.finding, f.path]), [["readme-config", CONFIG], ["readme-config", CONFIG], ["readme-title", "README.md"]]);
  assert.deepEqual(report.files, ["README.md"]);
});

test("warnings print and never fail the run", (t) => {
  const readme = swap("Building, testing", "Then walk me through it. Building, testing");
  const r = runNode(CHECK, [], { cwd: repo(t, { readme, config: NAMED }).dir });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^warning: readme-agent-prose: README\.md:19: /m);
  assert.match(r.stdout, /readme ok, 1 warning/);
});

test("--root names the repository from anywhere, and an argument the command does not know is exit 2", (t) => {
  const { dir } = repo(t, { config: NAMED });
  for (const args of [["--root", dir], [`--root=${dir}`]]) assert.equal(runNode(CHECK, args, { cwd: tempDir(t, "elsewhere-") }).stdout, "readme ok\n");
  const r = runNode(CHECK, ["--nope"], { cwd: dir });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^readme-check: unknown argument --nope\nusage: /);
});

test("a repo opts its READMEs into the Stop check with a readme block in either file, an empty one included", (t) => {
  assert.equal(optedIn(repo(t).dir), false);
  assert.equal(optedIn(repo(t, { config: { docsRoot: "docs" }, manifest: { project: "widget" } }).dir), false);
  assert.equal(optedIn(repo(t, { config: { readme: {} } }).dir), true);
  assert.equal(optedIn(repo(t, { manifest: { readme: { paths: [] } } }).dir), true);
});

test("checkRepo returns the files, findings and warnings the command prints", (t) => {
  const { dir } = repo(t, { readme: swap("# widget", "# other"), config: NAMED });
  const report = checkRepo(dir);
  assert.deepEqual([report.files, report.findings.map((f) => f.finding), report.warnings], [["README.md"], ["readme-title"], []]);
});

test("a copy in a repository runs by itself: the file imports nothing of the plugin's", (t) => {
  const { dir } = repo(t, { config: NAMED });
  const copy = write(dir, ".agents/scripts/readme-check.mjs", fs.readFileSync(CHECK, "utf8"));
  assert.equal(runNode(copy, [], { cwd: dir }).stdout, "readme ok\n");
  const imports = [...fs.readFileSync(CHECK, "utf8").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["node:child_process", "node:fs", "node:path"]);
});
