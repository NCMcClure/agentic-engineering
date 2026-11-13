// picture-this's pictures: which figure a name means, what the camera is
// asked to photograph, where the files go, and the Markdown handed back. The
// studio and the camera are stand-ins here; the real ones need a browser and
// are checked by hand.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sheet, still } from "../../../plugins/picture-this/scripts/commands/shots.mjs";
import { PtError } from "../../../plugins/picture-this/scripts/lib/args.mjs";
import { layout } from "../../../plugins/picture-this/scripts/lib/config.mjs";
import { findFigure, listFigures } from "../../../plugins/picture-this/scripts/lib/figures.mjs";
import { altText, pictureSnippet, stripAlt } from "../../../plugins/picture-this/scripts/lib/snippet.mjs";
import { homeLayout, lockHash, playwrightVersion } from "../../../plugins/picture-this/scripts/lib/studio.mjs";
import { REPO, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "picture-this");
const LOCKFILE = path.join(PLUGIN, "app", "package-lock.json");
const MODEL = fs.readFileSync(path.join(PLUGIN, "starters", "iso-flow", "model.json"), "utf8");

/** A repo with one figure and one draft round, and a data folder that looks installed. */
function world(t, { installed = true } = {}) {
  const { dir } = tempRepo(t, "pt-shots-");
  const repo = fs.realpathSync(dir);
  write(repo, ".agents/picture-this/figures/job-queue/figure.tsx", "export default () => null;\n");
  write(repo, ".agents/picture-this/figures/job-queue/model.json", MODEL);
  write(repo, ".agents/picture-this/figures/kit/kit.json", "{}");
  write(repo, ".agents/picture-this/drafts/round-1/a/figure.tsx", "export default () => null;\n");
  write(repo, ".agents/picture-this/drafts/round-1/a/model.json", MODEL);
  write(repo, ".agents/picture-this/drafts/round-1/kit/kit.json", "{}");
  const home = tempDir(t, "pt-home-");
  const at = homeLayout(home);
  if (installed) {
    write(at.app, ".install-stamp", lockHash(LOCKFILE) + "\n");
    write(at.browsers, ".install-stamp", playwrightVersion(LOCKFILE) + "\n");
  }
  const jobs = [], stopped = [];
  const deps = {
    env: { PT_HOME: home },
    cwd: repo,
    server: async () => ({ port: 5180, stop: async () => { stopped.push(true); } }),
    capture: async ({ port, shots }) => {
      jobs.push({ port, shots });
      for (const s of shots) write(path.dirname(s.out), path.basename(s.out), "png");
      return { status: 0, shots: shots.map((s) => ({ out: s.out, url: s.url, ok: true, errors: [], console: [], width: 880, height: 600 })) };
    },
  };
  return { repo, home, deps, jobs, stopped };
}
async function quiet(fn) {
  const real = process.stdout.write;
  let out = "";
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try { return { status: await fn(), out }; } finally { process.stdout.write = real; }
}

test("a name means a figure, round/draft a draft, fixture/name a fixture, and a folder is found by its path", (t) => {
  const w = world(t);
  const at = layout(w.repo);
  assert.deepEqual(listFigures(at).map((f) => `${f.kind} ${f.id}`), ["figure job-queue", "draft round-1/a"], "the kit folder is never a figure");
  assert.equal(findFigure(at, "job-queue").dir, path.join(at.figures, "job-queue"));
  assert.equal(findFigure(at, "round-1/a").kind, "draft");
  assert.equal(findFigure(at, path.join(at.drafts, "round-1", "a")).id, "round-1/a");
  assert.equal(findFigure(at, path.join(at.figures, "job-queue")).id, "job-queue");
  assert.equal(findFigure(at, "job-queue").model.title, "How an upload becomes a thumbnail");
  const fixtures = path.join(PLUGIN, "starters");
  assert.deepEqual([findFigure(at, "fixture/iso-flow", { fixtures }).kind, findFigure(at, "fixture/iso-flow", { fixtures }).dir], ["fixture", path.join(fixtures, "iso-flow")]);
  assert.throws(() => findFigure(at, "nope"), (e) => e instanceof PtError && /no figure 'nope': this repo has job-queue, round-1\/a/.test(e.message));
  assert.throws(() => findFigure(at, "kit"), /no figure 'kit'/);
  assert.throws(() => findFigure(at, ""), /which figure\?/);
  assert.throws(() => findFigure(layout(tempDir(t, "pt-empty-")), "x"), /this repo has no figures yet/);
});

