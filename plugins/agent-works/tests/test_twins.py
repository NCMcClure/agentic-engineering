"""aw twins and the session hook: a CLAUDE.md that imports its sibling beside every AGENTS.md."""
import json
import unittest

from tests.clihelp import Project

import twins


class Twins(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={})
        self.p.write("AGENTS.md", "# Root\n")
        self.p.write("apps/AGENTS.md", "# apps\n")
        self.p.write("apps/web/AGENTS.md", "# web\n")
        self.p.write("node_modules/pkg/AGENTS.md", "# not ours\n")

    def tearDown(self):
        self.p.close()

    def test_no_config_does_nothing(self):
        bare = Project()
        try:
            bare.write("AGENTS.md", "# Root\n")
            code, out, _ = bare.aw("twins")
            self.assertEqual(code, 0)
            self.assertEqual(len(out.strip().splitlines()), 1)
            self.assertFalse((bare.root / "CLAUDE.md").exists())
        finally:
            bare.close()

    def test_writes_heals_and_is_idempotent(self):
        code, out, _ = self.p.aw("twins")
        self.assertEqual(code, 0, out)
        for rel in ("CLAUDE.md", "apps/CLAUDE.md", "apps/web/CLAUDE.md"):
            self.assertEqual((self.p.root / rel).read_bytes(), b"@AGENTS.md\n")
        self.assertFalse((self.p.root / "node_modules/pkg/CLAUDE.md").exists())
        (self.p.root / "apps/CLAUDE.md").unlink()
        res = twins.heal(self.p.root)
        self.assertEqual((res["written"], res["root_created"]), (["apps/CLAUDE.md"], False))
        self.assertEqual(twins.heal(self.p.root)["written"], [])

    def test_check_writes_nothing(self):
        code, out, _ = self.p.aw("twins", "--check", "--json")
        doc = json.loads(out)
        self.assertEqual(code, 1)
        self.assertEqual([(f["code"], f["path"]) for f in doc["findings"]],
                         [("GEN_TWIN_MISSING", "CLAUDE.md"), ("GEN_TWIN_MISSING", "apps/CLAUDE.md"), ("GEN_TWIN_MISSING", "apps/web/CLAUDE.md")])
        self.assertFalse((self.p.root / "CLAUDE.md").exists())
        self.p.aw("twins")
        self.assertEqual(self.p.aw("twins", "--check")[0], 0)

    def test_content_of_its_own_is_never_overwritten(self):
        self.p.write("apps/CLAUDE.md", "My own notes.\n")
        code, out, _ = self.p.aw("twins")
        self.assertEqual(code, 1)
        self.assertIn("content of its own", out)
        self.assertEqual(self.p.read("apps/CLAUDE.md"), "My own notes.\n")

    def test_orphans(self):
        self.p.write("gone/CLAUDE.md", "@AGENTS.md\n")
        self.p.write("mine/CLAUDE.md", "Hand-written, no AGENTS.md beside it.\n")
        found = [(f.code, f.path) for f in twins.findings(self.p.root)]
        self.assertIn(("GEN_TWIN_ORPHAN", "gone/CLAUDE.md"), found)
        self.assertNotIn("mine/CLAUDE.md", [p for _, p in found])
        res = twins.heal(self.p.root)
        self.assertEqual(res["removed"], ["gone/CLAUDE.md"])
        self.assertTrue((self.p.root / "mine/CLAUDE.md").exists())

    def test_modes(self):
        self.p.write(".agents/agent-works.json", json.dumps({"claude": {"twins": "off"}}))
        code, out, _ = self.p.aw("twins")
        self.assertEqual(code, 0)
        self.assertFalse((self.p.root / "CLAUDE.md").exists())
        self.p.write(".agents/agent-works.json", json.dumps({"claude": {"twins": "committed"}}))
        self.p.write("gone/CLAUDE.md", "@AGENTS.md\n")
        self.assertEqual(self.p.aw("twins")[0], 1)  # committed: an orphan is reported, not deleted
        self.assertTrue((self.p.root / "CLAUDE.md").exists())
        self.assertTrue((self.p.root / "gone/CLAUDE.md").exists())


class SessionHook(unittest.TestCase):
    def test_heals_and_says_to_read_the_root_file_once(self):
        p = Project(config={})
        try:
            p.write("AGENTS.md", "# Root\n")
            p.write("apps/AGENTS.md", "# apps\n")
            payload = {"hook_event_name": "SessionStart", "cwd": str(p.root / "apps"), "session_id": "s1"}
            code, out, err = p.hook("session", payload)
            self.assertEqual((code, err), (0, ""))
            self.assertIn("Read AGENTS.md", out)
            self.assertEqual(p.read("apps/CLAUDE.md"), "@AGENTS.md\n")
            (p.root / "apps/CLAUDE.md").unlink()
            code, out, _ = p.hook("session", payload)
            self.assertEqual((code, out), (0, ""))  # the root twin was there: nothing to say
            self.assertTrue((p.root / "apps/CLAUDE.md").exists())
            if (p.home / "agents.jsonl").exists():  # the coordination modules are there: the session is registered
                rows = [json.loads(x) for x in (p.home / "agents.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
                self.assertTrue(any(r.get("session") == "s1" for r in rows))
        finally:
            p.close()

    def test_inert_without_config_committed_mode_and_bad_input(self):
        bare = Project()
        try:
            bare.write("AGENTS.md", "# Root\n")
            self.assertEqual(bare.hook("session", {"cwd": str(bare.root)}), (0, "", ""))
            self.assertFalse((bare.root / "CLAUDE.md").exists())
            self.assertFalse(bare.home.exists())
            bare.write(".agents/agent-works.json", json.dumps({"claude": {"twins": "committed"}}))
            self.assertEqual(bare.hook("session", {"cwd": str(bare.root)})[:2], (0, ""))
            self.assertFalse((bare.root / "CLAUDE.md").exists())
            bare.write(".agents/agent-works.json", "{ broken")
            self.assertEqual(bare.hook("session", ["not", "an", "object"])[0], 0)
        finally:
            bare.close()


if __name__ == "__main__":
    unittest.main()
