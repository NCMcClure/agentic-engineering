"""`aw note`/`aw notes` and `aw claim`/`aw claims`."""
import json
import os
import sys
import time
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_coord_support import CoordCase  # noqa: E402

from coord import store  # noqa: E402


class NotesCase(CoordCase):
    def test_a_note_is_one_line_on_the_projects_log(self):
        r = self.aw("note", "merged #12:  pull before\n rendering", "--as", "a")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ  a  merged #12: pull before rendering\n$")
        self.assertEqual(self.aw("note", "second", "--as", "b").returncode, 0)
        notes = self.doc("notes", "5", "--json")["notes"]
        self.assertEqual([(n["agent"], n["text"]) for n in notes], [("a", "merged #12: pull before rendering"), ("b", "second")])
        self.assertEqual(len(self.doc("notes", "1", "--json")["notes"]), 1)
        self.assertEqual(self.aw("notes", "1").stdout.strip().split("  ")[1:], ["b", "second"])
        self.assertEqual(self.aw("notes", cwd=self.project("other")).stdout.strip(), "(no notes)")

    def test_a_long_note_is_refused_with_a_hint(self):
        r = self.aw("note", "x" * 201)
        self.assertEqual(r.returncode, 2)
        self.assertIn("at most 200", r.stderr)
        self.assertIn("kanban card", r.stderr)
        self.assertEqual(self.aw("note", "x" * 200).returncode, 0)
        self.assertEqual(self.aw("note", "   ").returncode, 2)
        self.write_config(self.proj, {"budgets": {"noteChars": 20}})
        self.assertEqual(self.aw("note", "x" * 21).returncode, 2)
        self.assertEqual(len(self.doc("notes", "--json")["notes"]), 1)

    def test_notes_across_projects_and_the_machine(self):
        other = self.project("other")
        self.aw("note", "from proj", "--as", "a1")
        time.sleep(1.1)  # stamps have second precision, and --all sorts by them
        self.aw("note", "gpu driver updated: reboot pending", "--machine", "--as", "b1", cwd=other)
        time.sleep(1.1)
        self.aw("note", "from other", "--as", "b1", cwd=other)
        self.assertEqual([n["text"] for n in self.doc("notes", "--json")["notes"]], ["from proj"])
        self.assertEqual([n["text"] for n in self.doc("notes", "--project", "other", "--json")["notes"]], ["from other"])
        self.assertEqual([n["text"] for n in self.doc("notes", "--project", "oth", "--json")["notes"]], ["from other"])
        machine = self.doc("notes", "--machine", "--json", cwd=self.proj)["notes"]
        self.assertEqual([(n["agent"], n["text"]) for n in machine], [("b1@other", "gpu driver updated: reboot pending")])
        everything = self.doc("notes", "--all", "--json")["notes"]
        self.assertEqual([(n["where"], n["text"]) for n in everything],
                         [("proj", "from proj"), ("machine", "gpu driver updated: reboot pending"), ("other", "from other")])
        self.assertIn("[machine]  b1@other  gpu driver", self.aw("notes", "--all").stdout)
        self.assertEqual(len(self.doc("notes", "2", "--all", "--json")["notes"]), 2)
        self.assertEqual(self.aw("notes", "--project", "nope").returncode, 2)
        self.assertEqual(self.aw("notes", "--all", "--machine").returncode, 2)

    def test_the_log_rotates(self):
        self.write_config(self.proj, {"coordination": {"logBytes": 400}})
        for i in range(12):
            self.assertEqual(self.aw("note", f"note {i:02d} " + "z" * 60, "--as", "a").returncode, 0)
        folder = next((self.home / "projects").iterdir())
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["notes.log", "notes.log.1"])
        texts = [n["text"].split()[1] for n in self.doc("notes", "50", "--json")["notes"]]
        self.assertEqual(texts[-1], "11")
        self.assertEqual(texts, sorted(texts))
        self.assertLess(len(texts), 12)


