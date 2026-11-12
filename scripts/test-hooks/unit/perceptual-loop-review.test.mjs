// perceptual-loop's judging half: the review queue through add, build and apply
// in a temp project; blind relabelling (deterministic letters, the key kept
// apart from the pictures); the evidence lint's rules; the timing report; the
// sheet command's exits; and the critique workflow, run with stub agents, which
// must refuse telling picture names and never put the key in a prompt.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PL, PLUGIN, runNode, scene, tempDir, u8, write } from "./perceptual-loop-fixtures.mjs";

import { encodePng, decodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
import { lint } from "../../../plugins/perceptual-loop/scripts/commands/lint.mjs";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ENV = { PL_RUN: "", PL_DIR: "", PL_SHOTS_DIR: "" };

const pl = (dir, args, { env = {}, input = "" } = {}) => runNode(PL, args, { cwd: dir, env: { ...ENV, ...env }, input });
const json = (r) => { assert.equal(r.stderr.includes("internal error"), false, r.stderr); return JSON.parse(r.stdout); };
const png = (dir, rel, img) => { const f = write(dir, rel, ""); fs.writeFileSync(f, encodePng(img)); return f; };

/** A project with a state folder and three pictures, one of them transparent. */
function project() {
  const dir = fs.realpathSync(tempDir("pl-review-")); // the CLI's cwd is the real path (/var is /private/var on macOS)
  assert.equal(pl(dir, ["init", "--json"]).status, 0);
  png(dir, "pics/ref.png", u8(scene(300, 200)));
  png(dir, "pics/after.png", u8(scene(300, 200), (c, v) => v * 1.3));
  png(dir, "pics/clear.png", { width: 40, height: 20, channels: 4, data: new Uint8Array(40 * 20 * 4) });
  return dir;
}

// ---- review ------------------------------------------------------------------------------

const ADD = ["review", "add", "--id", "sky-exposure", "--title", "Sky exposure", "--question", "Which exposure is right?",
  "--context", "The candidate is brighter.", "--image", "reference=pics/ref.png", "--image", "after=pics/after.png", "--compare",
  "--option", "keep=Keep it", "--option", "revert=Go back", "--recommend", "keep", "--evidence", "EV=+0.38", "--verdict", "agent=different-ok: both plausible"];

function pageData(file) {
  const html = fs.readFileSync(file, "utf8");
  const m = html.match(/<script type="application\/json" id="pl-data">([\s\S]*?)<\/script>/);
  assert.ok(m, "the page carries its data");
  assert.doesNotMatch(html, /__(TITLE|DATA|BUILT)__/, "every placeholder is filled");
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|https?:\/\//, "the page loads nothing from anywhere");
  return JSON.parse(m[1]);
}

test("review add queues a question and refuses a malformed one", () => {
  const dir = project();
  const r = json(pl(dir, [...ADD, "--json"]));
  assert.deepEqual(r, { queued: "sky-exposure", open: 1 });
  const [item] = JSON.parse(fs.readFileSync(path.join(dir, ".agents/perceptual/decisions/queue.json"), "utf8"));
  assert.deepEqual(item.images, [{ label: "reference", path: "pics/ref.png", compare: true }, { label: "after", path: "pics/after.png", compare: true }]);
  assert.equal(item.recommended, "keep");
  assert.deepEqual(item.verdicts, [{ by: "agent", verdict: "different-ok", note: "both plausible" }]);
  assert.deepEqual(item.evidence, [{ label: "EV", value: "+0.38" }]);
  const base = ["review", "add", "--id", "x", "--title", "t", "--question", "q"];
  for (const [why, args] of [
    ["a queued id without --replace", ADD],
    ["one option", [...base, "--option", "a=A"]],
    ["the same option id twice", [...base, "--option", "a=A", "--option", "a=B"]],
    ["a recommendation that is not an option", [...base, "--option", "a=A", "--option", "b=B", "--recommend", "c"]],
    ["a picture that is not there", [...base, "--option", "a=A", "--option", "b=B", "--image", "x=pics/none.png"]],
    ["an id with a space", ["review", "add", "--id", "a b", "--title", "t", "--question", "q", "--option", "a=A", "--option", "b=B"]],
    ["--compare with one picture", [...base, "--option", "a=A", "--option", "b=B", "--image", "r=pics/ref.png", "--compare"]],
  ]) assert.equal(pl(dir, args).status, 2, why);
  assert.equal(pl(dir, [...ADD, "--replace"]).status, 0);
  assert.match(pl(dir, ["review", "list"]).stdout, /^sky-exposure: Which exposure is right\?$/m);
});

test("review build writes one self-contained page with every picture embedded as a JPEG, or linked", () => {
  const dir = project();
  pl(dir, ADD);
  pl(dir, ["review", "add", "--id", "glass", "--title", "Glass", "--question", "Clear enough?", "--image", "clear=pics/clear.png", "--option", "yes=Yes", "--option", "no=No"]);
  const built = json(pl(dir, ["review", "build", "--max-width", "120", "--json"]));
  assert.equal(built.page, path.join(dir, ".agents/perceptual/decisions/review.html"));
  assert.deepEqual(built.warnings, []);
  const data = pageData(built.page);
  assert.match(data.storageKey, /^pl-review:[0-9a-f]{10}$/);
  assert.deepEqual(data.items.map((i) => i.id), ["sky-exposure", "glass"]);
  const [ref] = data.items[0].images;
  assert.match(ref.src, /^data:image\/jpeg;base64,/);
  const jpg = Buffer.from(ref.src.split(",")[1], "base64");
  assert.deepEqual([...jpg.subarray(0, 2)], [0xff, 0xd8]);
  const sof = jpg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.deepEqual([jpg.readUInt16BE(sof + 5), jpg.readUInt16BE(sof + 7)], [80, 120], "scaled down to --max-width, aspect kept");
  assert.equal(data.items[0].images.every((i) => i.compare), true);
  if (hasFfmpeg) {
    // a fully transparent picture is laid on grey 128
    const clear = Buffer.from(data.items[1].images[0].src.split(",")[1], "base64");
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", "-", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: clear });
    assert.ok([...r.stdout].every((v) => Math.abs(v - 128) <= 2), "grey 128 under alpha");
  }
  const linked = json(pl(dir, ["review", "build", "--link-images", "--out", path.join(dir, "out/page.html"), "--json"]));
  assert.equal(pageData(linked.page).items[0].images[0].src, "../pics/ref.png");
  fs.rmSync(path.join(dir, "pics/after.png"));
  const missing = json(pl(dir, ["review", "build", "--json"]));
  assert.equal(missing.warnings.length, 1);
  assert.equal(pageData(missing.page).items[0].images[1].src, null, "a missing picture is shown as missing, not dropped");
});

test("review apply writes one ruling per answer, shortens the queue, and says what to do next", () => {
  const dir = project();
  pl(dir, ADD);
  pl(dir, ["review", "add", "--id", "glass", "--title", "Glass", "--question", "Clear enough?", "--option", "yes=Yes", "--option", "no=No"]);
  const decisions = write(dir, "decisions.json", JSON.stringify({ decidedAt: "2026-03-04T10:00:00.000Z", items: [
    { id: "sky-exposure", option: "revert", note: "Too bright for dusk.\nKeep the sun." }, { id: "ghost", option: "a", note: "" }] }));
  const r = json(pl(dir, ["review", "apply", decisions, "--json"]));
  assert.deepEqual(r.written.map((w) => [w.id, w.option, w.file]), [["sky-exposure", "revert", ".agents/perceptual/decisions/2026-03-04-sky-exposure.md"]]);
  assert.match(r.written[0].todo, /not the recommendation \(keep\).*The note adds instructions/);
  assert.deepEqual(r.unknown, ["ghost"]);
  assert.deepEqual(r.open, ["glass"]);
  const ruling = fs.readFileSync(path.join(dir, r.written[0].file), "utf8");
  assert.match(ruling, /^---\nid: sky-exposure\noption: revert\ndate: 2026-03-04\n---\n/);
  assert.match(ruling, /## Choice\n\n`revert`: Go back \(the recommendation was `keep`\)/);
  assert.match(ruling, /## Note\n\nToo bright for dusk\.\nKeep the sun\.\n/, "the note is kept word for word");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, ".agents/perceptual/decisions/queue.json"), "utf8")).map((i) => i.id), ["glass"]);
  pl(dir, ADD);
  const again = json(pl(dir, ["review", "apply", write(dir, "d2.json", JSON.stringify({ decidedAt: "2026-03-04T18:00:00Z", items: [{ id: "sky-exposure", option: null, note: "Ask again with the sunset shot." }] })), "--json"]));
  assert.equal(again.written[0].file, ".agents/perceptual/decisions/2026-03-04-sky-exposure-2.md", "a second ruling on one day keeps the first");
  assert.match(again.written[0].todo, /the note is the ruling/);
  assert.equal(pl(dir, ["review", "apply", write(dir, "bad.json", "{\"nope\": 1}")]).status, 2);
});

// ---- blind -------------------------------------------------------------------------------

test("blind copies to A, B and R in a fresh temp folder, letters from sha256(id), the key kept apart", () => {
  const dir = project();
  const before = path.join(dir, "pics/ref.png"), after = path.join(dir, "pics/after.png");
  // two ids whose first hash bytes differ in parity, so both labellings are exercised
  const parity = (id) => crypto.createHash("sha256").update(id).digest()[0] % 2;
  const ids = ["sky_0", "sky_1", "sky_2", "sky_3", "road_a", "road_b"];
  const even = ids.find((id) => parity(id) === 0), odd = ids.find((id) => parity(id) === 1);
  for (const id of [even, odd]) {
    const a = json(pl(dir, ["blind", "--id", id, "--before", before, "--after", after, "--reference", before, "--json"]));
    const b = json(pl(dir, ["blind", "--id", id, "--before", before, "--after", after, "--json"]));
    assert.equal(a.aIs, parity(id) === 0 ? "before" : "after");
    assert.equal(b.aIs, a.aIs, "the same id is labelled the same way every time");
    assert.notEqual(path.dirname(a.images.A), path.dirname(b.images.A), "each call gets its own folder");
    const view = path.dirname(a.images.A);
    assert.ok(view.startsWith(os.tmpdir()) || fs.realpathSync(view).startsWith(fs.realpathSync(os.tmpdir())), "under the OS temp directory");
    assert.match(path.basename(view), /^pl-blind-/);
    assert.deepEqual(fs.readdirSync(view).sort(), ["A.png", "B.png", "R.png"], "only the pictures, no key");
    const same = (x, y) => fs.readFileSync(x).equals(fs.readFileSync(y));
    assert.equal(same(a.images.A, a.aIs === "before" ? before : after), true);
    assert.equal(same(a.images.B, a.aIs === "before" ? after : before), true);
    assert.equal(a.key, path.join(dir, ".agents/perceptual/runs/blind", `${id}.json`));
    assert.equal(JSON.parse(fs.readFileSync(a.key, "utf8")).aIs, a.aIs);
    assert.match(pl(dir, ["blind", "reveal", id]).stdout, new RegExp(`^${id}: A is the ${a.aIs}`));
  }
  const text = pl(dir, ["blind", "--id", even, "--before", before, "--after", after]).stdout;
  assert.doesNotMatch(text, /aIs|is the before|is the after/, "the plain output names no letter's state");
  assert.equal(pl(dir, ["blind", "--id", "../x", "--before", before, "--after", after]).status, 2);
  assert.equal(pl(dir, ["blind", "--id", "x", "--before", before, "--after", path.join(dir, "none.png")]).status, 2);
  assert.equal(pl(dir, ["blind", "reveal", "never-made"]).status, 2);
});

// ---- the sheet command ---------------------------------------------------------------------

test("the sheet command writes each kind, gates a diff, and refuses a bad box", () => {
  const dir = project();
  const ref = path.join(dir, "pics/ref.png"), after = path.join(dir, "pics/after.png");
  const trip = json(pl(dir, ["sheet", "triptych", ref, after, "--box", "0.1,0.1,0.5,0.5", "--zoom", "2", "--json"]));
  assert.match(trip.sheet, /runs[\\/]sheets[\\/]triptych-\d{8}-\d{6}\.png$/);
  decodePng(fs.readFileSync(trip.sheet));
  const out = path.join(dir, "out/d.png");
  const diff = pl(dir, ["sheet", "diff", ref, after, "--max-delta-e", "0.001", "--out", out, "--json"]);
  assert.equal(diff.status, 1, "a mean dE above the bound exits 1");
  const doc = JSON.parse(diff.stdout);
  assert.equal(doc.sheet, out);
  assert.equal(doc.passed, false);
  assert.ok(doc.exposureEV > 0.3);
  assert.equal(pl(dir, ["sheet", "diff", ref, ref, "--max-delta-e", "0.001"]).status, 0);
  assert.equal(path.extname(json(pl(dir, ["sheet", "contact", path.join(dir, "pics"), "--jpeg", "--json"])).sheet), ".jpg");
  for (const box of ["0.5,0,0.4,1", "0,0,1", "a,b,c,d", "0,0,1.2,1"]) assert.equal(pl(dir, ["sheet", "triptych", ref, "--box", box]).status, 2, box);
  assert.equal(pl(dir, ["sheet", "triptych", path.join(dir, "none.png")]).status, 2);
  assert.equal(pl(dir, ["sheet", "nope"]).status, 2);
  assert.equal(pl(dir, ["sheet"]).status, 2);
});

// ---- lint ----------------------------------------------------------------------------------

const rules = (text, opts) => lint(text, opts).map((f) => f.rule);

test("lint: a verdict read off a metric fails; one that says what the picture shows does not", () => {
  assert.deepEqual(rules("The ssim got worse after the change."), ["metric-verdict"]);
  assert.deepEqual(rules("deltaE regressed by 0.4 on sky_0."), ["metric-verdict"]);
  assert.deepEqual(rules("The sheet shows the sky is darker, and the ssim is worse."), [], "it says what the picture shows");
  assert.deepEqual(rules("The ssim moved from 0.91 to 0.88."), []);
  assert.deepEqual(rules("It is not worse in ssim terms."), [], "negated");
  assert.deepEqual(rules("Is the ssim worse?"), [], "a question");
});

test("lint: a claim needs an artefact nearby; hedged and planned claims are left alone", () => {
  assert.deepEqual(rules("It works."), ["bare-claim"]);
  assert.deepEqual(rules("Verified."), ["bare-claim"]);
  assert.deepEqual(rules("Verified with `npm test`."), []);
  assert.deepEqual(rules("The bug is fixed in plugins/perceptual-loop/scripts/lib/jpeg.mjs."), []);
  assert.deepEqual(rules("It works. See `runs/iterate/sky_0/sheet.candidate.png`."), [], "the artefact in the next sentence");
  assert.deepEqual(rules("The gate passes:\n\n- 12 of 12 entries ok"), [], "the artefact under a line ending in a colon");
  assert.deepEqual(rules("The tests should pass once merged."), []);
  assert.deepEqual(rules("This is not verified."), []);
  assert.deepEqual(rules("A fixed seed keeps it stable."), [], "fixed as an adjective");
  assert.deepEqual(rules("Confirmed in !31 and 4f3c2a1."), []);
});

test("lint: targets against the reference fail; counts and skipped work are hints", () => {
  assert.deepEqual(rules("Get deltaE below 2 against the reference."), ["reference-target"]);
  assert.deepEqual(rules("Done when it is within 5 % of the reference."), ["reference-target"]);
  assert.deepEqual(rules("Done when it is within 5 % of the mockup.", { referenceNames: ["mockup"] }), ["reference-target"]);
  assert.deepEqual(rules("The gate tolerance keeps ssim above 0.9 of its baseline."), [], "a tolerance is a gate, not a target");
  const hints = lint("Everything is green in `npm test`.\n\nFull pass on the suite: 40 runs.");
  assert.deepEqual(hints.map((f) => [f.rule, f.hint]), [["no-skipped", true]]);
  assert.deepEqual(rules("Full pass on the suite: 40 runs. Nothing was skipped."), []);
  assert.deepEqual(rules("All tests green and happy."), ["no-count"]);
  assert.deepEqual(rules("```\nit works\nssim got worse\n```\n> it works\n"), [], "code and quotes are not read");
});

test("lint's CLI reads stdin, exits 1 on a finding and 0 on hints alone", () => {
  const dir = tempDir("pl-lint-");
  const bad = pl(dir, ["lint", "-"], { input: "Intro.\n\nThe ssim got worse.\n" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^stdin:3: metric-verdict: The ssim got worse\.\n    fix: /m);
  const hint = pl(dir, ["lint", "--json"], { input: "All checks green and happy." });
  assert.equal(hint.status, 0);
  assert.deepEqual(JSON.parse(hint.stdout).hints, 1);
  assert.equal(pl(dir, ["lint", path.join(dir, "none.md")]).status, 2);
});

// ---- timing --------------------------------------------------------------------------------

test("timing reports per phase, the runs over budget, and advice, from the two logs", () => {
  const dir = project();
  const line = (when, shots, render, compare, sheets, reason = null) => JSON.stringify({ when, run: "iterate", shots, sources: ["candidate"], seconds: { render, compare, sheets, total: render + compare + sheets }, reason });
  write(dir, ".agents/perceptual/runs/timing.jsonl", [
    line("2026-03-01T10:00:00Z", 1, 50, 10, 4), line("2026-03-01T10:20:00Z", 2, 70, 12, 5), line("2026-03-01T11:05:00Z", 3, 80, 8, 3),
    line("2026-03-02T09:00:00Z", 12, 400, 30, 20, "full: done"), line("2026-03-02T09:30:00Z", 8, 200, 20, 10, "verify: sky works"),
    "not json", JSON.stringify({ seconds: {} }),
  ].join("\n") + "\n");
  write(dir, ".agents/perceptual/runs/budget.log", ["2026-03-02T09:00:00Z\tfull\t12\tdone\tnode pl.mjs iterate --all",
    "2026-03-02T12:00:00Z\tfull\t12\tagain\tnode pl.mjs iterate --all", "2026-03-02T15:00:00Z\tfull\t12\tonce more\tnode pl.mjs iterate --all"].join("\n") + "\n");
  const r = json(pl(dir, ["timing", "--json"]));
  assert.equal(r.iterations, 5);
  assert.deepEqual(r.phases.render, { count: 5, median: 80, p90: 400, total: 800 });
  assert.deepEqual(r.phases.sheets, { count: 5, median: 5, p90: 20, total: 42 });
  assert.equal(r.iteration.median, 91);
  assert.equal(r.overBudget.count, 2);
  assert.equal(r.budgetLog.byKind.full, 3);
  assert.ok(r.advice.some((a) => /median iteration takes 91 s/.test(a)));
  assert.ok(r.advice.some((a) => /3 full runs on 2026-03-02/.test(a)));
  assert.ok(r.advice.some((a) => /2 line\(s\) of timing\.jsonl could not be read/.test(a)));
  const since = json(pl(dir, ["timing", "--since", "2026-03-02", "--json"]));
  assert.equal(since.iterations, 2);
  assert.equal(pl(dir, ["timing", "--since", "yesterday"]).status, 2);
  assert.match(pl(tempDir("pl-timing-"), ["timing"]).stdout, /No iterations recorded/);
});

// ---- the critique workflow, with stub agents -------------------------------------------------

const WORKFLOW = path.join(PLUGIN, "skills", "judge-and-queue", "workflows", "critique.js");
const AsyncFunction = (async () => {}).constructor;

/** Run the workflow script as the Workflow tool would, with stub agents and the same pipeline and parallel semantics. */
function runWorkflow(args, answer) {
  const src = fs.readFileSync(WORKFLOW, "utf8");
  assert.match(src, /^export const meta = \{/);
  const body = src.replace(/^export const meta =/, "const meta =");
  const calls = [], logs = [];
  const agent = async (prompt, opts) => { calls.push({ prompt, opts }); return answer(prompt, opts); };
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let v = item;
    for (const stage of stages) { try { v = await stage(v, item, i); } catch { return null; } }
    return v;
  }));
  const parallel = (thunks) => Promise.all(thunks.map(async (t) => { try { return await t(); } catch { return null; } }));
  const run = new AsyncFunction("args", "agent", "pipeline", "parallel", "log", "phase", body);
  return { result: run(args, agent, pipeline, parallel, (m) => logs.push(m), () => {}), calls, logs };
}

const neutral = (folder = "pl-blind-x7Qa2b") => ({ A: `/tmp/${folder}/A.png`, B: `/tmp/${folder}/B.png`, R: `/tmp/${folder}/R.png` });

test("the critique workflow refuses picture names that tell which state they are", async () => {
  const cases = [
    { A: "/proj/runs/iterate/sky_0/before.candidate.png", B: "/proj/.agents/perceptual/shots/sky_0/candidate.png" },
    { A: "/tmp/x/old.png", B: "/tmp/x/new.png" },
    { A: "/tmp/x/B.png", B: "/tmp/x/A.png" },
    { A: "/tmp/before/A.png", B: "/tmp/before/B.png" },
    { A: "/tmp/after-1/A.png", B: "/tmp/after-1/B.png" },
    { ...neutral(), R: "/tmp/pl-blind-x7Qa2b/reference.png" },
  ];
  for (const images of cases) {
    const { result, calls } = runWorkflow({ pluginRoot: "/plugins/pl", items: [{ id: "sky_0", images, aIs: "before", observables: ["is the sky blue?"] }] }, () => null);
    await assert.rejects(result, /tell the critic which state they are.*pl\.mjs" blind --id/s, JSON.stringify(images));
    assert.equal(calls.length, 0, "no agent is dispatched");
  }
  await assert.rejects(runWorkflow({ items: [{ id: "x", images: neutral(), aIs: "before" }] }, () => null).result, /pluginRoot is required/);
  await assert.rejects(runWorkflow({ pluginRoot: "/p", items: [] }, () => null).result, /args must be/);
  await assert.rejects(runWorkflow({ pluginRoot: "/p", items: [{ id: "x", images: neutral() }] }, () => null).result, /no usable item/);
});

test("the critique workflow keeps the key out of every prompt and translates letters to states at the end", async () => {
  const critic = {
    observables: [{ question: "is the sky blue?", a: "yes", b: "no", seen: "top third" }],
    defects: [{ image: "A", where: "left third", what: "banding" }, { image: "B", where: "top", what: "a seam" }],
    differences: [{ what: "lighter sky", where: "top", morePlausible: "B", why: "the sun is up" }, { what: "grain", where: "all over", morePlausible: "cannot tell", why: "both have it" }],
    couldNotJudge: ["the text, too small"],
  };
  const answer = (prompt, opts) => {
    if (opts.phase === "Critique") return critic;
    if (prompt.includes("a seam")) return { refuted: true, why: "no seam there" };
    if (prompt.includes("lighter sky")) return null; // a skeptic that failed
    return { refuted: false, why: "visible" };
  };
  for (const aIs of ["before", "after"]) {
    const { result, calls, logs } = runWorkflow(JSON.stringify({ pluginRoot: "/plugins/pl/", items: [{ id: "sky_0", images: neutral(), aIs, observables: ["is the sky blue?"], box: "0,0,0.5,0.5" }] }), answer);
    const out = await result;
    for (const c of calls) {
      assert.equal(c.opts.agentType, "perceptual-loop:vision-critic");
      assert.doesNotMatch(c.prompt, /\b(before|after|aIs)\b/i, "no prompt names a state or carries the key");
      assert.match(c.prompt, /The plugin root, for a crop, is \/plugins\/pl\./);
    }
    assert.equal(calls.filter((c) => c.opts.phase === "Critique").length, 1);
    assert.equal(calls.filter((c) => c.opts.phase === "Refute").length, 3, "one skeptic per defect and per ranked difference");
    assert.match(calls[0].prompt, /Attend to the box 0,0,0\.5,0\.5/);
    const [item] = out.items;
    const aState = aIs, bState = aIs === "before" ? "after" : "before";
    assert.deepEqual(item.observables, [{ question: "is the sky blue?", [aState]: "yes", [bState]: "no", seen: "top third" }]);
    assert.deepEqual(item.findings, [
      { kind: "defect", verified: true, on: aState, what: "banding", where: "left third" },
      { kind: "difference", verified: false, morePlausible: bState, what: "lighter sky", where: "top", why: "the sun is up" },
    ]);
    assert.deepEqual(item.unrankedDifferences, [{ what: "grain", where: "all over", why: "both have it" }]);
    assert.deepEqual([out.critiqued, out.notCovered, out.refuted, out.unverified, out.unranked], [1, 0, 1, 1, 1]);
    assert.ok(logs.some((l) => /1 critiqued; 1 finding\(s\) refuted/.test(l)));
  }
});
