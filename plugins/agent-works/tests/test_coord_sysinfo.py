"""`aw sys`: readings that are optional, the picture beside them, and "quiet enough to measure?"."""
import os
import sys
import time
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_coord_support import CoordCase  # noqa: E402

from coord import store, sysinfo  # noqa: E402

GB = 1024 ** 3
GPU_TEXT = """0, GPU-aaaa, Vendor Model 9000, 37, 4096, 32768, 55
1, GPU-bbbb, Vendor Model 9000, [N/A], [N/A], 32768, [N/A]
garbage line
"""
APPS_TEXT = """4321, C:\\Program Files\\Tool, Inc\\render.exe, 2048, GPU-aaaa
77, /usr/bin/python3, [N/A], GPU-aaaa
88, [Insufficient Permissions], [N/A], GPU-bbbb
"""


def picture(**over):
    doc = {"at": "2026-01-01T00:00:00Z", "gpus": sysinfo.parse_gpus(GPU_TEXT), "cpu": {"count": 8, "percent": 12.0, "load1": None},
           "memory": {"total": 64 * GB, "available": 32 * GB}, "leases": [], "locks": [], "agents": [],
           "projects": {"p-1": "alpha", "p-2": "beta"}}
    doc.update(over)
    return doc


def lease(agent, project, resource="gpu", **fields):
    return {"id": "ls-x", "resource": resource, "agent": agent, "project": project, "for": "work", **fields}


class ParseCase(unittest.TestCase):
    def test_gpu_rows(self):
        rows = sysinfo.parse_gpus(GPU_TEXT)
        self.assertEqual(len(rows), 2)
        self.assertEqual((rows[0]["index"], rows[0]["util"], rows[0]["memUsed"], rows[0]["memTotal"], rows[0]["temp"]),
                         (0, 37.0, 4 * GB, 32 * GB, 55.0))
        self.assertEqual((rows[1]["util"], rows[1]["memUsed"], rows[1]["temp"]), (None, None, None))
        self.assertEqual(sysinfo.parse_gpus(""), [])

    def test_gpu_processes(self):
        rows = sysinfo.parse_gpu_processes(APPS_TEXT)
        self.assertEqual([(r["pid"], r["name"], r["mem"], r["uuid"]) for r in rows],
                         [(4321, "render.exe", 2 * GB, "GPU-aaaa"), (77, "python3", None, "GPU-aaaa"),
                          (88, "[Insufficient Permissions]", None, "GPU-bbbb")])

    def test_warnings(self):
        self.assertEqual(sysinfo.warnings_of(picture(gpus=None)), [])
        busy = sysinfo.warnings_of(picture())
        self.assertEqual(busy, [])  # 37 % is under the "busy and undeclared" mark
        hot = picture()
        hot["gpus"][0]["util"] = 91.0
        self.assertIn("GPU 0 reads 91 % and nobody has declared it", sysinfo.warnings_of(hot)[0])
        hot["leases"] = [lease("a", "p-1")]
        self.assertEqual(sysinfo.warnings_of(hot), [])  # declared now
        over = picture(leases=[lease("a", "p-1", share=0.6, mem=40 * GB, cpu=6), lease("b", "p-2", share=0.6, mem=30 * GB, cpu=6),
                               lease("c", "p-2", "ram", mem=80 * GB)])
        text = "\n".join(sysinfo.warnings_of(over))
        self.assertIn("gpu is over-subscribed: the leases add up to a share of 1.2 (a (alpha), b (beta))", text)
        self.assertIn("GPU memory is over-subscribed: leases for 70.0 GB on 64.0 GB", text)
        self.assertIn("memory is over-subscribed: leases for 80.0 GB on 64.0 GB (c (beta))", text)
        self.assertIn("processors are over-subscribed: leases for 12 of 8", text)
        unknown = picture(gpus=None, memory=None, leases=[lease("a", "p-1", mem=4000 * GB)])
        self.assertEqual(sysinfo.warnings_of(unknown), [])  # nothing to hold the number against

    def test_quiet_reasons(self):
        quiet = picture()
        quiet["gpus"][0]["util"] = 2.0
        self.assertEqual(sysinfo.quiet_reasons(quiet, "me", "p-1", 10), [])
        self.assertIn("GPU 0 reads 37 % (threshold 10 %)", sysinfo.quiet_reasons(picture(), "me", "p-1", 10))
        self.assertEqual(sysinfo.quiet_reasons(picture(), "me", "p-1", 50), [])
        mine = dict(quiet, leases=[lease("me", "p-1")], locks=[{"resource": "gpu-exclusive", "scope": "machine", "agent": "me", "project": "p-1"}])
        self.assertEqual(sysinfo.quiet_reasons(mine, "me", "p-1", 10), [])  # my own declarations do not count
        theirs = dict(quiet, leases=[lease("me", "p-2"), lease("b", "p-2", "cpu")],
                      locks=[{"resource": "renderer", "scope": "machine", "agent": "b", "project": "p-2", "for": "bake"},
                             {"resource": "sim", "scope": "p-2", "agent": "b", "project": "p-2"}])
        reasons = sysinfo.quiet_reasons(theirs, "me", "p-1", 10)
        self.assertEqual(len(reasons), 2, reasons)  # the like-named agent's GPU lease, and the machine lock
        self.assertIn("me (beta) holds a lease on gpu", reasons[0])
        self.assertIn('b (beta) holds the lock on renderer: "bake"', reasons[1])
        self.assertEqual(len(sysinfo.quiet_reasons(theirs, "me", "p-1", 10, strict=True)), 4)
        self.assertIn("CPU reads 12 %", sysinfo.quiet_reasons(quiet, "me", "p-1", 10, cpu_under=5)[0])
        self.assertEqual(sysinfo.quiet_reasons(picture(gpus=None), "me", "p-1", 10), [])  # no reading is not a reason

    def test_record_line(self):
        line = sysinfo.record_line(picture())
        self.assertEqual(line, "2026-01-01T00:00:00Z; gpu0 37 % 4.0 GB/32.0 GB; gpu1 ? ?/32.0 GB; cpu 12 %; mem 50 %; "
                               "leases 0; locks 0; agents 0")
        self.assertIn("gpu: no reading", sysinfo.record_line(picture(gpus=None, cpu={}, memory=None)))


