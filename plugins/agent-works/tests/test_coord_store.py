"""The store itself: read-modify-write under contention, rotation, processes, identity, the list of projects."""
import argparse
import json
import os
import sys
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_coord_support import CoordCase, dead_pid  # noqa: E402

from coord import common, store  # noqa: E402

INCREMENT = """
from pathlib import Path
from coord import store
path, times = Path(sys.argv[1]), int(sys.argv[2])
def bump(doc):
    doc["n"] = doc.get("n", 0) + 1
    doc.setdefault("who", []).append(sys.argv[3])
for _ in range(times):
    store.update_json(path, {}, bump)
"""

APPEND = """
from pathlib import Path
from coord import store
for i in range(int(sys.argv[2])):
    store.append_line(Path(sys.argv[1]), f"{sys.argv[3]} {i} " + "x" * 80)
"""


class StoreCase(CoordCase):
    def test_read_modify_write_loses_nothing_between_processes(self):
        path = self.home / "counter.json"
        ps = [self.python(INCREMENT, path, 25, f"p{i}") for i in range(8)]
        errors = [p.communicate(timeout=120)[1] for p in ps]
        self.assertEqual([p.returncode for p in ps], [0] * 8, errors)
        doc = json.loads(path.read_text())
        self.assertEqual(doc["n"], 200)
        self.assertEqual({w: doc["who"].count(w) for w in set(doc["who"])}, {f"p{i}": 25 for i in range(8)})
        self.assertEqual([p.name for p in self.home.iterdir()], ["counter.json"])  # no lock or temp file left behind

    def test_appends_from_several_processes_all_arrive_whole(self):
        path = self.home / "log.txt"
        ps = [self.python(APPEND, path, 30, f"w{i}") for i in range(6)]
        errors = [p.communicate(timeout=120)[1] for p in ps]
        self.assertEqual([p.returncode for p in ps], [0] * 6, errors)
        lines = store.log_lines(path)
        self.assertEqual(len(lines), 180)
        self.assertTrue(all(len(ln.split()) == 3 and ln.endswith("x" * 80) for ln in lines))
        self.assertEqual({(w, i) for w, i, _ in (ln.split() for ln in lines)}, {(f"w{w}", str(i)) for w in range(6) for i in range(30)})

    def test_a_log_rotates_and_keeps_one_older_generation(self):
        path = self.home / "notes.log"
        for i in range(40):
            store.append_line(path, f"line {i:02d} " + "y" * 40, max_bytes=500)
        self.assertTrue(path.with_name("notes.log.1").is_file())
        self.assertLess(path.stat().st_size, 600)
        lines = store.log_lines(path)
        self.assertEqual(lines[-1].split()[1], "39")
        self.assertEqual(lines, sorted(lines))  # the older generation first
        self.assertLess(len(lines), 40)  # what was older than that is gone

    def test_a_lock_file_left_by_a_dead_process_is_broken(self):
        target = self.home / "thing.json"
        self.home.mkdir(parents=True)
        lk = self.home / "thing.json.lk"
        lk.write_text(f"{dead_pid()} 0")
        os.utime(lk, (time.time() - 5, time.time() - 5))
        started = time.monotonic()
        store.update_json(target, {}, lambda doc: doc.update(ok=True))
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual(json.loads(target.read_text()), {"ok": True})
        # ... while one whose holder lives is respected until the timeout
        lk.write_text(f"{os.getpid()} 0")
        with self.assertRaises(store.CoordError):
            with store.FileLock(target, timeout=1.0):
                pass
        lk.unlink()

    def test_a_damaged_file_starts_over_instead_of_failing(self):
        path = self.home / "resources.json"
        self.home.mkdir(parents=True)
        path.write_text("{ not json")
        store.update_json(path, {"leases": []}, lambda doc: doc["leases"].append(1))
        self.assertEqual(json.loads(path.read_text()), {"leases": [1]})

    def test_pid_liveness(self):
        self.assertTrue(store.pid_alive(os.getpid()))
        self.assertTrue(store.pid_alive(str(os.getpid())))
        self.assertFalse(store.pid_alive(dead_pid()))
        for bad in (0, -1, None, "x", ""):
            self.assertFalse(store.pid_alive(bad))

    def test_process_table_and_running(self):
        table = store.process_table()
        self.assertIn(os.getpid(), table)
        me = os.path.basename(sys.executable)
        self.assertIn(table[os.getpid()][1].lower(), (me.lower(), "python", "python3"))
        self.assertTrue(store.running([table[os.getpid()][1][:4].upper()]))  # by prefix, case ignored
        self.assertEqual(store.running([]), [])
        self.assertEqual(store.running(["aw-no-such-process-xyz"]), [])

    def test_session_pid_and_identity(self):
        self.assertEqual(store.session_pid(), os.getpid())  # AW_SESSION_PID, set by the test case
        del os.environ["AW_SESSION_PID"]
        found = store.session_pid()
        self.assertNotEqual(found, os.getpid())
        self.assertTrue(store.pid_alive(found))
        # Claude Code names its process to the shells and hooks it starts: one name for a session's every call,
        # also where the ancestry breaks (Git Bash). A process that is gone is not believed.
        os.environ["CLAUDE_PID"] = str(os.getppid())
        self.assertEqual(store.session_pid(), os.getppid())
        os.environ["CLAUDE_PID"] = str(dead_pid())
        self.assertEqual(store.session_pid(), found)
        os.environ["AW_SESSION_PID"] = "4242"
        self.assertEqual(store.session_pid(), 4242)  # the explicit variable wins
        os.environ.pop("CLAUDE_PID")
        cfg = common.load_config(self.proj)
        self.assertEqual(store.identity(cfg), "session-4242")
        self.assertEqual(store.identity(cfg, "a-1"), "a-1")
        with self.assertRaises(store.CoordError):
            store.identity(cfg, "Bad_Name")
        os.environ["AW_AGENT"] = "Explore Agent_2"
        self.assertEqual(store.identity(cfg), "explore-agent-2")  # a name from the environment is tidied, not refused
        os.environ.pop("AW_AGENT")
        os.environ["PL_AGENT"] = "older"
        self.assertEqual(store.identity(cfg), "older")  # an alias of the agent variable
        os.environ.pop("PL_AGENT")

    def test_time_helpers(self):
        self.assertEqual(store.iso_at(0), "1970-01-01T00:00:00Z")
        self.assertEqual(store.parse_iso("1970-01-01T00:01:00Z"), 60.0)
        self.assertIsNone(store.parse_iso("yesterday"))
        self.assertEqual(store.age_seconds(None), 0.0)
        self.assertAlmostEqual(store.age_seconds(store.iso_at(time.time() - 100)), 100, delta=3)
        self.assertEqual((store.ago(30), store.ago(600), store.ago(7200)), ("30 s", "10 min", "2.0 h"))

    def test_words_after_a_double_dash_are_the_command(self):
        parser = argparse.ArgumentParser()
        sub = parser.add_subparsers()
        run = sub.add_parser("run")
        run.add_argument("resource")
        run.add_argument("--for", dest="why")
        run.add_argument("--json", action="store_true")
        store.split_command(run)
        a = parser.parse_args(["run", "gpu", "--for", "x", "--", "prog", "--for", "y", "--json", "--", "-v"])
        self.assertEqual((a.resource, a.why, a.json), ("gpu", "x", False))
        self.assertEqual(a.command_line, ["prog", "--for", "y", "--json", "--", "-v"])
        self.assertEqual(parser.parse_args(["run", "--json", "gpu"]).command_line, [])

    def test_projects_seen_are_listed_once_per_repository(self):
        other = self.project("other")
        deep = other / "src" / "deep"
        deep.mkdir(parents=True)
        self.assertEqual(self.aw("note", "from proj").returncode, 0)
        self.assertEqual(self.aw("note", "from other", cwd=deep).returncode, 0)
        self.assertEqual(self.aw("note", "again", cwd=other).returncode, 0)
        seen = json.loads((self.home / "projects.json").read_text())
        self.assertEqual(sorted(v["name"] for v in seen.values()), ["other", "proj"])
        self.assertEqual({v["root"] for v in seen.values()}, {common.posix(self.proj), common.posix(other)})
        self.assertEqual(set(seen), {common.project_id(self.proj), common.project_id(deep)})
        self.assertEqual(store.find_project("oth"), [common.project_id(other)])
        self.assertEqual(store.project_name(common.project_id(other)), "other")
        self.assertEqual(store.project_name("gone-0123abcd"), "gone")

    def test_the_configs_name_is_the_projects_name_in_the_store(self):
        named = self.project("named")
        (named / ".agents").mkdir(exist_ok=True)
        (named / ".agents" / "agent-works.json").write_text('{"version": 1, "name": "Cardan"}', encoding="utf-8")
        self.assertEqual(self.aw("note", "from named", cwd=named).returncode, 0)
        seen = json.loads((self.home / "projects.json").read_text())
        self.assertEqual(seen[common.project_id(named)]["name"], "Cardan")
        self.assertRegex(common.project_id(named), r"^named-[0-9a-f]{8}$")

    def test_settings_come_from_the_config_or_the_defaults(self):
        self.assertEqual(store.setting({}, "lockStaleMinutes"), 45)
        self.assertEqual(store.setting({"coordination": {"lockStaleMinutes": 5}}, "lockStaleMinutes"), 5)
        self.assertEqual(store.setting({"coordination": {"lockStaleMinutes": "soon"}}, "lockStaleMinutes"), 45)
        with self.assertRaises(store.CoordError):
            store.check_name("../escape", "resource name")


if __name__ == "__main__":
    unittest.main()
