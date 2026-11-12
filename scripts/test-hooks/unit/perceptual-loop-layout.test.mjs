// perceptual-loop's edges with the project it runs in: a repo still on the
// first layout (.perceptual-loop/) is read where it is, a config that still
// spells that folder keeps finding its shots once the folder has moved, a
// render command is started as a program and never through a shell, and the
// two Python extras say plainly what they need when it is not there.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pythonRunner, runExtra } from "../../../plugins/perceptual-loop/scripts/commands/extras.mjs";
import { encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
import * as project from "../../../plugins/perceptual-loop/scripts/lib/project.mjs";
import { describe, renderCommand, shellOnly, startFailure } from "../../../plugins/perceptual-loop/scripts/lib/render.mjs";
import { PL, PLUGIN, runNode, tempDir, write } from "./perceptual-loop-fixtures.mjs";

const ENV = { PL_RUN: "", PL_DIR: "", PERCEPTUAL_LOOP_DIR: "", PL_SHOTS_DIR: "", PL_PYTHON: "" };
const pl = (dir, args, env = {}) => runNode(PL, args, { cwd: dir, env: { ...ENV, ...env } });
const picture = (level) => {
  const width = 32, height = 24, data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) data.set([(i * 5) % 200 + level, (i * 3) % 180 + level, 90], i * 3);
  return encodePng({ width, height, channels: 3, data });
};

/** A project as the plugin's first layout wrote it: the state folder at the root, its config naming that folder. */
function firstLayout({ shotsDir = ".perceptual-loop/shots" } = {}) {
  const dir = tempDir("pl-old-");
  const config = { version: 1, reference: "reference", candidates: ["candidate"], render: {}, passes: ["beauty"], regionsFrom: "reference",
    budget: { free: 3, match: [] }, metrics: { ssim: true, deltaE: true, edges: true, detail: true } };
  if (shotsDir) config.shotsDir = shotsDir;
  write(dir, ".perceptual-loop/config.json", JSON.stringify(config, null, 2) + "\n");
  write(dir, ".perceptual-loop/groups.json", JSON.stringify({ smoke: ["sky_*"] }));
  write(dir, ".perceptual-loop/baseline.json", JSON.stringify({ version: 1, tolerances: { "*/frame.ssim": 0.01 }, minRegionArea: 0.002, spread: {}, entries: {}, notes: {} }));
  for (const shot of ["sky_0", "sky_1"]) {
    write(dir, `.perceptual-loop/shots/${shot}/shot.json`, JSON.stringify({ name: shot, meta: {} }));
    fs.writeFileSync(path.join(dir, `.perceptual-loop/shots/${shot}/reference.png`), picture(20));
    fs.writeFileSync(path.join(dir, `.perceptual-loop/shots/${shot}/candidate.png`), picture(24));
  }
  return dir;
}

// ---- the first layout -----------------------------------------------------------------------

test("a repo still on the first layout is read where it is: the root, the state folder, the shots, a run", () => {
  const dir = firstLayout();
  assert.equal(project.findRoot(path.join(dir, ".perceptual-loop", "shots", "sky_0")), dir);
  assert.equal(project.onOldLayout(dir), true);
  assert.equal(project.stateDir(dir), path.join(dir, ".perceptual-loop"));
  assert.deepEqual(project.allShots(dir, project.loadConfig(dir)), ["sky_0", "sky_1"]);
  const r = pl(dir, ["iterate", "--group", "smoke", "--skip-render", "--no-sheets", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).shots.length, 2);
  assert.ok(fs.existsSync(path.join(dir, ".perceptual-loop/runs/iterate/sky_0/metrics.candidate.json")), "the run lands beside the state it was read from");
  assert.equal(fs.existsSync(path.join(dir, ".agents")), false, "nothing is written to a folder the repo does not have yet");
  const accept = pl(dir, ["baseline", "update", "--source", "candidate", "--run", "iterate", "sky_0"]);
  assert.equal(accept.status, 0, accept.stderr);
  assert.ok(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, ".perceptual-loop/baseline.json"), "utf8")).entries).length > 0);
});

test("a first-layout config that never named its shots folder keeps them beside itself", () => {
  const dir = firstLayout({ shotsDir: null });
  assert.equal(project.loadConfig(dir).shotsDir, ".perceptual-loop/shots");
  assert.deepEqual(project.allShots(dir, project.loadConfig(dir)), ["sky_0", "sky_1"]);
});

