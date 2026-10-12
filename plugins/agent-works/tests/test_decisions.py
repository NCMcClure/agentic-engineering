"""aw decisions: records, the generated index, the glossary."""
import json
import unittest

from tests.clihelp import Project

import common
import decisions

RECORD = """# {n}. {title}

## Status

accepted (2026-01-05)

## Sources

An issue.

## Context

Why.

## Decision

What.

## Consequences

Then.
"""


class Decisions(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={})

    def tearDown(self):
        self.p.close()

    def codes(self, cfg=None):
        return sorted((f.code, f.path, f.line) for f in decisions.findings(self.p.root, cfg))

    def test_new_numbers_and_indexes(self):
        code, out, err = self.p.aw("decisions", "new", "Use one wire format: little endian!")
        self.assertEqual((code, err, out.strip()), (0, "", ".agents/decisions/0001-use-one-wire-format-little-endian.md"))
        text = self.p.read(".agents/decisions/0001-use-one-wire-format-little-endian.md")
        self.assertTrue(text.startswith("# 0001. Use one wire format: little endian!\n"))
        for section in decisions.SECTIONS:
            self.assertIn(f"## {section}\n", text)
        code, out, _ = self.p.aw("decisions", "new", "Second thing", "--slug", "second", "--status", "accepted", "--json")
        self.assertEqual(json.loads(out)["number"], "0002")
        index = self.p.read(".agents/decisions/README.md")
        self.assertIn("- [0001 — Use one wire format: little endian!](0001-use-one-wire-format-little-endian.md) — proposed", index)
        self.assertIn("- [0002 — Second thing](0002-second.md) — accepted", index)
        self.assertEqual(self.codes(), [])
        self.assertEqual(self.p.aw("decisions", "index", "--check")[0], 0)
        self.assertEqual(self.p.aw("decisions", "new", "Second", "--slug", "second")[0], 2)
        self.assertEqual(self.p.aw("decisions", "new", "!!!")[0], 2)

    def test_lint_codes(self):
        w = self.p.write
        w(".agents/decisions/0001-first.md", RECORD.format(n="0001", title="First"))
        w(".agents/decisions/0002-short.md", "# 0002. Short\n\n## Status\n\naccepted\n\n## Decision\n\nYes.\n")
        w(".agents/decisions/0002-twice.md", RECORD.format(n="0002", title="Twice"))
        w(".agents/decisions/0004-wrong-heading.md", RECORD.format(n="0007", title="Wrong"))
        w(".agents/decisions/notes.md", RECORD.format(n="0009", title="No number in the name"))
        w(".agents/decisions/0005-amended.md", RECORD.format(n="0005", title="Amended") + "\n## Amendment 2026-02-01\n\nA.\n\n## Amendment 2026-03-01\n\nB.\n")
        w(".agents/decisions/0006-once.md", RECORD.format(n="0006", title="Once") + "\n## Amendment 2026-02-01\n\nA.\n")
        w(".agents/decisions/0008-long.md", RECORD.format(n="0008", title="Long") + "x\n" * 150)
        got = self.codes()
        D = ".agents/decisions/"
        self.assertEqual(got, [("DEC_AMENDED", D + "0005-amended.md", 0), ("DEC_INDEX_STALE", D + "README.md", 0),
                               ("DEC_NUMBER", D + "0002-twice.md", 0), ("DEC_NUMBER", D + "0004-wrong-heading.md", 1),
                               ("DEC_NUMBER", D + "notes.md", 0), ("DEC_SECTIONS", D + "0002-short.md", 0),
                               ("DEC_SIZE", D + "0008-long.md", 0)])
        msg = [f.message for f in decisions.findings(self.p.root) if f.code == "DEC_SECTIONS"][0]
        self.assertEqual(msg, "lacks the sections: Sources, Context, Consequences")
        code, out, _ = self.p.aw("decisions", "lint", "--json")
        self.assertEqual((code, json.loads(out)["summary"]["warning"]), (1, 7))
        self.assertEqual(self.p.aw("decisions", "index")[1].strip(), "wrote .agents/decisions/README.md")
        self.assertNotIn("DEC_INDEX_STALE", [c for c, _, _ in self.codes()])

    def test_the_folder_is_a_setting(self):
        self.p.write(".agents/agent-works.json", json.dumps({"paths": {"decisions": "design/adr"}}))
        self.p.aw("decisions", "new", "Elsewhere")
        self.assertTrue((self.p.root / "design/adr/0001-elsewhere.md").is_file())
        self.assertTrue((self.p.root / "design/adr/README.md").is_file())

    def test_glossary(self):
        self.p.write(".agents/CONTEXT.md", "# Glossary\n\n| Term | Meaning |\n|---|---|\n| **stream** | Frames over the wire. |\n"
                                           "| shot | One picture. |\n| `Stream` | Again. |\n| gate | " + "x" * 300 + " |\n\n- **hub** — the daemon\n- **hub**: twice\n"
                                           "```\n| stream | in a fence |\n```\n")
        got = self.codes()
        G = ".agents/CONTEXT.md"
        self.assertEqual(got, [("GLOSSARY_DUP_TERM", G, 7), ("GLOSSARY_DUP_TERM", G, 11), ("GLOSSARY_ROW_LONG", G, 8)])
        roomy = common.merge(common.load_config(self.p.root), {"budgets": {"glossaryRowChars": 400}})
        self.assertNotIn("GLOSSARY_ROW_LONG", [c for c, _, _ in self.codes(roomy)])
        self.p.write("docs/CONTEXT.md", "# Glossary\n\n| Term | Meaning |\n|---|---|\n| lap | Once round. |\n")
        multi = [f for f in decisions.findings(self.p.root) if f.code == "GLOSSARY_MULTI"]
        self.assertEqual([(f.path, f.level) for f in multi], [("docs/CONTEXT.md", "warning")])
        self.assertIn(".agents/CONTEXT.md, docs/CONTEXT.md", multi[0].message)

    BODY = "\n## Context\n\nWhy.\n\n## Decision\n\nWhat.\n\n## Consequences\n\nThen.\n"

    def test_status_and_sources_in_the_adr_forms(self):
        w = self.p.write
        D = ".agents/decisions/"
        w(D + "0001-heading.md", RECORD.format(n="0001", title="Heading"))
        w(D + "0002-bullets.md", "# 0002. Bullets\n\n- **Status:** accepted\n- **Date:** 2026-02-03\n- **Sources:** [an issue](https://example.com/1)\n" + self.BODY)
        w(D + "0003-bold.md", "# 0003. Bold\n\n**Status:** superseded by 0004\n\n**Sources:** a talk\n" + self.BODY)
        w(D + "0004-plain.md", "# 0004. Plain\n\nStatus: accepted (2026-03-01)\nDate: 2026-03-01\nSource: the measurement\n" + self.BODY)
        w(D + "0005-colon-outside.md", "# 0005. Colon outside\n\n* __Status__: **proposed**\n* **Sources**: none\n" + self.BODY)
        w(D + "0006-frontmatter.md", "---\nstatus: rejected\ndate: 2026-04-05\nsources: an issue\n---\n\n# 0006. Frontmatter\n" + self.BODY)
        w(D + "0007-mixed.md", "# 0007. Mixed\n\n- **Status:** accepted\n\n## Sources\n\nAn issue.\n" + self.BODY)
        # not the forms: a status line below the first section is prose, a fenced one is an example
        w(D + "0008-prose.md", "# 0008. Prose\n\n```\nStatus: accepted\n```\n\n## Context\n\nStatus: unknown at the time.\nSources: none.\n"
                               "\n## Decision\n\nWhat.\n\n## Consequences\n\nThen.\n")
        w(D + "0009-no-sources.md", "# 0009. No sources\n\n**Status:** accepted\n" + self.BODY)
        got = [(f.code, f.path, f.message) for f in decisions.findings(self.p.root) if f.code == "DEC_SECTIONS"]
        self.assertEqual(got, [("DEC_SECTIONS", D + "0008-prose.md", "lacks the sections: Status, Sources"),
                               ("DEC_SECTIONS", D + "0009-no-sources.md", "lacks the section: Sources")])
        status = {r["number"]: r["status"] for r in decisions.scan(self.p.root, common.load_config(self.p.root))}
        self.assertEqual(status, {"0001": "accepted (2026-01-05)", "0002": "accepted (2026-02-03)", "0003": "superseded by 0004",
                                  "0004": "accepted (2026-03-01)", "0005": "proposed", "0006": "rejected (2026-04-05)",
                                  "0007": "accepted", "0008": "", "0009": "accepted"})
        self.assertEqual(self.p.aw("decisions", "index")[0], 0)
        index = self.p.read(D + "README.md")
        self.assertIn("- [0002 — Bullets](0002-bullets.md) — accepted (2026-02-03)\n", index)
        self.assertIn("- [0003 — Bold](0003-bold.md) — superseded by 0004\n", index)
        self.assertIn("- [0006 — Frontmatter](0006-frontmatter.md) — rejected (2026-04-05)\n", index)
        self.assertIn("- [0008 — Prose](0008-prose.md)\n", index)
        # linting rewrote nobody's record
        self.assertEqual(self.p.read(D + "0002-bullets.md").splitlines()[2], "- **Status:** accepted")

    HAND = "# Architecture decisions\n\nRead 0001 before touching the wire.\n\n| No | What | Why it matters |\n|---|---|---|\n| 0001 | First | the wire |\n"

    def test_a_hand_written_index_is_kept(self):
        D = ".agents/decisions/"
        self.p.write(D + "0001-first.md", RECORD.format(n="0001", title="First"))
        self.p.write(D + "README.md", self.HAND)
        self.assertEqual(decisions.index_kind(self.p.root / D / "README.md"), "handwritten")
        found = decisions.findings(self.p.root)
        self.assertEqual([(f.code, f.level, f.path) for f in found], [("DEC_INDEX_HANDWRITTEN", "info", D + "README.md")])
        self.assertIn("5 lines would be lost", found[0].message)
        self.assertIn("--adopt", found[0].message)
        self.assertEqual(self.p.aw("decisions", "lint")[0], 0)            # information, not a failure
        self.assertEqual(self.p.aw("decisions", "index", "--check")[0], 0)
        # index refuses, says why and names the way
        code, out, err = self.p.aw("decisions", "index")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("written by hand; nothing was written", err)
        self.assertIn("aw decisions index --adopt", err)
        self.assertEqual(self.p.read(D + "README.md"), self.HAND)
        code, out, _ = self.p.aw("decisions", "index", "--json")
        self.assertEqual((code, json.loads(out)), (2, {"refused": True, "handwritten": [{"path": D + "README.md", "linesLost": 5}], "written": []}))
        # a new record adds its one line and leaves the rest
        code, out, _ = self.p.aw("decisions", "new", "Second thing", "--json")
        self.assertEqual(json.loads(out)["index"], D + "README.md")
        self.assertEqual(self.p.read(D + "README.md"), self.HAND + "\n- [0002 — Second thing](0002-second-thing.md) — proposed (" + common.today() + ")\n")
        # setup never writes over it
        before = self.p.read(D + "README.md")
        self.assertEqual(self.p.aw("setup", "--apply")[0], 0)
        self.assertEqual(self.p.read(D + "README.md"), before)
        # adopting is asked for by name
        code, out, _ = self.p.aw("decisions", "index", "--adopt")
        self.assertEqual((code, out.strip()), (0, "adopted " + D + "README.md"))
        text = self.p.read(D + "README.md")
        self.assertIn(decisions.GENERATED, text.splitlines()[:decisions.MARKER_WITHIN])
        self.assertNotIn("Architecture decisions", text)
        self.assertEqual(decisions.index_kind(self.p.root / D / "README.md"), "generated")
        self.assertEqual(self.codes(), [])
        self.assertEqual(self.p.aw("decisions", "index")[1].strip(), "the decision index is up to date")

    def test_a_generated_index_is_still_rewritten(self):
        D = ".agents/decisions/"
        self.p.aw("decisions", "new", "First")
        self.p.write(D + "0002-second.md", RECORD.format(n="0002", title="Second"))
        self.assertEqual([c for c, _, _ in self.codes()], ["DEC_INDEX_STALE"])
        self.assertEqual(self.p.aw("decisions", "index", "--check")[0], 1)
        self.assertEqual(self.p.aw("decisions", "index")[1].strip(), "wrote " + D + "README.md")
        self.assertEqual(self.codes(), [])
        # the stub `aw setup` wrote before it carried the marker is ours too, and so is the one it writes now
        for stub in (decisions.STUB_0_1_2, decisions.build_index([])):
            self.p.write(D + "README.md", stub)
            self.assertEqual(decisions.index_kind(self.p.root / D / "README.md"), "generated")
            self.assertEqual(self.p.aw("decisions", "index")[0], 0)
            self.assertIn("- [0002 — Second](0002-second.md)", self.p.read(D + "README.md"))
        self.assertIn(decisions.GENERATED, decisions.build_index([]))
        self.assertIn("No records yet", decisions.build_index([]))

    def test_new_follows_the_title_form_of_the_folder(self):
        forms = {"# {n}. {t}": "# 0004. Next one", "# ADR {n}: {t}": "# ADR 0004: Next one", "# {n}: {t}": "# 0004: Next one",
                 "# {n} - {t}": "# 0004 - Next one", "# ADR-{n}: {t}": "# ADR-0004: Next one", "# ADR {n} - {t}": "# ADR 0004 - Next one",
                 "# {n} — {t}": "# 0004 — Next one"}
        for form, want in forms.items():
            p = Project(config={})
            try:
                for n, t in (("0001", "First"), ("0002", "Second"), ("0003", "Third")):
                    p.write(f".agents/decisions/{n}-{t.lower()}.md", form.format(n=n, t=t) + "\n" + RECORD.split("\n", 1)[1])
                code, out, err = p.aw("decisions", "new", "Next one")
                self.assertEqual((form, code, err), (form, 0, ""))
                self.assertEqual((form, p.read(".agents/decisions/0004-next-one.md").splitlines()[0]), (form, want))
                found = decisions.findings(p.root)
                self.assertEqual([f.code for f in found if f.code in ("DEC_NUMBER", "DEC_SECTIONS")], [], form)  # every form is read
                self.assertIn("- [0004 — Next one](0004-next-one.md)", p.read(".agents/decisions/README.md"))
            finally:
                p.close()

    def test_new_takes_the_majority_of_the_last_records_and_its_own_form_in_an_empty_folder(self):
        w = self.p.write
        rest = "\n" + RECORD.split("\n", 1)[1]
        self.p.aw("decisions", "new", "Alone")
        self.assertEqual(self.p.read(".agents/decisions/0001-alone.md").splitlines()[0], "# 0001. Alone")
        for n in range(2, 8):                                        # six records in the ADR form, then two in another
            w(f".agents/decisions/{n:04d}-r{n}.md", f"# ADR {n:04d}: R{n}" + rest)
        w(".agents/decisions/0008-r8.md", "# 0008 - R8" + rest)
        w(".agents/decisions/0009-untitled.md", "Just prose, no heading.\n")
        self.p.aw("decisions", "new", "After")
        self.assertEqual(self.p.read(".agents/decisions/0010-after.md").splitlines()[0], "# ADR 0010: After")
        # short numbers are followed in their width
        q = Project(config={})
        try:
            for n in (1, 2, 3):
                q.write(f".agents/decisions/{n:04d}-r{n}.md", f"# ADR {n}: R{n}" + rest)
            q.aw("decisions", "new", "After")
            self.assertEqual(q.read(".agents/decisions/0004-after.md").splitlines()[0], "# ADR 4: After")
        finally:
            q.close()

    def test_nothing_there_is_clean(self):
        self.assertEqual(self.codes(), [])
        self.assertEqual(self.p.aw("decisions", "lint")[0], 0)
        self.assertEqual(self.p.aw("decisions", "index")[0], 0)
        self.assertFalse((self.p.root / ".agents/decisions").exists())


if __name__ == "__main__":
    unittest.main()
