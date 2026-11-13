// picture-this in a repo: where its figures live, the kit copied in beside
// them, and a draft landed as a figure. The rule under all of it is that the
// repo owns what is copied: a file its people changed is never written over.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { init, kit } from "../../../plugins/picture-this/scripts/commands/kit.mjs";
import { run as land } from "../../../plugins/picture-this/scripts/commands/land.mjs";
import { PtError } from "../../../plugins/picture-this/scripts/lib/args.mjs";
import { apply, current, kitFiles, kitVersion, plan } from "../../../plugins/picture-this/scripts/lib/owned.mjs";
import { REPO, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "picture-this");
const KIT = path.join(PLUGIN, "kit");
const MODEL = fs.readFileSync(path.join(PLUGIN, "app", "fixtures", "queue", "model.json"), "utf8");
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

function repoWith(t) {
  const { dir, git } = tempRepo(t, "pt-kit-");
  return { repo: fs.realpathSync(dir), git };
}
/** A stand-in plugin whose kit a test can change, to play the part of a later release. */
function pluginCopy(t) {
  const root = tempDir(t, "pt-plugin-");
  fs.cpSync(KIT, path.join(root, "kit"), { recursive: true });
  return root;
}
async function quiet(fn) {
  const real = process.stdout.write;
  let out = "";
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try { return { status: await fn(), out }; } finally { process.stdout.write = real; }
}
const actions = (p) => Object.fromEntries(p.files.filter((f) => f.action !== "same").map((f) => [f.rel, f.action]));

test("the kit carries the plugin's version and the files a figure draws with", () => {
  const manifest = JSON.parse(read(PLUGIN, ".claude-plugin", "plugin.json"));
  assert.equal(kitVersion(KIT), manifest.version, "kit/kit.json and plugin.json move together");
  const files = kitFiles(KIT);
  for (const rel of ["stage.tsx", "timeline.ts", "model.ts", "kit.css", "label.tsx", "term.tsx", "iso/project.ts", "iso/shapes.tsx", "iso/wire.tsx"]) assert.ok(files.includes(rel), rel);
  assert.equal(files.includes("kit.json"), false, "the marker is written by the install, not copied");
});

test("init records the folders, keeps what is not named, and refuses a folder outside the repo", async (t) => {
  const { repo } = repoWith(t);
  const first = await quiet(() => init(["--figures", "docs/src/figures", "--mdx", "docs/src/mdx.tsx"], { cwd: repo }));
  assert.equal(first.status, 0);
  assert.deepEqual(JSON.parse(read(repo, ".agents", "picture-this.json")), { version: 1, figuresDir: "docs/src/figures", stillsDir: "docs/figures", mdxComponents: "docs/src/mdx.tsx" });
  assert.match(first.out, /wrote \.agents\/picture-this\.json\n {2}figures: docs\/src\/figures\/<name>\/ {3}\(the kit: docs\/src\/figures\/kit\/\)/);

  await quiet(() => init(["--stills", "docs/public/figures"], { cwd: repo }));
  assert.deepEqual(JSON.parse(read(repo, ".agents", "picture-this.json")), { version: 1, figuresDir: "docs/src/figures", stillsDir: "docs/public/figures", mdxComponents: "docs/src/mdx.tsx" });

  await assert.rejects(() => quiet(() => init(["--figures", "../elsewhere"], { cwd: repo })), /is not a folder inside the repo/);
  assert.equal(JSON.parse(read(repo, ".agents", "picture-this.json")).figuresDir, "docs/src/figures", "a refused change leaves the config as it was");

  const { repo: fresh } = repoWith(t);
  await assert.rejects(() => quiet(() => init(["--stills", "/"], { cwd: fresh })), PtError);
  assert.equal(fs.existsSync(path.join(fresh, ".agents", "picture-this.json")), false, "and a refused first init leaves none");
  const plain = await quiet(() => init([], { cwd: fresh }));
  assert.match(plain.out, /mdx: {5}not set: figures are imported where they are used/);
});

