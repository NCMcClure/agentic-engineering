"""aw memory: lint, generated and hand-written indexes, new and touch."""
import json
import shutil
import subprocess
import unittest

from tests.clihelp import Project

import common
import memory

TODAY = common.today()
G = memory.GENERATED  # the second line of a generated index


def mem(slug, type_="learning", description="What is in it and when it matters", date="2026-01-05", name=None, extra="", body="Body.\n"):
    return f"---\nname: {name or slug}\ndescription: {description}\ntype: {type_}\nupdated: {date}\n{extra}---\n\n# {slug}\n\n{body}"


class Memory(unittest.TestCase):
    """A tree whose indexes are generated (they carry the marker)."""

    def setUp(self):
        self.p = Project(config={})
        self.p.write(".agents/memory/INDEX.md", f"# Memory index\n{G}\n\nWhat this project remembers.\n")
        self.p.write(".agents/memory/tooling/INDEX.md", f"# tooling/\n{G}\n\nTraps of the build tools.\n")
        self.p.write(".agents/memory/tooling/2026-01-05-compiler-memory.md", mem("compiler-memory"))
        self.p.write(".agents/memory/tooling/2026-01-07-why-ninja.md", mem("why-ninja", "decision", date="2026-01-07"))
        self.p.write(".agents/memory/project/2026-01-09-project-status.md", mem("project-status", "status", date="2026-01-09"))

    def tearDown(self):
        self.p.close()

    def codes(self):
        return sorted({(f.code, f.path) for f in memory.findings(self.p.root)})

    def stale_project_index(self):
        """Make another folder's index stale, and return its bytes: a side effect on it would show."""
        self.p.write(".agents/memory/project/2026-01-09-project-status.md",
                     mem("project-status", "status", description="Where the project stands now", date="2026-01-09"))
        return (self.p.root / ".agents/memory/project/INDEX.md").read_bytes()

    def test_index_is_generated_from_frontmatter(self):
        self.assertEqual(self.p.aw("memory", "index", "--check")[0], 1)
        code, out, _ = self.p.aw("memory", "index")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), ["wrote .agents/memory/INDEX.md", "wrote .agents/memory/project/INDEX.md",
                                            "wrote .agents/memory/tooling/INDEX.md"])
        tooling = self.p.read(".agents/memory/tooling/INDEX.md").splitlines()
        self.assertEqual(tooling[:7], ["# tooling/", G, "", "Traps of the build tools.", "", "Parent: [../INDEX.md](../INDEX.md)", ""])
        # decisions before learnings, each line: slug, type, the description
        self.assertEqual(tooling[-2:], ["- [why-ninja](2026-01-07-why-ninja.md) — decision — What is in it and when it matters",
                                        "- [compiler-memory](2026-01-05-compiler-memory.md) — learning — What is in it and when it matters"])
        root = self.p.read(".agents/memory/INDEX.md")
        self.assertEqual(root.splitlines()[:2], ["# Memory index", G])
        self.assertIn("What this project remembers.", root)  # the hand-written line is kept
        self.assertIn("- [tooling/](tooling/INDEX.md) — Traps of the build tools.", root)
        self.assertIn("- [project/](project/INDEX.md) — <one line: what belongs in this folder>", root)
        self.assertEqual(self.p.read(".agents/memory/project/INDEX.md").splitlines()[1], G)  # a missing index is made generated
        self.assertEqual(self.p.aw("memory", "index", "--check")[0], 0)
        self.assertEqual(self.p.aw("memory", "index")[1].strip(), "memory indexes are up to date")
        self.assertEqual(self.codes(), [])
        self.assertEqual({memory.index_kind(self.p.root / ".agents/memory" / d / "INDEX.md") for d in ("", "tooling", "project")},
                         {"generated"})

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
        self.p.aw("memory", "index")
        code, out, err = self.p.aw("memory", "new", "engine", "frame-pacing", "--type", "learning",
                                   "--description", "Why frames stutter under vsync and what fixed it", "--about", "Facts about the engine.")
        self.assertEqual((code, err), (0, ""))
        rel = f".agents/memory/engine/{TODAY}-frame-pacing.md"
        self.assertEqual(out.strip(), rel)
        fields, body = common.parse_frontmatter(self.p.read(rel))
        self.assertEqual(fields, {"name": "frame-pacing", "description": "Why frames stutter under vsync and what fixed it",
                                  "type": "learning", "updated": TODAY})
        self.assertIn("# Frame pacing", body)
        engine = self.p.read(".agents/memory/engine/INDEX.md")
        self.assertEqual(engine.splitlines()[:4], ["# engine/", G, "", "Facts about the engine."])
        self.assertIn(f"- [frame-pacing]({TODAY}-frame-pacing.md) — learning — Why frames stutter", engine)
        self.assertIn("- [engine/](engine/INDEX.md) — Facts about the engine.", self.p.read(".agents/memory/INDEX.md"))
        self.assertEqual(self.codes(), [])
        # a slug is unique across the tree; a project has one status memory; names are kebab-case
        self.assertEqual(self.p.aw("memory", "new", "other", "frame-pacing", "--type", "report", "--description", "x")[0], 2)
        self.assertEqual(self.p.aw("memory", "new", "project", "status-two", "--type", "status", "--description", "x")[0], 2)
        self.assertEqual(self.p.aw("memory", "new", "engine", "Bad_Slug", "--type", "report", "--description", "x")[0], 2)
        self.assertEqual(self.p.aw("memory", "new", "engine", "x", "--type", "essay", "--description", "x")[0], 2)

    def test_new_regenerates_only_its_folder(self):
        self.p.aw("memory", "index")
        before = self.stale_project_index()
        root = (self.p.root / ".agents/memory/INDEX.md").read_bytes()
        code, out, _ = self.p.aw("memory", "new", "tooling", "linker-flags", "--type", "report", "--description", "What LTO cost", "--json")
        self.assertEqual((code, json.loads(out)["indexes"]), (0, [".agents/memory/tooling/INDEX.md"]))
        self.assertIn(f"- [linker-flags]({TODAY}-linker-flags.md) — report — What LTO cost", self.p.read(".agents/memory/tooling/INDEX.md"))
        self.assertEqual((self.p.root / ".agents/memory/project/INDEX.md").read_bytes(), before)  # stale, and left so
        self.assertEqual((self.p.root / ".agents/memory/INDEX.md").read_bytes(), root)
        self.assertEqual(self.codes(), [("MEM_INDEX_STALE", ".agents/memory/project/INDEX.md")])

    def test_touch_renames_and_fixes_links(self):
        self.p.aw("memory", "index")
        before = self.stale_project_index()
        self.p.write("AGENTS.md", "# Root\r\n\r\nSee [the trap](.agents/memory/tooling/2026-01-05-compiler-memory.md).\r\n")
        self.p.write(".agents/memory/tooling/2026-01-07-why-ninja.md",
                     mem("why-ninja", "decision", date="2026-01-07", body="Because of [[compiler-memory]] (2026-01-05-compiler-memory.md).\n"))
        code, out, err = self.p.aw("memory", "touch", "compiler-memory", "--json")
        self.assertEqual((code, err), (0, ""))
        doc = json.loads(out)
        new = f".agents/memory/tooling/{TODAY}-compiler-memory.md"
        self.assertEqual((doc["path"], doc["renamedFrom"]), (new, ".agents/memory/tooling/2026-01-05-compiler-memory.md"))
        self.assertEqual(doc["renamedWith"], "rename")  # the test project's .git is a stand-in: git does not know the file
        self.assertEqual(sorted(doc["linksFixed"]), [".agents/memory/tooling/2026-01-07-why-ninja.md", "AGENTS.md"])
        self.assertEqual(doc["indexes"], [".agents/memory/tooling/INDEX.md"])
        self.assertFalse((self.p.root / ".agents/memory/tooling/2026-01-05-compiler-memory.md").exists())
        self.assertEqual(common.parse_frontmatter(self.p.read(new))[0]["updated"], TODAY)
        # a file whose link is fixed keeps its line endings
        self.assertEqual((self.p.root / "AGENTS.md").read_bytes().decode(),
                         f"# Root\r\n\r\nSee [the trap](.agents/memory/tooling/{TODAY}-compiler-memory.md).\r\n")
        self.assertIn(f"- [compiler-memory]({TODAY}-compiler-memory.md)", self.p.read(".agents/memory/tooling/INDEX.md"))
        self.assertEqual((self.p.root / ".agents/memory/project/INDEX.md").read_bytes(), before)  # no other folder's index
        self.assertEqual(self.codes(), [("MEM_INDEX_STALE", ".agents/memory/project/INDEX.md")])
        self.assertIn("already dated today", self.p.aw("memory", "touch", "compiler-memory")[1])
        self.assertEqual(self.p.aw("memory", "touch", "no-such")[0], 2)
        code, out, _ = self.p.aw("memory", "touch", "why-ninja", "--date", "2026-02-01")
        self.assertTrue((self.p.root / ".agents/memory/tooling/2026-02-01-why-ninja.md").exists(), out)
        self.assertIn("renamed without git", out)

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


