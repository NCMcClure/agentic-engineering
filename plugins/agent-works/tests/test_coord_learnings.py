"""`aw learn`: learnings shared by every project of the machine."""
import os
import sys
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_coord_support import CoordCase  # noqa: E402

from coord import learnings  # noqa: E402

FAKE_KEY = "AKIA" + "ABCDEFGHIJKLMNOP"  # shaped like a credential, and nothing more


class LearnCase(CoordCase):
    def add(self, topic, tags, text, **kw):
        r = self.aw("learn", "add", "--topic", topic, "--tags", tags, "--text", text, **kw)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.split(":")[0]

    def test_add_show_and_read_from_another_project(self):
        ident = self.add("Linker runs out of memory above eight jobs", "Linker, windows,build",
                         "Measured on a 64 GB machine: twelve link jobs at once exhaust memory.\nCap the job count at eight.")
        self.assertEqual(ident, "0001")
        files = [p.name for p in (self.home / "learnings").iterdir()]
        self.assertEqual(files, ["0001-linker-runs-out-of-memory-above-eight-jobs.md"])
        other = self.project("other")
        r = self.aw("learn", "show", "1", cwd=other)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("topic: Linker runs out of memory above eight jobs", r.stdout)
        self.assertIn("tags: [linker, windows, build]", r.stdout)
        self.assertIn("source: proj", r.stdout)  # where it came from
        self.assertIn("Cap the job count at eight.", r.stdout)
        doc = self.doc("learn", "show", "L0001", "--json", cwd=other)
        self.assertEqual((doc["id"], doc["tags"], doc["source"]), ("0001", ["linker", "windows", "build"], "proj"))
        self.assertEqual(doc["created"], doc["updated"])
        self.assertEqual(self.aw("learn", "show", "9").returncode, 2)

    def test_search_ranks_topic_above_tags_above_body(self):
        body = self.add("Shell mangles paths with spaces", "shell", "Quote every path; the worktree tool does not.")
        tag = self.add("Parallel checkouts need their own build folders", "worktree, git", "Build outputs are not shared.")
        topic = self.add("A worktree has no installed dependencies", "git", "Install them after creating one.")
        rows = self.doc("learn", "search", "worktree", "--json")["results"]
        self.assertEqual([r["id"] for r in rows], [topic, tag, body])
        self.assertEqual([r["id"] for r in self.doc("learn", "search", "WORKTREE", "dependencies", "--json")["results"]][0], topic)
        self.assertEqual([r["id"] for r in self.doc("learn", "search", "worktree", "--tag", "git", "--json")["results"]], [topic, tag])
        self.assertEqual([r["id"] for r in self.doc("learn", "search", "worktree", "--limit", "1", "--json")["results"]], [topic])
        self.assertEqual([r["id"] for r in self.doc("learn", "search", "--tag", "shell", "--json")["results"]], [body])
        two = self.doc("learn", "search", "paths", "spaces", "quote", "nothing-matches-this", "--json")["results"]
        self.assertEqual([r["id"] for r in two], [body])  # most of the terms is enough
        r = self.aw("learn", "search", "zebra")
        self.assertEqual((r.returncode, r.stdout.strip()), (1, "(nothing found)"))
        text = self.aw("learn", "search", "worktree").stdout
        self.assertIn(f"{topic}  A worktree has no installed dependencies [git]  (proj, ", text)
        self.assertIn("aw learn show <id>", text)

    def test_list_edit_and_retire(self):
        a = self.add("First fact", "os", "Body one.")
        b = self.add("Second fact", "tool, os", "Body two.")
        self.assertEqual([r["id"] for r in self.doc("learn", "list", "--json")["learnings"]], [a, b])
        self.assertEqual([r["id"] for r in self.doc("learn", "list", "--tag", "tool", "--json")["learnings"]], [b])
        r = self.aw("learn", "edit", a, "--topic", "First fact, corrected", "--tags", "os,kernel", "--text", "Body one, corrected.")
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = self.doc("learn", "show", a, "--json")
        self.assertEqual((doc["topic"], doc["tags"], doc["body"]), ("First fact, corrected", ["os", "kernel"], "Body one, corrected."))
        self.assertEqual(self.aw("learn", "edit", a).returncode, 2)  # nothing to change
        self.assertEqual(self.aw("learn", "edit", a, "--text", f"key {FAKE_KEY}").returncode, 2)
        r = self.aw("learn", "retire", b, "--reason", "fixed upstream in the next release")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([r["id"] for r in self.doc("learn", "list", "--json")["learnings"]], [a])
        self.assertEqual(self.aw("learn", "search", "second").returncode, 1)
        self.assertEqual([r["id"] for r in self.doc("learn", "search", "second", "--all", "--json")["results"]], [b])
        shown = self.aw("learn", "show", b).stdout
        self.assertRegex(shown, r"retired: \d{4}-\d\d-\d\d")
        self.assertIn("reason: fixed upstream in the next release", shown)
        self.assertIn("RETIRED", self.aw("learn", "list", "--all").stdout)
        self.assertEqual(self.aw("learn", "list", cwd=self.project("other")).stdout.count("\n"), 1)

    def test_what_looks_like_a_credential_is_refused(self):
        for text in (f"The key is {FAKE_KEY} in the settings.", "password: hunter2-hunter2", "-----BEGIN RSA PRIVATE KEY-----\nabc",
                     "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'", "clone https://someone:s3cretpass@host.example/repo.git",
                     "token ghp_" + "a" * 36):
            r = self.aw("learn", "add", "--topic", "A thing", "--tags", "x", "--text", text)
            self.assertEqual(r.returncode, 2, text)
            self.assertIn("refused", r.stderr)
            self.assertNotIn(text.split()[-1], r.stderr)  # the refusal does not repeat the value
        self.assertEqual(self.aw("learn", "add", "--topic", f"About {FAKE_KEY}", "--text", "fine body").returncode, 2)
        self.assertFalse((self.home / "learnings").exists() and list((self.home / "learnings").glob("*.md")))
        self.assertEqual(learnings.secrets_in("Set the password in the environment, never in the file.\nUse a token."), [])
        self.assertEqual(learnings.secrets_in("line one\napi_key = 'abcdef123456'"), ["a password or secret written out (line 2)"])

    def test_size_cap_and_usage(self):
        r = self.aw("learn", "add", "--topic", "Too long", "--text", "x" * 6001)
        self.assertEqual(r.returncode, 2)
        self.assertIn("at most 6000", r.stderr)
        self.write_config(self.proj, {"coordination": {"learningChars": 50}})
        self.assertEqual(self.aw("learn", "add", "--topic", "Short cap", "--text", "y" * 51).returncode, 2)
        self.assertEqual(self.aw("learn", "add", "--topic", "No body").returncode, 2)
        self.assertEqual(self.aw("learn", "add", "--topic", "t" * 121, "--text", "body").returncode, 2)
        self.assertEqual(self.aw("learn", "add", "--text", "no topic").returncode, 2)
        self.assertEqual(self.aw("learn").returncode, 2)
        self.assertEqual(self.aw("learn", "list").stdout.strip(), "(no learnings)")

    def test_body_from_a_file_or_stdin(self):
        f = self.tmp / "lesson.md"
        f.write_text("From a file.\n\n- with a list\n", encoding="utf-8")
        r = self.aw("learn", "add", "--topic", "From file", "--from-file", f)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.doc("learn", "show", "1", "--json")["body"], "From a file.\n\n- with a list")
        r = self.aw("learn", "add", "--topic", '"Quoted" topic: with a colon', "--from-file", "-", stdin="From stdin.\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = self.doc("learn", "show", "2", "--json")
        self.assertEqual((doc["body"], doc["topic"]), ("From stdin.", "'Quoted' topic: with a colon"))
        self.assertEqual(self.aw("learn", "add", "--topic", "Missing", "--from-file", self.tmp / "nope.md").returncode, 2)

    def test_concurrent_adds_get_distinct_ids(self):
        ps = [self.spawn("learn", "add", "--topic", f"Fact number {i}", "--tags", "race", "--text", f"Body {i}.") for i in range(8)]
        self.assertEqual([p.wait(60) for p in ps], [0] * 8)
        rows = self.doc("learn", "list", "--json")["learnings"]
        self.assertEqual([r["id"] for r in rows], [f"{n:04d}" for n in range(1, 9)])
        self.assertEqual(sorted(r["topic"] for r in rows), [f"Fact number {i}" for i in range(8)])


if __name__ == "__main__":
    unittest.main()
