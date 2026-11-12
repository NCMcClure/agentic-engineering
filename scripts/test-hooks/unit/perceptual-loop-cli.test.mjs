// perceptual-loop's CLI in a temp project, with a fixture renderer that writes
// each shot's candidate picture at an exposure read from a file: init and
// new-shot, iterate with its exit codes, the kept before picture, the timing
// line, the shot's sheet, the budget refusal, a targeted baseline update,
// calibration, groups, and the render command in both of its forms.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { PL, PLUGIN, runNode, scene, tempDir, u8, write } from "./perceptual-loop-fixtures.mjs";

import { decodePng, encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

const SHOTS = ["sky_0", "sky_1", "sky_2", "sky_3", "road_a"];
const ENV = { PL_RUN: "", PL_DIR: "", PL_SHOTS_DIR: "" };

// The renderer: `node render.mjs <shot>...` writes <shot>/candidate.png at the gain in gain.json.
const RENDERER = `import fs from "node:fs";
import path from "node:path";
import { encodePng } from ${JSON.stringify(pathToFileURL(path.join(PLUGIN, "scripts", "lib", "png.mjs")).href)};
const gain = JSON.parse(fs.readFileSync("gain.json", "utf8"));
const dir = process.env.SHOTS ?? ".agents/perceptual/shots";
for (const shot of process.argv.slice(2)) {
  const ref = fs.readFileSync(path.join(dir, shot, "reference.png"));
  const w = 64, h = 48, data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.min(255, Math.round(((i * 7 + c * 40 + shot.length * 13) % 200 + 20) * gain));
  fs.writeFileSync(path.join(dir, shot, "candidate.png"), encodePng({ width: w, height: h, channels: 3, data }));
  process.stdout.write("rendered " + shot + " from " + ref.length + " bytes of reference\\n");
}
`;

const pl = (dir, args, env = {}) => runNode(PL, args, { cwd: dir, env: { ...ENV, ...env } });
const json = (r) => { assert.equal(r.stderr.includes("internal error"), false, r.stderr); return JSON.parse(r.stdout); };

/** A project with five shots, each with a reference matching the renderer at gain 1. */
function project({ render = "node render.mjs {shots}" } = {}) {
  const dir = tempDir("pl-cli-");
  write(dir, "render.mjs", RENDERER);
  write(dir, "gain.json", "1\n");
  const r = pl(dir, ["init", "--render", `candidate=${typeof render === "string" ? render : "x"}`, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  if (typeof render !== "string") {
    const file = path.join(dir, ".agents/perceptual/config.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config.render.candidate = render;
    fs.writeFileSync(file, JSON.stringify(config));
  }
  for (const shot of SHOTS) {
    const w = 64, h = 48, data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.min(255, Math.round((i * 7 + c * 40 + shot.length * 13) % 200 + 20));
    const ref = write(dir, `in/${shot}.png`, "");
    fs.writeFileSync(ref, encodePng({ width: w, height: h, channels: 3, data }));
    const made = pl(dir, ["new-shot", shot, "--meta", `sky=${shot.startsWith("sky")}`, "--meta", `n=${shot.at(-1)}`, "--from-image", `reference=${ref}`, "--json"]);
    assert.equal(made.status, 0, made.stderr);
  }
  return dir;
}

test("init scaffolds the state folder once and never overwrites", () => {
  const dir = tempDir("pl-init-");
  write(dir, ".agents/AGENTS.md", "# .agents\n\n## Layout\n\n- `rules/` - the rules.\n");
  const first = json(pl(dir, ["init", "--render", "candidate=npm run render -- {shots}", "--json"]));
  assert.deepEqual(first.created, [".agents/perceptual/config.json", ".agents/perceptual/groups.json", ".agents/perceptual/baseline.json",
    ".agents/perceptual/.gitignore", ".agents/perceptual/success/", ".agents/perceptual/decisions/"]);
  assert.equal(first.hubLine, "added");
  const hub = fs.readFileSync(path.join(dir, ".agents/AGENTS.md"), "utf8");
  assert.match(hub, /^- `rules\/` - the rules\.\n- `perceptual\/` - /m);
  assert.deepEqual(fs.readFileSync(path.join(dir, ".agents/perceptual/.gitignore"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")), ["shots/", "runs/", "decisions/review.html"]);
  const config = JSON.parse(fs.readFileSync(path.join(dir, ".agents/perceptual/config.json"), "utf8"));
  assert.equal(config.render.candidate, "npm run render -- {shots}");
  assert.deepEqual(config.budget.match, [String.raw`pl\.mjs["']?\s+iterate\b`]);
  const again = json(pl(dir, ["init", "--json"]));
  assert.deepEqual(again.created, []);
  assert.equal(again.exists.length, 6);
  assert.equal(again.hubLine, "present");
  assert.equal(fs.readFileSync(path.join(dir, ".agents/AGENTS.md"), "utf8"), hub);
  assert.equal(pl(dir, ["init", "--reference", "candidate"]).status, 2, "a source cannot be both");
  assert.equal(pl(dir, ["init", "--candidate", "a.b"]).status, 2, "a source id has no dot");
});

test("new-shot and new-success write the contract's files and refuse bad names", () => {
  const dir = project();
  const shot = JSON.parse(fs.readFileSync(path.join(dir, ".agents/perceptual/shots/sky_0/shot.json"), "utf8"));
  assert.deepEqual(shot, { name: "sky_0", meta: { sky: true, n: 0 } });
  const r = json(pl(dir, ["new-shot", "car__front", "--region", "body=0.1,0.2,0.9,0.8", "--id", "body=#FF0000", "--json"]));
  assert.deepEqual(r.created.map((p) => path.basename(p)), ["shot.json", "ids.json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, ".agents/perceptual/shots/car__front/ids.json"), "utf8")), { body: [255, 0, 0] });
  for (const bad of [["new-shot", "bad name"], ["new-shot", "-x"], ["new-shot", "ok", "--region", "a=0.5,0,0.4,1"], ["new-shot", "ok2", "--id", "a=red"]]) {
    assert.equal(pl(dir, bad).status, 2, bad.join(" "));
  }
  const s = json(pl(dir, ["new-success", "Make the sky bluer", "--json"]));
  const text = fs.readFileSync(s.path, "utf8");
  assert.equal(path.basename(s.path), "make-the-sky-bluer.md");
  assert.match(text, /^# Make the sky bluer\n/);
  for (const part of ["Triage", "Observables", "Proving shots", "Not a goal", "Unknowns", "Left to the owner"]) assert.match(text, new RegExp(`^## ${part}$`, "m"));
});

test("iterate renders, compares, gates, keeps the before picture, and logs its time", () => {
  const dir = project();
  const first = pl(dir, ["iterate", "sky_0", "--json"]);
  assert.equal(first.status, 0, first.stderr);
  const doc = JSON.parse(first.stdout);
  assert.equal(doc.passed, true);
  assert.match(first.stderr, /rendered sky_0/, "with --json the renderer's output goes to stderr");
  assert.deepEqual(doc.before, [], "nothing to keep before the first render");
  assert.ok(doc.gate.candidate.totals.new > 0);
  const metrics = JSON.parse(fs.readFileSync(path.join(dir, ".agents/perceptual/runs/iterate/sky_0/metrics.candidate.json"), "utf8"));
  assert.equal(metrics.frame.ssim, 1);

  const accept = pl(dir, ["baseline", "update", "--source", "candidate", "--run", "iterate", "sky_0"]);
  assert.equal(accept.status, 0, accept.stderr);
  assert.match(accept.stdout, /entries changed, \d+ added, 0 removed/);

  fs.writeFileSync(path.join(dir, "gain.json"), "1.2\n");
  const moved = pl(dir, ["iterate", "sky_0"]);
  assert.equal(moved.status, 1, "the exposure moved beyond tolerance");
  assert.match(moved.stdout, /frame\.exposureEV/);
  assert.match(moved.stdout, /beyond tolerance: open the sheets/);
  const sheet = path.join(fs.realpathSync(dir), ".agents/perceptual/runs/iterate/sky_0/sheet.candidate.png");
  assert.ok(moved.stdout.includes(`\n  sheet: ${sheet}\n`), "the sheet replaces the three picture paths");
  assert.doesNotMatch(moved.stdout, /^  look: /m);
  const drawn = decodePng(fs.readFileSync(sheet));
  assert.ok(drawn.width <= 1568 && drawn.height > 48, `${drawn.width}x${drawn.height}`);
  assert.doesNotMatch(moved.stdout, /worse/);
  assert.ok(fs.existsSync(path.join(dir, ".agents/perceptual/runs/iterate/sky_0/before.candidate.png")));
  const timing = fs.readFileSync(path.join(dir, ".agents/perceptual/runs/timing.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(timing.length, 2);
  assert.deepEqual(Object.keys(timing[1]), ["when", "run", "shots", "sources", "rendered", "seconds", "reason", "cached", "gate"]);
  assert.deepEqual(Object.keys(timing[1].seconds), ["render", "compare", "sheets", "total"]);
  assert.equal(typeof timing[1].seconds.sheets, "number", "drawing the sheet is timed");
  assert.equal(timing[1].gate.candidate.beyond > 0, true);

  const bare = json(pl(dir, ["iterate", "sky_0", "--skip-render", "--no-sheets", "--run", "plain", "--json"]));
  assert.equal(bare.shots[0].sheet, null);
  assert.equal(bare.seconds.sheets, 0);
  assert.ok(bare.shots[0].look.after, "without a sheet the picture paths are given");
  assert.equal(fs.existsSync(path.join(dir, ".agents/perceptual/runs/plain/sky_0/sheet.candidate.png")), false);

  const check = pl(dir, ["baseline", "check", "--source", "candidate", "--run", "iterate", "--json"]);
  assert.equal(check.status, 1);
  assert.ok(JSON.parse(check.stdout).entries.some((e) => e.status === "beyond"));
});

test("the budget refuses a large render without a reason, and a dry run shows what it would do", () => {
  const dir = project();
  const refused = pl(dir, ["iterate", "--all"]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /5 shots selected/);
  assert.match(refused.stderr, /PL_RUN="verify:/);
  assert.ok(!fs.existsSync(path.join(dir, ".agents/perceptual/shots/sky_0/candidate.png")), "nothing was rendered");
  const dry = json(pl(dir, ["iterate", "--all", "--dry-run", "--json"]));
  assert.equal(dry.withinBudget, false);
  assert.equal(dry.render.candidate, "node render.mjs road_a sky_0 sky_1 sky_2 sky_3");
  const ran = pl(dir, ["iterate", "--all", "--json"], { PL_RUN: "verify: sky_0 works, this checks the rest" });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(JSON.parse(ran.stdout).reason, "verify: sky_0 works, this checks the rest");
  assert.equal(pl(dir, ["iterate", "--all", "--skip-render"]).status, 0, "comparing what is there is free");
});

test("an argv render command is spawned without a shell, one argument per shot", () => {
  const dir = project({ render: ["node", "render.mjs", "{shots}"] });
  const r = pl(dir, ["iterate", "sky_0", "sky_1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, ".agents/perceptual/shots/sky_1/candidate.png")));
  write(dir, ".agents/perceptual/shots/odd name/shot.json", "{}\n");
  const bad = pl(dir, ["iterate", "odd name"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /odd name/);
  // exitCode, not process.exit(): exit() after start-up segfaults now and then on node 24 / macOS (dev-rules)
  const failing = project({ render: "node -e \"process.exitCode = 3\"" });
  const f = pl(failing, ["iterate", "sky_0"]);
  assert.equal(f.status, 2);
  assert.match(f.stderr, /exited with 3: nothing was compared/);
});

test("compare, a targeted update that leaves other shots alone, and calibration over repeated runs", () => {
  const dir = project();
  assert.equal(pl(dir, ["iterate", "--group", "smoke"]).status, 2, "an empty group selects nothing");
  fs.writeFileSync(path.join(dir, ".agents/perceptual/groups.json"), JSON.stringify({ smoke: ["sky_0", "road_*"], sky: ["sky_*"] }));
  assert.equal(pl(dir, ["iterate", "--group", "smoke"]).status, 0);
  const cmp = json(pl(dir, ["compare", "--run", "c1", "--group", "sky", "--json"]));
  assert.equal(cmp.filter((d) => d.error).length, 3, "sky_1..3 have no candidate yet");
  assert.match(cmp.find((d) => d.shot === "sky_1").error, /missing pass: candidate\.png/);
  assert.equal(pl(dir, ["baseline", "update", "--source", "candidate", "--run", "c1", "--group", "sky"]).status, 2, "a run that cannot update every shot writes nothing");
  assert.equal(pl(dir, ["baseline", "update", "--source", "candidate", "--run", "iterate"]).status, 2, "update is always targeted");
  assert.equal(pl(dir, ["baseline", "update", "--source", "candidate", "--run", "iterate", "--all-shots-of-run"]).status, 0);
  const base = JSON.parse(fs.readFileSync(path.join(dir, ".agents/perceptual/baseline.json"), "utf8"));
  assert.deepEqual([...new Set(Object.keys(base.entries).map((k) => k.split("/")[0]))], ["road_a", "sky_0"]);

  const rep = pl(dir, ["iterate", "--group", "smoke", "--run", "cal", "--repeat", "3", "--skip-render"]);
  assert.equal(rep.status, 0, rep.stderr);
  assert.match(rep.stdout, /next: pl\.mjs calibrate --runs cal1,cal2,cal3/);
  assert.equal(fs.existsSync(path.join(dir, ".agents/perceptual/runs/cal1/sky_0/sheet.candidate.png")), false, "calibration runs draw no sheets");
  const cal = json(pl(dir, ["calibrate", "--runs", "cal1,cal2,cal3", "--write-tolerances", "--json"]));
  assert.equal(cal.classes["candidate/frame.ssim"].tolerance, 0.002, "a quiet run stops at the floor");
  const tol = pl(dir, ["baseline", "tolerances", "show"]);
  assert.match(tol.stdout, /candidate\/frame\.ssim\s+0\.002\s+3 runs of 2 shots/);
  assert.equal(pl(dir, ["baseline", "tolerances", "set", "candidate/frame.ssim", "0.01"]).status, 2, "a tolerance needs its note");
  assert.equal(pl(dir, ["calibrate", "--runs", "cal1"]).status, 2, "a spread needs two runs");
});

test("groups list, resolve, and propose a smoke set", () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, ".agents/perceptual/groups.json"), JSON.stringify({ sky: ["sky_*"], notroad: ["*", "!road_*"] }));
  const list = json(pl(dir, ["groups", "list", "--json"]));
  assert.deepEqual(list, { shots: 5, groups: { sky: 4, notroad: 4 } });
  assert.deepEqual(json(pl(dir, ["groups", "resolve", "--group", "sky", "--match", "*_[01]", "--json"])).shots, ["sky_0", "sky_1"]);
  const smoke = json(pl(dir, ["groups", "suggest-smoke", "--by", "sky", "--json"]));
  assert.deepEqual(smoke.smoke, ["road_a", "sky_0"]);
  assert.equal(smoke.combinations, 2);
  assert.equal(pl(dir, ["groups", "suggest-smoke", "--by", "colour"]).status, 2);
});

test("usage: help, unknown commands, unknown flags", () => {
  const dir = tempDir("pl-usage-");
  const help = pl(dir, ["--help"]);
  assert.equal(help.status, 0);
  for (const cmd of ["init", "new-shot", "new-success", "groups", "compare", "baseline", "calibrate", "iterate"]) assert.match(help.stdout, new RegExp(`\\b${cmd}\\b`));
  assert.equal(pl(dir, []).status, 2);
  assert.equal(pl(dir, ["frobnicate"]).status, 2);
  assert.equal(pl(dir, ["iterate", "--help"]).status, 0);
  assert.equal(pl(dir, ["iterate", "--nope"]).status, 2);
  assert.match(pl(dir, ["iterate", "x"]).stderr, /run pl\.mjs init first/);
});

test("a picture that is not a PNG needs ffmpeg, and the message names both ways out", () => {
  const dir = project();
  write(dir, "in/photo.jpg", "not really a jpeg");
  const r = pl(dir, ["new-shot", "photo", "--from-image", "reference=in/photo.jpg"], { PL_FFMPEG: path.join(dir, "no-such-ffmpeg") });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ffmpeg/);
  assert.match(r.stderr, /PL_FFMPEG/);
  assert.match(r.stderr, /convert .* to PNG/);
});

test("a JPEG goes through ffmpeg into the PNG decoder", { skip: !hasFfmpeg }, () => {
  const dir = project();
  const src = write(dir, "in/scene.png", "");
  fs.writeFileSync(src, encodePng(u8(scene(64, 48))));
  const jpg = path.join(dir, "in/scene.jpg");
  assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-q:v", "2", jpg]).status, 0);
  const r = pl(dir, ["new-shot", "photo", "--from-image", `reference=${jpg}`, "--from-image", `candidate=${src}`]);
  assert.equal(r.status, 0, r.stderr);
  const cmp = json(pl(dir, ["compare", "photo", "--run", "j", "--json"]));
  assert.ok(cmp[0].frame.ssim > 0.9, `ssim ${cmp[0].frame.ssim}`);
});
