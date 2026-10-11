"""`aw who` and `aw agent`: who is running, across projects, with what they hold."""
import json
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_coord_support import CoordCase, dead_pid  # noqa: E402

from coord import store  # noqa: E402


class AgentsCase(CoordCase):
    def who(self, cwd=None):
        return self.doc("who", "--json", cwd=cwd)

    def test_agents_of_two_projects_with_their_locks_and_leases(self):
        other = self.project("other")
        self.assertEqual(self.aw("who").stdout.strip(), "nobody: no agent registered, no lock or lease held")
        r = self.aw("agent", "start", "--name", "a1", "--session", "s-1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("a1: registered in proj", r.stdout)
        self.aw("agent", "start", "--name", "b1", cwd=other)
        self.aw("agent", "start", "--name", "b2", cwd=other / ".git")  # anywhere inside the repository
        self.aw("lock", "acquire", "gpu-exclusive", "--as", "a1", "--for", "benchmark", "--wait", "0")
        self.aw("lock", "acquire", "sim", "--as", "b1", "--for", "a run", "--wait", "0", cwd=other)
        self.aw("lease", "gpu", "--share", "0.3", "--for", "bake", "--hold", "--as", "b1", cwd=other)
        self.aw("lease", "cpu", "--cpu", "8", "--for", "compile", "--hold", "--as", "ghost", cwd=other)  # never registered
        doc = self.who(cwd=other)
        by = {a["name"]: a for a in doc["agents"]}
        self.assertEqual(sorted(by), ["a1", "b1", "b2", "ghost"])
        self.assertEqual((by["a1"]["pid"], by["a1"]["session"], by["a1"]["registered"]), (os.getpid(), "s-1", True))
        self.assertEqual(by["a1"]["root"], str(self.proj).replace("\\", "/"))
        self.assertEqual([(x["resource"], x["scope"]) for x in by["a1"]["locks"]], [("gpu-exclusive", "machine")])
        self.assertEqual([x["resource"] for x in by["b1"]["locks"]], ["sim"])
        self.assertEqual([(x["resource"], x["share"]) for x in by["b1"]["leases"]], [("gpu", 0.3)])
        self.assertEqual((by["b2"]["locks"], by["b2"]["leases"]), ([], []))
        self.assertEqual((by["ghost"]["registered"], [x["resource"] for x in by["ghost"]["leases"]]), (False, ["cpu"]))
        self.assertEqual(sorted(p["name"] for p in doc["projects"].values()), ["other", "proj"])
        self.assertEqual(by["a1"]["project"] != by["b1"]["project"], True)
        text = self.aw("who").stdout
        for part in ("other  (", "proj  (", "  a1  pid ", 'lock  gpu-exclusive [machine] for 0 min: "benchmark"',
                     'lock  sim [project]', 'lease gpu share 0.3', "ghost  (not registered"):
            self.assertIn(part, text)
        self.assertLess(text.index("other  ("), text.index("proj  ("))  # grouped by project

    def test_beat_and_stop(self):
        first = self.doc("agent", "start", "--name", "a1", "--json")
        time.sleep(1.1)
        r = self.aw("agent", "beat", "--name", "a1")
        self.assertIn("a1: still here", r.stdout)
        entry = self.who()["agents"][0]
        self.assertEqual(entry["started"], first["started"])
        self.assertGreater(entry["beat"], first["beat"])
        self.assertEqual(len(self.who()["agents"]), 1)  # a beat is not a second entry
        self.assertIn("b9: registered", self.aw("agent", "beat", "--name", "b9").stdout)  # a beat from a stranger registers it
        self.assertIn("a1: left", self.aw("agent", "stop", "--name", "a1").stdout)
        self.assertIn("was not registered", self.aw("agent", "stop", "--name", "a1").stdout)
        self.assertEqual([a["name"] for a in self.who()["agents"]], ["b9"])

    def test_the_name_comes_from_the_agent_variable_or_the_session(self):
        self.assertIn(f"session-{os.getpid()}: registered", self.aw("agent", "start").stdout)
        self.assertIn("worker-3: registered", self.aw("agent", "start", AW_AGENT="worker-3").stdout)
        self.assertIn("older: registered", self.aw("agent", "start", PL_AGENT="older").stdout)
        self.assertEqual(self.aw("agent", "start", "--name", "Bad Name").returncode, 2)
        self.assertEqual(sorted(a["name"] for a in self.who()["agents"]), ["older", f"session-{os.getpid()}", "worker-3"])

    def test_the_session_hook_and_a_later_command_are_one_agent(self):
        # The SessionStart hook and each tool call are separate processes with separate ancestries. What ties them
        # to one session is the process Claude Code names (CLAUDE_PID): the hook registers it, a later command finds
        # the same name, and what that command takes is listed under the one entry.
        self.write_config(self.proj, {"version": 1})
        hook = [sys.executable, "-B", str(Path(__file__).resolve().parent.parent / "hooks" / "session.py")]
        env = self.env(CLAUDE_PID=str(os.getpid()))
        env.pop("AW_SESSION_PID")
        payload = json.dumps({"hook_event_name": "SessionStart", "cwd": str(self.proj), "session_id": "s-9"})
        r = subprocess.run(hook, input=payload, env=env, cwd=str(self.proj), capture_output=True, text=True, timeout=60)
        self.assertEqual((r.returncode, r.stderr), (0, ""))

        def later(*args):
            return subprocess.run([sys.executable, "-B", str(Path(__file__).resolve().parent.parent / "cli" / "aw.py"), *args],
                                  env=env, cwd=str(self.proj), capture_output=True, text=True, timeout=60,
                                  stdin=subprocess.DEVNULL)

        self.assertEqual(later("lock", "acquire", "sim", "--for", "x", "--wait", "0").returncode, 0)
        self.assertEqual(later("lease", "gpu", "--share", "0.2", "--for", "y", "--hold").returncode, 0)
        agents = json.loads(later("who", "--json").stdout)["agents"]
        self.assertEqual([(a["name"], a["pid"], a["session"], a["registered"], len(a["locks"]), len(a["leases"])) for a in agents],
                         [(f"session-{os.getpid()}", os.getpid(), "s-9", True, 1, 1)])
        self.assertEqual(later("lock", "release", "sim").returncode, 0)  # the same name again: its own lock

    def test_agents_whose_process_is_gone_are_dropped(self):
        self.aw("agent", "start", "--name", "alive")
        self.aw("agent", "start", "--name", "gone", "--pid", dead_pid())
        path = self.home / "agents.jsonl"
        stale = {"id": "old", "name": "silent", "project": "p-00000000", "pid": None, "started": store.iso_at(time.time() - 9 * 3600),
                 "beat": store.iso_at(time.time() - 9 * 3600)}
        fresh = {**stale, "id": "new", "name": "pidless", "beat": store.now()}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(stale) + "\n" + json.dumps(fresh) + "\nnot json\n")
        self.assertEqual(sorted(a["name"] for a in self.who()["agents"]), ["alive", "pidless"])
        kept = [json.loads(line)["name"] for line in path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(sorted(kept), ["alive", "pidless"])  # the store itself was tidied

    def test_concurrent_starts_all_register(self):
        ps = [self.spawn("agent", "start", "--name", f"a{i}") for i in range(8)]
        self.assertEqual([p.wait(60) for p in ps], [0] * 8)
        self.assertEqual(sorted(a["name"] for a in self.who()["agents"]), [f"a{i}" for i in range(8)])
        lines = (self.home / "agents.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 8)
        self.assertTrue(all(json.loads(line)["pid"] == os.getpid() for line in lines))


if __name__ == "__main__":
    unittest.main()
