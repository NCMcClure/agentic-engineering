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
import lock as pl_lock  # noqa: E402

CONFIG = {
    "budget": {"free": 3, "match": [r"shot-render", r"npm run render", r"iterate\.py"]},
    "locks": {"dir": "LOCKS", "apps": {"editor": {"processes": ["UnrealEditor"], "match": [r"shot-render", r"run-tests"]},
                                       "sim": {"match": [r"run-in-session"]}}},
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
        config = json.loads(json.dumps(CONFIG).replace("LOCKS", (self.tmp / "locks").as_posix()))
        (d / "config.json").write_text(json.dumps(config))
        (d / "groups.json").write_text(json.dumps(GROUPS))
        self.locks = self.tmp / "locks"
        self.locks.mkdir()
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

    def hold(self, app, agent):
        (self.locks / f"{app}.lock").write_text(json.dumps({"app": app, "agent": agent, "for": "test", "since": pl_lock.now_iso(),
                                                            "refreshed": "2026-01-01T00:00:00Z"}))

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
        self.hold("editor", "ue-1")
        self.allow('$env:PL_AGENT = "ue-1"; $env:PL_RUN = "verify: smoke passed, this is the sky group"; ./scripts/shot-render.ps1 -Group sky')
        self.allow('$env:PL_AGENT = "ue-1"; ./scripts/shot-render.ps1 -Group sky -Match "sky_[012]"')
        self.deny('$env:PL_AGENT = "ue-1"; ./scripts/shot-render.ps1 -Group sky', "renders 6 shots")
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
        self.allow('python lock.py note --as a "iterate.py --all is next; then shot-render.ps1 -All"')

    def test_heredoc_and_here_string_bodies_are_skipped(self):
        self.allow("git commit -F - <<'EOF'\nrender: uv run iterate.py --all\nshot-render.ps1 -All\nEOF")
        self.allow("python notes.py <<EOF\nuv run iterate.py --all\nEOF\nnpm run render -- sky_0")
        self.allow("python notes.py <<-EOF\n\tuv run iterate.py --all\n\tEOF")
        self.allow("$body = @'\nuv run iterate.py --all\n./shot-render.ps1 -All\n'@\nSet-Content note.md $body")
        self.allow('$body = @"\nuv run iterate.py --all\n"@; Write-Output $body')
        self.deny("python notes.py <<EOF\nharmless\nEOF\nuv run iterate.py --all", "renders 9 shots")  # after the body: a command
        self.deny("python - <<< 'x'; uv run iterate.py --all", "renders 9 shots")  # <<< is not a heredoc


class Locks(GuardCase):
    def test_a_guarded_command_needs_a_holder(self):
        r = self.deny("powershell -File scripts/run-tests.ps1", "starts 'editor'", "no PL_AGENT", "lock.py", "run editor --as <agent>",
                      "acquire editor --as <agent>", "release editor --as <agent>", "not a security boundary", "Exit 3")
        self.assertIn(str(HERE.parent / "scripts" / "lock.py"), r)  # a real path the agent can run
        self.deny("PL_AGENT=ue-1 powershell -File scripts/run-tests.ps1", "'ue-1' does not hold the lock (it is free)", "--as ue-1")
        self.hold("editor", "someone")
        self.deny("PL_AGENT=ue-1 powershell -File scripts/run-tests.ps1", "held by someone")
        self.deny('$env:PL_AGENT = "ue-1"; ./scripts/run-tests.ps1', "held by someone")

    def test_the_holder_runs_and_its_lock_is_refreshed(self):
        self.hold("editor", "ue-1")
        self.allow("PL_AGENT=ue-1 powershell -File scripts/run-tests.ps1")
        self.allow('$env:PL_AGENT = "ue-1"; ./scripts/run-tests.ps1 -Tier core')
        self.allow("export PL_AGENT=ue-1\n./scripts/shot-render.sh sky_0")
        self.assertNotEqual(pl_lock.read_lock(self.locks, "editor")["refreshed"], "2026-01-01T00:00:00Z")
        self.deny("PL_AGENT=ue-1 tools/run-in-session.ps1 run x", "starts 'sim'")  # another application, another lock

    def test_lock_run_wraps_a_guarded_command(self):
        self.allow('python -B "/plugins/pl/scripts/lock.py" run editor --as ue-1 --for "tests, 3 min" -- powershell -File scripts/run-tests.ps1')
        self.allow('python lock.py run editor --as ue-1 --for "x" --max-minutes 5 -- "./scripts/shot-render.sh sky_0 sky_1"')
        self.allow('python lock.py run sim --as a --for x -- python lock.py run editor --as a --for x -- ./run-in-session.ps1 shot-render sky_0')
        self.deny('python lock.py run sim --as ue-1 --for "x" -- powershell -File scripts/run-tests.ps1', "starts 'editor'")
        # the wrapper holds the lock, it does not buy shots
        self.deny('python lock.py run editor --as ue-1 --for "x" -- ./scripts/shot-render.sh --all', "renders 9 shots")
        self.allow('PL_RUN="full: #12 finished" python lock.py run editor --as ue-1 --for "x" -- ./scripts/shot-render.sh --all')
        self.assertEqual(self.log()[0].split("\t")[1:3], ["full", "9"])

    def test_the_lock_tool_itself_and_dry_runs_pass(self):
        self.allow('python lock.py acquire editor --as ue-1 --for "run-tests, 3 min"')
        self.allow("python lock.py release editor --as ue-1 && python lock.py status")
        self.allow("./scripts/shot-render.sh --list")
        self.allow("git log --oneline -- scripts/run-tests.ps1")

    def test_default_lock_folder_is_the_one_lock_py_uses(self):
        d = self.root / ".perceptual-loop"
        (d / "config.json").write_text(json.dumps({"locks": {"apps": {"editor": {"match": ["run-tests"]}}}}))
        env = {**os.environ, "LOCALAPPDATA": str(self.tmp / "data"), "XDG_STATE_HOME": str(self.tmp / "data"), "PYTHONDONTWRITEBYTECODE": "1"}
        env.pop("PL_AGENT", None)
        lock = [sys.executable, "-B", str(HERE.parent / "scripts" / "lock.py")]
        self.assertEqual(subprocess.run([*lock, "acquire", "editor", "--as", "ue-1", "--for", "t", "--wait", "0"], cwd=self.root, env=env,
                                        capture_output=True).returncode, 0)
        # the hook process has CLAUDE_PLUGIN_DATA, the agent's shell has not: both must look in the same place
        env["CLAUDE_PLUGIN_DATA"] = str(self.tmp / "plugin-data")
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": "PL_AGENT=ue-1 ./run-tests.sh"}, "cwd": str(self.root)})
        r = subprocess.run([sys.executable, "-B", str(HERE.parent / "hooks" / "guard.py")], input=payload, env=env, capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        payload = payload.replace("ue-1", "ue-2")
        r = subprocess.run([sys.executable, "-B", str(HERE.parent / "hooks" / "guard.py")], input=payload, env=env, capture_output=True, text=True)
        self.assertEqual(json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertIn("held by ue-1", r.stdout)


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
        self.assertEqual(guard.command_part("export PL_AGENT=a"), "")
        self.assertEqual(guard.first_word('"C:/Tools/Git/git.exe" log'), "git")


if __name__ == "__main__":
    unittest.main()
