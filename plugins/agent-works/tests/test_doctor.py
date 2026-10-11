"""aw doctor: every check together, its own codes, the baseline and the page."""
import json
import unittest

from tests.clihelp import Project

import common
import doctor


class Doctor(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.close()

    def run_json(self, *args, **kw):
        code, out, err = self.p.aw("doctor", "--json", *args, **kw)
        self.assertEqual(err, "")
        return code, json.loads(out)

    def codes(self, doc):
        return sorted({f["code"] for f in doc["findings"]})

    def test_an_empty_repository_without_config_is_clean(self):
        code, doc = self.run_json()
        self.assertEqual((code, doc["summary"], doc["findings"], doc["config"], doc["failed"]),
                         (0, {"critical": 0, "warning": 0, "info": 0}, [], None, {}))
        self.assertEqual(list(doc)[-2:], ["summary", "findings"])
        self.assertIn("no .agents/agent-works.json", self.p.aw("doctor")[1])
        self.assertFalse(self.p.home.exists())  # read-only: nothing is written, here or in the store

    def test_a_legacy_repository_gets_its_report_without_config(self):
        w = self.p.write
        w("AGENTS.md", "# Root\n\n**Status: the MVP works.**\n\n- `src/`\n" + "line\n" * 200)
        w("src/app/a.py", "x")
        w("docs/adr/0001-first.md", "# 1. First\n\n## Status\n\naccepted\n")
        w("docs/CONTEXT.md", "# Glossary\n\n| Term | Meaning |\n|---|---|\n| lap | Once round. |\n")
        w(".agents/board/board.json", "{}")
        w(".agents/memory/project/2026-01-09-project-status.md",
          "---\nname: project-status\ndescription: d\ntype: status\nupdated: 2026-01-09\n---\n\n## Done\n\n" + "- x\n" * 400)
        code, doc = self.run_json()
        self.assertEqual(code, 2)
        self.assertEqual(self.codes(doc), ["DOCS_AGENT_FILE", "HUB_MISSING", "KANBAN_OLD_FOLDER", "KANBAN_UNTRACKED", "MEM_INDEX_STALE",
                                           "ROOT_SIZE", "ROOT_STATUS_PROSE", "STATUS_DONE_SECTION", "STATUS_SIZE"]
                         if "KANBAN_UNTRACKED" in self.codes(doc) else
                         ["DOCS_AGENT_FILE", "HUB_MISSING", "KANBAN_OLD_FOLDER", "MEM_INDEX_STALE", "ROOT_SIZE", "ROOT_STATUS_PROSE",
                          "STATUS_DONE_SECTION", "STATUS_SIZE"])
        by = {f["code"]: f for f in doc["findings"]}
        self.assertEqual((by["STATUS_SIZE"]["level"], by["ROOT_STATUS_PROSE"]["level"], by["ROOT_STATUS_PROSE"]["line"]), ("critical", "info", 3))
        moves = sorted(f["message"] for f in doc["findings"] if f["code"] == "DOCS_AGENT_FILE")
        self.assertIn("`git mv docs/CONTEXT.md .agents/CONTEXT.md`", moves[0])
        self.assertIn("`git mv docs/adr .agents/decisions`", moves[1])
        self.assertEqual((doc["sizes"]["rootAgentsLines"], doc["sizes"]["statusLines"], doc["sizes"]["memoryFiles"]), (205, 409, 1))
        text = self.p.aw("doctor")[1]
        for heading in ("Hubs and the root", "Memory and status", "Tasks and briefs", "User docs", "doctor: 1 critical"):
            self.assertIn(heading, text)

    def test_config_invalid_is_critical(self):
        self.p.write(".agents/agent-works.json", "{ nope")
        code, doc = self.run_json()
        self.assertEqual(code, 2)
        self.assertEqual([(f["code"], f["level"], f["path"]) for f in doc["findings"] if f["code"] == "CONFIG_INVALID"],
                         [("CONFIG_INVALID", "critical", ".agents/agent-works.json")])
        self.p.write(".agents/agent-works.json", json.dumps({
            "version": 2, "budgets": [], "guard": {"ownerFiles": "x", "rules": [{"id": "r", "match": ["([a"]}, {"match": ["x"]}],
                                                   "generated": [{"match": "(("}]},
            "resources": {"gpu": {"scope": "galaxy", "match": ["ok"]}, "bad": 3}}))
        msgs = [f.message for f in doctor.config_findings(common.load_config(self.p.root), self.p.root)]
        self.assertEqual(len(msgs), 8, msgs)
        for part in ("\"version\" is 2", "\"budgets\" must be an object", "\"guard.ownerFiles\" must be a list", "guard.rules[r]",
                     "\"id\" and \"match\"", "guard.generated", "resources.gpu.scope", "\"resources.bad\" must be an object"):
            self.assertTrue(any(part in m for m in msgs), part)
        self.p.write(".agents/agent-works.json", json.dumps({"version": 1, "guard": {"rules": [{"id": "ok", "match": ["a+"]}]}}))
        self.assertEqual(doctor.config_findings(common.load_config(self.p.root), self.p.root), [])

    def test_contract_page(self):
        self.p.write(".agents/agent-works.json", "{}")
        self.assertIn("CONTRACT_MISSING", self.codes(self.run_json()[1]))
        self.p.write(".agents/README.md", "# mine\n")
        stale = [f for f in self.run_json()[1]["findings"] if f["code"] == "CONTRACT_STALE"]
        self.assertIn("no agent-works version stamp", stale[0]["message"])
        self.p.write(".agents/README.md", "<!-- agent-works contract v0.0.1: generated -->\n# x\n")
        stale = [f for f in self.run_json()[1]["findings"] if f["code"] == "CONTRACT_STALE"]
        self.assertIn("generated by agent-works 0.0.1", stale[0]["message"])
        self.p.write(".agents/README.md", f"<!-- agent-works contract v{common.plugin_version()}: generated -->\n# x\n" + "l\n" * 120)
        stale = [f for f in self.run_json()[1]["findings"] if f["code"] == "CONTRACT_STALE"]
        self.assertEqual(len(stale), 1)
        self.assertIn("the budget is 120", stale[0]["message"])
        self.p.write(".agents/README.md", f"<!-- agent-works contract v{common.plugin_version()}: generated -->\n# x\n")
        self.assertEqual(self.codes(self.run_json()[1]), [])

    def test_briefs_twins_and_two_homes(self):
        w = self.p.write
        w(".agents/agent-works.json", json.dumps({"tasks": {"home": "github"}}))
        w(".agents/README.md", f"<!-- agent-works contract v{common.plugin_version()}: generated -->\n")
        w("AGENTS.md", "# Root\n")
        w(".agents/briefs/common.md", "l\n" * 121)
        w(".agents/briefs/rounds/2026-01-05-round.md", "l\n" * 81)
        w(".agents/briefs/rounds/2026-01-06-short.md", "l\n" * 80)
        w(".agents/kanban/board.json", "{}")
        w(".agents/kanban/0001-a.md", "---\nid: \"0001\"\ntitle: A\nstatus: todo\norder: 1\n---\n")
        found = doctor.collect(self.p.root)["findings"]
        got = sorted((f.code, f.path) for f in found if f.code.startswith(("BRIEF_", "GEN_", "TASKS_")))
        self.assertEqual(got, [("BRIEF_SIZE", ".agents/briefs/common.md"), ("BRIEF_SIZE", ".agents/briefs/rounds/2026-01-05-round.md"),
                               ("GEN_TWIN_MISSING", "CLAUDE.md"), ("TASKS_TWO_HOMES", ".agents/kanban")])
        self.assertEqual(doctor.group_of("BRIEF_SIZE"), "Tasks and briefs")
        self.assertEqual(doctor.group_of("GEN_TWIN_MISSING"), "Hubs and the root")
        self.assertEqual(doctor.group_of("SOMETHING_NEW"), "Other")

    def test_a_broken_check_does_not_hide_the_others(self):
        failed = {}
        self.assertEqual(doctor._safe("boom", lambda: 1 / 0, failed), [])
        self.assertIn("ZeroDivisionError", failed["boom"])

    def test_baseline(self):
        self.p.write("AGENTS.md", "# Root\n" + "l\n" * 250)
        code, doc = self.run_json("--baseline")
        path = self.p.home / "projects" / common.project_id(self.p.root) / "baseline.json"
        self.assertTrue(path.is_file())
        self.assertEqual(doc["baselineWritten"], common.posix(path))
        self.assertNotIn("baseline", doc)  # the first run has nothing to compare against
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual((saved["sizes"]["rootAgentsLines"], saved["codes"]), (251, {"ROOT_SIZE": 1}))
        self.p.write("AGENTS.md", "# Root\n" + "l\n" * 150)
        code, doc = self.run_json()
        self.assertEqual(code, 0)
        self.assertEqual(doc["baseline"]["sizes"]["rootAgentsLines"], [251, 151])
        self.assertEqual(doc["baseline"]["codes"], {"ROOT_SIZE": [1, 0]})
        text = self.p.aw("doctor")[1]
        self.assertIn("since the baseline of", text)
        self.assertIn("rootAgentsLines: 251 -> 151", text)
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["sizes"]["rootAgentsLines"], 251)  # only --baseline rewrites it

    def test_html_page(self):
        self.p.write("AGENTS.md", "# Root <b>\n" + "l\n" * 250)
        out = self.p.root / "report.html"
        code, text, _ = self.p.aw("doctor", "--html", str(out))
        self.assertEqual(code, 1)
        self.assertIn("report written", text)
        page = out.read_text(encoding="utf-8")
        self.assertTrue(page.startswith("<!doctype html>"))
        self.assertIn("<code>ROOT_SIZE</code>", page)
        self.assertNotIn("http", page.replace("http-equiv", ""))  # self-contained: nothing is fetched

    def test_text_report_folds_long_lists(self):
        for i in range(12):
            self.p.write(f".agents/memory/loose-{i}.md", "x")
        text = self.p.aw("doctor")[1]
        self.assertIn("… 4 more MEM_ROOT_LOOSE", text)
        self.assertNotIn("more MEM_ROOT_LOOSE", self.p.aw("doctor", "--all")[1])


if __name__ == "__main__":
    unittest.main()
