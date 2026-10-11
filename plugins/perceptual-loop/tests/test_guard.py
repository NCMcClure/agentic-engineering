"""Tests of the guard hook's decisions.  python -B -m unittest discover -s tests   (standard library only)"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "hooks"))
sys.path.insert(0, str(HERE.parent / "scripts"))
import guard  # noqa: E402

CONFIG = {
    "budget": {"free": 3, "match": [r"shot-render", r"npm run render", r"iterate\.py"]},
}
SHOTS = [f"sky_{i}" for i in range(6)] + ["cockpit_a", "cockpit_b", "road_top"]
GROUPS = {"sky": ["sky_*"], "smoke": ["sky_0", "cockpit_a", "road_top"], "cabins": ["cockpit_*"], "most": ["*", "!road_*"]}


class GuardCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pl-guard-")).resolve()
        self.root = self.tmp / "proj"
        d = self.root / ".perceptual-loop"
        for s in SHOTS:
            (d / "shots" / s).mkdir(parents=True)
            (d / "shots" / s / "shot.json").write_text(json.dumps({"name": s}))
        (d / "config.json").write_text(json.dumps(CONFIG))
        (d / "groups.json").write_text(json.dumps(GROUPS))
        self._env = os.environ.pop("PERCEPTUAL_LOOP_DIR", None)

    def tearDown(self):
        if self._env is not None:
            os.environ["PERCEPTUAL_LOOP_DIR"] = self._env
        shutil.rmtree(self.tmp, ignore_errors=True)

    def decide(self, command):
        return guard.decide(command, str(self.root))

    def allow(self, command):
        self.assertIsNone(self.decide(command), command)

    def deny(self, command, *needles):
        reason = self.decide(command)
        self.assertIsNotNone(reason, f"not denied: {command}")
        for n in needles:
            self.assertIn(n, reason)
        return reason

    def log(self):
        p = self.root / ".perceptual-loop" / "runs" / "budget.log"
        return p.read_text().splitlines() if p.exists() else []


class Budget(GuardCase):
    def test_within_the_free_budget(self):
        self.allow("npm run render -- sky_0 sky_1 sky_2")
        self.allow("npm run render -- sky_0,sky_1 cockpit_a")
        self.allow("uv run --no-project plugin/scripts/iterate.py --group smoke")
        self.allow("uv run iterate.py --group sky --match 'sky_[01]'")
        self.allow("uv run iterate.py --all --match road_*")
        self.assertEqual(self.log(), [])

    def test_too_many_is_denied_and_the_message_teaches(self):
        r = self.deny("npm run render -- sky_0 sky_1 sky_2 sky_3", "renders 4 shots", "1-3 shots", "--dry-run", 'PL_RUN="verify:',
                      "$env:PL_RUN", "not a security boundary", "in a file")
        self.assertIn("full suite", r)
        self.deny("uv run iterate.py --group sky", "renders 6 shots (--group sky)")
        self.deny("uv run iterate.py --group=sky", "renders 6 shots")
        self.deny("uv run iterate.py --all", "renders 9 shots (--all)")
        self.deny("uv run iterate.py --group most", "renders 8 shots")
        self.deny("uv run iterate.py --shots sky_0,sky_1,sky_2,sky_3", "renders 4 shots")
        self.deny("uv run iterate.py 'sky_*'", "renders 6 shots")
        self.deny("uv run iterate.py --match 'sky_*'", "renders 6 shots")
        self.deny("cd tools && uv run iterate.py --all 2>&1 | tail -5", "renders 9 shots")

    def test_a_stated_reason_allows_and_is_logged(self):
        self.allow('PL_RUN="verify: the sky colour works on sky_0, this checks the group" uv run iterate.py --group sky')
        self.allow("PL_RUN='full: issue 12 is finished' uv run iterate.py --all")
        log = self.log()
        self.assertEqual(len(log), 2)
        when, kind, n, why, head = log[0].split("\t")
        self.assertEqual((kind, n, why), ("verify", "6", "the sky colour works on sky_0, this checks the group"))
        self.assertTrue(head.startswith("uv run iterate.py --group sky"))
        self.assertEqual(log[1].split("\t")[1:3], ["full", "9"])

    def test_a_reason_must_say_which_kind_and_why(self):
        self.deny("PL_RUN=1 uv run iterate.py --all", 'PL_RUN is "1"')
        self.deny('PL_RUN="verify:" uv run iterate.py --all')
        self.deny('PL_RUN="because I want to" uv run iterate.py --all')
        self.deny('echo PL_RUN="verify: quoted by a reader does not count"; uv run iterate.py --all')

    def test_powershell_spellings(self):
        self.deny("powershell -File engines/scripts/shot-render.ps1 -All", "renders 9 shots")
        self.deny("& ./scripts/shot-render.ps1 -Group sky", "renders 6 shots")
        self.allow('$env:AW_AGENT = "ue-1"; $env:PL_RUN = "verify: smoke passed, this is the sky group"; ./scripts/shot-render.ps1 -Group sky')
        self.allow('$env:AW_AGENT = "ue-1"; ./scripts/shot-render.ps1 -Group sky -Match "sky_[012]"')
        self.deny('$env:AW_AGENT = "ue-1"; ./scripts/shot-render.ps1 -Group sky', "renders 6 shots")
        self.assertEqual(len(self.log()), 1)

    def test_nothing_rendered_is_never_blocked(self):
        for flag in ("--dry-run", "--list", "--skip-render", "-List", "--help"):
            self.allow(f"uv run iterate.py --all {flag}")
        self.allow("./scripts/shot-render.ps1 -All -List")  # also starts no application

    def test_an_unknown_count_does_not_block(self):
        self.allow("npm run render")
        self.allow("npm run render -- new_shot_1 new_shot_2 new_shot_3 new_shot_4")  # not in the shots folder yet
        self.allow("uv run iterate.py --group nosuchgroup")
        self.allow("npm run render -- $SHOTS")

    def test_readers_and_quoted_text_do_not_match(self):
        self.allow("git commit -m 'npm run render -- sky_0 sky_1 sky_2 sky_3; iterate.py --all'")
        self.allow('git commit -m "render: iterate.py --all is refused; use shot-render with --group"')
        self.allow('gh pr create --title "iterate.py --all" --body "ran shot-render.ps1 -All && iterate.py --all | tail"')
        self.allow("echo 'uv run iterate.py --all'")
        self.allow("grep -rn 'iterate.py --all' docs/ | head -3")
        self.allow("cat scripts/iterate.py; ls shot-render.ps1; rg 'npm run render -- --all'")
        self.allow("Get-Content scripts/shot-render.ps1 | Select-String 'iterate.py --all'")
        self.allow("cd tools/shot-render && ls")
        self.allow('aw note "iterate.py --all is next; then shot-render.ps1 -All"')

    def test_heredoc_and_here_string_bodies_are_skipped(self):
        self.allow("git commit -F - <<'EOF'\nrender: uv run iterate.py --all\nshot-render.ps1 -All\nEOF")
        self.allow("python notes.py <<EOF\nuv run iterate.py --all\nEOF\nnpm run render -- sky_0")
        self.allow("python notes.py <<-EOF\n\tuv run iterate.py --all\n\tEOF")
        self.allow("$body = @'\nuv run iterate.py --all\n./shot-render.ps1 -All\n'@\nSet-Content note.md $body")
        self.allow('$body = @"\nuv run iterate.py --all\n"@; Write-Output $body')
        self.deny("python notes.py <<EOF\nharmless\nEOF\nuv run iterate.py --all", "renders 9 shots")  # after the body: a command
        self.deny("python - <<< 'x'; uv run iterate.py --all", "renders 9 shots")  # <<< is not a heredoc


class AwWrappers(GuardCase):
    """Locks and leases are the agent-works plugin's; what its wrappers run is judged here as the inner command."""

    def test_a_wrapped_render_within_the_budget_passes(self):
        self.allow('aw lock run editor --for "tests, 3 min" -- ./scripts/shot-render.sh sky_0 sky_1')
        self.allow('aw lock run editor --as ue-1 --for "x" --max-minutes 5 -- "./scripts/shot-render.sh sky_0 sky_1"')
        self.allow('aw lease gpu --share 0.5 --mem 12GB --for "three shots" -- npm run render -- sky_0 sky_1 sky_2')
        self.allow('aw lock run sim --for x -- aw lock run editor --for x -- ./run-in-session.ps1 shot-render sky_0')
        self.allow('aw lease gpu --for x -- aw lock run editor --for x -- uv run iterate.py --group smoke')
        self.allow('python -B "/plugins/agent-works/cli/aw.py" lock run editor --for "x" -- uv run iterate.py sky_0')
        self.assertEqual(self.log(), [])

    def test_the_wrapper_does_not_buy_shots(self):
        self.deny('aw lock run editor --for "x" -- ./scripts/shot-render.sh --all', "renders 9 shots")
        self.deny('aw lease gpu --share 1 --for "x" -- uv run iterate.py --group sky', "renders 6 shots (--group sky)")
        self.deny('aw lock run sim --for x -- aw lease gpu --for x -- uv run iterate.py --all', "renders 9 shots")
        self.deny('aw.cmd lock run editor --for x -- "uv run iterate.py --all"', "renders 9 shots")
        self.deny('python -B "/plugins/agent-works/cli/aw.py" lease gpu --for x -- uv run iterate.py --all', "renders 9 shots")
        self.deny('AW_AGENT=ue-1 aw lock run editor --for x -- npm run render -- sky_0 sky_1 sky_2 sky_3', "renders 4 shots")

    def test_a_reason_reaches_through_the_wrapper(self):
        self.allow('PL_RUN="full: #12 finished" aw lock run editor --for "x" -- ./scripts/shot-render.sh --all')
        self.allow('aw lease gpu --for x -- PL_RUN="verify: sky_0 works, this is the group" uv run iterate.py --group sky')
        self.assertEqual([line.split("\t")[1:3] for line in self.log()], [["full", "9"], ["verify", "6"]])
        self.assertTrue(self.log()[0].split("\t")[4].startswith("./scripts/shot-render.sh --all"))  # the inner command is logged

    def test_dry_runs_and_wrapper_flags(self):
        self.allow('aw lock run editor --for x -- uv run iterate.py --all --dry-run')
        self.allow('aw lock run editor --for x -- ./scripts/shot-render.ps1 -All -List')
        # a flag of the wrapper is not a flag of the render: --all here belongs to nothing that renders
        self.deny('aw lock run editor --for "list the --dry-run output" -- uv run iterate.py --all', "renders 9 shots")

    def test_other_aw_commands_are_left_alone(self):
        self.allow('aw lock acquire editor --for "iterate.py --all, 3 min"')
        self.allow("aw lock release editor && aw lock status")
        self.allow('aw note "ran iterate.py --all; shot-render.ps1 -All is next"')
        self.allow('aw kanban add "npm run render -- --all is too slow"')
        self.allow('python -B cli/aw.py note "uv run iterate.py --all"')
        self.allow("aw sys --quiet-for timing && uv run iterate.py sky_0")
        self.deny("aw sys --quiet-for timing && uv run iterate.py --all", "renders 9 shots")  # the next segment is a command

    def test_a_wrapped_baseline_update_is_still_targeted(self):
        self.deny("aw lock run editor --for x -- uv run scripts/baseline.py update", "--source", "a selection")
        self.allow("aw lock run editor --for x -- uv run scripts/baseline.py update --source candidate sky_0")

    def test_unwrap(self):
        self.assertEqual(guard.unwrap_aw("aw lock run a --for x -- cmd --flag"), (True, "cmd --flag"))
        self.assertEqual(guard.unwrap_aw("aw lease gpu --share 0.5 -- aw lock run a -- 'cmd one two'"), (True, "cmd one two"))
        self.assertEqual(guard.unwrap_aw("aw lock status"), (False, ""))
        self.assertEqual(guard.unwrap_aw("draw.py lock run a -- cmd"), (False, "draw.py lock run a -- cmd"))
        self.assertEqual(guard.unwrap_aw("uv run iterate.py --all"), (False, "uv run iterate.py --all"))