test("the snippet shows the light still, and the dark one where the reader's theme is dark", () => {
  assert.equal(pictureSnippet({ light: "docs/figures/a.light.png", dark: "docs/figures/a.dark.png", alt: `Say "hi" & <wave>`, width: 880 }), [
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="docs/figures/a.dark.png">`,
    `  <img alt="Say &quot;hi&quot; &amp; &lt;wave&gt;" src="docs/figures/a.light.png" width="880">`,
    "</picture>",
  ].join("\n"));
  assert.doesNotMatch(pictureSnippet({ light: "a", dark: "b", alt: "c" }), /width=/);
  assert.equal(altText({ title: "How it works", claim: "It answers first." }), "How it works. It answers first.");
  assert.equal(altText({ title: "How it works." , claim: "" }), "How it works.");
  assert.equal(altText(null), "");
});

test("still photographs the hero frame in light and dark and writes into the repo's stills folder", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => still(["job-queue"], w.deps));
  assert.equal(status, 0);
  assert.equal(w.jobs.length, 1);
  const { port, shots } = w.jobs[0];
  assert.equal(port, 5180);
  assert.deepEqual(shots.map((s) => s.url), [
    "/frame?figure=job-queue&still=1&controls=0&width=880&theme=light",
    "/frame?figure=job-queue&still=1&controls=0&width=880&theme=dark",
  ]);
  assert.deepEqual(shots.map((s) => s.colorScheme), ["light", "dark"]);
  assert.deepEqual(shots.map((s) => s.selector), ["[data-pt-stage]", "[data-pt-stage]"]);
  assert.deepEqual(shots.map((s) => s.out), ["light", "dark"].map((theme) => path.join(w.repo, "docs", "figures", `job-queue.${theme}.png`)));
  assert.deepEqual(shots[0].viewport, { width: 928, height: 900 });
  assert.equal(out, [
    "wrote docs/figures/job-queue.light.png",
    "wrote docs/figures/job-queue.dark.png",
    "",
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="docs/figures/job-queue.dark.png">`,
    `  <img alt="How an upload becomes a thumbnail. The API answers before the slow work starts, so an upload never waits on it." src="docs/figures/job-queue.light.png" width="880">`,
    "</picture>",
    "",
  ].join("\n"));
  assert.deepEqual(w.stopped, [true], "a studio started for the job is stopped after it");
  assert.equal(fs.readFileSync(path.join(w.repo, ".agents", "picture-this", "drafts", ".gitignore"), "utf8"), "*\n");
});

test("still takes any held frame, the technical track, another width, and paths from where the Markdown lives", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => still(["job-queue", "--beat", "save", "--at", "25", "--technical", "--width", "720", "--from", path.join(w.repo, "docs")], w.deps));
  assert.equal(status, 0);
  assert.equal(w.jobs[0].shots[0].url, "/frame?figure=job-queue&still=1&controls=0&width=720&beat=save&at=0.25&audience=technical&theme=light");
  assert.match(out, /srcset="figures\/job-queue\.dark\.png"/);
  assert.match(out, /width="720"/);

  const json = await quiet(() => still(["job-queue", "--json"], w.deps));
  const doc = JSON.parse(json.out);
  assert.deepEqual([doc.ok, doc.figure, doc.width, doc.errors], [true, "job-queue", 880, []]);
  assert.equal(doc.light, path.join(w.repo, "docs", "figures", "job-queue.light.png"));
});

