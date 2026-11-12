// perceptual-loop's report lint on whole reports: a good one comes back clean,
// a bad one is flagged line by line, and each rule holds on its own list of
// sentences that must and must not trip it.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { lint } from "../../../plugins/perceptual-loop/scripts/commands/lint.mjs";
import { PL, runNode, tempDir } from "./perceptual-loop-fixtures.mjs";

const GOOD = `# Sky colour at dusk (#31)

## What changed
The horizon band takes the sun's colour below 6 degrees of elevation. In the picture the band is now orange
where it was grey (\`runs/dusk/sky_dusk_top/pair.png\`); the reference has the same band, a little wider.

## Evidence
- \`pl.mjs iterate sky_dusk_top sky_dusk_low\`: the gate passes for both shots, 14 of 14 entries within tolerance.
- frame.ssim of sky_dusk_top moved from 0.81 to 0.84; frame.deltaE moved from 9.2 to 6.0. The numbers moved
  because the band is there now, as the pair sheet shows.
- The crowd region's SSIM is lower (0.61 to 0.58): the candidate now shadows the stand, which the reference
  does not; in the picture this is the more plausible one. Verdict: more-correct.
- Verified live: \`npm test -- --only stream\` gives 78 of 78.
- Fixed in 3f2a9c1: the lamp list was read before the track loaded.
- All tests pass: 212 passed (\`npm test\`).

## Not run
The full suite was not run: only the sky group (12 shots) can see this change. The tolerance for
candidate/frame.ssim stays 0.01 against its baseline. How it works is described in docs/sky.md.
The mask and id passes stay as they were; a fixed seed keeps the clouds in place.
It should pass on the night shots too, but that is not verified. Is the band better at noon?

\`\`\`
SSIM got worse and everything works, all tests pass (inside a code block: not linted)
\`\`\`
> quoted: verified and fixed, deltaE is worse
`;

const BAD = `# Report

SSIM got worse on the cockpit shots, so the change was reverted.
The paint is better now, deltaE dropped a lot.
The score regressed after the importer change.

I verified the fix.
The crash is fixed.
Everything works now.
The gate passes.

Target: within 10 % of the reference on every sky shot.
We should get deltaE below 3 against the reference before merging.

All tests pass.
Full pass done, all gates green.
`;

const rules = (text, opts) => lint(text, opts).map((f) => [f.line, f.rule]);

test("a report that names its evidence is clean", () => {
  assert.deepEqual(rules(GOOD), []);
});

test("a report of bare claims is flagged line by line, with a fix for each", () => {
  assert.deepEqual(rules(BAD), [
    [3, "metric-verdict"], [4, "metric-verdict"], [5, "metric-verdict"],
    [7, "bare-claim"], [8, "bare-claim"], [9, "bare-claim"], [10, "bare-claim"],
    [12, "reference-target"], [13, "reference-target"],
    [15, "bare-claim"], [16, "no-count"], [16, "no-skipped"],
  ]);
  const byRule = Object.fromEntries(lint(BAD).map((f) => [f.rule, f]));
  assert.ok(byRule["no-count"].hint && byRule["no-skipped"].hint);
  assert.equal(byRule["bare-claim"].hint, false);
  assert.match(byRule["metric-verdict"].fix, /moved from X to Y/);
});

test("metric-verdict: a verdict word near a metric, unless the sentence says what the picture shows", () => {
  assert.deepEqual(rules("The SSIM is worse than before."), [[1, "metric-verdict"]]);
  assert.deepEqual(rules("ΔE regressed from 4 to 6 on `sky_top`."), [[1, "metric-verdict"]]);
  assert.deepEqual(rules("PSNR is better by 2 dB."), [[1, "metric-verdict"]]);
  assert.deepEqual(rules("SSIM is lower because the shadow of the stand is new; in the picture it is the more plausible one."), []);
  assert.deepEqual(rules("The pair sheet shows the lamp is missing, and the score is worse for it."), []);
  assert.deepEqual(rules("SSIM moved from 0.91 to 0.88 on sky_top."), []);
  assert.deepEqual(rules("The metric is not a verdict; never say worse from a number alone."), []);
  assert.deepEqual(rules("This is a better structure for the importer."), [], "no metric near");
  const far = "The SSIM of the shot was read from the run of this morning after the long import and then nothing at all got any worse.";
  assert.deepEqual(rules(far), []);
  assert.deepEqual(rules(far, { window: 40 }), [[1, "metric-verdict"]]);
});

