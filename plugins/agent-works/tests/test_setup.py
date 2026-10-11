"""aw setup: the plan, the apply, an existing repository, the launcher."""
import json
import os
import subprocess
import unittest

from tests.clihelp import CLI, Project

import common
import setup as aw_setup


class Setup(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.close()

    def plan(self, *args):
        code, out, err = self.p.aw("setup", "--plan", "--json", *args)
        self.assertEqual((code, err), (0, ""))
        return json.loads(out)

    def steps(self, doc, do=None):
        return [(s["do"], s["path"]) for s in doc["steps"] if do is None or s["do"] == do]

    def tree(self):
        return sorted(common.rel(p, self.p.root) for p in self.p.root.rglob("*") if p.is_file() and ".git/" not in common.rel(p, self.p.root))

    def test_plan_writes_nothing(self):
        before = self.tree()
        doc = self.plan()
        self.assertTrue(doc["fresh"])
        self.assertEqual(self.steps(doc, "create"), [
            ("create", ".agents/agent-works.json"), ("create", ".agents/README.md"), ("create", "AGENTS.md"),
            ("create", ".agents/memory/INDEX.md"), ("create", ".agents/memory/project/INDEX.md"),
            ("create", f".agents/memory/project/{common.today()}-project-status.md"),
            ("create", ".agents/decisions/README.md"), ("create", ".agents/CONTEXT.md")])
        self.assertEqual(self.steps(doc, "append"), [("append", ".gitignore")])
        self.assertNotIn("text", doc["steps"][0])
        self.assertEqual(self.tree(), before)
        self.assertIn("Nothing was written", self.p.aw("setup", "--plan")[1])
        self.assertEqual(self.p.aw("setup")[0], 2)
        self.assertEqual(self.p.aw("setup", "--plan", "--apply")[0], 2)

    def test_apply_on_a_fresh_repository_then_doctor_is_calm(self):
        self.p.write("src/a.py", "x")
        code, out, err = self.p.aw("setup", "--apply")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(self.tree(), sorted([
            ".agents/CONTEXT.md", ".agents/README.md", ".agents/agent-works.json", ".agents/decisions/README.md",
            ".agents/memory/INDEX.md", ".agents/memory/project/INDEX.md",
            f".agents/memory/project/{common.today()}-project-status.md", ".gitignore", "AGENTS.md", "CLAUDE.md", "src/a.py"]))
        cfg = json.loads(self.p.read(".agents/agent-works.json"))
        self.assertEqual((cfg["version"], cfg["claude"]["twins"]), (1, "generated"))
        self.assertIn(f"agent-works contract v{common.plugin_version()}", self.p.read(".agents/README.md"))
        self.assertIn("CLAUDE.md", self.p.read(".gitignore").splitlines())
        self.assertEqual(self.p.read("CLAUDE.md"), "@AGENTS.md\n")
        for rel in self.tree():
            self.assertNotIn(b"\r", (self.p.root / rel).read_bytes(), rel)
        doc = json.loads(self.p.aw("doctor", "--json")[1])
        self.assertEqual(doc["summary"]["critical"], 0)
        self.assertEqual(sorted({f["code"] for f in doc["findings"]}), ["HUB_UNLISTED_CHILD"])  # the repo map is still to fill in
        # the guard is now on
        d = self.p.hook("guard", {"tool_name": "Bash", "cwd": str(self.p.root), "tool_input": {"command": "git add -A"}})
        self.assertIn('"deny"', d[1])
        # and a second run changes nothing
        snapshot = {rel: (self.p.root / rel).read_bytes() for rel in self.tree()}
        code, out, _ = self.p.aw("setup", "--apply")
        self.assertIn("nothing to do", out)
        self.assertEqual({rel: (self.p.root / rel).read_bytes() for rel in self.tree()}, snapshot)

    def test_the_plugins_section_of_the_root_file(self):
        block = common.plugins_block()
        for name in ("agent-works", "codebase-optimizer", "perceptual-loop"):
            self.assertIn(f"| **{name}** |", block)
        self.p.aw("setup", "--apply")
        self.assertIn(block, self.p.read("AGENTS.md"))  # a new root file carries it
        self.assertNotIn("{{", self.p.read("AGENTS.md"))
        # an existing file: after its first section, and brought up to date in place
        mine = "# Mine\n\n## What this is\n\nA thing.\n\n## Rules\n\n1. One.\n"
        self.p.write("AGENTS.md", mine)
        self.assertIn("ROOT_PLUGINS", {f["code"] for f in json.loads(self.p.aw("doctor", "--json")[1])["findings"]})
        self.p.aw("setup", "--apply")
        self.assertEqual(self.p.read("AGENTS.md"), "# Mine\n\n## What this is\n\nA thing.\n\n" + block + "\n## Rules\n\n1. One.\n")
        self.assertNotIn("ROOT_PLUGINS", {f["code"] for f in json.loads(self.p.aw("doctor", "--json")[1])["findings"]})
        self.p.write("AGENTS.md", self.p.read("AGENTS.md").replace("Work judged by eye or ear", "Old words"))
        self.assertIn("ROOT_PLUGINS", {f["code"] for f in json.loads(self.p.aw("doctor", "--json")[1])["findings"]})
        # the config's list decides the rows
        self.p.write(".agents/agent-works.json", json.dumps({"version": 1, "plugins": ["agent-works"]}))
        self.p.aw("setup", "--apply")
        text = self.p.read("AGENTS.md")
        self.assertIn("| **agent-works** |", text)
        self.assertNotIn("perceptual-loop", text)
        self.assertTrue(text.endswith("## Rules\n\n1. One.\n"))
        self.p.write(".agents/agent-works.json", json.dumps({"version": 1, "plugins": []}))
        self.p.aw("setup", "--apply")
        self.assertEqual(self.p.read("AGENTS.md"), "# Mine\n\n## What this is\n\nA thing.\n\n\n## Rules\n\n1. One.\n")
        self.assertNotIn("ROOT_PLUGINS", {f["code"] for f in json.loads(self.p.aw("doctor", "--json")[1])["findings"]})

    def test_an_existing_repository_keeps_its_prose_and_gets_reports(self):
        w = self.p.write
        w("AGENTS.md", "# Mine\n" + "l\n" * 300)
        w("CLAUDE.md", "My own Claude notes.\n")
        w(".gitignore", "node_modules/")  # no final newline
        w(".agents/memory/INDEX.md", "# Memory index\n\nOurs.\n")
        w(".agents/memory/tooling/2026-01-05-a-trap.md", "---\nname: a-trap\ndescription: d\ntype: learning\nupdated: 2026-01-05\n---\n")
        w(".agents/board/board.json", "{}")
        w("docs/adr/0001-first.md", "# 1. First\n")
        w("docs/CONTEXT.md", "# Glossary\n")
        w(".plan/plan/x.md", "x")
        w(".perceptual-loop/config.json", "{}")
        doc = self.plan()
        self.assertFalse(doc["fresh"])
        self.assertEqual(self.steps(doc, "keep"), [("keep", "AGENTS.md"), ("keep", ".agents/memory")])
        self.assertIn("300", [s for s in doc["steps"] if s["path"] == "AGENTS.md"][0]["why"].replace("301", "300"))
        reports = {s["path"]: s for s in doc["steps"] if s["do"] == "report"}
        self.assertEqual(sorted(reports), [".agents/board", ".perceptual-loop", ".plan", "CLAUDE.md", "docs/CONTEXT.md", "docs/adr"])
        self.assertEqual(reports["docs/adr"]["commands"][0], "git mv docs/adr .agents/decisions")
        self.assertEqual(reports["docs/CONTEXT.md"]["commands"][0], "git mv docs/CONTEXT.md .agents/CONTEXT.md")
        self.assertEqual(reports[".agents/board"]["commands"], ["git mv .agents/board .agents/kanban"])
        self.assertIn("DOCS_AGENT_FILE", reports["docs/adr"]["why"])
        code, out, _ = self.p.aw("setup", "--apply")
        self.assertEqual(code, 0)
        self.assertTrue(self.p.read("AGENTS.md").startswith("# Mine\n"))
        self.assertIn(("section", "AGENTS.md"), self.steps(doc))
        self.assertTrue(self.p.read("AGENTS.md").endswith(common.plugins_block()))  # put in, the prose untouched
        self.assertEqual(self.p.read("AGENTS.md").count("l\n"), 300)
        self.assertEqual(self.p.read("CLAUDE.md"), "My own Claude notes.\n")  # never overwritten
        self.assertIn("content of its own", out)
        self.assertEqual(self.p.read(".gitignore").splitlines()[0], "node_modules/")
        self.assertIn("CLAUDE.md", self.p.read(".gitignore").splitlines())
        self.assertTrue((self.p.root / "docs/adr/0001-first.md").is_file())       # nothing is moved out of docs
        self.assertFalse((self.p.root / ".agents/decisions").exists())
        self.assertFalse((self.p.root / ".agents/CONTEXT.md").exists())
        self.assertTrue((self.p.root / ".agents/board/board.json").is_file())
        self.assertIn("Ours.", self.p.read(".agents/memory/INDEX.md"))
        self.assertEqual(self.p.read(".agents/memory/INDEX.md"), "# Memory index\n\nOurs.\n")  # an index that was there stays
        self.assertFalse((self.p.root / ".agents/memory/tooling/INDEX.md").exists())  # and none is written unasked
        self.assertNotIn("wrote .agents/memory", out)
        self.assertIn("MEM_INDEX_STALE", self.p.aw("memory", "lint")[1])
        self.assertFalse((self.p.root / ".agents/memory/project").exists())  # an existing tree is not given a second status

    def test_options(self):
        self.p.write(".agents/board/board.json", "{}")
        self.p.write(".agents/board/0001-a.md", "card")
        doc = self.plan("--twins", "off", "--kanban", "ignored", "--move-board")
        self.assertEqual(self.steps(doc, "move"), [("move", ".agents/board")])
        self.assertEqual(self.steps(doc, "twins"), [])
        self.assertEqual(self.steps(doc, "append"), [("append", ".gitignore")])
        self.p.aw("setup", "--apply", "--twins", "off", "--kanban", "ignored", "--move-board")
        self.assertTrue((self.p.root / ".agents/kanban/0001-a.md").is_file())
        self.assertFalse((self.p.root / ".agents/board").exists())
        self.assertEqual(json.loads(self.p.read(".agents/agent-works.json"))["claude"]["twins"], "off")
        self.assertFalse((self.p.root / "CLAUDE.md").exists())
        lines = self.p.read(".gitignore").splitlines()
        self.assertIn(".agents/kanban/", lines)
        self.assertNotIn("CLAUDE.md", lines)

    def test_the_contract_page_is_regenerated_only_when_it_is_ours(self):
        self.p.aw("setup", "--apply")
        self.p.write(".agents/README.md", "<!-- agent-works contract v0.0.1: generated -->\nold\n")
        self.assertIn(("regenerate", ".agents/README.md"), self.steps(self.plan()))
        self.p.aw("setup", "--apply")
        self.assertIn(f"contract v{common.plugin_version()}", self.p.read(".agents/README.md"))
        self.p.write(".agents/README.md", "# Hand-written\n")
        self.assertIn(("report", ".agents/README.md"), self.steps(self.plan()))
        self.p.aw("setup", "--apply")
        self.assertEqual(self.p.read(".agents/README.md"), "# Hand-written\n")

    def test_every_template_is_a_file_and_only_a_file(self):
        self.assertFalse(hasattr(aw_setup, "FALLBACKS"))  # one copy of each template: assets/templates
        with self.assertRaises(common.AwError):
            common.template("no-such-template.md")
        for name in ("config.json", "agents-readme.md", "agents-root.md", "memory-index.md", "status.md", "glossary.md"):
            self.assertTrue(aw_setup.template(name, version="1", project="p", twins="generated", slug="s", date="d", title="t", description="x"), name)
        self.assertEqual(json.loads(aw_setup.template("config.json", twins="committed"))["claude"]["twins"], "committed")

    def test_the_launcher_finds_the_cli(self):
        target = self.p.tmp / "bin"
        code, out, err = self.p.aw("setup", "--install-launcher", str(target))
        self.assertEqual((code, err), (0, ""))
        self.assertTrue((target / "aw").is_file() and (target / "aw.cmd").is_file())
        self.assertNotIn(b"\r", (target / "aw").read_bytes())
        self.assertEqual(self.tree(), [])  # installing a launcher sets nothing up
        launcher = [str(target / "aw.cmd")] if os.name == "nt" else ["sh", str(target / "aw")]
        r = subprocess.run([*launcher, "hubs", "--json"], cwd=str(self.p.root), capture_output=True, text=True, encoding="utf-8",
                           env=self.p.env(AGENT_WORKS_CLI=str(CLI / "aw.py")), timeout=60)
        self.assertEqual((r.returncode, json.loads(r.stdout)["findings"]), (0, []), r.stderr)


if __name__ == "__main__":
    unittest.main()
