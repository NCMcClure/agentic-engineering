// perceptual-loop's gate and calibration, plus the shared project helpers they
// read through: tolerance specificity, a measured spread allowed 1.5x, the four
// statuses, the targeted rebuild that keeps the baseline's order, bistable
// detection, and where a project's root and its shots are.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as gate from "../../../plugins/perceptual-loop/scripts/lib/gate.mjs";
import * as project from "../../../plugins/perceptual-loop/scripts/lib/project.mjs";
import { tempDir, write } from "./perceptual-loop-fixtures.mjs";

test("fnmatch follows Python: * crosses everything, [!x] negates, a lone [ is literal", () => {
  const { fnmatch } = project;
  assert.ok(fnmatch("sky_01", "sky_*"));
  assert.ok(fnmatch("a/b", "a*"));
  assert.ok(fnmatch("sky_1", "sky_[0-2]"));
  assert.ok(!fnmatch("sky_3", "sky_[0-2]"));
  assert.ok(fnmatch("sky_3", "sky_[!0-2]"));
  assert.ok(fnmatch("a[b", "a[b"));
  assert.ok(fnmatch("x]", "x[]]"));
  assert.ok(!fnmatch("Sky_1", "sky_*"));
  assert.deepEqual(project.matchGlobs(["a1", "a2", "b1"], ["a*", "!a2", "b?"]), ["a1", "b1"]);
});

test("flat keys: frame numbers, white balance per channel, regions without their area", () => {
  const flat = project.flattenMetrics({
    shot: "s", source: "candidate",
    frame: { ssim: 0.9, wb: [1.1, 1, 0.9], edgeF1: 0.8 },
    regions: { body: { area: 0.2, ssim: 0.7, iou: 0.95 } },
  });
  assert.deepEqual(flat, {
    "s/candidate/frame.ssim": 0.9, "s/candidate/frame.wb.r": 1.1, "s/candidate/frame.wb.g": 1, "s/candidate/frame.wb.b": 0.9,
    "s/candidate/frame.edgeF1": 0.8, "s/candidate/region.body.ssim": 0.7, "s/candidate/region.body.iou": 0.95,
  });
});

test("the most specific tolerance pattern wins, and a measured spread is allowed 1.5x", () => {
  const baseline = {
    tolerances: { "*/frame.ssim": 0.01, "candidate/frame.ssim": 0.002, "*/region.*.edgeF1": 0.04, "candidate/region.glass.edgeF1": 0.09 },
    spread: { "s/candidate/frame.deltaE": 0.2 },
  };
  assert.equal(project.toleranceFor("s/candidate/frame.ssim", baseline), 0.002);
  assert.equal(project.toleranceFor("s/web/frame.ssim", baseline), 0.01);
  assert.equal(project.toleranceFor("s/web/region.body.edgeF1", baseline), 0.04);
  assert.equal(project.toleranceFor("s/candidate/region.glass.edgeF1", baseline), 0.09);
  assert.equal(project.toleranceFor("s/web/region.a.b.edgeF1", baseline), 0, "* matches one part only");
  assert.ok(Math.abs(project.toleranceFor("s/candidate/frame.deltaE", baseline) - 0.3) < 1e-12);
});

test("the gate reports ok, beyond, new, and missing, and says moved with a direction", () => {
  const baseline = {
    tolerances: { "*/frame.ssim": 0.01, "*/frame.deltaE": 0.3 }, spread: {}, notes: {},
    entries: { "a/candidate/frame.ssim": 0.9, "a/candidate/frame.deltaE": 2.0, "b/candidate/frame.ssim": 0.8, "c/candidate/frame.ssim": 0.5, "a/web/frame.ssim": 0.1 },
  };
  const flat = { "a/candidate/frame.ssim": 0.905, "a/candidate/frame.deltaE": 2.5, "a/candidate/frame.edgeF1": 0.7 };
  const report = gate.gate(baseline, flat, ["a", "b"], "candidate");
  const by = Object.fromEntries(report.entries.map((e) => [e.key, e]));
  assert.equal(by["a/candidate/frame.ssim"].status, "ok");
  assert.equal(by["a/candidate/frame.ssim"].direction, "toward");
  assert.equal(by["a/candidate/frame.deltaE"].status, "beyond");
  assert.equal(by["a/candidate/frame.deltaE"].direction, "away from");
  assert.equal(by["a/candidate/frame.edgeF1"].status, "new");
  assert.equal(by["b/candidate/frame.ssim"].status, "missing");
  assert.ok(!("c/candidate/frame.ssim" in by) && !("a/web/frame.ssim" in by), "other shots and sources are not this gate's");
  assert.deepEqual(report.totals, { ok: 1, beyond: 1, new: 1, missing: 1 });
  assert.ok(gate.failed(report, {}));
  const text = gate.reportText(report, {});
  assert.match(text, /moved by \+0\.5000, tolerance 0\.3000, away from the reference/);
  assert.doesNotMatch(text, /worse|regress/i);
  // a value equal to the baseline within float dust never fails a zero tolerance
  const exact = gate.gate({ ...baseline, tolerances: {} }, { "a/candidate/frame.ssim": 0.9 + 1e-12 }, ["a"], "candidate");
  assert.equal(exact.entries.find((e) => e.key === "a/candidate/frame.ssim").status, "ok");
});

