"""Tests of evidence_lint.py with good and bad reports.  python -B -m unittest test_evidence_lint"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import evidence_lint as el  # noqa: E402

GOOD = """# Sky colour at dusk (#31)

## What changed
The horizon band takes the sun's colour below 6 degrees of elevation. In the picture the band is now orange
where it was grey (`runs/dusk/sky_dusk_top/pair.png`); the reference has the same band, a little wider.

## Evidence
- `iterate.py sky_dusk_top sky_dusk_low`: the gate passes for both shots, 14 of 14 entries within tolerance.
- frame.ssim of sky_dusk_top moved from 0.81 to 0.84; frame.deltaE moved from 9.2 to 6.0. The numbers moved
  because the band is there now, as the pair sheet shows.
- The crowd region's SSIM is lower (0.61 to 0.58): the candidate now shadows the stand, which the reference
  does not; in the picture this is the more plausible one. Verdict: more-correct.
- Verified live: `cardan test --only stream` gives 78 of 78.
- Fixed in 3f2a9c1: the lamp list was read before the track loaded.
- All tests pass: 212 passed (`bun test`).

## Not run
The full suite was not run: only the sky group (12 shots) can see this change. The tolerance for
candidate/frame.ssim stays 0.01 against its baseline. How it works is described in docs/sky.md.
The mask and id passes stay as they were; a fixed seed keeps the clouds in place.
It should pass on the night shots too, but that is not verified. Is the band better at noon?

```
SSIM got worse and everything works, all tests pass (inside a code block: not linted)
```
> quoted: verified and fixed, deltaE is worse
"""

BAD = """# Report

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
"""


def rules(text, **kw):
    return [(f["line"], f["rule"]) for f in el.lint(text, **kw)]


class Lint(unittest.TestCase):
    def test_a_good_report_is_clean(self):
        self.assertEqual(rules(GOOD), [])

    def test_a_bad_report(self):
        self.assertEqual(rules(BAD), [
            (3, "metric-verdict"), (4, "metric-verdict"), (5, "metric-verdict"),
            (7, "bare-claim"), (8, "bare-claim"), (9, "bare-claim"), (10, "bare-claim"),
            (12, "reference-target"), (13, "reference-target"),
            (15, "bare-claim"), (16, "no-count"), (16, "no-skipped"),
        ])
        by_rule = {f["rule"]: f for f in el.lint(BAD)}
        self.assertTrue(by_rule["no-count"]["hint"] and by_rule["no-skipped"]["hint"])
        self.assertFalse(by_rule["bare-claim"]["hint"])
        self.assertIn("moved from X to Y", by_rule["metric-verdict"]["fix"])

    def test_metric_verdict(self):
        self.assertEqual(rules("The SSIM is worse than before."), [(1, "metric-verdict")])
        self.assertEqual(rules("ΔE regressed from 4 to 6 on `sky_top`."), [(1, "metric-verdict")])
        self.assertEqual(rules("PSNR is better by 2 dB."), [(1, "metric-verdict")])
        self.assertEqual(rules("SSIM is lower because the shadow of the stand is new; in the picture it is the more plausible one."), [])
        self.assertEqual(rules("The pair sheet shows the lamp is missing, and the score is worse for it."), [])
        self.assertEqual(rules("SSIM moved from 0.91 to 0.88 on sky_top."), [])
        self.assertEqual(rules("The metric is not a verdict; never say worse from a number alone."), [])
        self.assertEqual(rules("This is a better structure for the importer."), [])  # no metric near
        far = "The SSIM of the shot was read from the run of this morning after the long import and then nothing at all got any worse."
        self.assertEqual(rules(far), [])
        self.assertEqual(rules(far, window=40), [(1, "metric-verdict")])

    def test_bare_claim(self):
        for bad in ("Verified.", "I confirmed the behaviour on the other tracks.", "It works.", "This now works end to end.",
                    "The build passes.", "Tests pass.", "The flicker is fixed.", "Fixed the flicker."):
            self.assertEqual(rules(bad), [(1, "bare-claim")], bad)
        for good in ("Verified with `bun test packages/formats`: 41 pass.", "Confirmed in runs/a/sky_top/pair.png.",
                     "It works: 3 shots render in 22 s.", "The build passes (#412).", "Fixed the flicker in 9c0ffee1.",
                     "Tests pass: 31/31.", "Verified by test_stale_lock_is_taken_over.",
                     "This is not verified.", "It should work on Linux.", "To be confirmed by the owner.", "Run it again until it passes.",
                     "Here is how it works.", "The render passes are beauty and mask.", "Use a fixed seed.", "Check that the gate passes.",
                     "If the build passes, merge.", "Works on my machine is not evidence."):
            self.assertEqual(rules(good), [], good)

    def test_the_artifact_may_follow(self):
        self.assertEqual(rules("The gate passes. See `runs/x/report.json`."), [])
        self.assertEqual(rules("Verified:\n\n- `cardan test`: 78 of 78\n"), [])
        self.assertEqual(rules("Verified.\n\nAnother paragraph with `a path`.\n"), [(1, "bare-claim")])

    def test_reference_target(self):
        self.assertEqual(rules("Goal: within 5% of the reference."), [(1, "reference-target")])
        self.assertEqual(rules("Bring SSIM above 0.9 on the cockpit shots."), [(1, "reference-target")])
        self.assertEqual(rules("We are within 10 % of AC now."), [])
        self.assertEqual(rules("We are within 10 % of AC now.", reference_names=["AC"]), [(1, "reference-target")])
        self.assertEqual(rules("The tolerance should keep frame.ssim above 0.9 of its baseline."), [])
        self.assertEqual(rules("deltaE is below 2 in the sky region of `sky_top`."), [])  # a measurement, not a target
        self.assertEqual(rules("The page loads within 10 % of the budget."), [])

    def test_hints(self):
        self.assertEqual(rules("All tests pass (`bun test`)."), [])
        self.assertEqual(rules("All 31 tests pass, see `bun test`."), [])
        self.assertEqual([r for _, r in rules("Ran `x`. Everything is green.")], ["no-count"])
        self.assertEqual([r for _, r in rules("Full pass over 305 shots with `parity compare`.")], ["no-skipped"])
        self.assertEqual(rules("Full pass over 305 shots with `parity compare`.\n\nSkipped: nothing.\n"), [])
        self.assertEqual(rules("The full suite was not run."), [])

    def test_line_numbers_in_wrapped_paragraphs_and_lists(self):
        text = "Intro line one\nstill the intro. The gate\npasses.\n\n- item one is fine\n- It works.\n"
        self.assertEqual(rules(text), [(2, "bare-claim"), (6, "bare-claim")])

    def test_cli(self):
        script = str(Path(el.__file__))
        r = subprocess.run([sys.executable, "-B", script, "--json"], input=BAD.encode(), capture_output=True)
        doc = json.loads(r.stdout)
        self.assertEqual((r.returncode, doc["failing"], doc["hints"]), (1, 10, 2))
        r = subprocess.run([sys.executable, "-B", script, "-"], input=GOOD.encode(), capture_output=True)
        self.assertEqual((r.returncode, r.stdout.decode().strip()), (0, "no findings"))
        r = subprocess.run([sys.executable, "-B", script], input=b"Ran `x`. Everything is green.", capture_output=True)
        self.assertEqual(r.returncode, 0)  # hints alone do not fail
        self.assertIn("stdin:1: hint no-count:", r.stdout.decode())
        self.assertEqual(subprocess.run([sys.executable, "-B", script, "no-such-file.md"], capture_output=True).returncode, 2)


if __name__ == "__main__":
    unittest.main()
