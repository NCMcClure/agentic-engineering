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

    def test_nothing_there_is_clean(self):
        self.assertEqual(self.codes(), [])
        self.assertEqual(self.p.aw("decisions", "lint")[0], 0)
        self.assertEqual(self.p.aw("decisions", "index")[0], 0)
        self.assertFalse((self.p.root / ".agents/decisions").exists())


if __name__ == "__main__":
    unittest.main()
