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

    def test_config_match_entries_with_their_own_unless(self):
        good = {"version": 1,
                "guard": {"rules": [{"id": "r", "match": [{"pattern": "a+", "unless": ["b"]}, "c"], "unless": ["d"]}]},
                "resources": {"ed": {"match": [{"pattern": "render\\.ps1", "unless": ["-List\\b"]}, "Editor"], "unless": ["--version"],
                                     "matchFileCommands": True}},
                "runs": [{"id": "x", "match": [{"pattern": "render", "unless": "--plan"}], "unless": ["--help"]}]}
        self.p.write(".agents/agent-works.json", json.dumps(good))
        self.assertEqual(doctor.config_findings(common.load_config(self.p.root), self.p.root), [])
        bad = {"version": 1,
               "guard": {"rules": [{"id": "r", "match": [{"pattern": "a", "unless": ["([b"]}, {"unless": ["x"]}]}]},
               "resources": {"ed": {"match": [{"pattern": "((", "unless": ["ok"]}, 7], "unless": ["[z"]}},
               "runs": [{"id": "x", "match": [{"pattern": "ok", "unless": ["(?P<"]}], "unless": ["(("]}]}
        self.p.write(".agents/agent-works.json", json.dumps(bad))
        found = doctor.config_findings(common.load_config(self.p.root), self.p.root)
        self.assertEqual({(f.code, f.level) for f in found}, {("CONFIG_INVALID", "critical")})
        msgs = [f.message for f in found]
        self.assertEqual(len(msgs), 7, msgs)
        for part in ("guard.rules[r] (unless): the pattern '([b'", "guard.rules[r]: a match entry is a regular expression or",
                     "resources.ed: the pattern '(('", "resources.ed: 7 is not a regular expression",
                     "resources.ed (unless): the pattern '[z'", "runs[x] (unless): the pattern '(?P<'", "runs[x] (unless): the pattern '(('"):
            self.assertTrue(any(part in m for m in msgs), (part, msgs))

    def test_stray_briefs(self):
        w = self.p.write
        w(".agents/agent-works.json", "{}")
        w(".gitignore", ".scratch/\nruns/\n")
        w(".scratch/round-3/agent-a1.md", "Do the importer.\n")                 # git-ignored: exactly where they hide
        w(".scratch/BRIEF-common.md", "Rules for all.\n")
        w("runs/2026-01-05/handoff.md", "What is left.\n")
        w("notes/Handover-to-next.md", "x\n")
        w("docs/agent-brief.md", "x\n")
        w("a/b/c/briefing.md", "x\n")                                           # three folders deep: still read
        # not strays
        w(".agents/briefs/common.md", "ours\n")
        w(".agents/briefs/rounds/2026-01-05-brief-round.md", "ours\n")
        w(".agents/memory/tooling/2026-01-05-brief-lessons.md", "a memory about briefs\n")
        w(".agents/kanban/0001-write-the-brief.md", "a card\n")
        w("docs/brief.txt", "not Markdown\n")
        w("docs/briefcase/notes.md", "the folder's name is not the file's\n")
        w("AGENTS.md", "# Root\n")
        # not walked: too deep, heavy trees, the tool's own worktrees, a folder of thousands
        w("a/b/c/d/agent-deep.md", "x\n")
        w("node_modules/pkg/agent-brief.md", "x\n")
        w("build/handoff.md", "x\n")
        w(".claude/worktrees/w1/.scratch/agent-a1.md", "x\n")
        w(".claude/agents/agent-reviewer.md", "an agent definition\n")
        w("huge/agent-lost.md", "x\n")
        w("huge/sub/agent-lost.md", "x\n")
        old = doctor.STRAY_ENTRIES
        doctor.STRAY_ENTRIES = 40
        try:
            for i in range(41):
                w(f"huge/data-{i:03d}.bin", "")
            found = doctor.stray_brief_findings(self.p.root, common.load_config(self.p.root))
        finally:
            doctor.STRAY_ENTRIES = old
        self.assertEqual([(f.code, f.level, f.path) for f in found], [(c, "warning", p) for c, p in [
            ("BRIEF_STRAY", ".scratch/BRIEF-common.md"), ("BRIEF_STRAY", ".scratch/round-3/agent-a1.md"),
            ("BRIEF_STRAY", "a/b/c/briefing.md"), ("BRIEF_STRAY", "docs/agent-brief.md"),
            ("BRIEF_STRAY", "notes/Handover-to-next.md"), ("BRIEF_STRAY", "runs/2026-01-05/handoff.md")]])
        self.assertIn(".agents/briefs/common.md", found[0].message)
        self.assertEqual(doctor.group_of("BRIEF_STRAY"), "Tasks and briefs")
        # through the whole doctor, and the names are a setting
        self.assertIn("BRIEF_STRAY", self.codes(self.run_json()[1]))
        w(".agents/agent-works.json", json.dumps({"briefs": {"stray": ["handoff*.md"]}}))
        got = doctor.stray_brief_findings(self.p.root, common.load_config(self.p.root))
        self.assertEqual([f.path for f in got], ["runs/2026-01-05/handoff.md"])
        w(".agents/agent-works.json", json.dumps({"briefs": {"stray": []}, "paths": {"briefs": ".scratch"}}))
        self.assertEqual(doctor.stray_brief_findings(self.p.root, common.load_config(self.p.root)), [])
        w(".agents/agent-works.json", json.dumps({"paths": {"briefs": ".scratch"}}))   # the briefs folder is a setting
        got = [f.path for f in doctor.stray_brief_findings(self.p.root, common.load_config(self.p.root))]
        self.assertNotIn(".scratch/BRIEF-common.md", got)
        self.assertIn(".agents/briefs/rounds/2026-01-05-brief-round.md", got)
        w(".agents/agent-works.json", json.dumps({"briefs": []}))
        self.assertIn("\"briefs\" must be an object", " ".join(f.message for f in doctor.config_findings(common.load_config(self.p.root), self.p.root)))

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


