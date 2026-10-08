"""Tests of lock.py as agents use it: separate processes on one temp project.  python -B -m unittest test_lock"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
LOCK = str(Path(__file__).resolve().parent.parent / "scripts" / "lock.py")
FAST = ["--poll", "0.2"]


class LockCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pl-lock-")).resolve()
        self.proj = self.tmp / "proj"
        self.write_config(self.proj, {"staleMinutes": 45, "apps": {"sim": {"processes": [], "match": []}, "editor": {"maxMinutes": 5}}})
        self.env = {**os.environ, "LOCALAPPDATA": str(self.tmp / "data"), "XDG_STATE_HOME": str(self.tmp / "data"),
                    "PYTHONDONTWRITEBYTECODE": "1"}
        for k in ("CLAUDE_PLUGIN_DATA", "PL_AGENT", "PERCEPTUAL_LOOP_DIR"):
            self.env.pop(k, None)
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            if p.poll() is None:
                p.kill()
            p.communicate()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_config(self, proj, locks):
        (proj / ".perceptual-loop").mkdir(parents=True, exist_ok=True)
        (proj / ".perceptual-loop" / "config.json").write_text(json.dumps({"locks": locks}), encoding="utf-8")

    def lock(self, *args, cwd=None, timeout=60):
        return subprocess.run([sys.executable, "-B", LOCK, *args], cwd=cwd or self.proj, env=self.env, capture_output=True,
                              text=True, timeout=timeout)

    def spawn(self, *args):
        p = subprocess.Popen([sys.executable, "-B", LOCK, *args], cwd=self.proj, env=self.env, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        self.procs.append(p)
        return p

    def holder(self):
        return self.lock("holder", "sim").stdout.strip()

    def test_race_has_exactly_one_holder(self):
        ps = [self.spawn("acquire", "sim", "--as", f"r-{i}", "--for", "race", "--wait", "0") for i in range(8)]
        codes = [p.wait(60) for p in ps]
        self.assertEqual(sorted(codes), [0] + [3] * 7, codes)
        winner = f"r-{codes.index(0)}"
        self.assertEqual(self.holder(), winner)
        self.assertEqual(self.lock("release", "sim", "--as", "someone-else").returncode, 1)  # only the holder
        self.assertEqual(self.holder(), winner)
        self.assertEqual(self.lock("acquire", "sim", "--as", winner, "--for", "again", "--wait", "0").returncode, 0)  # refresh
        self.assertEqual(self.lock("release", "sim", "--as", winner).returncode, 0)
        self.assertEqual(self.lock("holder", "sim").returncode, 1)

    def test_queue_serves_in_ask_order(self):
        self.assertEqual(self.lock("acquire", "sim", "--as", "first", "--for", "hold", "--wait", "0").returncode, 0)
        order = self.tmp / "order.txt"
        waiters = []
        for name in ("c-late", "a-mid", "b-last"):  # names sort differently from the ask order on purpose
            code = f"import time; open(r'{order}', 'a').write('{name}\\n'); time.sleep(0.3)"
            waiters.append(self.spawn("run", "sim", "--as", name, "--for", "queued", "--wait", "40", *FAST, "--", sys.executable, "-c", code))
            time.sleep(0.6)
        status = json.loads(self.lock("status", "--json").stdout)["apps"][0]
        self.assertEqual([w["agent"] for w in status["waiting"]], ["c-late", "a-mid", "b-last"])
        self.assertEqual(self.lock("release", "sim", "--as", "first").returncode, 0)
        self.assertEqual([p.wait(60) for p in waiters], [0, 0, 0])
        self.assertEqual(order.read_text().split(), ["c-late", "a-mid", "b-last"])
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        self.assertEqual(json.loads(self.lock("status", "--json").stdout)["apps"][0]["waiting"], [])

    def test_dead_waiter_keeps_its_place(self):
        self.lock("acquire", "sim", "--as", "first", "--for", "hold", "--wait", "0")
        r = self.lock("acquire", "sim", "--as", "early", "--for", "x", "--wait", "0")  # its command "dies" at once
        self.assertEqual(r.returncode, 3)
        self.assertIn("STILL QUEUED", r.stderr)
        self.assertIn("Run the same command again", r.stderr)
        time.sleep(0.3)
        late = self.spawn("acquire", "sim", "--as", "late", "--for", "x", "--wait", "40", *FAST)
        time.sleep(0.5)
        self.lock("release", "sim", "--as", "first")
        time.sleep(1.2)  # 'late' polls every 0.2 s, yet the free lock is not its to take
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        self.assertEqual(self.lock("acquire", "sim", "--as", "early", "--for", "x", "--wait", "0").returncode, 0)  # asks again: still first
        self.assertEqual(self.lock("release", "sim", "--as", "early").returncode, 0)
        self.assertEqual(late.wait(30), 0)
        self.assertEqual(self.holder(), "late")

    def test_silent_waiter_is_passed_over_but_stays_listed(self):
        self.lock("acquire", "sim", "--as", "first", "--for", "hold", "--wait", "0")
        self.assertEqual(self.lock("acquire", "sim", "--as", "gone", "--for", "x", "--wait", "0").returncode, 3)
        self.lock("release", "sim", "--as", "first")
        time.sleep(1.5)
        self.assertEqual(self.lock("acquire", "sim", "--as", "next", "--for", "x", "--wait", "0", "--live", "1").returncode, 0)
        waiting = json.loads(self.lock("status", "--json").stdout)["apps"][0]["waiting"]
        self.assertEqual([w["agent"] for w in waiting], ["gone"])
        self.lock("release", "sim", "--as", "next")
        # ... and its ticket is thrown away once nobody polled it for --keep seconds
        self.assertEqual(self.lock("acquire", "sim", "--as", "next", "--for", "x", "--wait", "0", "--live", "1", "--keep", "1").returncode, 0)
        self.assertEqual(json.loads(self.lock("status", "--json").stdout)["apps"][0]["waiting"], [])

    def test_run_releases_after_a_failing_child_and_sets_pl_agent(self):
        code = "import os, sys; print('agent=' + os.environ.get('PL_AGENT', '')); sys.exit(7)"
        r = self.lock("run", "sim", "--as", "runner", "--for", "fails", "--wait", "0", "--", sys.executable, "-c", code)
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertIn("agent=runner", r.stdout)
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        r = self.lock("run", "sim", "--as", "runner", "--for", "no such program", "--wait", "0", "--", "pl-no-such-program-xyz", "a")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        r = self.lock("run", "sim", "--as", "runner", "--for", "shell line", "--wait", "0", "--", "echo one && echo two")
        self.assertEqual((r.returncode, r.stdout.split()), (0, ["one", "two"]), r.stderr)

    def test_run_kills_a_child_at_its_limit_and_releases(self):
        marker = self.tmp / "grandchild.txt"
        # the child starts a grandchild that would write the marker after 6 s: the whole tree must die
        inner = f"import time; time.sleep(6); open(r'{marker}', 'w').write('alive')"
        code = f"import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', {inner!r}]); time.sleep(60)"
        started = time.monotonic()
        r = self.lock("run", "sim", "--as", "runner", "--for", "hangs", "--wait", "0", "--max-minutes", "0.03", "--", sys.executable, "-c", code)
        self.assertEqual(r.returncode, 124, r.stderr)
        self.assertLess(time.monotonic() - started, 20)
        self.assertIn("limit", r.stderr)
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        self.assertIn("killed at its", self.lock("board").stdout)
        time.sleep(6.5)
        self.assertFalse(marker.exists(), "the grandchild outlived the kill")

    def test_held_lock_blocks_run_and_status_shows_the_hold(self):
        self.lock("acquire", "editor", "--as", "holder", "--for", "long job", "--wait", "0")
        r = self.lock("run", "editor", "--as", "other", "--for", "x", "--wait", "0", "--", sys.executable, "-c", "print('ran')")
        self.assertEqual(r.returncode, 3)
        self.assertNotIn("ran", r.stdout)
        row = json.loads(self.lock("status", "--json").stdout)["apps"][1]
        self.assertEqual((row["agent"], row["maxMinutes"], row["overdue"]), ("holder", 5.0, False))
        text = self.lock("status").stdout
        self.assertIn("held by holder for 0 of 5 min", text)
        self.assertIn("1. other waiting since", text)
        # a hold past its maximum is flagged
        d = Path(json.loads(self.lock("status", "--json").stdout)["dir"])
        doc = json.loads((d / "editor.lock").read_text())
        doc["since"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 600))
        (d / "editor.lock").write_text(json.dumps(doc))
        self.assertIn("for 10 of 5 min OVERDUE", self.lock("status").stdout)

    def test_stale_lock_is_taken_over_with_a_board_line(self):
        self.write_config(self.proj, {"staleMinutes": 0.02, "apps": {"sim": {"processes": []}}})
        self.lock("acquire", "sim", "--as", "sleeper", "--for", "forgot", "--wait", "0")
        self.assertEqual(self.lock("acquire", "sim", "--as", "taker", "--for", "x", "--wait", "0").returncode, 3)  # not stale yet
        time.sleep(3)
        r = self.lock("acquire", "sim", "--as", "taker", "--for", "x", "--wait", "0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("taken over from sleeper", r.stdout)
        self.assertIn("took over sim from sleeper", self.lock("board").stdout)

    def test_usage(self):
        self.assertEqual(self.lock("acquire", "nope", "--as", "a", "--for", "x", "--wait", "0").returncode, 2)
        self.assertEqual(self.lock("acquire", "sim", "--as", "Bad_Name", "--for", "x", "--wait", "0").returncode, 2)
        self.assertEqual(self.lock("run", "sim", "--as", "a", "--for", "x", "--wait", "0").returncode, 2)  # no command
        self.assertEqual(self.lock("--help").returncode, 0)
        other = self.tmp / "unconfigured"
        other.mkdir()
        self.assertEqual(self.lock("acquire", "anything", "--as", "a", "--for", "x", "--wait", "0", cwd=other).returncode, 0)
        self.assertEqual(self.lock("holder", "anything", cwd=self.proj).returncode, 2)  # another project, and not in its config
        r = self.lock("note", "--as", "a", "merged #12:  pull before rendering")
        self.assertRegex(r.stdout, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ  a  merged #12: pull before rendering")
        self.assertEqual(len(json.loads(self.lock("board", "5", "--json").stdout)["lines"]), 1)

    @unittest.skipUnless(shutil.which("git"), "git is not installed")
    def test_worktree_shares_the_locks_and_another_project_does_not(self):
        def git(*args, cwd=self.proj):
            subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *args], cwd=cwd, check=True, capture_output=True)

        git("init", "-q", ".")
        git("commit", "-q", "--allow-empty", "-m", "init")
        wt = self.tmp / "wt"
        git("worktree", "add", "-q", str(wt), "-b", "wt")
        self.write_config(wt, {"apps": {"sim": {}}})
        sub = wt / "deep" / "er"
        sub.mkdir(parents=True)
        self.assertEqual(self.lock("acquire", "sim", "--as", "main-agent", "--for", "x", "--wait", "0").returncode, 0)
        self.assertEqual(self.lock("holder", "sim", cwd=sub).stdout.strip(), "main-agent")
        here = json.loads(self.lock("status", "--json").stdout)["dir"]
        there = json.loads(self.lock("status", "--json", cwd=wt).stdout)["dir"]
        self.assertEqual(here, there)
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=wt, capture_output=True, text=True).stdout.strip()
        self.assertEqual(Path(common).resolve().parent, self.proj)  # the key is the repository git itself names
        other = self.tmp / "other"
        self.write_config(other, {"apps": {"sim": {}}})
        self.assertEqual(self.lock("holder", "sim", cwd=other).returncode, 1)


if __name__ == "__main__":
    unittest.main()