test("bare-claim: a finished fact with no artefact; hedged, planned and descriptive sentences are left alone", () => {
  for (const bad of ["Verified.", "I confirmed the behaviour on the other tracks.", "It works.", "This now works end to end.",
    "The build passes.", "Tests pass.", "The flicker is fixed.", "Fixed the flicker."]) {
    assert.deepEqual(rules(bad), [[1, "bare-claim"]], bad);
  }
  for (const good of ["Verified with `npm test packages/formats`: 41 pass.", "Confirmed in runs/a/sky_top/pair.png.",
    "It works: 3 shots render in 22 s.", "The build passes (#412).", "Fixed the flicker in 9c0ffee1.",
    "Tests pass: 31/31.", "Verified by test_stale_lock_is_taken_over.",
    "This is not verified.", "It should work on Linux.", "To be confirmed by the owner.", "Run it again until it passes.",
    "Here is how it works.", "The render passes are beauty and mask.", "Use a fixed seed.", "Check that the gate passes.",
    "If the build passes, merge.", "Works on my machine is not evidence."]) {
    assert.deepEqual(rules(good), [], good);
  }
});

test("the artefact may follow: in the next sentence, or under a line that ends in a colon", () => {
  assert.deepEqual(rules("The gate passes. See `runs/x/report.json`."), []);
  assert.deepEqual(rules("Verified:\n\n- `npm test`: 78 of 78\n"), []);
  assert.deepEqual(rules("Verified.\n\nAnother paragraph with `a path`.\n"), [[1, "bare-claim"]]);
});

test("reference-target: a target against the reference, by any name the project gives it", () => {
  assert.deepEqual(rules("Goal: within 5% of the reference."), [[1, "reference-target"]]);
  assert.deepEqual(rules("Bring SSIM above 0.9 on the cockpit shots."), [[1, "reference-target"]]);
  assert.deepEqual(rules("We are within 10 % of AC now."), []);
  assert.deepEqual(rules("We are within 10 % of AC now.", { referenceNames: ["AC"] }), [[1, "reference-target"]]);
  assert.deepEqual(rules("The tolerance should keep frame.ssim above 0.9 of its baseline."), []);
  assert.deepEqual(rules("deltaE is below 2 in the sky region of `sky_top`."), [], "a measurement, not a target");
  assert.deepEqual(rules("The page loads within 10 % of the budget."), []);
});

test("hints: a total with no count, a full pass with nothing said about what was skipped", () => {
  assert.deepEqual(rules("All tests pass (`npm test`)."), []);
  assert.deepEqual(rules("All 31 tests pass, see `npm test`."), []);
  assert.deepEqual(rules("Ran `x`. Everything is green.").map(([, r]) => r), ["no-count"]);
  assert.deepEqual(rules("Full pass over 305 shots with `parity compare`.").map(([, r]) => r), ["no-skipped"]);
  assert.deepEqual(rules("Full pass over 305 shots with `parity compare`.\n\nSkipped: nothing.\n"), []);
  assert.deepEqual(rules("The full suite was not run."), []);
});

test("a finding carries the line its sentence starts on, in wrapped paragraphs and lists", () => {
  const text = "Intro line one\nstill the intro. The gate\npasses.\n\n- item one is fine\n- It works.\n";
  assert.deepEqual(rules(text), [[2, "bare-claim"], [6, "bare-claim"]]);
});

test("the command: counts as JSON, a file or stdin, exit 1 on a finding, 0 on hints alone, 2 on no file", () => {
  const dir = tempDir("pl-lint-");
  const run = (args, input) => runNode(PL, ["lint", ...args], { cwd: dir, input });
  const bad = run(["--json"], BAD);
  const doc = JSON.parse(bad.stdout);
  assert.deepEqual([bad.status, doc.failing, doc.hints], [1, 10, 2]);
  const good = run(["-"], GOOD);
  assert.deepEqual([good.status, good.stdout.trim()], [0, "no findings"]);
  const hint = run([], "Ran `x`. Everything is green.");
  assert.equal(hint.status, 0, "hints alone do not fail");
  assert.ok(hint.stdout.includes("stdin:1: hint no-count:"), hint.stdout);
  assert.equal(run([path.join(dir, "no-such-file.md")]).status, 2);
});