test("once the folder has moved, a config that still spells the old one finds its shots in the new", () => {
  const dir = firstLayout();
  fs.mkdirSync(path.join(dir, ".agents"));
  fs.renameSync(path.join(dir, ".perceptual-loop"), path.join(dir, ".agents", "perceptual"));
  assert.equal(project.onOldLayout(dir), false);
  const config = project.loadConfig(dir);
  assert.equal(config.shotsDir, ".perceptual-loop/shots", "the file is not rewritten");
  assert.equal(project.shotsDir(dir, config), path.join(dir, ".agents", "perceptual", "shots"));
  assert.deepEqual(project.allShots(dir, config), ["sky_0", "sky_1"]);
  assert.deepEqual(project.oldPathKeys(config), [["shotsDir", ".perceptual-loop/shots", ".agents/perceptual/shots"]]);
  const r = pl(dir, ["compare", "--all", "--run", "moved", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, ".agents/perceptual/runs/moved/sky_1/metrics.candidate.json")));
  // a question queued before the move names its pictures in the old folder, and the page still finds them
  write(dir, ".agents/perceptual/decisions/queue.json", JSON.stringify([{ id: "sky", title: "Sky", question: "Which exposure?", options: [{ id: "keep", label: "Keep" }],
    images: [{ label: "before", path: ".perceptual-loop/shots/sky_0/reference.png" }, { label: "after", path: ".perceptual-loop/shots/sky_0/candidate.png" }] }]));
  const page = pl(dir, ["review", "build", "--json"]);
  assert.equal(page.status, 0, page.stderr);
  assert.deepEqual(JSON.parse(page.stdout).warnings, [], "no picture is reported missing");
  // a path the config names elsewhere is used as written
  assert.equal(project.configPath(dir, "renders/shots"), path.join(dir, "renders", "shots"));
  // and where both folders exist, the old spelling still means the old folder
  fs.mkdirSync(path.join(dir, ".perceptual-loop", "shots"), { recursive: true });
  assert.equal(project.shotsDir(dir, config), path.join(dir, ".perceptual-loop", "shots"));
});

test("the current layout wins where both hold a config, and every value naming the old folder is listed", () => {
  const dir = firstLayout();
  write(dir, ".agents/perceptual/config.json", JSON.stringify({ render: { candidate: "node tools/render.mjs --out .perceptual-loop/shots {shots}", reference: ["capture", ".perceptual-loop/shots"] } }));
  assert.equal(project.stateDir(dir), path.join(dir, ".agents", "perceptual"));
  assert.deepEqual(project.oldPathKeys(project.loadConfig(dir)).map(([key, , now]) => [key, now]), [
    ["render.candidate", "node tools/render.mjs --out .agents/perceptual/shots {shots}"],
    ["render.reference[1]", ".agents/perceptual/shots"],
  ]);
});

test("the state folder's variable answers to PL_DIR, and still to the name it had first", () => {
  const dir = firstLayout(), elsewhere = tempDir("pl-env-");
  fs.cpSync(path.join(dir, ".perceptual-loop"), path.join(elsewhere, "state"), { recursive: true });
  const shots = path.join(elsewhere, "state", "shots");
  for (const name of ["PL_DIR", "PERCEPTUAL_LOOP_DIR"]) {
    const r = pl(tempDir("pl-cwd-"), ["groups", "resolve", "--all", "--json"], { [name]: path.join(elsewhere, "state"), PL_SHOTS_DIR: shots });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.match(r.stdout, /sky_0/, name);
  }
});

// ---- the render command ---------------------------------------------------------------------

const cmd = (render, shots = ["sky_0", "sky_1"], dir = "/shots dir") => renderCommand({ render: { candidate: render } }, "candidate", shots, dir);

test("a render string is split into words as a shell would, and nothing else of a shell is honoured", () => {
  assert.deepEqual(cmd("npm run render -- {shots}").argv, ["npm", "run", "render", "--", "sky_0", "sky_1"]);
  assert.deepEqual(cmd(`node "tools/my render.mjs" --out {shotsDir} --source={source} {shots}`).argv,
    ["node", "tools/my render.mjs", "--out", "/shots dir", "--source=candidate", "sky_0", "sky_1"], "a quoted word stays one argument, and a folder with a space stays one too");
  assert.deepEqual(cmd("node render.mjs --shots={shots}").argv, ["node", "render.mjs", "--shots=sky_0 sky_1"], "inside an argument the names are joined");
  assert.deepEqual(cmd(String.raw`C:\tools\render.exe {shots}`).argv, [String.raw`C:\tools\render.exe`, "sky_0", "sky_1"], "a backslash is a path separator");
  const withEnv = cmd("QUALITY=low env SEED=7 node render.mjs {shots}");
  assert.deepEqual([withEnv.env, withEnv.argv], [{ QUALITY: "low" }, ["env", "SEED=7", "node", "render.mjs", "sky_0", "sky_1"]], "only the leading NAME=value words are the environment");
  assert.deepEqual(cmd("env QUALITY=low OUT={shotsDir} node render.mjs {shots}").env, { QUALITY: "low", OUT: "/shots dir" });
  assert.equal(cmd("QUALITY=low node 'my render.mjs' {shots}").text, "QUALITY=low node 'my render.mjs' sky_0 sky_1");
  assert.equal(describe(["a b", "c"]), "'a b' c");
});

