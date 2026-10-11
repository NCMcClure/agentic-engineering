"""aw memory: lint, the generated indexes, new and touch."""
import json
import unittest

from tests.clihelp import Project

import common
import memory

TODAY = common.today()


def mem(slug, type_="learning", description="What is in it and when it matters", date="2026-01-05", name=None, extra="", body="Body.\n"):
    return f"---\nname: {name or slug}\ndescription: {description}\ntype: {type_}\nupdated: {date}\n{extra}---\n\n# {slug}\n\n{body}"


class Memory(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={})
        self.p.write(".agents/memory/INDEX.md", "# Memory index\n\nWhat this project remembers.\n")
        self.p.write(".agents/memory/tooling/INDEX.md", "# tooling/\n\nTraps of the build tools.\n")
        self.p.write(".agents/memory/tooling/2026-01-05-compiler-memory.md", mem("compiler-memory"))
        self.p.write(".agents/memory/tooling/2026-01-07-why-ninja.md", mem("why-ninja", "decision", date="2026-01-07"))
        self.p.write(".agents/memory/project/2026-01-09-project-status.md", mem("project-status", "status", date="2026-01-09"))

    def tearDown(self):
        self.p.close()

    def codes(self):
        return sorted({(f.code, f.path) for f in memory.findings(self.p.root)})

    def test_index_is_generated_from_frontmatter(self):
        self.assertEqual(self.p.aw("memory", "index", "--check")[0], 1)
        code, out, _ = self.p.aw("memory", "index")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), ["wrote .agents/memory/INDEX.md", "wrote .agents/memory/project/INDEX.md",
                                            "wrote .agents/memory/tooling/INDEX.md"])
        tooling = self.p.read(".agents/memory/tooling/INDEX.md").splitlines()
        self.assertEqual(tooling[:5], ["# tooling/", "", "Traps of the build tools.", "", "Parent: [../INDEX.md](../INDEX.md)"])
        # decisions before learnings, each line: slug, type, the description
        self.assertEqual(tooling[-2:], ["- [why-ninja](2026-01-07-why-ninja.md) — decision — What is in it and when it matters",
                                        "- [compiler-memory](2026-01-05-compiler-memory.md) — learning — What is in it and when it matters"])
        root = self.p.read(".agents/memory/INDEX.md")
        self.assertIn("What this project remembers.", root)  # the hand-written line is kept
        self.assertIn("- [tooling/](tooling/INDEX.md) — Traps of the build tools.", root)
        self.assertIn("- [project/](project/INDEX.md) — <one line: what belongs in this folder>", root)
        self.assertEqual(self.p.aw("memory", "index", "--check")[0], 0)
        self.assertEqual(self.p.aw("memory", "index")[1].strip(), "memory indexes are up to date")
        self.assertEqual(self.codes(), [])

    def test_lint_codes(self):
        self.p.aw("memory", "index")
        w = self.p.write
        w(".agents/memory/loose-note.md", "no home")
        w(".agents/memory/tooling/2026-01-05-no-front.md", "# nothing\n")
        w(".agents/memory/tooling/Bad Name.md", mem("bad-name"))
        w(".agents/memory/tooling/2026-01-06-other.md", mem("other", name="different", date="2026-01-06"))
        w(".agents/memory/tooling/2026-01-06-odd-type.md", mem("odd-type", "note", date="2026-01-06"))
        w(".agents/memory/tooling/2026-01-06-old-date.md", mem("old-date", date="2025-12-01"))
        w(".agents/memory/project/2026-01-06-compiler-memory.md", mem("compiler-memory", date="2026-01-06"))
        w(".agents/memory/tooling/2026-01-06-long-hook.md", mem("long-hook", description="x" * 161, date="2026-01-06"))
        w(".agents/memory/tooling/2026-01-06-linked.md", mem("linked", date="2026-01-06", body="See [[why-ninja]] and [[nowhere]].\n"))
        w(".agents/memory/tooling/2026-01-06-big.md", mem("big", date="2026-01-06", body="line\n" * 400))
        w(".agents/memory/tooling/2026-01-06-shared.md", mem("shared", date="2026-01-06", extra="tags: [machine, windows]\n"))
        w(".agents/memory/project/2026-01-06-second-status.md", mem("second-status", "status", date="2026-01-06", body="## Done\n\n- much\n"))
        found = memory.findings(self.p.root)
        by = {}
        for f in found:
            by.setdefault(f.code, []).append(f)
        names = lambda code: sorted(f.path.rsplit("/", 1)[-1] for f in by.get(code, []))  # noqa: E731
        self.assertEqual(names("MEM_ROOT_LOOSE"), ["loose-note.md"])
        self.assertEqual(names("MEM_FRONTMATTER"), ["2026-01-05-no-front.md", "2026-01-06-odd-type.md", "2026-01-06-old-date.md"])
        self.assertEqual(names("MEM_NAME_MISMATCH"), ["2026-01-06-other.md", "Bad Name.md"])
        self.assertEqual(names("MEM_SLUG_DUP"), ["2026-01-05-compiler-memory.md"])
        self.assertEqual(names("MEM_HOOK_LONG"), ["2026-01-06-long-hook.md"])
        self.assertEqual([(f.path.rsplit("/", 1)[-1], f.line, f.message) for f in by["MEM_LINK_DANGLING"]],
                         [("2026-01-06-linked.md", 10, "[[nowhere]] names no memory")])
        self.assertEqual(names("MEM_FILE_SIZE"), ["2026-01-06-big.md"])
        self.assertEqual([(f.level, f.path.rsplit("/", 1)[-1]) for f in by["MEM_SHARED_CANDIDATE"]], [("info", "2026-01-06-shared.md")])
        self.assertEqual(names("STATUS_MULTI"), ["2026-01-09-project-status.md"])
        self.assertEqual([(f.path.rsplit("/", 1)[-1], f.line) for f in by["STATUS_DONE_SECTION"]], [("2026-01-06-second-status.md", 10)])
        self.assertIn("MEM_INDEX_STALE", by)
        self.assertTrue(all(f.level == "warning" for f in found if f.code != "MEM_SHARED_CANDIDATE"))

    def test_budgets_and_the_critical_status(self):
        cfg = common.merge(common.defaults(), {"budgets": {"memoryFolderFiles": 1, "statusLines": 10}})
        self.p.write(".agents/memory/project/2026-01-09-project-status.md", mem("project-status", "status", date="2026-01-09", body="x\n" * 12))
        got = {f.code: f for f in memory.findings(self.p.root, cfg)}
        self.assertEqual(got["MEM_FOLDER_OVER"].path, ".agents/memory/tooling")
        self.assertEqual(got["STATUS_SIZE"].level, "warning")
        self.p.write(".agents/memory/project/2026-01-09-project-status.md", mem("project-status", "status", date="2026-01-09", body="x\n" * 40))
        got = {f.code: f for f in memory.findings(self.p.root, cfg)}
        self.assertEqual(got["STATUS_SIZE"].level, "critical")  # over three times the budget
        self.assertNotIn("MEM_FILE_SIZE", got)

    def test_new(self):
        code, out, err = self.p.aw("memory", "new", "engine", "frame-pacing", "--type", "learning",
                                   "--description", "Why frames stutter under vsync and what fixed it", "--about", "Facts about the engine.")
        self.assertEqual((code, err), (0, ""))
        rel = f".agents/memory/engine/{TODAY}-frame-pacing.md"
        self.assertEqual(out.strip(), rel)
        fields, body = common.parse_frontmatter(self.p.read(rel))
        self.assertEqual(fields, {"name": "frame-pacing", "description": "Why frames stutter under vsync and what fixed it",
                                  "type": "learning", "updated": TODAY})
        self.assertIn("# Frame pacing", body)
        self.assertIn(f"- [frame-pacing]({TODAY}-frame-pacing.md) — learning — Why frames stutter", self.p.read(".agents/memory/engine/INDEX.md"))
        self.assertIn("- [engine/](engine/INDEX.md) — Facts about the engine.", self.p.read(".agents/memory/INDEX.md"))
        self.assertEqual(self.codes(), [])
        # a slug is unique across the tree; a project has one status memory; names are kebab-case
        self.assertEqual(self.p.aw("memory", "new", "other", "frame-pacing", "--type", "report", "--description", "x")[0], 2)
        self.assertEqual(self.p.aw("memory", "new", "project", "status-two", "--type", "status", "--description", "x")[0], 2)
        self.assertEqual(self.p.aw("memory", "new", "engine", "Bad_Slug", "--type", "report", "--description", "x")[0], 2)
        self.assertEqual(self.p.aw("memory", "new", "engine", "x", "--type", "essay", "--description", "x")[0], 2)

    def test_touch_renames_and_fixes_links(self):
        self.p.aw("memory", "index")
        self.p.write("AGENTS.md", "# Root\n\nSee [the trap](.agents/memory/tooling/2026-01-05-compiler-memory.md).\n")
        self.p.write(".agents/memory/tooling/2026-01-07-why-ninja.md",
                     mem("why-ninja", "decision", date="2026-01-07", body="Because of [[compiler-memory]] (2026-01-05-compiler-memory.md).\n"))
        code, out, err = self.p.aw("memory", "touch", "compiler-memory", "--json")
        self.assertEqual((code, err), (0, ""))
        doc = json.loads(out)
        new = f".agents/memory/tooling/{TODAY}-compiler-memory.md"
        self.assertEqual((doc["path"], doc["renamedFrom"]), (new, ".agents/memory/tooling/2026-01-05-compiler-memory.md"))
        self.assertEqual(sorted(doc["linksFixed"]), [".agents/memory/tooling/2026-01-07-why-ninja.md", "AGENTS.md"])
        self.assertFalse((self.p.root / ".agents/memory/tooling/2026-01-05-compiler-memory.md").exists())
        self.assertEqual(common.parse_frontmatter(self.p.read(new))[0]["updated"], TODAY)
        self.assertIn(f"(.agents/memory/tooling/{TODAY}-compiler-memory.md)", self.p.read("AGENTS.md"))
        self.assertIn(f"- [compiler-memory]({TODAY}-compiler-memory.md)", self.p.read(".agents/memory/tooling/INDEX.md"))
        self.assertEqual(self.codes(), [])
        self.assertIn("already dated today", self.p.aw("memory", "touch", "compiler-memory")[1])
        self.assertEqual(self.p.aw("memory", "touch", "no-such")[0], 2)
        code, out, _ = self.p.aw("memory", "touch", "why-ninja", "--date", "2026-02-01")
        self.assertTrue((self.p.root / ".agents/memory/tooling/2026-02-01-why-ninja.md").exists(), out)

    def test_lint_json_and_a_project_without_memory(self):
        self.p.aw("memory", "index")
        code, out, _ = self.p.aw("memory", "lint", "--json")
        self.assertEqual((code, json.loads(out)), (0, {"summary": {"critical": 0, "warning": 0, "info": 0}, "findings": []}))
        bare = Project()
        try:
            self.assertEqual(bare.aw("memory", "lint")[0], 0)
            self.assertEqual(json.loads(bare.aw("memory", "lint", "--json")[1])["findings"], [])
            self.assertEqual(bare.aw("memory", "index")[0], 0)
            self.assertFalse((bare.root / ".agents").exists())
        finally:
            bare.close()
        self.assertEqual(self.p.aw("memory")[0], 2)


if __name__ == "__main__":
    unittest.main()