class ClaimsCase(CoordCase):
    CONFIG = {"counters": {"schema": {"note": "the migration number"}}}

    def claim(self, *args, **kw):
        return self.aw("claim", *args, **kw)

    def value(self, *args, **kw):
        return self.doc("claim", *args, "--json", **kw)["value"]

    def test_values_are_handed_out_once(self):
        r = self.claim("schema", "--as", "a")
        self.assertEqual(r.returncode, 2)  # nothing known about the counter yet
        self.assertIn("--after N", r.stderr)
        self.assertEqual(self.value("schema", "--after", "28", "--for", "branch one", "--as", "a"), 29)
        self.assertEqual(self.value("schema", "--as", "b"), 30)
        doc = self.doc("claim", "schema", "--as", "a", "--json")
        self.assertEqual((doc["value"], doc["renewed"]), (29, True))  # asking again: the same number
        r = self.claim("schema", "--value", "30", "--as", "a")
        self.assertEqual(r.returncode, 1)
        self.assertIn("schema 30 is claimed by b", r.stderr)
        r = self.claim("schema", "--value", "12", "--as", "c")
        self.assertEqual(r.returncode, 1)
        self.assertIn("landed already", r.stderr)
        self.assertEqual(self.value("schema", "--value", "40", "--as", "c"), 40)
        self.assertEqual(self.value("schema", "--as", "d"), 41)
        text = self.aw("claims").stdout
        self.assertIn("schema: landed up to 28  (the migration number)", text)
        self.assertRegex(text, r'29  a  until \S+: "branch one"')
        counters = self.doc("claims", "--json")["counters"]
        self.assertEqual([c["value"] for c in counters["schema"]["claims"]], [29, 30, 40, 41])

    def test_release_frees_a_value_unless_it_landed(self):
        self.assertEqual(self.value("schema", "--after", "5", "--as", "a"), 6)
        self.assertEqual(self.value("schema", "--as", "b"), 7)
        self.assertEqual(self.claim("schema", "--release", "--as", "c").returncode, 1)  # holds none
        r = self.claim("schema", "--release", "--landed", "--as", "b")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("released 7 (landed)", r.stdout)
        self.assertEqual(self.claim("schema", "--release", "--as", "a").returncode, 0)  # the work was dropped: 6 is free
        self.assertEqual(self.doc("claims", "--json")["counters"]["schema"], {"floor": 7, "claims": []})
        self.assertEqual(self.value("schema", "--as", "c"), 8)  # above what landed; the gap at 6 stays a gap

    def test_a_claim_ends_after_its_time(self):
        self.assertEqual(self.value("schema", "--after", "1", "--hours", "0", "--as", "a"), 2)
        time.sleep(2.1)
        self.assertEqual(self.doc("claims", "--json")["counters"]["schema"]["claims"], [])
        self.assertEqual(self.value("schema", "--as", "b"), 2)  # free again
        doc = self.doc("claim", "schema", "--as", "c", "--json")
        self.assertAlmostEqual(store.parse_iso(doc["until"]) - time.time(), 72 * 3600, delta=120)

    def test_counters_are_per_project_and_undeclared_ones_warn(self):
        other = self.project("other")
        self.assertEqual(self.value("schema", "--after", "10", "--as", "a"), 11)
        r = self.claim("schema", "--after", "3", "--as", "a", cwd=other)
        self.assertEqual(r.returncode, 0)
        self.assertIn("schema: 4 is a's", r.stdout)
        self.assertIn("not declared", r.stderr)  # other has no config
        self.assertNotIn("not declared", self.claim("schema", "--as", "a").stderr)
        self.assertEqual(self.aw("claims", cwd=self.project("third")).stdout.strip(), "(no counters)")
        everything = self.doc("claims", "--all", "--json")["projects"]
        self.assertEqual(sorted(c["schema"]["claims"][0]["value"] for c in everything.values() if c), [4, 11])
        self.assertEqual(self.claim("bad/name", "--after", "1").returncode, 2)

    def test_concurrent_claims_get_distinct_values(self):
        self.assertEqual(self.value("schema", "--after", "100", "--as", "seed"), 101)
        ps = [self.spawn("claim", "schema", "--as", f"a{i}", "--json") for i in range(8)]
        values = sorted(json.loads(p.communicate(timeout=60)[0])["value"] for p in ps)
        self.assertEqual(values, list(range(102, 110)))


if __name__ == "__main__":
    unittest.main()