test("a targeted rebuild changes only the named shots and keeps every entry's place", () => {
  const old = {
    "a/candidate/frame.ssim": 0.9, "a/candidate/frame.edgeF1": 0.8,
    "b/candidate/frame.ssim": 0.7, "b/candidate/region.x.ssim": 0.6,
    "a/web/frame.ssim": 0.1, "c/candidate/frame.ssim": 0.5,
  };
  const flat = { "b/candidate/frame.ssim": 0.75, "b/candidate/frame.edgeF1": 0.65, "d/candidate/frame.ssim": 0.4 };
  const { entries, changed, added, removed } = gate.rebuildEntries(old, flat, ["b", "d"], "candidate");
  assert.deepEqual(Object.keys(entries), [
    "a/candidate/frame.ssim", "a/candidate/frame.edgeF1",
    "b/candidate/frame.ssim", "b/candidate/frame.edgeF1",
    "a/web/frame.ssim", "c/candidate/frame.ssim",
    "d/candidate/frame.ssim",
  ]);
  assert.equal(entries["b/candidate/frame.ssim"], 0.75);
  assert.equal(entries["a/candidate/frame.ssim"], 0.9);
  assert.deepEqual({ changed, added, removed }, { changed: 1, added: 2, removed: 1 });
});

test("calibration: tolerance is 2.5x the class's largest spread with floors, rounded up to two digits", () => {
  assert.equal(gate.roundUp(0.00123), 0.0013);
  assert.equal(gate.roundUp(0.05), 0.05);
  assert.equal(gate.roundUp(0), 0);
  assert.equal(gate.metricClass("s/candidate/region.glass.edgeF1"), "candidate/region.*.edgeF1");
  assert.equal(gate.metricClass("s/candidate/frame.wb.r"), "candidate/frame.wb.r");
  const runs = [{ "a/c/frame.ssim": 0.9 }, { "a/c/frame.ssim": 0.9012 }];
  const doc = gate.measure(runs, 2.5);
  assert.equal(doc.classes["c/frame.ssim"].tolerance, 0.003, "2.5 x 0.0012 = 0.003 is above the floor of 0.002");
  assert.deepEqual(doc.bistable, {}, "two runs can never show a flip");
});

test("the project root is the first ancestor with a config, else the git root, else cwd", () => {
  const dir = tempDir("pl-root-");
  write(dir, "repo/.git/HEAD", "ref: refs/heads/main\n");
  write(dir, "repo/sub/.agents/perceptual/config.json", "{}\n");
  fs.mkdirSync(path.join(dir, "repo/sub/deep/er"), { recursive: true });
  fs.mkdirSync(path.join(dir, "repo/other"), { recursive: true });
  fs.mkdirSync(path.join(dir, "bare"), { recursive: true });
  const real = (p) => fs.realpathSync(p);
  assert.equal(real(project.findRoot(path.join(dir, "repo/sub/deep/er"))), real(path.join(dir, "repo/sub")));
  assert.equal(real(project.findRoot(path.join(dir, "repo/other"))), real(path.join(dir, "repo")));
  assert.equal(real(project.findRoot(path.join(dir, "bare"))), real(path.join(dir, "bare")));
});

test("a selection resolves names, globs, groups, and --match, in order and without repeats", () => {
  const dir = tempDir("pl-select-");
  write(dir, ".agents/perceptual/config.json", "{}\n");
  write(dir, ".agents/perceptual/groups.json", JSON.stringify({ sky: ["sky_*"], most: ["*", "!road_*"] }));
  for (const s of ["sky_0", "sky_1", "sky_2", "road_a", "cab_a"]) write(dir, `.agents/perceptual/shots/${s}/shot.json`, "{}\n");
  const config = project.loadConfig(dir);
  const pick = (opts) => project.resolveShots({ names: [], ...opts }, dir, config);
  assert.deepEqual(pick({ names: ["sky_1,road_a", "sky_1"] }), ["sky_1", "road_a"]);
  assert.deepEqual(pick({ names: ["sky_*"] }), ["sky_0", "sky_1", "sky_2"]);
  assert.deepEqual(pick({ group: "most", match: "*_a" }), ["cab_a"]);
  assert.deepEqual(pick({ all: true }), ["cab_a", "road_a", "sky_0", "sky_1", "sky_2"]);
  assert.throws(() => pick({ names: ["nope"] }), /no such shot: nope/);
  assert.throws(() => pick({ group: "x" }), /no group 'x'/);
  assert.throws(() => project.selected({ names: [] }, dir, config), /no shots selected/);
});