test("kit status says the kit is missing, and kit install puts every file in the figures folder", async (t) => {
  const { repo } = repoWith(t);
  const before = await quiet(() => kit(["status"], { cwd: repo }));
  assert.equal(before.status, 1);
  assert.match(before.out, /^the kit is not in this repo: `kit install` puts it in \.agents\/picture-this\/figures\/kit\//);

  const dry = await quiet(() => kit(["install", "--dry-run"], { cwd: repo }));
  assert.equal(dry.status, 0);
  assert.match(dry.out, /^would write the kit \(0\.1\.0\) into \.agents\/picture-this\/figures\/kit\/:\n/);
  assert.match(dry.out, /^ {2}stage\.tsx: would add$/m);
  assert.equal(fs.existsSync(path.join(repo, ".agents")), false, "a dry run writes nothing");

  const done = await quiet(() => kit(["install"], { cwd: repo }));
  assert.equal(done.status, 0);
  const dir = path.join(repo, ".agents", "picture-this", "figures", "kit");
  for (const rel of kitFiles(KIT)) assert.equal(read(dir, rel), read(KIT, rel), rel);
  const marker = JSON.parse(read(dir, "kit.json"));
  assert.equal(marker.version, "0.1.0");
  assert.deepEqual(Object.keys(marker.owned).sort(), kitFiles(KIT));

  const after = await quiet(() => kit(["status"], { cwd: repo }));
  assert.equal(after.status, 0);
  assert.equal(after.out, "ok: the kit in .agents/picture-this/figures/kit/ is current (0.1.0)\n");
  const again = await quiet(() => kit(["install"], { cwd: repo }));
  assert.match(again.out, /nothing to change/);
});

test("an update replaces what nobody touched, keeps what was edited, and removes what is no longer shipped", async (t) => {
  const { repo } = repoWith(t);
  const plugin = pluginCopy(t);
  await quiet(() => kit(["install"], { cwd: repo, pluginRoot: plugin }));
  const dir = path.join(repo, ".agents", "picture-this", "figures", "kit");

  // The repo's people restyle the kit; the plugin ships a later one.
  fs.appendFileSync(path.join(dir, "kit.css"), "\n/* ours */\n");
  fs.writeFileSync(path.join(plugin, "kit", "kit.json"), JSON.stringify({ version: "0.2.0" }));
  fs.appendFileSync(path.join(plugin, "kit", "timeline.ts"), "\n// newer\n");
  fs.appendFileSync(path.join(plugin, "kit", "kit.css"), "\n/* theirs */\n");
  fs.writeFileSync(path.join(plugin, "kit", "three.tsx"), "// new in 0.2.0\n");
  fs.rmSync(path.join(plugin, "kit", "term.tsx"));

  const p = plan(path.join(plugin, "kit"), dir);
  assert.deepEqual([p.installed, p.version, current(p)], ["0.1.0", "0.2.0", false]);
  assert.deepEqual(actions(p), { "kit.css": "kept", "three.tsx": "add", "timeline.ts": "update" });
  assert.deepEqual(p.gone, ["term.tsx"]);

  const status = await quiet(() => kit(["status"], { cwd: repo, pluginRoot: plugin }));
  assert.equal(status.status, 1);
  assert.match(status.out, /^the kit in \.agents\/picture-this\/figures\/kit\/ is 0\.1\.0; the plugin ships 0\.2\.0\n/);
  assert.match(status.out, /kit\.css: kept \(changed in this repo\)/);
  assert.match(status.out, /timeline\.ts: older/);
  assert.match(status.out, /term\.tsx: no longer shipped/);

  const done = await quiet(() => kit(["install"], { cwd: repo, pluginRoot: plugin }));
  assert.match(done.out, /timeline\.ts: updated/);
  assert.match(done.out, /three\.tsx: added/);
  assert.match(done.out, /term\.tsx: removed/);
  assert.match(read(dir, "kit.css"), /\/\* ours \*\/\n$/, "the edited file is exactly as its people left it");
  assert.doesNotMatch(read(dir, "kit.css"), /theirs/);
  assert.match(read(dir, "timeline.ts"), /newer/);
  assert.equal(fs.existsSync(path.join(dir, "term.tsx")), false);
  assert.equal(JSON.parse(read(dir, "kit.json")).version, "0.2.0");

  const settled = plan(path.join(plugin, "kit"), dir);
  assert.equal(current(settled), true, "an edited file does not keep the kit forever out of date");
  assert.deepEqual(actions(settled), { "kit.css": "kept" }, "and it stays kept on the next update too");
});

test("a file the plugin never wrote is never taken over, and an edited file that is no longer shipped is left", (t) => {
  const source = path.join(pluginCopy(t), "kit");
  const target = path.join(tempDir(t, "pt-target-"), "kit");
  write(target, "stage.tsx", "// somebody's own stage\n");
  apply(source, target);
  assert.equal(read(target, "stage.tsx"), "// somebody's own stage\n");
  assert.equal(JSON.parse(read(target, "kit.json")).owned["stage.tsx"], undefined);

  fs.appendFileSync(path.join(target, "label.tsx"), "// edited\n");
  fs.rmSync(path.join(source, "label.tsx"));
  const p = plan(source, target);
  assert.deepEqual(p.gone, [], "edited, so not ours to remove");
  apply(source, target, p);
  assert.match(read(target, "label.tsx"), /\/\/ edited\n$/);
});

/** A repo with one draft round: a draft, its copy of the kit, and its model. */
function withDraft(t, model = MODEL) {
  const { repo } = repoWith(t);
  write(repo, ".agents/picture-this/drafts/round-1/a/figure.tsx", `import { Stage } from "../kit/stage";\nexport default function Figure() { return null; }\n`);
  write(repo, ".agents/picture-this/drafts/round-1/a/model.json", model);
  write(repo, ".agents/picture-this/drafts/round-1/a/sheet.png", "png");
  return repo;
}

test("land copies a draft's figure and model into the figures folder, and brings the kit with it", async (t) => {
  const repo = withDraft(t);
  const { status, out } = await quiet(() => land(["round-1/a", "--as", "job-queue"], { cwd: repo }));
  assert.equal(status, 0);
  const figures = path.join(repo, ".agents", "picture-this", "figures");
  assert.deepEqual(fs.readdirSync(path.join(figures, "job-queue")).sort(), ["figure.tsx", "model.json"], "the draft's sheets stay in scratch");
  assert.equal(read(figures, "job-queue", "figure.tsx"), read(repo, ".agents", "picture-this", "drafts", "round-1", "a", "figure.tsx"), "laid out as a figure already: not a character is rewritten");
  assert.ok(fs.existsSync(path.join(figures, "kit", "stage.tsx")), "the import ../kit/stage resolves where it landed");
  assert.equal(out, [
    "landed round-1/a as .agents/picture-this/figures/job-queue/",
    `the kit was added: .agents/picture-this/figures/kit/ (${kitFiles(KIT).length} files)`,
    "",
    "To show it in a page:",
    `  import JobQueue from "<path to>/.agents/picture-this/figures/job-queue/figure";`,
    "  <JobQueue />",
    "To give a README its picture: `still job-queue`",
    "",
  ].join("\n"));

  write(repo, ".agents/picture-this/drafts/round-1/b/figure.tsx", "// another\n");
  write(repo, ".agents/picture-this/drafts/round-1/b/model.json", MODEL);
  const second = await quiet(() => land(["round-1/b", "--as", "sync-flow"], { cwd: repo }));
  assert.doesNotMatch(second.out, /the kit was added/, "the kit is added once");
});

test("land refuses to write over a figure unless told to, and lands into the configured folder", async (t) => {
  const repo = withDraft(t);
  await quiet(() => init(["--figures", "docs/src/figures"], { cwd: repo }));
  await quiet(() => land(["round-1/a", "--as", "job-queue"], { cwd: repo }));
  const landed = path.join(repo, "docs", "src", "figures", "job-queue", "figure.tsx");
  assert.ok(fs.existsSync(landed));
  fs.writeFileSync(landed, "// polished by hand\n");
  await assert.rejects(() => quiet(() => land(["round-1/a", "--as", "job-queue"], { cwd: repo })), (e) => e instanceof PtError && e.code === 2 && /docs\/src\/figures\/job-queue is already there: pick another name, or pass --replace/.test(e.message));
  assert.equal(read(landed), "// polished by hand\n");
  assert.equal((await quiet(() => land(["round-1/a", "--as", "job-queue", "--replace"], { cwd: repo }))).status, 0);
  assert.match(read(landed), /import \{ Stage \}/);
});

test("land takes a draft, a real name, and a model that passes", async (t) => {
  const repo = withDraft(t);
  const refused = async (args, pattern) => assert.rejects(() => quiet(() => land(args, { cwd: repo })), (e) => e instanceof PtError && pattern.test(e.message), args.join(" "));
  await refused(["round-1/a"], /usage: node pt\.mjs land/);
  await refused(["round-1/a", "--as", "Job Queue"], /is not a figure name/);
  await refused(["round-1/a", "--as", "kit"], /is not a figure name/);
  await refused(["round-9/z", "--as", "x"], /no figure 'round-9\/z'/);
  await quiet(() => land(["round-1/a", "--as", "job-queue"], { cwd: repo }));
  await refused(["job-queue", "--as", "copy"], /is already one of the repo's figures: land takes a draft/);

  const bad = JSON.parse(MODEL);
  bad.flows[0].to = "nowhere";
  const broken = withDraft(t, JSON.stringify(bad));
  const { status, out } = await quiet(() => land(["round-1/a", "--as", "job-queue"], { cwd: broken }));
  assert.equal(status, 1);
  assert.match(out, /error: flow 'upload': to 'nowhere' is not an entity\nround-1\/a: its model does not pass, so it is not landed/);
  assert.equal(fs.existsSync(path.join(broken, ".agents", "picture-this", "figures")), false, "nothing is written for a draft that does not pass");
});
