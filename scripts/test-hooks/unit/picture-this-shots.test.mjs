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
import { GIF_MAX_BYTES, GIF_WARN_BYTES, loopFrames, sizeOf } from "../../../plugins/picture-this/scripts/lib/gif.mjs";
import { altText, imageSnippet, pictureSnippet, stripAlt } from "../../../plugins/picture-this/scripts/lib/snippet.mjs";
import { homeLayout, lockHash, playwrightVersion } from "../../../plugins/picture-this/scripts/lib/studio.mjs";
import { REPO, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "picture-this");
const LOCKFILE = path.join(PLUGIN, "app", "package-lock.json");
const MODEL = fs.readFileSync(path.join(PLUGIN, "studies", "iso-flow", "model.json"), "utf8");

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
  // The stand-in camera. Like the real one, it films a shot that carries a
  // `film` into a GIF of `gifBytes` bytes, and writes nothing past maxBytes.
  const w = { repo, home, jobs, stopped, gifBytes: 549_241 };
  w.deps = {
    env: { PT_HOME: home },
    cwd: repo,
    server: async () => ({ port: 5180, stop: async () => { stopped.push(true); } }),
    capture: async ({ port, shots }) => {
      jobs.push({ port, shots });
      const taken = shots.map((s) => {
        const done = { out: s.out, url: s.url, ok: true, errors: [], console: [], width: 880, height: 600 };
        if (s.film) Object.assign(done, { frames: s.film.frames.length, bytes: w.gifBytes, over: w.gifBytes > s.film.maxBytes, ok: w.gifBytes <= s.film.maxBytes });
        if (done.ok) write(path.dirname(s.out), path.basename(s.out), s.film ? "gif" : "png");
        return done;
      });
      return { status: taken.every((d) => d.ok) ? 0 : 1, shots: taken };
    },
  };
  return w;
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
  const fixtures = path.join(PLUGIN, "studies");
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
  await refused(["job-queue", "--beat", "later"], /has no beat 'later': its beats are answer, work, save, rest/);
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

test("a loop's frames divide it evenly, each knows its beat, and their delays add up to the loop", () => {
  const beats = JSON.parse(MODEL).beats;
  const { total, frames } = loopFrames(beats, 15);
  assert.equal(total, 10400);
  assert.equal(frames.length, 156, "10.4 s at 15 a second");
  assert.deepEqual(frames[0], { beat: "answer", at: 0, delay: 70 }, "the loop starts where the clock does");
  assert.deepEqual(frames[48], { beat: "work", at: 0, delay: 70 }, "an instant on a boundary belongs to the beat that starts there");
  assert.deepEqual([frames[155].beat, frames[155].at < 1], ["rest", true], "the last frame is one step short of the first, so the loop closes without a jump");
  const starts = { answer: 0, work: 3200, save: 6200, rest: 9000 }, lengths = Object.fromEntries(beats.map((b) => [b.id, b.ms]));
  frames.forEach((f, i) => assert.ok(Math.abs(starts[f.beat] + f.at * lengths[f.beat] - (i * total) / 156) < 0.01, `frame ${i} is at its instant`));
  assert.deepEqual([...new Set(frames.map((f) => f.delay))].sort(), [60, 70], "a GIF counts in hundredths of a second: 66.7 ms is shown as 60 or 70");
  assert.equal(frames.reduce((sum, f) => sum + f.delay, 0), total, "and the rounding is carried, so the GIF runs as long as the loop");

  const odd = loopFrames([{ id: "a", ms: 1234 }, { id: "r", ms: 333, rest: true }], 30);
  assert.equal(odd.frames.length, 47);
  assert.equal(odd.frames.reduce((sum, f) => sum + f.delay, 0), 1570, "a loop that is not a whole number of hundredths is off by under one");
  assert.ok(odd.frames.every((f) => f.delay >= 30), "no delay is short enough for a browser to slow it down");
  assert.equal(loopFrames([{ id: "a", ms: 20 }], 5).frames.length, 1, "never no frames");

  assert.deepEqual([sizeOf(549_241), sizeOf(400), sizeOf(6_200_000), sizeOf(12_449_000)], ["549 KB", "1 KB", "6.2 MB", "12.4 MB"]);
  assert.deepEqual([GIF_WARN_BYTES, GIF_MAX_BYTES], [5_000_000, 10_000_000]);
});