class Accepted(unittest.TestCase):
    """`accept` in the config: a finding the project decided is fine as it is."""

    WHY = "cli.ts is the path every run command names"

    def setUp(self):
        self.p = Project()
        w = self.p.write
        w("AGENTS.md", "# Root\n\n- `apps/`\n")
        w("apps/hub/src/cli.ts", "x")
        w("apps/hub/src/store/a.ts", "x")
        w(".agents/memory/reference/2026-01-05-approved-plan.md",
          "---\nname: approved-plan\ndescription: The plan as approved\ntype: reference\nupdated: 2026-01-05\n---\n\n" + "- step\n" * 420)
        w(".agents/memory/reference/2026-01-06-other.md",
          "---\nname: other\ndescription: Another long one\ntype: reference\nupdated: 2026-01-06\n---\n\n" + "- step\n" * 420)

    def tearDown(self):
        self.p.close()

    def config(self, accept, **more):
        self.p.write(".agents/agent-works.json", json.dumps({"version": 1, "claude": {"twins": "off"}, "accept": accept, **more}))

    def doctor(self, *args):
        code, out, err = self.p.aw("doctor", "--json", *args)
        self.assertEqual(err, "")
        return code, json.loads(out)

    def having(self, doc, code):
        return sorted(f["path"] for f in doc["findings"] if f["code"] == code)

    def test_an_accepted_finding_is_not_a_warning(self):
        self.config([])
        code, before = self.doctor()
        self.assertEqual(self.having(before, "HUB_MIXED_DIR"), ["apps/hub/src"])
        self.assertEqual(len(self.having(before, "MEM_FILE_SIZE")), 2)
        self.assertEqual(before["accepted"], [])
        self.config([{"code": "HUB_MIXED_DIR", "path": "apps/hub/src", "why": self.WHY},
                     {"code": "MEM_FILE_SIZE", "path": ".agents/memory/reference/*-approved-plan.md", "why": "the approved plan, as written"}])
        code, doc = self.doctor()
        self.assertEqual(self.having(doc, "HUB_MIXED_DIR"), [])
        self.assertEqual(self.having(doc, "MEM_FILE_SIZE"), [".agents/memory/reference/2026-01-06-other.md"])  # the glob took one, not both
        self.assertEqual(self.having(doc, "ACCEPT_UNUSED"), [])
        self.assertEqual(doc["summary"]["warning"], before["summary"]["warning"] - 2)
        self.assertEqual([(a["code"], a["path"], a["why"]) for a in doc["accepted"]],
                         [("HUB_MIXED_DIR", "apps/hub/src", self.WHY),
                          ("MEM_FILE_SIZE", ".agents/memory/reference/2026-01-05-approved-plan.md", "the approved plan, as written")])
        self.assertEqual(list(doc)[-2:], ["summary", "findings"])
        self.assertNotIn("HUB_MIXED_DIR", doc["codes"])  # the baseline counts what is still open
        text = self.p.aw("doctor")[1]
        self.assertIn("\n2 accepted (aw doctor --accepted lists them)\n", text)
        self.assertNotIn(self.WHY, text)
        listed = self.p.aw("doctor", "--accepted")[1]
        self.assertIn("Accepted (2)", listed)
        self.assertRegex(listed, r"HUB_MIXED_DIR\s+apps/hub/src — " + self.WHY)
        self.assertNotIn("aw doctor --accepted lists them", listed)

    def test_accepting_everything_that_warns_makes_the_run_clean(self):
        self.config([])
        code, doc = self.doctor()
        self.assertEqual(code, 1)
        self.config([{"code": f["code"], "path": f["path"], "why": "decided"} for f in doc["findings"] if f["level"] == "warning"])
        code, doc = self.doctor()
        self.assertEqual((code, doc["summary"]["warning"], doc["summary"]["critical"]), (0, 0, 0))
        self.assertIn("doctor: 0 critical, 0 warning", self.p.aw("doctor")[1])

    def test_a_critical_finding_and_the_config_check_are_never_accepted(self):
        status = ".agents/memory/project/2026-01-09-project-status.md"
        self.p.write(status, "---\nname: project-status\ndescription: d\ntype: status\nupdated: 2026-01-09\n---\n\n" + "- x\n" * 400)
        self.config([{"code": "STATUS_SIZE", "path": status, "why": "long on purpose"}])
        code, doc = self.doctor()
        self.assertEqual(code, 2)
        self.assertEqual([f["level"] for f in doc["findings"] if f["code"] == "STATUS_SIZE"], ["critical"])
        self.assertEqual(doc["accepted"], [])
        unused = [f for f in doc["findings"] if f["code"] == "ACCEPT_UNUSED"]
        self.assertEqual([(f["level"], f["path"]) for f in unused], [("info", ".agents/agent-works.json")])
        self.assertIn("critical", unused[0]["message"])
        for never in ("CONFIG_INVALID", "ACCEPT_UNUSED"):
            self.config([{"code": never, "path": "*", "why": "no"}])
            code, doc = self.doctor()
            self.assertEqual(code, 2)
            self.assertIn("is never accepted", " ".join(f["message"] for f in doc["findings"] if f["code"] == "CONFIG_INVALID"))

    def test_an_entry_that_matches_nothing_is_reported(self):
        self.config([{"code": "HUB_MIXED_DIR", "path": "apps/hub/src", "why": self.WHY},
                     {"code": "HUB_MIXED_DIR", "path": "apps/gone", "why": "it was mixed once"}])
        code, doc = self.doctor()
        unused = [f for f in doc["findings"] if f["code"] == "ACCEPT_UNUSED"]
        self.assertEqual(len(unused), 1)
        self.assertEqual(unused[0]["level"], "info")
        self.assertIn("HUB_MIXED_DIR", unused[0]["message"])
        self.assertIn("apps/gone", unused[0]["message"])
        self.assertEqual(doctor.group_of("ACCEPT_UNUSED"), "Config")

    def test_the_shape_is_checked(self):
        self.config({"code": "HUB_MIXED_DIR"})
        msgs = [f.message for f in doctor.config_findings(common.load_config(self.p.root), self.p.root)]
        self.assertEqual(len(msgs), 1)
        self.assertIn("\"accept\" must be a list", msgs[0])
        self.config(["HUB_MIXED_DIR",
                     {"code": "HUB_MIXED", "path": "a", "why": "w"},
                     {"code": "HUB_MIXED_DIR", "why": "w"},
                     {"code": "HUB_MIXED_DIR", "path": "a", "why": "  "},
                     {"code": "HUB_MIXED_DIR", "path": "a"},
                     {"code": "HUB_MIXED_DIR", "path": "apps/hub/src", "why": self.WHY}])
        found = doctor.config_findings(common.load_config(self.p.root), self.p.root)
        self.assertEqual([(f.code, f.level) for f in found], [("CONFIG_INVALID", "critical")] * 5)
        msgs = [f.message for f in found]
        for part in ("accept[0]", "accept[1]: \"code\" \"HUB_MIXED\" is not a finding code", "accept[2]: \"path\"",
                     "accept[3]: \"why\"", "accept[4]: \"why\""):
            self.assertTrue(any(part in m for m in msgs), (part, msgs))
        code, doc = self.doctor()  # the entry that is well-formed still holds
        self.assertEqual((code, self.having(doc, "HUB_MIXED_DIR"), len(doc["accepted"])), (2, [], 1))
        self.config([], name=7)
        self.assertIn("\"name\" must be a string", doctor.config_findings(common.load_config(self.p.root), self.p.root)[0].message)

    def test_the_single_checks_honour_the_list(self):
        self.config([])
        code, out, _ = self.p.aw("hubs", "--json")
        self.assertEqual((code, [f["code"] for f in json.loads(out)["findings"]]), (1, ["HUB_MISSING", "HUB_MISSING", "HUB_MIXED_DIR"]))
        self.assertNotIn("accepted", json.loads(out))
        self.assertEqual(self.p.aw("memory", "lint")[0], 1)
        mixed = {"code": "HUB_MIXED_DIR", "path": "apps/hub/src", "why": self.WHY}
        self.config([mixed])
        code, out, _ = self.p.aw("hubs", "--json")
        doc = json.loads(out)
        self.assertEqual((code, [f["code"] for f in doc["findings"]], doc["summary"]["warning"]), (1, ["HUB_MISSING", "HUB_MISSING"], 2))
        self.assertEqual([(a["code"], a["path"], a["why"]) for a in doc["accepted"]], [("HUB_MIXED_DIR", "apps/hub/src", self.WHY)])
        self.assertEqual(list(doc)[-2:], ["summary", "findings"])
        self.config([mixed, {"code": "HUB_MISSING", "path": "apps*", "why": "two folders, one file each"},
                     {"code": "MEM_FILE_SIZE", "path": "./.agents/memory/reference/*", "why": "reference material, kept whole"}])
        code, text, _ = self.p.aw("hubs")
        self.assertEqual(code, 0)
        self.assertIn("3 accepted (aw doctor --accepted lists them)", text)
        self.assertTrue(text.rstrip().endswith("clean"))
        code, out, _ = self.p.aw("memory", "lint", "--json")
        doc = json.loads(out)
        self.assertEqual([f for f in doc["findings"] if f["code"] == "MEM_FILE_SIZE"], [])
        self.assertEqual(len(doc["accepted"]), 2)
        self.assertNotIn("ACCEPT_UNUSED", out)  # only the whole run can say an entry matches nothing

    def test_every_finding_code_is_known(self):
        import re
        from tests.clihelp import CLI
        used = set()
        for f in CLI.rglob("*.py"):
            used |= set(re.findall(r"Finding\(\s*\"([A-Z][A-Z0-9_]+)\"", f.read_text(encoding="utf-8")))
        self.assertEqual(sorted(used), sorted(common.CODES))
        self.assertEqual([c for c in common.CODES if doctor.group_of(c) == "Other"], [])


if __name__ == "__main__":
    unittest.main()