test("an array is taken as it is, and {shots} as a whole argument becomes one argument per shot", () => {
  assert.deepEqual(cmd(["node", "tools/render.mjs", "--out", "{shotsDir}", "{shots}"]).argv, ["node", "tools/render.mjs", "--out", "/shots dir", "sky_0", "sky_1"]);
  assert.deepEqual(cmd(["bash", "-c", "cd app && npm run render -- {shots}"]).argv, ["bash", "-c", "cd app && npm run render -- sky_0 sky_1"], "a project that wants a shell names it");
  assert.throws(() => cmd([]), /no render command for 'candidate'/);
  assert.throws(() => cmd(["node", 7]), /must be a string or an array of strings/);
  assert.throws(() => cmd(undefined), /add render\.candidate, or pass --skip-render/);
  assert.throws(() => cmd("X=1"), /names no program/);
});

test("what only a shell can do is refused with the fix, never run", () => {
  for (const [line, why] of [["cd app && npm run render -- {shots}", "more than one command"], ["npm run render -- {shots} | tee log.txt", "more than one command"],
    ["npm run render -- {shots}; rm -rf out", "more than one command"], ["npm run render -- {shots} > out.log", "a redirection (>)"],
    ["npm run render -- {shots} 2>&1", "a redirection (2>&1)"], ["node render.mjs $SHOT_ARGS {shots}", "a shell expansion ($SHOT_ARGS)"],
    ["node render.mjs $(cat list) {shots}", "a shell expansion"], ["node render.mjs `cat list`", "a shell expansion"]]) {
    assert.ok(shellOnly(line).startsWith(why), `${line}: ${shellOnly(line)}`);
    assert.throws(() => cmd(line), (e) => e.code === 2 && e.message.includes("never through a shell") && e.message.includes('["bash", "-c", ') && e.message.includes("put that line in a script"), line);
  }
  assert.equal(shellOnly("npm run render -- {shots}"), "");
  assert.equal(shellOnly(`node tools/render.mjs --title "a; b && c | d > e" {shots}`), "", "a quoted word may hold anything");
  assert.throws(() => cmd("node render.mjs {shots}", ["ok", "bad name"]), /refusing to render shot 'bad name'/);
  assert.throws(() => cmd("node render.mjs {shots}", ["a;touch x"]), /refusing to render shot/);
});

test("iterate starts the render as a program: a quoted argument with shell marks in it arrives whole, and nothing else runs", () => {
  const dir = tempDir("pl-render-");
  write(dir, "render.mjs", 'import fs from "node:fs";\nfs.writeFileSync("argv.json", JSON.stringify({ argv: process.argv.slice(2), quality: process.env.QUALITY ?? null }));\n');
  assert.equal(pl(dir, ["init", "--render", `candidate=QUALITY=low node render.mjs --note "x; touch pwned && echo > pwned" {shots}`, "--json"]).status, 0);
  for (const shot of ["sky_0", "sky_1"]) {
    write(dir, `.agents/perceptual/shots/${shot}/shot.json`, JSON.stringify({ name: shot }));
    for (const source of ["reference", "candidate"]) fs.writeFileSync(path.join(dir, `.agents/perceptual/shots/${shot}/${source}.png`), picture(20));
  }
  const dry = pl(dir, ["iterate", "sky_0", "sky_1", "--dry-run", "--json"]);
  assert.equal(JSON.parse(dry.stdout).render.candidate, "QUALITY=low node render.mjs --note 'x; touch pwned && echo > pwned' sky_0 sky_1");
  const r = pl(dir, ["iterate", "sky_0", "sky_1", "--no-sheets", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "argv.json"), "utf8")), { argv: ["--note", "x; touch pwned && echo > pwned", "sky_0", "sky_1"], quality: "low" });
  assert.equal(fs.existsSync(path.join(dir, "pwned")), false);

  // a config edited by hand into a shell line is refused when it would run, and init refuses to write one
  const file = path.join(dir, ".agents/perceptual/config.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.render.candidate = "node render.mjs {shots} && touch pwned";
  fs.writeFileSync(file, JSON.stringify(config));
  const refused = pl(dir, ["iterate", "sky_0"]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /render\.candidate is started as a program with its arguments, never through a shell/);
  assert.equal(fs.existsSync(path.join(dir, "pwned")), false);
  const init = pl(tempDir("pl-render-"), ["init", "--render", "candidate=make shots | tee log"]);
  assert.equal(init.status, 2);
  assert.match(init.stderr, /--render candidate: a render command is started without a shell/);

  // a program that is not there is said plainly
  config.render.candidate = ["no-such-renderer-here", "{shots}"];
  fs.writeFileSync(file, JSON.stringify(config));
  const missing = pl(dir, ["iterate", "sky_0"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /the render of 'candidate' could not start/);
});