class ProbeCase(unittest.TestCase):
    def test_probes_answer_or_say_nothing(self):
        c = sysinfo.cpu(0.05)
        self.assertGreaterEqual(c["count"], 1)
        self.assertTrue(c["percent"] is None or 0 <= c["percent"] <= 100)
        m = sysinfo.memory()
        self.assertTrue(m is None or 0 < m["available"] <= m["total"])
        rows = sysinfo.disks([("here", os.getcwd()), ("also here", os.getcwd()), ("nowhere", os.path.join(os.getcwd(), "no", "such"))])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["of"], ["here", "also here", "nowhere"])  # a missing folder is measured where it would live
        self.assertIsNone(sysinfo._run(["aw-no-such-program-xyz"]))
        self.assertIsNone(sysinfo._run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.3))  # too slow: no reading


class SysCase(CoordCase):
    def no_gpu_tool(self):
        empty = self.tmp / "empty-path"
        empty.mkdir(exist_ok=True)
        return {"PATH": str(empty)}  # nvidia-smi is not found there

    def test_sys_prints_readings_beside_declarations_and_json_carries_the_same(self):
        other = self.project("other")
        self.aw("agent", "start", "--name", "a1")
        self.aw("agent", "start", "--name", "b1", cwd=other)
        self.aw("lease", "gpu", "--share", "0.5", "--mem", "8GB", "--for", "bake", "--hold", "--as", "b1", cwd=other)
        self.aw("lock", "acquire", "gpu-exclusive", "--as", "a1", "--for", "benchmark", "--wait", "0")
        r = self.aw("sys", **self.no_gpu_tool())
        self.assertEqual(r.returncode, 0, r.stderr)
        for part in ("no GPU reading (nvidia-smi is not on the path)", "  cpu ", "  memory ", "  disk ",
                     'gpu share 0.5 8.0 GB  b1 (other)', 'gpu-exclusive [machine]  a1 (proj)', "proj (this project): a1",
                     "other: b1", "record: "):
            self.assertIn(part, r.stdout)
        doc = self.doc("sys", "--json", **self.no_gpu_tool())
        self.assertIsNone(doc["gpus"])
        self.assertEqual(set(doc) >= {"at", "gpus", "gpuNote", "cpu", "memory", "disks", "leases", "locks", "agents", "projects",
                                      "totals", "warnings"}, True)
        self.assertEqual([(x["resource"], x["agent"]) for x in doc["leases"]], [("gpu", "b1")])
        self.assertEqual([(x["resource"], x["agent"], x["scope"]) for x in doc["locks"]], [("gpu-exclusive", "a1", "machine")])
        self.assertEqual(sorted(x["name"] for x in doc["agents"]), ["a1", "b1"])
        self.assertEqual(sorted(doc["projects"].values()), ["other", "proj"])
        self.assertTrue(any("store" in d["of"] for d in doc["disks"]))

    def test_sys_works_with_whatever_this_machine_has(self):
        doc = self.doc("sys", "--json")  # a GPU or none: both are fine
        self.assertTrue(doc["gpus"] is None or isinstance(doc["gpus"], list))
        self.assertEqual(doc["leases"], [])
        self.assertIn("record: ", self.aw("sys").stdout)

    def test_quiet_for_timing(self):
        other = self.project("other")
        quiet = ["sys", "--quiet-for", "timing", "--gpu-under", "101", "--as", "me"]  # whatever the GPU reads, it passes
        r = self.aw(*quiet)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("quiet for timing: yes", r.stdout)
        self.assertIn("record: ", r.stdout)
        held = self.doc("lease", "gpu", "--for", "training", "--hold", "--as", "b1", "--json", cwd=other)["lease"]["id"]
        r = self.aw(*quiet)
        self.assertEqual(r.returncode, 1)
        self.assertIn("quiet for timing: NO", r.stdout)
        self.assertIn('b1 (other) holds a lease on gpu: "training"', r.stdout)
        doc = self.doc(*quiet, "--json")
        self.assertEqual((doc["quiet"]["ok"], len(doc["quiet"]["reasons"])), (False, 1))
        self.assertEqual(self.aw(*quiet[:-1], "b1", cwd=other).returncode, 0)  # its own lease does not count against it
        self.aw("lease", "--release", held, "--as", "b1", cwd=other)
        self.aw("lock", "acquire", "gpu-exclusive", "--as", "b1", "--for", "bench", "--wait", "0", cwd=other)
        r = self.aw(*quiet)
        self.assertEqual(r.returncode, 1)
        self.assertIn("holds the lock on gpu-exclusive", r.stdout)
        self.aw("lock", "release", "gpu-exclusive", "--as", "b1", cwd=other)
        self.aw("lock", "acquire", "sim", "--as", "b1", "--for", "its own", "--wait", "0", cwd=other)
        self.assertEqual(self.aw(*quiet).returncode, 0)  # another project's own lock is not machine noise ...
        self.assertEqual(self.aw(*quiet, "--strict").returncode, 1)  # ... unless asked to count everything
        r = self.aw("sys", "--quiet-for", "timing", "--gpu-under", "0", **self.no_gpu_tool())
        self.assertEqual(r.returncode, 0, r.stdout)  # no reading: the declarations alone decide, and the answer says so
        self.assertIn("judged by the declarations alone", r.stdout)

    def test_quiet_waits_for_a_lease_to_end(self):
        other = self.project("other")
        busy = self.spawn("lease", "gpu", "--for", "short job", "--as", "b1", "--", sys.executable, "-c", "import time; time.sleep(3)", cwd=other)
        deadline = time.monotonic() + 20
        while not self.doc("leases", "--json")["leases"] and time.monotonic() < deadline:
            time.sleep(0.2)
        self.assertEqual(self.aw("sys", "--quiet-for", "timing", "--gpu-under", "101", "--as", "me").returncode, 1)
        doc = self.doc("sys", "--quiet-for", "timing", "--gpu-under", "101", "--as", "me", "--wait", "30", "--interval", "0.3", "--json")
        self.assertTrue(doc["quiet"]["ok"], doc["quiet"])
        self.assertGreater(doc["quiet"]["waitedSeconds"], 0)
        self.assertEqual(busy.wait(30), 0)
        r = self.aw("sys", "--quiet-for", "timing", "--gpu-under", "101", "--strict", "--wait", "0.5", "--interval", "0.2", "--as", "me")
        self.assertEqual(r.returncode, 0, r.stdout)


if __name__ == "__main__":
    unittest.main()
