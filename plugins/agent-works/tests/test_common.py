"""cli/common.py: roots, config, ids, files, findings, frontmatter."""
import json
import os
import unittest
from pathlib import Path

from tests.clihelp import Project

import common


class Roots(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.close()

    def test_repo_root_and_config(self):
        sub = self.p.root / "a" / "b"
        sub.mkdir(parents=True)
        self.assertEqual(common.repo_root(sub), self.p.root)
        self.assertIsNone(common.repo_root(self.p.tmp))
        self.assertIsNone(common.find_config(sub))
        self.assertEqual(common.load_config(sub)["budgets"]["hubLines"], 40)
        self.assertNotIn("_path", common.load_config(sub))
        cfg_file = self.p.write(".agents/agent-works.json", json.dumps({"budgets": {"hubLines": 25}, "guard": {"ownerFiles": ["x"]}}))
        self.assertEqual(common.find_config(sub), cfg_file)
        cfg = common.load_config(sub)
        self.assertEqual((cfg["budgets"]["hubLines"], cfg["budgets"]["statusLines"], cfg["guard"]["ownerFiles"]), (25, 120, ["x"]))
        self.assertEqual(cfg["guard"]["staging"]["blanket"], "deny")
        self.assertEqual(Path(cfg["_root"]), self.p.root)
        self.assertEqual(common.project_root(sub), self.p.root)
        self.assertEqual(common.defaults()["guard"]["ownerFiles"], [])  # the defaults were not touched

    def test_invalid_config_never_raises(self):
        self.p.write(".agents/agent-works.json", "{ nope")
        cfg = common.load_config(self.p.root)
        self.assertIn("not valid JSON", cfg["_error"])
        self.assertEqual(cfg["paths"]["memory"], ".agents/memory")
        self.p.write(".agents/agent-works.json", "[1]")
        self.assertIn("JSON object", common.load_config(self.p.root)["_error"])

    def test_a_worktree_resolves_to_the_main_tree(self):
        wt = self.p.tmp / "wt"
        gitdir = self.p.root / ".git" / "worktrees" / "wt"
        gitdir.mkdir(parents=True)
        (gitdir / "commondir").write_text("../..\n", encoding="utf-8")
        (gitdir / "HEAD").write_text("ref: refs/heads/topic\n", encoding="utf-8")
        wt.mkdir()
        (wt / ".git").write_text(f"gitdir: {gitdir}\n", encoding="utf-8")
        (wt / "src").mkdir()
        self.assertEqual(common.repo_root(wt / "src"), wt)
        self.assertEqual(common.main_root(wt / "src"), self.p.root)
        self.assertEqual(common.main_root(self.p.root), self.p.root)
        self.assertEqual(common.project_id(wt), common.project_id(self.p.root))
        self.assertRegex(common.project_id(wt), r"^acme-[0-9a-f]{8}$")
        self.assertEqual(common.current_branch(wt), "topic")
        self.assertEqual(common.current_branch(self.p.root), "feat/x")
        (self.p.root / ".git" / "HEAD").write_text("0123456789abcdef\n", encoding="utf-8")
        self.assertIsNone(common.current_branch(self.p.root))

    def test_kanban_folder_honours_the_old_one(self):
        cfg = common.load_config(self.p.root)
        self.assertEqual(common.kanban_dir(cfg, self.p.root), self.p.root / ".agents" / "kanban")
        self.p.write(".agents/board/board.json", "{}")
        self.assertEqual(common.kanban_dir(cfg, self.p.root), self.p.root / ".agents" / "board")
        (self.p.root / ".agents" / "kanban").mkdir()
        self.assertEqual(common.kanban_dir(cfg, self.p.root), self.p.root / ".agents" / "kanban")


class Environment(unittest.TestCase):
    NAMES = ("AGENT_WORKS_HOME", "AW_AGENT", "PL_AGENT", "CLAUDE_AGENT_NAME", "ACME_AGENT")

    def setUp(self):
        self.saved = {k: os.environ.pop(k, None) for k in self.NAMES}

    def tearDown(self):
        for k, v in self.saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v

    def test_aw_home(self):
        self.assertEqual(common.aw_home(), Path.home() / ".agent-works")
        os.environ["AGENT_WORKS_HOME"] = os.path.join("some", "where")
        self.assertEqual(common.aw_home(), Path("some") / "where")

    def test_agent_name(self):
        cfg = common.defaults()
        self.assertIsNone(common.agent_name(cfg))
        os.environ["CLAUDE_AGENT_NAME"] = "c"
        self.assertEqual(common.agent_name(cfg), "c")
        os.environ["PL_AGENT"] = "p"
        self.assertEqual(common.agent_name(cfg), "p")
        os.environ["AW_AGENT"] = "a"
        self.assertEqual(common.agent_name(cfg), "a")
        cfg["guard"]["agentVar"] = "ACME_AGENT"
        os.environ["ACME_AGENT"] = "x"
        self.assertEqual(common.agent_name(cfg), "x")


class Files(unittest.TestCase):
    def setUp(self):
        self.p = Project(git=False)

    def tearDown(self):
        self.p.close()

    def test_atomic_write_and_exclusive_create(self):
        f = self.p.root / "deep" / "x.json"
        common.atomic_write(f, "one\ntwo\n")
        self.assertEqual(f.read_bytes(), b"one\ntwo\n")  # LF on every platform
        common.atomic_write(f, "three\n")
        self.assertEqual(common.read_text(f), "three\n")
        self.assertEqual([p.name for p in f.parent.iterdir()], ["x.json"])  # no temp file left
        lock = self.p.root / "locks" / "a.lock"
        self.assertTrue(common.exclusive_create(lock, "me"))
        self.assertFalse(common.exclusive_create(lock, "you"))
        self.assertEqual(common.read_text(lock), "me")

    def test_read_json_default(self):
        self.assertEqual(common.read_json(self.p.root / "none.json", {"d": 1}), {"d": 1})
        self.p.write("bad.json", "{")
        self.assertEqual(common.read_json(self.p.root / "bad.json", []), [])
        self.p.write("bom.json", "\ufeff{\"a\": 1}")
        self.assertEqual(common.read_json(self.p.root / "bom.json"), {"a": 1})

    def test_rel_uses_forward_slashes(self):
        self.assertEqual(common.rel(self.p.root / "a" / "b.md", self.p.root), "a/b.md")
        self.assertRegex(common.now_iso(), r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

    def test_template_fills_and_leaves_what_nobody_filled(self):
        text = common.template("decision.md", number="0007", title="Use X")
        self.assertTrue(text.startswith("# 0007. Use X\n"))
        self.assertIn("{{status}}", text)  # a place nobody filled stays visible
        with self.assertRaises(common.AwError):
            common.template("no-such-template.md")


class Findings(unittest.TestCase):
    def test_exit_codes_and_the_one_json_shape(self):
        F = common.Finding
        fs = [F("B_WARN", "warning", "b.md", 3, "w"), F("A_CRIT", "critical", "a.md", 0, "c"), F("C_INFO", "info", "", 0, "i")]
        self.assertEqual(common.exit_for([]), 0)
        self.assertEqual(common.exit_for(fs[2:]), 0)
        self.assertEqual(common.exit_for(fs[:1]), 1)
        self.assertEqual(common.exit_for(fs), 2)
        doc = common.findings_doc(fs, {"root": "x"})
        self.assertEqual(list(doc), ["root", "summary", "findings"])
        self.assertEqual(doc["summary"], {"critical": 1, "warning": 1, "info": 1})
        self.assertEqual([f["code"] for f in doc["findings"]], ["A_CRIT", "B_WARN", "C_INFO"])
        self.assertEqual(doc["findings"][1], {"code": "B_WARN", "level": "warning", "path": "b.md", "line": 3, "message": "w"})
        self.assertIn("b.md:3", fs[0].text())

    def test_both_import_spellings_are_one_module(self):
        import cli.common as spelled

        self.assertIs(spelled, common)
        self.assertIs(spelled.Finding, common.Finding)


class Frontmatter(unittest.TestCase):
    def test_parse(self):
        text = "---\nname: a-b\ndescription: \"One: two\"\ntags: [machine, tooling]\nlabels:\n  - x\n  - y\nremote:\n  id: 7\nempty:\n---\n\n# T\n"
        f, body = common.parse_frontmatter(text)
        self.assertEqual(f, {"name": "a-b", "description": "One: two", "tags": ["machine", "tooling"], "labels": ["x", "y"],
                             "remote": {"id": "7"}, "empty": ""})
        self.assertEqual(body, "\n# T\n")
        self.assertEqual(common.parse_frontmatter("# no front\n"), (None, "# no front\n"))
        self.assertEqual(common.parse_frontmatter("---\r\na: 1\r\n---\r\nx")[0], {"a": "1"})


class DocumentedSchema(unittest.TestCase):
    """One schema: the block core/references/guard-config.md shows is the code's defaults, key for key."""

    def setUp(self):
        self.doc = (Path(__file__).resolve().parent.parent / "core" / "references" / "guard-config.md").read_text(encoding="utf-8")

    def test_the_documented_defaults_are_the_codes(self):
        block = self.doc.split("```json", 1)[1].split("```", 1)[0]
        self.assertEqual(json.loads(block), common.defaults())

    def test_every_default_key_has_its_row(self):
        table = self.doc.split("## Key by key", 1)[1].split(chr(10) + "## ", 1)[0]
        for block in ("dup", "kanban", "coordination"):
            for key in common.DEFAULTS[block]:
                self.assertIn(f"`{block}.{key}`", table)

    def test_the_modules_read_the_same_defaults(self):
        import kanban
        from coord import store

        self.assertEqual(store.SETTINGS, common.DEFAULTS["coordination"])
        self.assertEqual((kanban.STALE_START_DAYS, kanban.GATE_OWED_DAYS), (7, 3))
        self.assertEqual(store.setting({"coordination": {"claimHours": 5}}, "claimHours"), 5.0)
        self.assertEqual(store.setting({}, "claimHours"), 72.0)


if __name__ == "__main__":
    unittest.main()