test("still --gif films one loop of the bare frame at one pixel per px, and says how large it came out", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => still(["job-queue", "--gif"], w.deps));
  assert.equal(status, 0);
  assert.equal(w.jobs.length, 1);
  const { shots } = w.jobs[0];
  assert.equal(shots.length, 1, "light only unless --dark");
  const [shot] = shots;
  assert.equal(shot.url, "/frame?figure=job-queue&still=1&controls=0&width=720&theme=light");
  assert.equal(shot.selector, "[data-pt-stage]");
  assert.equal(shot.out, path.join(w.repo, "docs", "figures", "job-queue.gif"));
  assert.deepEqual([shot.colorScheme, shot.scale, shot.viewport], ["light", 1, { width: 768, height: 900 }]);
  assert.deepEqual(shot.film, { frames: loopFrames(JSON.parse(MODEL).beats, 15).frames, maxBytes: GIF_MAX_BYTES }, "the camera is told every instant to hold the clock at, and when to refuse");
  assert.equal(out, [
    "wrote docs/figures/job-queue.gif  (549 KB: 156 frames, 720 px wide, 15 a second, one loop of 10.4 s)",
    "",
    `<img alt="How an upload becomes a thumbnail. The API answers before the slow work starts, so an upload never waits on it." src="docs/figures/job-queue.gif" width="720">`,
    "",
  ].join("\n"));
  assert.deepEqual(fs.readdirSync(path.join(w.repo, "docs", "figures")), ["job-queue.gif"], "nothing but the GIF is written");
  assert.deepEqual(w.stopped, [true]);
});

