// A baseline accepted with the Python scripts the plugin shipped until 0.2.0 has to keep gating, and a
// report written then has to mean the same now. These are the numbers those scripts gave on the
// pictures and sounds perceptual-loop-fixtures.mjs builds (numpy 1.26.2, scipy 1.11.4, Pillow 10.4.0),
// recorded once. The Node engine is held to them within the tolerance beside each measure. A change
// that moves one is a change of definition: say so in the changelog. Nothing here runs Python.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measure } from "../../../plugins/perceptual-loop/scripts/lib/gate.mjs";
import { analyse, regionMetrics, regionsFromBoxes, regionsFromId } from "../../../plugins/perceptual-loop/scripts/lib/metrics.mjs";
import { encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
import { PL, calibrateRuns, goldenCases, goldenSounds, idPass, noisy, runNode, scene, shifted, tempDir, u8, wavF32 } from "./perceptual-loop-fixtures.mjs";

// ---- pictures ------------------------------------------------------------------------------

// compare.py's analyse() per case: reference against candidate.
const FRAMES = {
  "identical": { size: [320, 240], rough: false, frame: {"ssim": 1.0, "deltaE": 0.0, "deltaENorm": 0.0, "exposureEV": 0.0, "wb": [1.0, 1.0, 1.0], "contrast": 1.0, "edgeF1": 1.0, "edgeRecall": 1.0, "edgePrecision": 1.0, "detailLog2": 0.0} },
  "ev+0.3": { size: [320, 240], rough: false, frame: {"ssim": 0.9951003193855286, "deltaE": 4.687440872192383, "deltaENorm": 0.21685419976711273, "exposureEV": 0.29898178577423096, "wb": [1.0007046461105347, 1.0, 0.9978269934654236], "contrast": 0.9968017544791008, "edgeF1": 1.0, "edgeRecall": 1.0, "edgePrecision": 1.0, "detailLog2": -0.011136887220211254} },
  "wb": { size: [320, 240], rough: false, frame: {"ssim": 0.9996305108070374, "deltaE": 2.770378828048706, "deltaENorm": 0.14017419517040253, "exposureEV": 0.02663656696677208, "wb": [1.0978773832321167, 1.0, 0.9009226560592651], "contrast": 1.004670157183331, "edgeF1": 1.0, "edgeRecall": 1.0, "edgePrecision": 1.0, "detailLog2": -0.004880391525982963} },
  "flatter": { size: [320, 240], rough: false, frame: {"ssim": 0.9963316917419434, "deltaE": 4.4698805809021, "deltaENorm": 3.686192512512207, "exposureEV": -0.14607514441013336, "wb": [0.9511190056800842, 1.0, 1.029117465019226], "contrast": 0.7652485443998656, "edgeF1": 0.9382488479262673, "edgeRecall": 0.8836805555555556, "edgePrecision": 1.0, "detailLog2": -0.6934365642538686} },
  "blurred": { size: [320, 240], rough: false, frame: {"ssim": 0.9941969513893127, "deltaE": 0.21351224184036255, "deltaENorm": 0.21351224184036255, "exposureEV": 0.0, "wb": [1.0, 1.0, 1.0], "contrast": 0.9999496325866938, "edgeF1": 0.9741763134461265, "edgeRecall": 0.9496527777777778, "edgePrecision": 1.0, "detailLog2": -3.2743740992490813} },
  "noisy": { size: [320, 240], rough: false, frame: {"ssim": 0.9090631008148193, "deltaE": 2.123116970062256, "deltaENorm": 2.123116970062256, "exposureEV": 0.000503821182064712, "wb": [1.0, 1.0, 1.0], "contrast": 0.9804441025224012, "edgeF1": 0.993043414918415, "edgeRecall": 0.9965277777777778, "edgePrecision": 0.9895833333333334, "detailLog2": 3.49969291616273} },
  "shift3": { size: [320, 240], rough: false, frame: {"ssim": 0.9782994389533997, "deltaE": 1.4735676050186157, "deltaENorm": 1.4891084432601929, "exposureEV": -0.0009335228241980076, "wb": [0.9867203235626221, 1.0, 1.0], "contrast": 1.0034118667031946, "edgeF1": 0.6890202539005718, "edgeRecall": 0.6857638888888888, "edgePrecision": 0.6923076923076923, "detailLog2": -0.004069312179659456} },
  "box-shift1": { size: [320, 240], rough: false, frame: {"ssim": 0.9888366460800171, "deltaE": 0.1026359349489212, "deltaENorm": 0.1026359349489212, "exposureEV": 0.0, "wb": [1.0, 1.0, 1.0], "contrast": 1.0, "edgeF1": 1.0, "edgeRecall": 1.0, "edgePrecision": 1.0, "detailLog2": 0.0} },
  "box-shift12": { size: [320, 240], rough: false, frame: {"ssim": 0.9622349143028259, "deltaE": 1.2316312789916992, "deltaENorm": 1.2316312789916992, "exposureEV": 0.0, "wb": [1.0, 1.0, 1.0], "contrast": 1.0, "edgeF1": 0.5170454545454546, "edgeRecall": 0.5170454545454546, "edgePrecision": 0.5170454545454546, "detailLog2": 0.0} },
  "half-even-640x360": { size: [640, 360], rough: false, frame: {"ssim": 0.9522587656974792, "deltaE": 3.456418514251709, "deltaENorm": 1.5285604000091553, "exposureEV": -0.2005329430103302, "wb": [0.9988225698471069, 1.0, 1.000856637954712], "contrast": 0.9871114709194851, "edgeF1": 0.9928020462307297, "edgeRecall": 0.9990272373540856, "edgePrecision": 0.9866539561487131, "detailLog2": 3.278388407184479} },
  "hd-1280x720": { size: [1280, 720], rough: false, frame: {"ssim": 0.9974594712257385, "deltaE": 1.1446926593780518, "deltaENorm": 0.20964176952838898, "exposureEV": 0.01484585739672184, "wb": [1.0481786727905273, 1.0, 0.9713842868804932], "contrast": 1.001562972152886, "edgeF1": 0.9997581620314389, "edgeRecall": 0.9995164410058027, "edgePrecision": 1.0, "detailLog2": -0.0013089425479781767} },
};

// region_metrics() over an id pass (the left 30 % red, the rest blue) and two boxes, for three of the cases.
const REGIONS = {
  "wb": {
    "id_0000FF": {"area": 0.7, "ssim": 0.9996511340141296, "deltaENorm": 0.14132724702358246, "edgeF1": 1.0},
    "left": {"area": 0.29998697916666667, "ssim": 0.999582827091217, "deltaENorm": 0.13748255372047424, "edgeF1": 1.0},
    "top": {"area": 0.32, "ssim": 0.9993482232093811, "deltaENorm": 0.1404019147157669, "edgeF1": 1.0},
    "disc": {"area": 0.0875, "ssim": 0.9999178647994995, "deltaENorm": 0.13320781290531158, "edgeF1": 1.0},
  },
  "noisy": {
    "id_0000FF": {"area": 0.7, "ssim": 0.9137718677520752, "deltaENorm": 2.112494468688965, "edgeF1": 0.9978070175438596},
    "left": {"area": 0.29998697916666667, "ssim": 0.8980739116668701, "deltaENorm": 2.1478796005249023, "edgeF1": 0.9745762711864406},
    "top": {"area": 0.32, "ssim": 0.9123682975769043, "deltaENorm": 2.2066619396209717, "edgeF1": 0.9743589743589743},
    "disc": {"area": 0.0875, "ssim": 0.9197549223899841, "deltaENorm": 1.8422040939331055, "edgeF1": 1.0},
  },
  "shift3": {
    "id_0000FF": {"area": 0.7, "ssim": 0.9741438627243042, "deltaENorm": 1.414817452430725, "edgeF1": 0.6866200826372172},
    "left": {"area": 0.29998697916666667, "ssim": 0.9879955649375916, "deltaENorm": 1.6625198125839233, "edgeF1": 0.6986899563318778},
    "top": {"area": 0.32, "ssim": 0.9910103678703308, "deltaENorm": 1.44351065158844, "edgeF1": 0.05333333333333334},
    "disc": {"area": 0.0875, "ssim": 0.8926120400428772, "deltaENorm": 1.8054966926574707, "edgeF1": 0.8961086192265729},
  },
};

// Metrics are stored to 5 decimals. Frame numbers agree to 2 in the fifth; a region averages fewer
// pixels and agrees to 5 in the fifth. Edge scores are ratios of counts and agree exactly.
const FRAME_TOL = { ssim: 2e-5, deltaE: 2e-5, deltaENorm: 2e-5, exposureEV: 2e-5, wb: 2e-5, contrast: 2e-5, detailLog2: 2e-5, edgeF1: 1e-9, edgeRecall: 1e-9, edgePrecision: 1e-9 };
const REGION_TOL = { area: 1e-12, ssim: 5e-5, deltaENorm: 5e-5, edgeF1: 1e-9 };

const cases = new Map(goldenCases().map(([name, ref, cand]) => [name, [ref, cand]]));
const analysed = new Map();
const analysis = (name) => {
  if (!analysed.has(name)) analysed.set(name, analyse(...cases.get(name)));
  return analysed.get(name);
};

test("frame metrics agree with the recorded numbers: SSIM, delta E, the exposure fit, edges, detail", () => {
  assert.deepEqual([...cases.keys()], Object.keys(FRAMES));
  for (const [name, want] of Object.entries(FRAMES)) {
    const [ref] = cases.get(name);
    assert.deepEqual([ref.width, ref.height], want.size, name);
    const an = analysis(name);
    assert.equal(an.rough, want.rough, name);
    assert.deepEqual(Object.keys(an.frame), Object.keys(want.frame), name);
    for (const [k, v] of Object.entries(want.frame)) {
      const got = an.frame[k];
      const off = Array.isArray(v) ? Math.max(...v.map((x, i) => Math.abs(x - got[i]))) : Math.abs(v - got);
      assert.ok(off <= FRAME_TOL[k], `${name} ${k}: ${got}, recorded ${v} (off by ${off}, allowed ${FRAME_TOL[k]})`);
    }
  }
});

test("region metrics from an id pass and from boxes agree with the recorded numbers", () => {
  for (const [name, want] of Object.entries(REGIONS)) {
    const an = analysis(name);
    const regions = [...regionsFromId(idPass(), { left: [255, 0, 0] }, 0.002),
      ...regionsFromBoxes({ top: [0.1, 0.05, 0.9, 0.45], disc: [0.65, 0.53, 0.9, 0.88] }, 320, 240)];
    assert.deepEqual(regions.map((r) => r.name), Object.keys(want), name);
    for (const r of regions) {
      const got = regionMetrics(r.mask, an.maps);
      assert.deepEqual(Object.keys(got), Object.keys(want[r.name]), `${name} ${r.name}`);
      for (const [k, v] of Object.entries(want[r.name])) {
        assert.ok(Math.abs(got[k] - v) <= REGION_TOL[k], `${name} ${r.name} ${k}: ${got[k]}, recorded ${v}`);
      }
    }
  }
});

// ---- the command, end to end -----------------------------------------------------------------

// compare.py --json on a two-shot project, as it stored the numbers (5 decimals): s1 has an id pass on both
// sources, the candidate's shifted 4 px, so each region carries an iou; s2's candidate is twice the
// reference's size and is resized on the way in, with one box region.
const STORED = {
  s1: { size: [320, 240], regionsKind: "id", notes: [],
    frame: {"ssim": 0.93368, "deltaE": 3.614, "deltaENorm": 1.68536, "exposureEV": 0.20297, "wb": [0.99671, 1.0, 0.99804], "contrast": 0.97983, "edgeF1": 0.99139, "edgeRecall": 1.0, "edgePrecision": 0.98294, "detailLog2": 2.87545},
    regions: {"id_0000FF": {"area": 0.7, "ssim": 0.93726, "deltaENorm": 1.6738, "edgeF1": 0.99782, "iou": 0.98214}, "left": {"area": 0.29999, "ssim": 0.92531, "deltaENorm": 1.71232, "edgeF1": 0.96721, "iou": 0.95983}} },
  s2: { size: [320, 240], regionsKind: "boxes", notes: ["candidate resized from 640x480 to the reference's 320x240"],
    frame: {"ssim": 0.99229, "deltaE": 0.57664, "deltaENorm": 0.57664, "exposureEV": 0.0005, "wb": [1.0, 1.0, 1.0], "contrast": 0.99197, "edgeF1": 0.99827, "edgeRecall": 0.99826, "edgePrecision": 0.99827, "detailLog2": 0.07993},
    regions: {"top": {"area": 0.32, "ssim": 0.99378, "deltaENorm": 0.57615, "edgeF1": 1.0}} },
};

// One unit of the last stored digit, plus rounding. The plugin's own Lanczos resize is not Pillow's to the
// last bit, and the finest detail is where that shows: detailLog2 of a resized candidate agrees to 5e-4.
const STORED_TOL = 1.5e-5, RESIZED_DETAIL_TOL = 5e-4;

test("pl.mjs compare on a first-layout project stores the recorded numbers, an id pass, iou and a resized candidate included", () => {
  const dir = tempDir("pl-parity-"), state = path.join(dir, ".perceptual-loop");
  const put = (rel, content) => { fs.mkdirSync(path.dirname(path.join(state, rel)), { recursive: true }); fs.writeFileSync(path.join(state, rel), content); };
  put("config.json", JSON.stringify({ version: 1, reference: "reference", candidates: ["candidate"], shotsDir: ".perceptual-loop/shots", render: {}, passes: ["beauty"],
    regionsFrom: "reference", budget: { free: 3, match: [] }, metrics: { ssim: true, deltaE: true, edges: true, detail: true } }));
  put("baseline.json", JSON.stringify({ version: 1, tolerances: {}, minRegionArea: 0.002, spread: {}, entries: {}, notes: {} }));
  put("shots/s1/shot.json", JSON.stringify({ name: "s1" }));
  put("shots/s1/ids.json", JSON.stringify({ left: [255, 0, 0] }));
  put("shots/s1/reference.png", encodePng(u8(scene())));
  put("shots/s1/candidate.png", encodePng(noisy(u8(scene(), (c, v) => v * 1.15), 5, 3)));
  put("shots/s1/reference.id.png", encodePng(idPass()));
  put("shots/s1/candidate.id.png", encodePng(shifted(idPass(), 4)));
  put("shots/s2/shot.json", JSON.stringify({ name: "s2", regions: { top: [0.1, 0.05, 0.9, 0.45] } }));
  put("shots/s2/reference.png", encodePng(u8(scene())));
  put("shots/s2/candidate.png", encodePng(noisy(u8(scene(640, 480)), 3, 9)));
  const r = runNode(PL, ["compare", "--all", "--run", "r", "--json"], { cwd: dir, env: { PL_DIR: "", PERCEPTUAL_LOOP_DIR: "", PL_SHOTS_DIR: "", PL_FFMPEG: "" } });
  assert.equal(r.status, 0, r.stderr);
  const docs = JSON.parse(r.stdout);
  assert.deepEqual(docs.map((d) => d.shot), Object.keys(STORED));
  for (const doc of docs) {
    const want = STORED[doc.shot];
    assert.deepEqual([doc.size, doc.regionsKind, doc.notes], [want.size, want.regionsKind, want.notes], doc.shot);
    const near = (got, v, what) => {
      const tol = doc.shot === "s2" && what.endsWith("detailLog2") ? RESIZED_DETAIL_TOL : STORED_TOL;
      const off = Array.isArray(v) ? Math.max(...v.map((x, i) => Math.abs(x - got[i]))) : Math.abs(v - got);
      assert.ok(off <= tol, `${doc.shot} ${what}: ${got}, recorded ${v}`);
    };
    assert.deepEqual(Object.keys(doc.frame), Object.keys(want.frame), doc.shot);
    for (const [k, v] of Object.entries(want.frame)) near(doc.frame[k], v, `frame.${k}`);
    assert.deepEqual(Object.keys(doc.regions), Object.keys(want.regions), doc.shot);
    for (const [name, region] of Object.entries(want.regions)) {
      assert.deepEqual(Object.keys(doc.regions[name]), Object.keys(region), `${doc.shot} ${name}`);
      for (const [k, v] of Object.entries(region)) near(doc.regions[name][k], v, `region.${name}.${k}`);
    }
  }
});

// ---- calibration ---------------------------------------------------------------------------

// calibrate.py's measure() over six runs of flat metrics with known noise and one bistable entry, margin 2.5.
const CALIBRATE = {
  keys: 20,
  classes: {
    "candidate/frame.deltaENorm": {"entries": 4, "maxSpread": 0.009062960331793768, "at": "d/candidate/frame.deltaENorm", "medianSpread": 0.0073398973850997695, "tolerance": 0.05, "floor": 0.05, "bistable": 0},
    "candidate/frame.exposureEV": {"entries": 4, "maxSpread": 0.0008647274302784336, "at": "d/candidate/frame.exposureEV", "medianSpread": 0.0006712965614860886, "tolerance": 0.005, "floor": 0.005, "bistable": 0},
    "candidate/frame.ssim": {"entries": 4, "maxSpread": 0.0003630682437680832, "at": "d/candidate/frame.ssim", "medianSpread": 0.0003128341682255287, "tolerance": 0.002, "floor": 0.002, "bistable": 0},
    "candidate/region.*.edgeF1": {"entries": 8, "maxSpread": 0.0009384515988639652, "at": "d/candidate/region.body.edgeF1", "medianSpread": 0.00080828772427044, "tolerance": 0.0024, "floor": 0.002, "bistable": 1},
  },
  bistable: {"c/candidate/region.glass.edgeF1": {"spread": 0.050080724732694204, "values": [0.70003, 0.75006], "class": "candidate/region.*.edgeF1"}},
};

test("calibration agrees with the recorded numbers: spreads to 1e-12, tolerances and the bistable entry exactly", () => {
  const got = measure(calibrateRuns(), 2.5);
  assert.equal(got.keys, CALIBRATE.keys);
  assert.deepEqual(Object.keys(got.classes), Object.keys(CALIBRATE.classes));
  for (const [cls, want] of Object.entries(CALIBRATE.classes)) {
    const g = got.classes[cls];
    assert.deepEqual([g.entries, g.at, g.tolerance, g.floor, g.bistable], [want.entries, want.at, want.tolerance, want.floor, want.bistable], cls);
    assert.ok(Math.abs(g.maxSpread - want.maxSpread) < 1e-12 && Math.abs(g.medianSpread - want.medianSpread) < 1e-12, cls);
  }
  assert.deepEqual(Object.keys(got.bistable), Object.keys(CALIBRATE.bistable));
  for (const [key, want] of Object.entries(CALIBRATE.bistable)) {
    assert.deepEqual([got.bistable[key].values, got.bistable[key].class], [want.values, want.class], key);
    assert.ok(Math.abs(got.bistable[key].spread - want.spread) < 1e-12, key);
  }
});

// ---- sounds --------------------------------------------------------------------------------

// audio.py --json per command, on the sounds of goldenSounds(): the exit code and the measures.
const AUDIO = {
  "probe.tone": { exit: 0, doc: {"rate": 48000, "channels": 2, "samples": 96000, "duration": 2.0, "peakDb": -23.0, "rmsDb": -26.01, "lufs": -22.99} },
  "probe.noise": { exit: 0, doc: {"rate": 48000, "channels": 1, "samples": 96000, "duration": 2.0, "peakDb": -2.15, "rmsDb": -17.52, "lufs": -14.38} },
  "probe.hits": { exit: 0, doc: {"rate": 48000, "channels": 1, "samples": 96000, "duration": 2.0, "peakDb": -6.09, "rmsDb": -25.06, "lufs": -23.37} },
  "probe.a220": { exit: 0, doc: {"rate": 44100, "channels": 1, "samples": 44100, "duration": 1.0, "peakDb": -6.02, "rmsDb": -9.03, "lufs": -9.93} },
  "silence.gap": { exit: 0, doc: {"rmsDb": -17.45, "peakDb": -10.46, "silent": false, "silentShare": 0.5806, "leadingSilence": 0.24, "trailingSilence": 0.48, "clipped": false, "clippedSamples": 0, "dcOffset": [0.0], "gate": true} },
  "silence.dc": { exit: 1, doc: {"rmsDb": -21.25, "peakDb": -16.48, "silent": false, "silentShare": 0.0, "leadingSilence": 0.0, "trailingSilence": 0.0, "clipped": false, "clippedSamples": 0, "dcOffset": [0.05], "gate": false} },
  "silence.tone": { exit: 0, doc: {"rmsDb": -26.01, "peakDb": -23.0, "silent": false, "silentShare": 0.0, "leadingSilence": 0.0, "trailingSilence": 0.0, "clipped": false, "clippedSamples": 0, "dcOffset": [-0.0, -0.0], "gate": true} },
  "pitch.a220": { exit: 0, doc: {"frames": 95, "voicedShare": 1.0, "medianHz": 220.009, "minHz": 220.008, "maxHz": 220.01, "expected": {"frames": 95, "medianErrorPct": 0.004, "withinTolerance": 1.0, "octaveErrors": 0.0, "medianRatio": 1.00004}, "gate": true} },
  "pitch.engine": { exit: 0, doc: {"frames": 194, "voicedShare": 1.0, "medianHz": 154.964, "minHz": 110.944, "maxHz": 216.425, "gate": true} },
  "onsets.hits": { exit: 0, doc: {"onsets": [0.248, 0.7973, 1.3093], "expected": {"matched": 3, "missed": [], "extra": [], "meanOffsetMs": 1.78, "maxOffsetMs": 2.67, "meanSignedOffsetMs": -1.78}, "gate": true} },
  "compare.late": { exit: 0, doc: {"lagMs": 50.0, "lagFrom": "waveform", "lagCorrelation": 0.9946, "levelDb": -6.067, "lsdDb": 0.047, "bandsDb": {"31.5": -6.02, "63": -6.02, "125": -6.02, "250": -6.02, "500": -6.02, "1000": -6.02, "2000": -6.02, "4000": -6.02, "8000": -6.02, "16000": -6.02}, "envelopeCorrelation": 1.0, "overlapSeconds": 1.95, "gate": true} },
  "compare.dull": { exit: 0, doc: {"lagMs": 0.171, "lagFrom": "envelope", "lagCorrelation": 0.7656, "levelDb": -13.43, "lsdDb": 38.509, "bandsDb": {"31.5": 0.0, "63": 0.0, "125": -0.0, "250": -0.03, "500": -0.42, "1000": -3.4, "2000": -11.92, "4000": -23.65, "8000": -36.83, "16000": -53.65}, "envelopeCorrelation": 0.9646, "overlapSeconds": 2.0, "gate": true} },
};

// What each call was, by its key above: the command, the sound (two for compare), then its options.
const CALLS = {
  "probe.tone": ["probe", "tone"], "probe.noise": ["probe", "noise"], "probe.hits": ["probe", "hits"], "probe.a220": ["probe", "a220"],
  "silence.gap": ["silence", "gap"], "silence.dc": ["silence", "dc"], "silence.tone": ["silence", "tone"],
  "pitch.a220": ["pitch", "a220", "--expect-hz", "220"], "pitch.engine": ["pitch", "engine", "--fmax", "600"],
  "onsets.hits": ["onsets", "hits", "--expect-times", "0.25,0.8,1.31"],
  "compare.late": ["compare", "noise", "late"], "compare.dull": ["compare", "noise", "dull"],
};

// The allowed difference per measure, in its own unit. Levels and loudness are printed to 0.01 dB and
// agree to it; pitch to 0.01 Hz; a lag to 0.01 ms. Onsets are the one measure that moved: the Node
// detector places a start within 2 ms of where the Python one did, and the offsets follow.
const AUDIO_TOL = {
  peakDb: 0.011, rmsDb: 0.011, lufs: 0.011, levelDb: 0.011, lsdDb: 0.011, bandsDb: 0.021,
  silentShare: 0.001, leadingSilence: 0.011, trailingSilence: 0.011, dcOffset: 1e-4,
  voicedShare: 0.011, medianHz: 0.011, minHz: 0.011, maxHz: 0.011, medianErrorPct: 0.011, withinTolerance: 0.011, octaveErrors: 0.011, medianRatio: 1e-4,
  onsets: 0.002, meanOffsetMs: 2, maxOffsetMs: 2, meanSignedOffsetMs: 2,
  lagMs: 0.011, lagCorrelation: 0.001, envelopeCorrelation: 0.001, overlapSeconds: 0.011,
};

/** Every number of `want` against `got`, within the tolerance its key names; anything else must be equal. */
function agree(got, want, where) {
  for (const [k, v] of Object.entries(want)) {
    const at = `${where} ${k}`, g = got?.[k];
    if (typeof v === "number") {
      if (k in AUDIO_TOL) assert.ok(typeof g === "number" && Math.abs(g - v) <= AUDIO_TOL[k], `${at}: ${g}, recorded ${v} (allowed ${AUDIO_TOL[k]})`);
      else assert.equal(g, v, at);
    } else if (Array.isArray(v) && v.length && v.every((x) => typeof x === "number") && k in AUDIO_TOL) {
      assert.equal(g?.length, v.length, `${at}: ${JSON.stringify(g)}, recorded ${JSON.stringify(v)}`);
      v.forEach((x, i) => assert.ok(Math.abs(g[i] - x) <= AUDIO_TOL[k], `${at}[${i}]: ${g[i]}, recorded ${x}`));
    } else if (k === "bandsDb") {
      assert.deepEqual(Object.keys(g).sort(), Object.keys(v).sort(), at);
      for (const [band, db] of Object.entries(v)) assert.ok(Math.abs(g[band] - db) <= AUDIO_TOL.bandsDb, `${at} ${band} Hz: ${g[band]}, recorded ${db}`);
    } else if (k === "gate") assert.equal(g?.passed, v, at);
    else if (v && typeof v === "object" && !Array.isArray(v)) agree(g, v, at);
    else assert.deepEqual(g, v, at);
  }
}

test("the audio measures agree with the recorded numbers: loudness, silence, pitch, onsets, lag, level, spectra", () => {
  const dir = tempDir("pl-parity-");
  for (const [name, sound] of Object.entries(goldenSounds())) fs.writeFileSync(path.join(dir, `${name}.wav`), wavF32(sound.channels, sound.rate));
  assert.deepEqual(Object.keys(CALLS), Object.keys(AUDIO));
  for (const [key, [command, ...rest]] of Object.entries(CALLS)) {
    const sounds = command === "compare" ? 2 : 1;
    const args = rest.map((word, i) => (i < sounds ? `${word}.wav` : word));
    const r = runNode(PL, ["audio", command, ...args, "--json"], { cwd: dir, env: { PL_DIR: "", PL_SHOTS_DIR: "", PL_FFMPEG: "", PL_FFPROBE: "" } });
    assert.equal(r.status, AUDIO[key].exit, `${key}: ${r.stderr}`);
    agree(JSON.parse(r.stdout), AUDIO[key].doc, key);
  }
});