test("on Windows a batch file that would not start is answered with the argv that names the shell", () => {
  const error = Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" });
  assert.match(startFailure("candidate", ["npm", "run", "render"], error, "win32"), /\["cmd", "\/c", "npm", \.\.\.\]/);
  assert.equal(startFailure("candidate", ["npm"], error, "linux"), "the render of 'candidate' could not start: spawn npm ENOENT");
});

// ---- the two Python extras ------------------------------------------------------------------

test("exactly two Python files ship, and nothing else in the engine is Python", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const python = walk(PLUGIN).filter((f) => f.endsWith(".py")).map((f) => path.relative(PLUGIN, f).split(path.sep).join("/")).sort();
  assert.deepEqual(python, ["scripts/keypoints.py", "scripts/semantic.py"]);
  // each stands alone: it imports no module of the plugin's own
  for (const rel of python) {
    const text = fs.readFileSync(path.join(PLUGIN, rel), "utf8");
    assert.doesNotMatch(text, /^\s*(?:import|from)\s+(?:pl_common|video|compare|groups|sheet|baseline)\b/m, rel);
    assert.match(text, /^DIR_NAME = "\.agents\/perceptual"$/m, rel);
  }
});

test("an extra's --help says what it is, what it needs, and what it found, without starting Python", () => {
  for (const name of ["semantic", "keypoints"]) {
    const r = pl(tempDir("pl-extra-"), [name, "--help"], { PATH: "" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /An optional extra: it runs \w+\.py, a Python script/);
    assert.match(r.stdout, /runs as {2}nothing: neither uv nor python3 nor python is on PATH/);
  }
  assert.match(pl(tempDir("pl-extra-"), ["--help"]).stdout, /semantic +optional, needs Python and torch.*\n +keypoints +optional, needs Python and mediapipe/);
});

test("without Python, or without the script, an extra exits 2 and says which is missing; the rest of the CLI is untouched", () => {
  const dir = tempDir("pl-extra-");
  const none = pl(dir, ["keypoints", "detect", "x.png"], { PATH: "" });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /pl\.mjs keypoints runs a Python script, and no Python was found/);
  assert.match(none.stderr, /Every other command works without it/);
  assert.equal(pl(dir, ["lint"], { PATH: "" }).status, 0, "a Node command needs neither Python nor the scripts");
  assert.equal(pythonRunner({ PATH: "" }), null);
  assert.deepEqual(pythonRunner({ PATH: "", PL_PYTHON: "/opt/py/bin/python" }).argv, ["/opt/py/bin/python"]);
  assert.throws(() => runExtra("semantic", ["similarity", "a.png", "b.png"], { dir, env: { PATH: "" } }), /this install does not have it\. It is an optional extra/);
});

test("with an interpreter, the arguments go through unchanged and the script's exit code comes back", () => {
  // Node stands in for Python: it runs the stand-in script, whatever the file is called.
  const dir = tempDir("pl-extra-");
  write(dir, "semantic.py", 'require("node:fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\nprocess.exitCode = 3;\n');
  const seen = path.join(dir, "seen.json");
  const code = runExtra("semantic", [seen, "similarity", "a b.png", "--min-clip", "0.8"], { dir, env: { ...process.env, PL_PYTHON: process.execPath }, stdio: "ignore" });
  assert.equal(code, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(seen, "utf8")), ["similarity", "a b.png", "--min-clip", "0.8"]);
});