class Baseline(GuardCase):
    def test_update_must_be_targeted(self):
        self.deny("uv run --no-project scripts/baseline.py update", "--source", "a selection")
        self.deny("uv run scripts/baseline.py update --group smoke", "--source <one candidate>")
        self.deny('uv run "C:/plugins/pl/scripts/baseline.py" update --source candidate', "a selection")
        self.deny("uv run scripts\\baseline.py update --source candidate --run 2026-01-01", "a selection")
        self.allow("uv run scripts/baseline.py update --source candidate sky_0 sky_1")
        self.allow("uv run scripts/baseline.py update --source=candidate --group smoke")
        self.allow("uv run scripts/baseline.py update --source candidate --shots sky_0,sky_1 --run last")
        self.allow("uv run scripts/baseline.py update --all --source candidate")
        self.allow("uv run scripts/baseline.py check --group smoke")
        self.allow("git commit -m 'baseline.py update is refused without --source'")
        self.allow("cat scripts/baseline.py | grep update")


class Hook(GuardCase):
    def run_hook(self, payload, cwd=None):
        text = payload if isinstance(payload, str) else json.dumps(payload)
        return subprocess.run([sys.executable, "-B", str(HERE.parent / "hooks" / "guard.py")], input=text, capture_output=True, text=True, cwd=cwd or self.tmp)

    def test_deny_is_json_on_stdout_and_exit_0(self):
        r = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "uv run iterate.py --all"}, "cwd": str(self.root / ".perceptual-loop")})
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)["hookSpecificOutput"]
        self.assertEqual((out["hookEventName"], out["permissionDecision"]), ("PreToolUse", "deny"))
        self.assertIn("renders 9 shots", out["permissionDecisionReason"])

    def test_allow_is_silent(self):
        r = self.run_hook({"tool_name": "PowerShell", "tool_input": {"command": "uv run iterate.py sky_0"}, "cwd": str(self.root)})
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))

    def test_no_config_is_a_no_op(self):
        bare = self.tmp / "bare"
        bare.mkdir()
        r = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "uv run iterate.py --all; baseline.py update"}, "cwd": str(bare)})
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        self.assertIsNone(guard.config_root(str(bare)))
        self.assertEqual(guard.config_root(str(self.root / ".perceptual-loop" / "shots")), str(self.root))

    def test_its_own_failures_never_block(self):
        for payload in ("", "not json", "[]", '{"tool_input": {"command": 5}}', '{"tool_input": null}'):
            r = self.run_hook(payload)
            self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""), payload)
        (self.root / ".perceptual-loop" / "config.json").write_text("{ broken")
        r = self.run_hook({"tool_input": {"command": "uv run iterate.py --all"}, "cwd": str(self.root)})
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        (self.root / ".perceptual-loop" / "config.json").write_text(json.dumps({"budget": {"free": 3, "match": ["(unclosed", "iterate"]}}))
        r = self.run_hook({"tool_input": {"command": "uv run iterate.py --all"}, "cwd": str(self.root)})
        self.assertIn("deny", r.stdout)  # a broken pattern is skipped, the good one still works

    def test_hooks_json(self):
        doc = json.loads((HERE.parent / "hooks" / "hooks.json").read_text())
        entry = doc["hooks"]["PreToolUse"][0]
        self.assertRegex("Bash", entry["matcher"])
        self.assertRegex("PowerShell", entry["matcher"])
        hook = entry["hooks"][0]
        self.assertEqual(hook["timeout"], 5)
        self.assertIn('"${CLAUDE_PLUGIN_ROOT}/hooks/guard.py"', hook["command"])


class Splitting(unittest.TestCase):
    def test_segments(self):
        self.assertEqual(guard.split_segments("a && b || c; d | e\nf"), ["a", "b", "c", "d", "e", "f"])
        self.assertEqual(guard.split_segments('git commit -m "a; b && c | d"; x'), ['git commit -m "a; b && c | d"', "x"])
        self.assertEqual(guard.split_segments("run x 2>&1 | tail"), ["run x 2>&1", "tail"])
        self.assertEqual(guard.split_segments("a \\\n  --flag; b `\n -Flag"), ["a    --flag", "b   -Flag"])
        self.assertEqual(guard.command_part('FOO=1 BAR="x y" env BAZ=2 cmd --a'), "cmd --a")
        self.assertEqual(guard.command_part('$env:PL_RUN = "verify: render works"'), "")
        self.assertEqual(guard.command_part("export AW_AGENT=a"), "")
        self.assertEqual(guard.first_word('"C:/Tools/Git/git.exe" log'), "git")


if __name__ == "__main__":
    unittest.main()