HAND = {
    ".agents/memory/INDEX.md": "# Memory index\r\n\r\nFolders by content. Start with `project/`.\r\n\r\n"
                               "- [project/](project/INDEX.md) — living status, and the plan we no longer follow\r\n"
                               "- [tooling/](tooling/INDEX.md) — traps of the build tools (ask before adding a compiler)\r\n",
    ".agents/memory/tooling/INDEX.md": "# tooling/\r\n\r\nTraps of the build tools. Parent: [../INDEX.md](../INDEX.md).\r\n\r\n"
                                       "- [why-ninja](2026-01-07-why-ninja.md) — decision — make was 4× slower; **measured** on the big tree\r\n"
                                       "- [compiler-memory](2026-01-05-compiler-memory.md) — learning — the compiler needs 6 GB a job: "
                                       "cap the jobs, see [why-ninja](2026-01-07-why-ninja.md)\r\n\r\nNotes below the list stay too.\r\n",
    ".agents/memory/project/INDEX.md": "# project/\n\n- [project-status](2026-01-09-project-status.md) — status — read this first",  # no final newline
}


class HandWritten(unittest.TestCase):
    """A tree whose indexes were written by hand: they say more than the descriptions, and no command may wipe that."""

    def setUp(self):
        self.p = Project(config={})
        for rel, text in HAND.items():
            self.p.write(rel, text)
        self.p.write(".agents/memory/tooling/2026-01-05-compiler-memory.md", mem("compiler-memory").replace("\n", "\r\n"))
        self.p.write(".agents/memory/tooling/2026-01-07-why-ninja.md", mem("why-ninja", "decision", date="2026-01-07"))
        self.p.write(".agents/memory/project/2026-01-09-project-status.md", mem("project-status", "status", date="2026-01-09"))

    def tearDown(self):
        self.p.close()

    def raw(self, rel):
        return (self.p.root / rel).read_bytes().decode("utf-8")

    def unchanged(self, *but):
        return all(self.raw(rel) == text for rel, text in HAND.items() if rel not in but)

    def test_touch_replaces_the_file_name_and_nothing_else(self):
        code, out, err = self.p.aw("memory", "touch", "compiler-memory", "--json")
        self.assertEqual((code, err), (0, ""))
        doc = json.loads(out)
        self.assertEqual(doc["indexes"], [".agents/memory/tooling/INDEX.md"])
        index = ".agents/memory/tooling/INDEX.md"
        self.assertEqual(self.raw(index), HAND[index].replace("2026-01-05-compiler-memory.md", f"{TODAY}-compiler-memory.md"))
        old, new = HAND[index].splitlines(keepends=True), self.raw(index).splitlines(keepends=True)
        self.assertEqual([i for i, (a, b) in enumerate(zip(old, new)) if a != b], [5])  # one line, and every other byte as it was
        self.assertEqual(len(old), len(new))
        self.assertTrue(self.unchanged(index))
        self.assertEqual(memory.index_kind(self.p.root / index), "handwritten")
        # the memory itself keeps its line endings
        self.assertEqual(self.raw(f".agents/memory/tooling/{TODAY}-compiler-memory.md"),
                         mem("compiler-memory", date=TODAY).replace("\n", "\r\n"))
        # a second touch on the same day changes nothing at all
        snapshot = {rel: self.raw(rel) for rel in HAND}
        self.assertEqual(json.loads(self.p.aw("memory", "touch", "compiler-memory", "--json")[1])["indexes"], [])
        self.assertEqual({rel: self.raw(rel) for rel in HAND}, snapshot)

    def test_new_appends_one_line(self):
        code, out, err = self.p.aw("memory", "new", "tooling", "linker-flags", "--type", "report", "--description", "What LTO cost", "--json")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(json.loads(out)["indexes"], [".agents/memory/tooling/INDEX.md"])
        index = ".agents/memory/tooling/INDEX.md"
        old, new = HAND[index].splitlines(keepends=True), self.raw(index).splitlines(keepends=True)
        line = f"- [linker-flags]({TODAY}-linker-flags.md) — report — What LTO cost\r\n"  # the house format, the file's line endings
        self.assertEqual(new, old[:6] + [line] + old[6:])  # after the last list line; the notes below it stay below
        self.assertTrue(self.unchanged(index))
        # an index without a final newline gets one before the new line
        self.assertEqual(self.p.aw("memory", "new", "project", "the-plan", "--type", "reference", "--description", "The first plan")[0], 0)
        self.assertEqual(self.raw(".agents/memory/project/INDEX.md"),
                         HAND[".agents/memory/project/INDEX.md"] + f"\n- [the-plan]({TODAY}-the-plan.md) — reference — The first plan\n")
        self.assertEqual(self.raw(".agents/memory/INDEX.md"), HAND[".agents/memory/INDEX.md"])

    def test_new_folder_gets_a_hand_written_index_and_one_root_line(self):
        code, out, err = self.p.aw("memory", "new", "engine", "frame-pacing", "--type", "learning", "--description", "Why frames stutter",
                                   "--about", "Facts about the engine.", "--json")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(json.loads(out)["indexes"], [".agents/memory/engine/INDEX.md", ".agents/memory/INDEX.md"])
        self.assertEqual(self.raw(".agents/memory/INDEX.md"),
                         HAND[".agents/memory/INDEX.md"] + "- [engine/](engine/INDEX.md) — Facts about the engine.\r\n")
        self.assertEqual(self.raw(".agents/memory/engine/INDEX.md"),
                         "# engine/\n\nFacts about the engine.\n\nParent: [../INDEX.md](../INDEX.md)\n\n"
                         f"- [frame-pacing]({TODAY}-frame-pacing.md) — learning — Why frames stutter\n")
        self.assertEqual(memory.index_kind(self.p.root / ".agents/memory/engine/INDEX.md"), "handwritten")
        self.assertTrue(self.unchanged(".agents/memory/INDEX.md"))

    def test_index_refuses_until_it_is_told_to_adopt(self):
        code, out, err = self.p.aw("memory", "index")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("3 indexes are written by hand; nothing was written", err)
        self.assertIn(".agents/memory/tooling/INDEX.md  (3 lines would be lost)", err)   # two list lines and the notes
        self.assertIn(".agents/memory/project/INDEX.md  (1 line would be lost)", err)
        self.assertIn(".agents/memory/INDEX.md  (2 lines would be lost)", err)            # the description line is kept
        self.assertIn("6 lines say something else today", err)
        self.assertIn("aw memory index --adopt", err)
        self.assertTrue(self.unchanged())
        code, out, _ = self.p.aw("memory", "index", "--json")
        doc = json.loads(out)
        self.assertEqual((code, doc["refused"], doc["written"]), (2, True, []))
        self.assertEqual({h["path"]: h["linesLost"] for h in doc["handwritten"]},
                         {".agents/memory/INDEX.md": 2, ".agents/memory/project/INDEX.md": 1, ".agents/memory/tooling/INDEX.md": 3})
        self.assertTrue(self.unchanged())
        code, out, err = self.p.aw("memory", "index", "--adopt")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out.splitlines(), ["adopted .agents/memory/INDEX.md", "adopted .agents/memory/project/INDEX.md",
                                            "adopted .agents/memory/tooling/INDEX.md"])
        tooling = self.raw(".agents/memory/tooling/INDEX.md").splitlines()
        self.assertEqual(tooling[:4], ["# tooling/", G, "", "Traps of the build tools. Parent: [../INDEX.md](../INDEX.md)."])
        self.assertEqual(tooling[-1], "- [compiler-memory](2026-01-05-compiler-memory.md) — learning — What is in it and when it matters")
        self.assertEqual(memory.findings(self.p.root), [])
        self.assertEqual(self.p.aw("memory", "index")[1].strip(), "memory indexes are up to date")  # generated now: no flag needed

    def test_check_tells_hand_written_from_stale(self):
        code, out, _ = self.p.aw("memory", "index", "--check", "--json")
        doc = json.loads(out)
        self.assertEqual(code, 0)  # information: a hand-written index is not a stale one
        self.assertEqual([(f["code"], f["level"], f["path"]) for f in doc["findings"]],
                         [("MEM_INDEX_HANDWRITTEN", "info", ".agents/memory/INDEX.md"),
                          ("MEM_INDEX_HANDWRITTEN", "info", ".agents/memory/project/INDEX.md"),
                          ("MEM_INDEX_HANDWRITTEN", "info", ".agents/memory/tooling/INDEX.md")])
        self.assertIn("3 lines would be lost", doc["findings"][2]["message"])
        # a missing index and a generated one that is out of date are stale; the hand-written ones stay information
        (self.p.root / ".agents/memory/project/INDEX.md").unlink()
        self.p.write(".agents/memory/tooling/INDEX.md", f"# tooling/\n{G}\n\nTraps.\n")
        code, out, _ = self.p.aw("memory", "index", "--check", "--json")
        self.assertEqual(code, 1)
        self.assertEqual([(f["code"], f["level"], f["path"]) for f in json.loads(out)["findings"]],
                         [("MEM_INDEX_STALE", "warning", ".agents/memory/project/INDEX.md"),
                          ("MEM_INDEX_STALE", "warning", ".agents/memory/tooling/INDEX.md"),
                          ("MEM_INDEX_HANDWRITTEN", "info", ".agents/memory/INDEX.md")])
        self.assertTrue(self.unchanged(".agents/memory/project/INDEX.md", ".agents/memory/tooling/INDEX.md"))
        # the marker counts on the first two lines only: a later mention of it does not make an index generated
        self.p.write(".agents/memory/tooling/INDEX.md", f"# tooling/\n\nTraps.\n\n{G}\n")
        self.assertEqual(memory.index_kind(self.p.root / ".agents/memory/tooling/INDEX.md"), "handwritten")