test("a GIF takes a dark twin, another rate and width and the technical track, and lands beside a draft", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => still(["job-queue", "--gif", "--dark", "--fps", "10", "--width", "600", "--technical", "--from", path.join(w.repo, "docs")], w.deps));
  assert.equal(status, 0);
  const { shots } = w.jobs[0];
  assert.deepEqual(shots.map((s) => s.url), [
    "/frame?figure=job-queue&still=1&controls=0&width=600&audience=technical&theme=light",
    "/frame?figure=job-queue&still=1&controls=0&width=600&audience=technical&theme=dark",
  ]);
  assert.deepEqual(shots.map((s) => path.basename(s.out)), ["job-queue.gif", "job-queue.dark.gif"]);
  assert.deepEqual(shots.map((s) => [s.colorScheme, s.scale, s.film.frames.length]), [["light", 1, 104], ["dark", 1, 104]]);
  assert.equal(out, [
    "wrote figures/job-queue.gif  (549 KB: 104 frames, 600 px wide, 10 a second, one loop of 10.4 s)",
    "wrote figures/job-queue.dark.gif  (549 KB: 104 frames, 600 px wide, 10 a second, one loop of 10.4 s)",
    "",
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="figures/job-queue.dark.gif">`,
    `  <img alt="How an upload becomes a thumbnail. The API answers before the slow work starts, so an upload never waits on it." src="figures/job-queue.gif" width="600">`,
    "</picture>",
    "",
  ].join("\n"));

  assert.equal((await quiet(() => still(["round-1/a", "--gif", "--dark"], w.deps))).status, 0);
  assert.deepEqual(w.jobs[1].shots.map((s) => path.relative(w.repo, s.out).split(path.sep).join("/")), [
    ".agents/picture-this/drafts/round-1/a/still.gif",
    ".agents/picture-this/drafts/round-1/a/still.dark.gif",
  ]);
  assert.equal(imageSnippet({ src: "a.gif", alt: `Say "hi"` }), `<img alt="Say &quot;hi&quot;" src="a.gif">`);
});

test("--strip and --gif together are one run of the camera, and the hero still is left alone", async (t) => {
  const w = world(t);
  const out = tempDir(t, "pt-out-");
  const json = await quiet(() => still(["job-queue", "--strip", "--gif", "--out", out, "--json"], w.deps));
  assert.equal(json.status, 0);
  assert.equal(w.jobs.length, 1, "the studio is started once");
  assert.deepEqual(w.jobs[0].shots.map((s) => [path.basename(s.out), s.scale ?? "job's"]), [["job-queue.strip.light.png", "job's"], ["job-queue.strip.dark.png", "job's"], ["job-queue.gif", 1]]);
  const doc = JSON.parse(json.out);
  assert.deepEqual([doc.ok, doc.figure, doc.warnings, doc.errors], [true, "job-queue", [], []]);
  assert.deepEqual([doc.strip.beats, doc.strip.width], [3, 640]);
  assert.deepEqual({ ...doc.gif, snippet: null }, { light: path.join(out, "job-queue.gif"), width: 720, fps: 15, frames: 156, ms: 10400, bytes: { light: 549_241 }, snippet: null });
  assert.deepEqual(fs.readdirSync(out).sort(), ["job-queue.gif", "job-queue.strip.dark.png", "job-queue.strip.light.png"], "everything lands in --out and nowhere else");
  assert.equal(fs.existsSync(path.join(w.repo, "docs")), false, "the repo's stills folder is not touched");

  const text = await quiet(() => still(["job-queue", "--strip", "--gif"], w.deps));
  assert.match(text.out, /^wrote docs\/figures\/job-queue\.strip\.light\.png\nwrote docs\/figures\/job-queue\.strip\.dark\.png\n\n<picture>\n[^]*<\/picture>\n\nwrote docs\/figures\/job-queue\.gif  \(549 KB: [^]*\n\n<img alt=[^\n]*src="docs\/figures\/job-queue\.gif" width="720">\n$/);
});

test("a GIF past 5 MB is written with a warning, and one past GitHub's 10 MB is refused, each saying what to lower", async (t) => {
  const w = world(t);
  w.gifBytes = 6_200_000;
  const heavy = await quiet(() => still(["job-queue", "--gif"], w.deps));
  assert.equal(heavy.status, 0, "a warning is not a failure");
  assert.equal(heavy.out, [
    "wrote docs/figures/job-queue.gif  (6.2 MB: 156 frames, 720 px wide, 15 a second, one loop of 10.4 s)",
    "warning: job-queue.gif is 6.2 MB. GitHub shows an image up to 10 MB, but a page loads all of it before it moves: lower --width (now 720) or --fps (now 15), or shorten the figure's loop (now 10.4 s)",
    "",
    `<img alt="How an upload becomes a thumbnail. The API answers before the slow work starts, so an upload never waits on it." src="docs/figures/job-queue.gif" width="720">`,
    "",
  ].join("\n"));
  w.gifBytes = GIF_WARN_BYTES;
  assert.doesNotMatch((await quiet(() => still(["job-queue", "--gif"], w.deps))).out, /warning/, "exactly 5 MB is not past it");

  const gif = path.join(w.repo, "docs", "figures", "job-queue.gif");
  fs.writeFileSync(gif, "the one from before");
  w.gifBytes = 12_449_000;
  const refused = await quiet(() => still(["job-queue", "--gif", "--dark", "--fps", "24"], w.deps));
  assert.equal(refused.status, 1);
  assert.equal(refused.out, [
    "error: job-queue.gif would be 12.4 MB, over GitHub's 10 MB limit for an image, so it was not written: lower --width (now 720) or --fps (now 24), or shorten the figure's loop (now 10.4 s)",
    "error: job-queue.dark.gif would be 12.4 MB, over GitHub's 10 MB limit for an image, so it was not written: lower --width (now 720) or --fps (now 24), or shorten the figure's loop (now 10.4 s)",
    "",
  ].join("\n"));
  assert.equal(fs.readFileSync(gif, "utf8"), "the one from before", "a GIF that was fine is not replaced by one that is not");
  assert.equal(fs.existsSync(path.join(w.repo, "docs", "figures", "job-queue.dark.gif")), false);

  const doc = JSON.parse((await quiet(() => still(["job-queue", "--gif", "--json"], w.deps))).out);
  assert.deepEqual([doc.ok, "gif" in doc, doc.errors.length], [false, false, 1]);
  w.gifBytes = GIF_MAX_BYTES;
  assert.equal((await quiet(() => still(["job-queue", "--gif"], w.deps))).status, 0, "exactly 10 MB is still shown");
});

test("the GIF's options go with --gif, and a loop needs every beat's length", async (t) => {
  const w = world(t);
  const refused = async (args, pattern) => {
    await assert.rejects(() => quiet(() => still(args, w.deps)), (e) => e instanceof PtError && e.code === 2 && pattern.test(e.message), args.join(" "));
  };
  await refused(["job-queue", "--dark"], /--dark and --fps go with --gif/);
  await refused(["job-queue", "--strip", "--fps", "12"], /--dark and --fps go with --gif/);
  await refused(["job-queue", "--gif", "--fps", "60"], /--fps is frames a second, 5 to 30/);
  await refused(["job-queue", "--gif", "--fps", "4"], /--fps is frames a second, 5 to 30/);
  await refused(["job-queue", "--gif", "--at", "50"], /--beat and --at choose the still's frame/);
  await refused(["job-queue", "--gif", "--width", "400"], /--width is the figure's width in CSS px, 520 to 1600/);
  const model = JSON.parse(MODEL);
  delete model.beats[1].ms;
  write(w.repo, ".agents/picture-this/figures/unchecked/figure.tsx", "export default () => null;\n");
  write(w.repo, ".agents/picture-this/figures/unchecked/model.json", JSON.stringify(model));
  await refused(["unchecked", "--gif"], /unchecked has a beat with no length \(ms\): run `model check` on it/);
  assert.deepEqual(w.jobs, [], "nothing was filmed");

  const failing = { ...w.deps, capture: async ({ shots }) => ({ status: 1, shots: shots.map((s) => ({ out: s.out, url: s.url, ok: false, errors: ["the frame at work 0.5 was never painted"], console: [] })) }) };
  const failed = await quiet(() => still(["job-queue", "--gif"], failing));
  assert.deepEqual([failed.status, failed.out], [1, "error: job-queue.gif: the frame at work 0.5 was never painted\n"]);
});

test("the film camera steps the clock and waits for each frame; it records nothing", () => {
  const film = fs.readFileSync(path.join(PLUGIN, "app", "film.mjs"), "utf8");
  assert.match(film, /await window\.__pt\.seek\(b, a\)/, "each frame is the stage's clock held at an instant");
  assert.match(film, /getAttribute\("data-pt-ready"\)/, "and photographed only once the stage says it is painted");
  assert.match(film, /ready\.startsWith\(`\$\{beat\}:`\)/);
  assert.doesNotMatch(film, /recordVideo|screencast|setTimeout|waitForTimeout/, "no recording, and no waiting on the wall clock");
  assert.match(film, /style\.minHeight/, "the frame is held at its tallest beat, so every frame is one size");
  assert.match(film, /join: \{ animated: true \}/);
  assert.match(film, /loop: 0, dither: 0/, "it loops for ever, in the figure's own flat colours");
  assert.match(film, /gif\.length > maxBytes/, "and a GIF past the limit is never written");
  const camera = fs.readFileSync(path.join(PLUGIN, "app", "capture.mjs"), "utf8");
  assert.match(camera, /if \(shot\.film\) .*await import\("\.\/film\.mjs"\)/, "the encoder is loaded only for a film, so a still never waits on it");
  const app = JSON.parse(fs.readFileSync(path.join(PLUGIN, "app", "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
  assert.ok(app.dependencies.sharp, "the encoder is one of the studio's packages, installed in the data folder");
  assert.match(lock.packages["node_modules/sharp"].version, /^0\.35\./);
  assert.equal(fs.existsSync(path.join(PLUGIN, "node_modules")), false, "and never in the plugin");
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
  assert.match(source, /deviceScaleFactor: shot\.scale \?\? scale/, "twice the size unless a shot says otherwise");
  assert.match(source, /"--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"/, "3D is drawn by software, so a machine with a graphics card and one without take the same still");
  assert.match(source, /chromium\.launch\(\{ args: BROWSER_ARGS \}\)/);
  assert.match(source, /getAttribute\("data-pt-paints"\) === s\.getAttribute\("data-pt-ready"\)/, "a 3D scene's canvas has drawn the frame the stage holds");
  const stage = fs.readFileSync(path.join(PLUGIN, "kit", "stage.tsx"), "utf8");
  assert.match(stage, /setAttribute\("data-pt-ready", key\)/, "the stage is what says so");
  assert.match(stage, /document\.fonts/, "and only once its fonts are in");
});

test("the film gives every frame its own palette, so a white panel stays white on the clay page", () => {
  const source = fs.readFileSync(path.join(PLUGIN, "app", "film.mjs"), "utf8");
  assert.match(source, /\.gif\(\{[^}]*dither: 0[^}]*interPaletteMaxError: 0[^}]*\}\)/);
});