test("a draft's stills land beside the draft, and a fixture's need a place", async (t) => {
  const w = world(t);
  assert.equal((await quiet(() => still(["round-1/a"], w.deps))).status, 0);
  assert.deepEqual(w.jobs[0].shots.map((s) => path.relative(w.repo, s.out).split(path.sep).join("/")), [
    ".agents/picture-this/drafts/round-1/a/still.light.png",
    ".agents/picture-this/drafts/round-1/a/still.dark.png",
  ]);
  assert.equal(w.jobs[0].shots[0].url, "/frame?figure=round-1%2Fa&still=1&controls=0&width=880&theme=light");
  const out = tempDir(t, "pt-out-");
  assert.equal((await quiet(() => still(["round-1/a", "--out", out], w.deps))).status, 0);
  assert.equal(w.jobs[1].shots[0].out, path.join(out, "a.light.png"));
});

test("still refuses what it cannot do before it starts anything", async (t) => {
  const w = world(t);
  const refused = async (args, pattern) => {
    await assert.rejects(() => quiet(() => still(args, w.deps)), (e) => e instanceof PtError && e.code === 2 && pattern.test(e.message), args.join(" "));
  };
  await refused([], /usage: node pt\.mjs still/);
  await refused(["nope"], /no figure 'nope'/);
  await refused(["job-queue", "--beat", "rest"], /has no beat 'rest': its beats are answer, work, save/);
  await refused(["job-queue", "--at", "140"], /--at is a percentage through the beat, 0 to 100/);
  await refused(["job-queue", "--width", "200"], /--width is the figure's width in CSS px, 520 to 1600/);
  write(w.repo, ".agents/picture-this/figures/broken/figure.tsx", "x");
  write(w.repo, ".agents/picture-this/figures/broken/model.json", "{ nope");
  await refused(["broken"], /broken has no readable model\.json/);
  assert.deepEqual(w.jobs, [], "nothing was photographed");

  const bare = world(t, { installed: false });
  await assert.rejects(() => quiet(() => still(["job-queue"], bare.deps)), /the studio is not installed: run `setup --yes` first/);
  write(homeLayout(bare.home).app, ".install-stamp", lockHash(LOCKFILE) + "\n");
  await assert.rejects(() => quiet(() => still(["job-queue"], bare.deps)), /the browser stills are taken with is not installed/);
});

test("a figure that fails to draw is a failed still, with what the page said", async (t) => {
  const w = world(t);
  const failing = { ...w.deps, capture: async ({ shots }) => ({ status: 1, shots: shots.map((s) => ({ out: s.out, url: s.url, ok: false, errors: ["job-queue: Cannot read properties of undefined"], console: [] })) }) };
  const { status, out } = await quiet(() => still(["job-queue"], failing));
  assert.equal(status, 1);
  assert.equal(out, "error: job-queue.light.png: job-queue: Cannot read properties of undefined\nerror: job-queue.dark.png: job-queue: Cannot read properties of undefined\n");
  assert.deepEqual(w.stopped, [true], "the studio is stopped even when the camera fails");

  const dead = { ...w.deps, capture: async () => ({ status: 2, shots: [] }) };
  await assert.rejects(() => quiet(() => still(["job-queue"], dead)), /the camera could not run: is the browser installed\?/);
});

test("still --strip photographs the told beats in one row, in light and dark, instead of the still", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => still(["job-queue", "--strip"], w.deps));
  assert.equal(status, 0);
  assert.equal(w.jobs.length, 1, "one run of the camera");
  const { shots } = w.jobs[0];
  assert.deepEqual(shots.map((s) => s.url), [
    "/strip?figure=job-queue&width=640&theme=light",
    "/strip?figure=job-queue&width=640&theme=dark",
  ]);
  assert.deepEqual(shots.map((s) => s.selector), ["[data-pt-strip]", "[data-pt-strip]"]);
  assert.deepEqual(shots.map((s) => s.colorScheme), ["light", "dark"]);
  assert.deepEqual(shots.map((s) => s.out), ["light", "dark"].map((theme) => path.join(w.repo, "docs", "figures", `job-queue.strip.${theme}.png`)));
  assert.deepEqual(shots[0].viewport, { width: 3 * 641 + 49, height: 900 }, "three told beats side by side: the rest beat is not one");
  assert.equal(out, [
    "wrote docs/figures/job-queue.strip.light.png",
    "wrote docs/figures/job-queue.strip.dark.png",
    "",
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="docs/figures/job-queue.strip.dark.png">`,
    `  <img alt="How an upload becomes a thumbnail, in 3 steps: Answer first, Work later, Keep the result." src="docs/figures/job-queue.strip.light.png">`,
    "</picture>",
    "",
  ].join("\n"));
  assert.deepEqual(fs.readdirSync(path.join(w.repo, "docs", "figures")).sort(), ["job-queue.strip.dark.png", "job-queue.strip.light.png"], "nothing but the strip is written");
  assert.deepEqual(w.stopped, [true]);
});

test("a strip takes the technical track and another width, lands beside a draft, and says what it wrote as JSON", async (t) => {
  const w = world(t);
  assert.equal((await quiet(() => still(["round-1/a", "--strip", "--technical", "--width", "520"], w.deps))).status, 0);
  assert.equal(w.jobs[0].shots[0].url, "/strip?figure=round-1%2Fa&width=520&audience=technical&theme=light");
  assert.deepEqual(w.jobs[0].shots.map((s) => path.relative(w.repo, s.out).split(path.sep).join("/")), [
    ".agents/picture-this/drafts/round-1/a/still.strip.light.png",
    ".agents/picture-this/drafts/round-1/a/still.strip.dark.png",
  ]);

  const json = await quiet(() => still(["job-queue", "--strip", "--from", path.join(w.repo, "docs"), "--json"], w.deps));
  const doc = JSON.parse(json.out);
  assert.deepEqual([doc.ok, doc.figure, doc.errors, doc.strip.beats, doc.strip.width], [true, "job-queue", [], 3, 640]);
  assert.equal(doc.strip.light, path.join(w.repo, "docs", "figures", "job-queue.strip.light.png"));
  assert.match(doc.strip.snippet, /srcset="figures\/job-queue\.strip\.dark\.png"/);

  await assert.rejects(() => quiet(() => still(["job-queue", "--strip", "--beat", "save"], w.deps)), (e) => e instanceof PtError && /--beat and --at choose the still's frame/.test(e.message));
  await assert.rejects(() => quiet(() => still(["job-queue", "--strip", "--width", "200"], w.deps)), /--width is the figure's width in CSS px, 520 to 1600/);

  const failing = { ...w.deps, capture: async ({ shots }) => ({ status: 1, shots: shots.map((s) => ({ out: s.out, url: s.url, ok: false, errors: ["job-queue: boom"], console: [] })) }) };
  const failed = await quiet(() => still(["job-queue", "--strip"], failing));
  assert.deepEqual([failed.status, failed.out], [1, "error: job-queue.strip.light.png: job-queue: boom\nerror: job-queue.strip.dark.png: job-queue: boom\n"]);
});

test("a strip's alt text names the steps it shows, and falls back to the claim when a beat has no title", () => {
  const model = JSON.parse(MODEL);
  assert.equal(stripAlt(model), "How an upload becomes a thumbnail, in 3 steps: Answer first, Work later, Keep the result.");
  assert.equal(stripAlt({ title: "How it works.", beats: [{ id: "a", title: "Only" }, { id: "r", rest: true }] }), "How it works, in 1 step: Only.");
  assert.equal(stripAlt({ title: "How it works", claim: "It answers first.", beats: [{ id: "a" }, { id: "b", title: "B" }] }), "How it works. It answers first.");
  assert.equal(stripAlt(null), "");
});

test("the strip is a page of the studio: one row inside one frame that wears the kit's colours", () => {
  const page = fs.readFileSync(path.join(PLUGIN, "app", "src", "main.tsx"), "utf8");
  assert.match(page, /page === "strip"/);
  assert.match(page, /className="pt-stage studio-strip-frame" data-pt-strip=\{entry\.id\}/, "the frame is the kit's, so its colours are the figure's");
  assert.match(page, /beat=\{beat\.id\} at=\{0\.5\} still captions=\{false\} controls=\{false\}/, "each beat is held at its middle, with no words or strip of its own");
  assert.doesNotMatch(page.slice(page.indexOf("function Strip"), page.indexOf("function App")), /<h[1-6]/, "no studio headings in a picture for a README");
});

test("sheet lays the beats out with and without captions, and records what the page complained about", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => sheet(["round-1/a"], w.deps));
  assert.equal(status, 0);
  const { shots } = w.jobs[0];
  assert.deepEqual(shots.map((s) => s.url), [
    "/sheet?figure=round-1%2Fa&theme=light&width=560&columns=2&captions=1",
    "/sheet?figure=round-1%2Fa&theme=light&width=560&columns=2&captions=0",
  ]);
  assert.deepEqual(shots.map((s) => s.selector), ["[data-pt-sheet]", "[data-pt-sheet]"]);
  const dir = path.join(w.repo, ".agents", "picture-this", "drafts", "round-1", "a");
  assert.deepEqual(shots.map((s) => s.out), [path.join(dir, "sheet.png"), path.join(dir, "sheet.nocap.png")]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "checks.json"), "utf8")), { figure: "round-1/a", beats: 3, errors: [], console: [] });
  assert.equal(out, "wrote .agents/picture-this/drafts/round-1/a/sheet.png\nwrote .agents/picture-this/drafts/round-1/a/sheet.nocap.png  (no captions: the one for a cold reader)\n");

  assert.equal((await quiet(() => sheet(["job-queue", "--dark", "--technical"], w.deps))).status, 0);
  assert.equal(w.jobs[1].shots[0].url, "/sheet?figure=job-queue&theme=dark&width=560&columns=2&audience=technical&captions=1");
  assert.equal(w.jobs[1].shots[0].out, path.join(w.repo, ".agents", "picture-this", "drafts", "sheets", "job-queue", "sheet.png"), "a landed figure's sheets go to scratch, not beside it");
});

test("a console error on the page fails the sheet's check, though the pictures are written", async (t) => {
  const w = world(t);
  const noisy = { ...w.deps, capture: async (job) => { const done = await w.deps.capture(job); for (const s of done.shots) s.console = ["Warning: each child in a list should have a unique key"]; return done; } };
  const { status, out } = await quiet(() => sheet(["round-1/a"], noisy));
  assert.equal(status, 1);
  assert.match(out, /^console: Warning: each child in a list should have a unique key\nwrote /);
  const checks = JSON.parse(fs.readFileSync(path.join(w.repo, ".agents", "picture-this", "drafts", "round-1", "a", "checks.json"), "utf8"));
  assert.deepEqual(checks.console, ["Warning: each child in a list should have a unique key"], "said once, not once per picture");
});

test("the camera script waits for every figure to say it is painted, and photographs nothing that failed", () => {
  const source = fs.readFileSync(path.join(PLUGIN, "app", "capture.mjs"), "utf8");
  assert.match(source, /hasAttribute\("data-pt-ready"\)/);
  assert.match(source, /\[data-pt-error\], \.studio-error/);
  assert.match(source, /reducedMotion: "reduce"/);
  assert.match(source, /deviceScaleFactor: scale/);
  const stage = fs.readFileSync(path.join(PLUGIN, "kit", "stage.tsx"), "utf8");
  assert.match(stage, /setAttribute\("data-pt-ready", key\)/, "the stage is what says so");
  assert.match(stage, /document\.fonts/, "and only once its fonts are in");
});