@unittest.skipUnless(shutil.which("git"), "needs git")
class TouchInGit(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={}, git=False)
        for rel, text in HAND.items():
            self.p.write(rel, text)
        self.p.write(".agents/memory/tooling/2026-01-05-compiler-memory.md", mem("compiler-memory"))
        self.p.write(".agents/memory/tooling/2026-01-07-why-ninja.md", mem("why-ninja", "decision", date="2026-01-07"))
        self.p.write(".agents/memory/project/2026-01-09-project-status.md", mem("project-status", "status", date="2026-01-09"))
        self.git("init", "-q")
        self.git("add", "--", ".agents/agent-works.json", ".agents/memory/INDEX.md", ".agents/memory/tooling", ".agents/memory/project/INDEX.md")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "first")

    def tearDown(self):
        self.p.close()

    def git(self, *args):
        r = subprocess.run(["git", "-c", "core.autocrlf=false", *args], cwd=str(self.p.root), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_a_tracked_memory_is_renamed_with_git_mv(self):
        code, out, err = self.p.aw("memory", "touch", "compiler-memory")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("(was 2026-01-05-compiler-memory.md; renamed with git mv)", out)
        self.assertIn("updated .agents/memory/tooling/INDEX.md", out)
        status = self.git("status", "--porcelain").splitlines()
        # staged as a rename (R), with the new date still to stage (M); the index edit is unstaged
        self.assertIn(f"RM .agents/memory/tooling/2026-01-05-compiler-memory.md -> .agents/memory/tooling/{TODAY}-compiler-memory.md", status)
        self.assertIn(" M .agents/memory/tooling/INDEX.md", status)
        self.assertEqual(common.parse_frontmatter(self.p.read(f".agents/memory/tooling/{TODAY}-compiler-memory.md"))[0]["updated"], TODAY)
        self.assertIn(f"]({TODAY}-compiler-memory.md)", self.p.read(".agents/memory/tooling/INDEX.md"))

    def test_an_untracked_memory_is_renamed_plainly(self):
        doc = json.loads(self.p.aw("memory", "touch", "project-status", "--json")[1])
        self.assertEqual(doc["renamedWith"], "rename")
        self.assertTrue((self.p.root / f".agents/memory/project/{TODAY}-project-status.md").is_file())
        self.assertIn(f"]({TODAY}-project-status.md)", self.p.read(".agents/memory/project/INDEX.md"))


if __name__ == "__main__":
    unittest.main()
