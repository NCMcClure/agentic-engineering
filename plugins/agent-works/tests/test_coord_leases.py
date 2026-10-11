"""`aw lease` and `aw leases`: declared use that lives with a command or until released, and adds up."""
import json
import os
import sys
import time
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_coord_support import CoordCase, dead_pid  # noqa: E402

from coord import leases, store  # noqa: E402

GB = 1024 ** 3


class LeaseCase(CoordCase):
    def leases(self, cwd=None):
        return self.doc("leases", "--json", cwd=cwd)["leases"]

    def test_a_lease_lives_while_its_command_runs_and_another_project_sees_it(self):
        other = self.project("other")
        p = self.spawn("lease", "gpu", "--share", "0.5", "--mem", "12GB", "--cpu", "4", "--as", "trainer", "--for", "fine-tune",
                       "--", sys.executable, "-c", "import os, time; print(os.environ['AW_LEASE']); time.sleep(3)")
        deadline = time.monotonic() + 20
        rows = []
        while not rows and time.monotonic() < deadline:
            time.sleep(0.2)
            rows = self.leases(cwd=other)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["resource"], row["agent"], row["share"], row["mem"], row["cpu"], row["for"], row["hold"]),
                         ("gpu", "trainer", 0.5, 12 * GB, 4.0, "fine-tune", False))
        self.assertEqual(row["project"], self.doc("lock", "status", "--json")["project"])
        self.assertIn('gpu share 0.5 12.0 GB 4 cpu  trainer (proj)', self.aw("leases", cwd=other).stdout)
        out, err = p.communicate(timeout=30)
        self.assertEqual(p.returncode, 0, err)
        self.assertEqual(out.strip(), row["id"])
        self.assertIn("released (exit 0)", err)
        self.assertEqual(self.leases(), [])

    def test_the_lease_goes_when_the_command_fails_or_is_killed_at_its_limit(self):
        r = self.aw("lease", "gpu", "--for", "fails", "--", sys.executable, "-c", "import sys; sys.exit(7)")
        self.assertEqual(r.returncode, 7, r.stderr)
        self.assertEqual(self.leases(), [])
        r = self.aw("lease", "gpu", "--for", "no such program", "--", "aw-no-such-program-xyz", "a")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.leases(), [])
        r = self.aw("lease", "gpu", "--for", "hangs", "--max-minutes", "0.02", "--", sys.executable, "-c", "import time; time.sleep(60)")
        self.assertEqual(r.returncode, 124, r.stderr)
        self.assertEqual(self.leases(), [])
        r = self.aw("lease", "cpu", "--for", "shell line", "--", "echo one && echo two")
        self.assertEqual((r.returncode, r.stdout.split()), (0, ["one", "two"]), r.stderr)

    def test_hold_and_release(self):
        doc = self.doc("lease", "gpu", "--share", "0.25", "--for", "notebook", "--hold", "--as", "a1", "--json")
        lease = doc["lease"]
        self.assertTrue(lease["hold"])
        self.assertEqual(lease["pid"], os.getpid())  # the session, so the lease ends with it
        self.assertAlmostEqual(store.parse_iso(lease["until"]) - time.time(), 120 * 60, delta=30)
        self.assertEqual([r["id"] for r in self.leases()], [lease["id"]])
        r = self.aw("lease", "--release", lease["id"], "--as", "a2")
        self.assertEqual(r.returncode, 1)
        self.assertIn("only its holder", r.stderr)
        self.assertEqual(self.aw("lease", "--release", lease["id"], "--as", "a1", cwd=self.project("other")).returncode, 1)
        self.assertEqual(self.aw("lease", "--release", lease["id"], "--as", "a1").returncode, 0)
        self.assertEqual(self.leases(), [])
        self.assertEqual(self.aw("lease", "--release", lease["id"], "--as", "a1").returncode, 0)  # already gone
        text = self.aw("lease", "gpu", "--for", "x", "--hold", "--minutes", "5").stdout
        self.assertIn("release it with: aw lease --release ls-", text)

    def test_leases_whose_process_is_gone_or_whose_time_is_over_are_dropped(self):
        self.home.mkdir(parents=True)
        now = store.now()
        rows = [
            {"id": "ls-dead", "resource": "gpu", "agent": "a", "project": "p-00000000", "for": "x", "pid": dead_pid(), "since": now},
            {"id": "ls-over", "resource": "gpu", "agent": "a", "project": "p-00000000", "for": "x", "pid": os.getpid(), "since": now,
             "until": store.iso_at(time.time() - 5)},
            {"id": "ls-live", "resource": "gpu", "agent": "a", "project": "p-00000000", "for": "x", "pid": os.getpid(), "since": now,
             "until": store.iso_at(time.time() + 600)},
        ]
        (self.home / "resources.json").write_text(json.dumps({"leases": rows}))
        self.assertEqual([r["id"] for r in self.leases()], ["ls-live"])
        self.assertEqual([r["id"] for r in json.loads((self.home / "resources.json").read_text())["leases"]], ["ls-live"])

    def test_leases_add_up_and_over_subscription_is_a_warning_not_a_refusal(self):
        other = self.project("other")
        self.assertEqual(self.aw("lease", "gpu", "--share", "0.7", "--for", "a", "--hold", "--as", "a1").returncode, 0)
        r = self.aw("lease", "gpu", "--share", "0.6", "--mem", "2000GB", "--for", "b", "--hold", "--as", "b1", cwd=other)
        self.assertEqual(r.returncode, 0, r.stderr)  # not refused
        self.assertIn("also on gpu right now", r.stderr)
        self.assertIn("a1 (proj)", r.stderr)
        doc = self.doc("leases", "--json")
        self.assertEqual((doc["totals"]["gpu"]["count"], doc["totals"]["gpu"]["share"]), (2, 1.3))
        self.assertIn("gpu: 2 leases add up to share 1.3", self.aw("leases").stdout)
        self.assertEqual(len(self.doc("leases", "--resource", "cpu", "--json")["leases"]), 0)
        warnings = self.doc("sys", "--json")["warnings"]
        self.assertTrue(any("gpu is over-subscribed" in w and "1.3" in w for w in warnings), warnings)

    def test_concurrent_leases_all_land(self):
        ps = [self.spawn("lease", "gpu", "--share", "0.1", "--for", f"n{i}", "--hold", "--as", f"a{i}") for i in range(8)]
        self.assertEqual([p.wait(60) for p in ps], [0] * 8)
        self.assertEqual(sorted(r["agent"] for r in self.leases()), [f"a{i}" for i in range(8)])

    def test_usage(self):
        self.assertEqual(self.aw("lease", "gpu", "--share", "1.5", "--for", "x", "--hold").returncode, 2)
        self.assertEqual(self.aw("lease", "gpu", "--hold").returncode, 2)  # no --for
        self.assertEqual(self.aw("lease", "gpu", "--for", "x").returncode, 2)  # neither a command nor --hold
        self.assertEqual(self.aw("lease", "gpu", "--for", "x", "--hold", "--", "echo", "x").returncode, 2)  # both
        self.assertEqual(self.aw("lease", "gpu", "--mem", "12", "--for", "x", "--hold").returncode, 2)  # no unit
        self.assertEqual(self.aw("lease", "--for", "x", "--hold").returncode, 2)  # no resource
        self.assertEqual(self.leases(), [])
        self.assertEqual(self.aw("leases").stdout.strip(), "no leases")

    def test_memory_sizes(self):
        self.assertEqual(leases.parse_mem("12GB"), 12 * GB)
        self.assertEqual(leases.parse_mem("512 mb"), 512 * 1024 ** 2)
        self.assertEqual(leases.parse_mem("1.5g"), int(1.5 * GB))
        self.assertEqual(leases.parse_mem("2GiB"), 2 * GB)
        for bad in ("12", "lots", "GB", "-1GB"):
            with self.assertRaises(store.CoordError):
                leases.parse_mem(bad)
        self.assertEqual((leases.fmt_bytes(12 * GB), leases.fmt_bytes(512 * 1024 ** 2), leases.fmt_bytes(None)), ("12.0 GB", "512.0 MB", "?"))


if __name__ == "__main__":
    unittest.main()
