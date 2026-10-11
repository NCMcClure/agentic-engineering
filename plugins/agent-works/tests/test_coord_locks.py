"""`aw lock` as agents use it: separate processes, one temp store, one or several temp projects."""
import json
import os
import shutil
import subprocess
import sys
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_coord_support import CoordCase, dead_pid  # noqa: E402

FAST = ["--poll", "0.2"]
QUEUED = 3
RESOURCES = {"sim": {"scope": "project", "processes": [], "match": []}, "editor": {"scope": "project", "maxMinutes": 5}}


class LockCase(CoordCase):
    CONFIG = {"resources": RESOURCES}

    def lock(self, *args, **kw):
        return self.aw("lock", *args, **kw)

    def holder(self, resource="sim", cwd=None):
        return self.lock("holder", resource, cwd=cwd).stdout.strip()

    def row(self, resource, cwd=None):
        rows = self.doc("lock", "status", "--json", cwd=cwd)["resources"]
        return next(r for r in rows if r["resource"] == resource)

    # ------------------------------------------------------------------ ported from perceptual-loop's lock tests

    def test_race_has_exactly_one_holder(self):
        ps = [self.spawn("lock", "acquire", "sim", "--as", f"r-{i}", "--for", "race", "--wait", "0") for i in range(8)]
        codes = [p.wait(60) for p in ps]
        self.assertEqual(sorted(codes), [0] + [QUEUED] * 7, codes)
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
            waiters.append(self.spawn("lock", "run", "sim", "--as", name, "--for", "queued", "--wait", "40", *FAST,
                                      "--", sys.executable, "-c", code))
            time.sleep(0.6)
        self.assertEqual([w["agent"] for w in self.row("sim")["waiting"]], ["c-late", "a-mid", "b-last"])
        self.assertEqual(self.lock("release", "sim", "--as", "first").returncode, 0)
        self.assertEqual([p.wait(60) for p in waiters], [0, 0, 0])
        self.assertEqual(order.read_text().split(), ["c-late", "a-mid", "b-last"])
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        self.assertEqual(self.row("sim")["waiting"], [])

    def test_dead_waiter_keeps_its_place(self):
        self.lock("acquire", "sim", "--as", "first", "--for", "hold", "--wait", "0")
        r = self.lock("acquire", "sim", "--as", "early", "--for", "x", "--wait", "0")  # its command "dies" at once
        self.assertEqual(r.returncode, QUEUED)
        self.assertIn("STILL QUEUED", r.stderr)
        self.assertIn("Run the same command again", r.stderr)
        time.sleep(0.3)
        late = self.spawn("lock", "acquire", "sim", "--as", "late", "--for", "x", "--wait", "40", *FAST)
        time.sleep(0.8)
        self.lock("release", "sim", "--as", "first")
        time.sleep(1.2)  # 'late' polls every 0.2 s, yet the free lock is not its to take
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        self.assertEqual(self.lock("acquire", "sim", "--as", "early", "--for", "x", "--wait", "0").returncode, 0)  # asks again: still first
        self.assertEqual(self.lock("release", "sim", "--as", "early").returncode, 0)
        self.assertEqual(late.wait(30), 0)
        self.assertEqual(self.holder(), "late")

    def test_silent_waiter_is_passed_over_but_stays_listed(self):
        self.lock("acquire", "sim", "--as", "first", "--for", "hold", "--wait", "0")
        self.assertEqual(self.lock("acquire", "sim", "--as", "gone", "--for", "x", "--wait", "0").returncode, QUEUED)
        self.lock("release", "sim", "--as", "first")
        time.sleep(1.5)
        self.assertEqual(self.lock("acquire", "sim", "--as", "next", "--for", "x", "--wait", "0", "--live", "1").returncode, 0)
        self.assertEqual([w["agent"] for w in self.row("sim")["waiting"]], ["gone"])
        self.lock("release", "sim", "--as", "next")
        # ... and its ticket is thrown away once nobody polled it for --keep seconds
        self.assertEqual(self.lock("acquire", "sim", "--as", "next", "--for", "x", "--wait", "0", "--live", "1", "--keep", "1").returncode, 0)
        self.assertEqual(self.row("sim")["waiting"], [])

    def test_run_releases_after_a_failing_child_and_sets_the_agent_variable(self):
        code = "import os, sys; print('agent=' + os.environ.get('AW_AGENT', '')); sys.exit(7)"
        r = self.lock("run", "sim", "--as", "runner", "--for", "fails", "--wait", "0", "--", sys.executable, "-c", code)
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertIn("agent=runner", r.stdout)
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        r = self.lock("run", "sim", "--as", "runner", "--for", "no such program", "--wait", "0", "--", "aw-no-such-program-xyz", "a")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.lock("holder", "sim").returncode, 1)
        r = self.lock("run", "sim", "--as", "runner", "--for", "shell line", "--wait", "0", "--", "echo one && echo two")
        self.assertEqual((r.returncode, r.stdout.split()), (0, ["one", "two"]), r.stderr)

    def test_run_sets_the_projects_own_agent_variable_and_keeps_the_commands_flags(self):
        self.write_config(self.proj, {"resources": RESOURCES, "guard": {"agentVar": "ACME_AGENT"}})
        code = "import os, sys; print(os.environ.get('ACME_AGENT'), os.environ.get('AW_AGENT'), sys.argv[1:])"
        r = self.lock("run", "sim", "--for", "flags", "--wait", "0", "--", sys.executable, "-c", code, "--as", "x", "--json", "--", "-v",
                      ACME_AGENT="from-env")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "from-env from-env ['--as', 'x', '--json', '--', '-v']")  # the name came from the variable

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
        self.assertIn("killed at its", self.aw("notes").stdout)
        time.sleep(6.5)
        self.assertFalse(marker.exists(), "the grandchild outlived the kill")

    def test_held_lock_blocks_run_and_status_shows_the_hold(self):
        self.lock("acquire", "editor", "--as", "holder", "--for", "long job", "--wait", "0")
        r = self.lock("run", "editor", "--as", "other", "--for", "x", "--wait", "0", "--", sys.executable, "-c", "print('ran')")
        self.assertEqual(r.returncode, QUEUED)
        self.assertIn("STILL QUEUED", r.stderr)
        self.assertNotIn("ran", r.stdout)
        row = self.row("editor")
        self.assertEqual((row["agent"], row["maxMinutes"], row["overdue"], row["scope"]),
                         ("holder", 5.0, False, self.doc("lock", "status", "--json")["project"]))
        text = self.lock("status").stdout
        self.assertIn("held by holder for 0 of 5 min", text)
        self.assertIn("1. other waiting since", text)
        # a hold past its maximum is flagged
        path = Path(self.doc("lock", "status", "--json")["dir"]) / row["scope"] / "editor.lock"
        doc = json.loads(path.read_text())
        doc["since"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 600))
        path.write_text(json.dumps(doc))
        self.assertIn("for 10 of 5 min OVERDUE", self.lock("status").stdout)
        self.assertIn("editor", self.lock("status", "editor").stdout)
        self.assertNotIn("sim", self.lock("status", "editor").stdout)

    def test_stale_lock_is_taken_over_with_a_note(self):
        self.write_config(self.proj, {"resources": {"sim": {"processes": []}}, "coordination": {"lockStaleMinutes": 0.02}})
        self.lock("acquire", "sim", "--as", "sleeper", "--for", "forgot", "--wait", "0")
        self.assertEqual(self.lock("acquire", "sim", "--as", "taker", "--for", "x", "--wait", "0").returncode, QUEUED)  # not stale yet
        time.sleep(3)
        r = self.lock("acquire", "sim", "--as", "taker", "--for", "x", "--wait", "0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("taken over from sleeper", r.stdout)
        self.assertIn("took over sim from sleeper", self.aw("notes").stdout)

    def test_usage(self):
        self.assertEqual(self.lock("acquire", "sim", "--as", "Bad_Name", "--for", "x", "--wait", "0").returncode, 2)
        self.assertEqual(self.lock("acquire", "bad/name", "--as", "a", "--for", "x", "--wait", "0").returncode, 2)
        self.assertEqual(self.lock("acquire", "sim", "--as", "a", "--wait", "0").returncode, 2)  # no --for
        self.assertEqual(self.lock("run", "sim", "--as", "a", "--for", "x", "--wait", "0").returncode, 2)  # no command
        self.assertEqual(self.lock("--help").returncode, 0)
        self.assertEqual(self.lock().returncode, 2)
        self.assertEqual(self.lock("release", "sim", "--as", "a").returncode, 0)  # already free
        self.assertEqual(self.holder(), "")

    @unittest.skipUnless(shutil.which("git"), "git is not installed")
    def test_worktree_shares_the_locks_and_another_project_does_not(self):
        def git(*args, cwd=None):
            subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", *args],
                           cwd=cwd or self.real, check=True, capture_output=True)

        self.real = self.tmp / "real"
        self.real.mkdir()
        self.write_config(self.real, {"resources": {"sim": {}}})
        git("init", "-q", ".")
        git("commit", "-q", "--allow-empty", "-m", "init")
        wt = self.tmp / "wt"
        git("worktree", "add", "-q", str(wt), "-b", "wt")
        self.write_config(wt, {"resources": {"sim": {}}})
        sub = wt / "deep" / "er"
        sub.mkdir(parents=True)
        self.assertEqual(self.lock("acquire", "sim", "--as", "main-agent", "--for", "x", "--wait", "0", cwd=self.real).returncode, 0)
        self.assertEqual(self.holder(cwd=sub), "main-agent")
        here = self.doc("lock", "status", "--json", cwd=self.real)["project"]
        there = self.doc("lock", "status", "--json", cwd=wt)["project"]
        self.assertEqual(here, there)
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=wt, capture_output=True, text=True).stdout.strip()
        self.assertEqual(Path(common).resolve().parent, self.real)  # the key is the repository git itself names
        self.assertEqual(self.lock("holder", "sim", cwd=self.proj).returncode, 1)  # another project: its own sim

    # ------------------------------------------------------------------------------------------- scopes and order

    def test_two_projects_contend_for_a_machine_resource(self):
        machine = {"resources": {"renderer": {"scope": "machine"}}}
        a, b = self.project("alpha", machine), self.project("beta", machine)
        self.assertEqual(self.lock("acquire", "renderer", "--as", "a1", "--for", "alpha's run", "--wait", "0", cwd=a).returncode, 0)
        # the same agent name in another project is somebody else
        r = self.lock("acquire", "renderer", "--as", "a1", "--for", "beta's run", "--wait", "0", cwd=b)
        self.assertEqual(r.returncode, QUEUED)
        self.assertIn("a1 (alpha)", r.stderr)
        row = self.row("renderer", cwd=b)
        self.assertEqual((row["scope"], row["agent"], row["for"]), ("machine", "a1", "alpha's run"))
        self.assertEqual(row["project"], self.doc("lock", "status", "--json", cwd=a)["project"])
        self.assertIn("a1@", row["waiting"][0]["agent"])
        self.assertEqual(self.lock("release", "renderer", "--as", "a1", cwd=b).returncode, 1)  # not beta's to release
        self.assertEqual(self.holder("renderer", cwd=b), "a1")
        waiter = self.spawn("lock", "run", "renderer", "--as", "a1", "--for", "beta's run", "--wait", "30", *FAST, "--",
                            sys.executable, "-c", "print('beta ran')", cwd=b)
        time.sleep(0.8)
        self.assertEqual(self.lock("release", "renderer", "--as", "a1", cwd=a).returncode, 0)
        out, _ = waiter.communicate(timeout=30)
        self.assertEqual((waiter.returncode, out.strip()), (0, "beta ran"))
        self.assertEqual(self.lock("holder", "renderer", cwd=a).returncode, 1)

    def test_builtin_machine_resource_races_across_projects(self):
        roots = [self.project("alpha"), self.project("beta"), self.project("gamma", {"resources": {}})]
        ps = [self.spawn("lock", "acquire", "gpu-exclusive", "--as", "bench", "--for", "race", "--wait", "0", cwd=roots[i % 3])
              for i in range(9)]
        codes = [p.wait(60) for p in ps]
        # three agents named alike per project: the three of one project count as one holder refreshing
        winners = {i % 3 for i, c in enumerate(codes) if c == 0}
        self.assertEqual(len(winners), 1, codes)
        held = [self.lock("holder", "gpu-exclusive", "--json", cwd=r) for r in roots]
        self.assertEqual(len({json.loads(h.stdout)["project"] for h in held}), 1)
        self.assertTrue(all(json.loads(h.stdout)["scope"] == "machine" for h in held))

    def test_a_project_resource_does_not_block_another_project(self):
        other = self.project("other", {"resources": RESOURCES})
        self.assertEqual(self.lock("acquire", "sim", "--as", "a1", "--for", "x", "--wait", "0").returncode, 0)
        self.assertEqual(self.lock("acquire", "sim", "--as", "b1", "--for", "y", "--wait", "0", cwd=other).returncode, 0)
        self.assertEqual((self.holder(), self.holder(cwd=other)), ("a1", "b1"))
        self.assertEqual(self.lock("release", "sim", "--as", "b1", cwd=other).returncode, 0)
        self.assertEqual(self.holder(), "a1")
        rows = self.doc("lock", "status", "--all", "--json", cwd=other)["resources"]
        self.assertEqual([(r["agent"]) for r in rows if r["resource"] == "sim" and r["held"]], ["a1"])
        self.assertIn("sim [proj]: held by a1", self.lock("status", "--all", cwd=other).stdout)

    def test_undeclared_resource_is_an_ad_hoc_project_lock_with_a_warning(self):
        other = self.project("bare")
        r = self.lock("acquire", "anything", "--as", "a", "--for", "x", "--wait", "0", cwd=other)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("not declared", r.stderr)
        self.assertEqual(self.lock("holder", "anything", cwd=self.proj).returncode, 1)  # this project's own, and free
        doc = self.doc("lock", "acquire", "nope", "--as", "a", "--for", "x", "--wait", "0", "--json")
        self.assertTrue(doc["held"])
        self.assertEqual(doc["scope"], self.doc("lock", "status", "--json")["project"])
        self.assertIn("not declared", doc["warnings"][0])
        r = self.lock("acquire", "sim", "--as", "a", "--for", "x", "--wait", "0")
        self.assertNotIn("not declared", r.stderr)

    def test_lock_order_warning(self):
        self.write_config(self.proj, {"resources": RESOURCES, "lockOrder": ["sim", "editor"]})
        r = self.lock("acquire", "sim", "--as", "a", "--for", "x", "--wait", "0")
        self.assertNotIn("lock order", r.stderr)
        r = self.lock("acquire", "editor", "--as", "a", "--for", "x", "--wait", "0")
        self.assertEqual(r.returncode, 0)
        self.assertNotIn("lock order", r.stderr)  # sim, then editor: the order
        self.lock("release", "sim", "--as", "a")
        r = self.lock("acquire", "sim", "--as", "a", "--for", "x", "--wait", "0")
        self.assertEqual(r.returncode, 0)  # a warning, not a refusal
        self.assertIn("lock order: sim comes before editor", r.stderr)
        r = self.lock("acquire", "sim", "--as", "b", "--for", "x", "--wait", "0")
        self.assertNotIn("lock order", r.stderr)  # b holds nothing

        from coord import locks
        self.assertIsNone(locks.order_warning("a", ["b"], ["a", "c"]))
        self.assertIsNone(locks.order_warning("x", ["a"], ["a", "b"]))
        self.assertIn("release c", locks.order_warning("a", ["c", "z"], ["a", "b", "c"]))

    def test_the_lock_of_a_run_that_died_is_taken_over_at_once(self):
        scope = self.doc("lock", "status", "--json")["project"]
        d = self.home / "locks" / scope
        d.mkdir(parents=True)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        ghost = {"agent": "ghost", "project": scope, "for": "crashed", "pid": dead_pid(), "run": True, "since": stamp, "refreshed": stamp}
        (d / "sim.lock").write_text(json.dumps(ghost))
        r = self.lock("acquire", "sim", "--as", "taker", "--for", "x", "--wait", "0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("taken over from ghost", r.stdout)
        self.assertIn("its run is gone", self.aw("notes").stdout)
        # a plain hold (acquire) with a fresh stamp is never taken over, whatever its pid
        (d / "editor.lock").write_text(json.dumps({**ghost, "run": False}))
        self.assertEqual(self.lock("acquire", "editor", "--as", "taker", "--for", "x", "--wait", "0").returncode, QUEUED)

    def test_older_lock_fields_are_read_as_aliases(self):
        scope = self.doc("lock", "status", "--json")["project"]
        d = self.home / "locks" / scope
        d.mkdir(parents=True)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        (d / "sim.lock").write_text(json.dumps({"holder": "old-agent", "what": "an import", "since": stamp, "refreshed": stamp}))
        row = self.row("sim")
        self.assertEqual((row["agent"], row["for"]), ("old-agent", "an import"))
        self.assertEqual(self.lock("release", "sim", "--as", "old-agent").returncode, 0)

    def test_what_the_guard_asks(self):
        from coord import common, locks

        cfg = common.load_config(self.proj)
        self.assertIsNone(locks.holder("sim", cfg, self.proj))
        self.assertFalse(locks.holds("a1", "sim", cfg, self.proj))
        self.lock("acquire", "sim", "--as", "a1", "--for", "guarded", "--wait", "0")
        held = locks.holder("sim", cfg, self.proj)
        self.assertEqual((held["agent"], held["for"], held["scope"]), ("a1", "guarded", common.project_id(self.proj)))
        self.assertTrue(locks.holds("a1", "sim", cfg, self.proj))
        self.assertFalse(locks.holds("a2", "sim", cfg, self.proj))
        self.assertFalse(locks.holds(None, "sim", cfg, self.proj))
        before = held["refreshed"]
        time.sleep(1.1)
        self.assertTrue(locks.refresh("a1", "sim", cfg, self.proj))
        self.assertFalse(locks.refresh("a2", "sim", cfg, self.proj))
        self.assertGreater(locks.holder("sim", cfg, self.proj)["refreshed"], before)
        # a machine resource: held by an agent of another project, so not by the like-named one here
        other = self.project("other")
        self.lock("acquire", "gpu-exclusive", "--as", "a1", "--for", "x", "--wait", "0", cwd=other)
        self.assertEqual(locks.holder("gpu-exclusive", cfg, self.proj)["scope"], "machine")
        self.assertFalse(locks.holds("a1", "gpu-exclusive", cfg, self.proj))
        self.assertTrue(locks.holds("a1", "gpu-exclusive", common.load_config(other), other))
        self.assertEqual(locks.scope_of("gpu", {"resources": {"gpu": {"scope": "project"}}}, self.proj), "machine")


if __name__ == "__main__":
    unittest.main()
