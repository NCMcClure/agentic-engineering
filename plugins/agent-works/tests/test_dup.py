"""aw dup: a rule stated in more than one place."""
import json
import unittest

from tests.clihelp import Project

import common
import dup

RULE = ("Never start the simulator from an agent shell: it runs in the service session and once logged the owner out of "
        "the store, so every launch goes through the session runner script.")


def decision(slug, body):
    return f"---\nname: {slug}\ndescription: d\ntype: decision\nupdated: 2026-01-05\n---\n\n# {slug}\n\n{body}\n"


class Dup(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={})
        self.p.write("AGENTS.md", f"# Root\n\n## Rules\n\n1. **Session.** {RULE}\n2. Something only said here, once, in the root file.\n")
        self.p.write("tools/AGENTS.md", "# tools\n\n- `session/` — the runner.\n")

    def tearDown(self):
        self.p.close()

    def found(self, **kw):
        return dup.findings(self.p.root, **kw)

    def test_one_copy_is_clean(self):
        self.assertEqual(self.found(), [])
        self.assertEqual(self.p.aw("dup")[0], 0)

    def test_the_same_rule_in_a_hub_a_brief_and_a_decision_memory(self):
        self.p.write("tools/AGENTS.md", f"# tools\n\n- `session/` — the runner.\n\nRemember: *never start the simulator* from an agent shell: it runs\n"
                                        "in the service session and once logged the owner out of the store, so every launch goes through the\nsession runner script!\n")
        self.p.write(".agents/briefs/common.md", f"# Brief\n\n{RULE}\n")
        self.p.write(".agents/memory/safety/2026-01-05-session-zero.md", decision("session-zero", RULE))
        self.p.write(".agents/memory/safety/2026-01-05-a-learning.md", decision("a-learning", RULE).replace("type: decision", "type: learning"))
        self.p.write("docs/guide.md", RULE)  # user docs are not a rule surface
        got = sorted((f.path, f.line, f.message.split(": \"")[0]) for f in self.found())
        self.assertEqual([(p, l) for p, l, _ in got], [
            (".agents/briefs/common.md", 3), ("AGENTS.md", 5), ("AGENTS.md", 5), ("AGENTS.md", 5),
            ("tools/AGENTS.md", 5), ("tools/AGENTS.md", 5)])
        root_pairs = sorted(m for p, _, m in got if p == "AGENTS.md")
        self.assertEqual([m.split(" words also in ")[1] for m in root_pairs],
                         [".agents/briefs/common.md:3", ".agents/memory/safety/2026-01-05-session-zero.md:10", "tools/AGENTS.md:5"])
        self.assertTrue(all(f.code == "DUP_RULE" and f.level == "warning" for f in self.found()))
        code, out, _ = self.p.aw("dup", "--json")
        doc = json.loads(out)
        self.assertEqual((code, doc["summary"]["warning"], doc["surfaces"]), (1, 6, 4))

    def test_markup_case_and_wrapping_do_not_hide_a_copy_but_code_and_short_runs_do(self):
        self.p.write("tools/AGENTS.md", "# tools\n\n```\n" + RULE + "\n```\n\nNever start the simulator from an agent shell.\n")
        self.assertEqual(self.found(), [])
        self.assertEqual(len(self.found(min_words=7)), 0)  # a run shorter than a shingle is never seen
        cfg = common.merge(common.load_config(self.p.root), {"dup": {"shingleWords": 6, "minWords": 7}})
        self.assertEqual(len(dup.findings(self.p.root, cfg)), 1)

    def test_threshold_and_ignore_are_settings(self):
        partial = " ".join(RULE.split()[:13])
        self.p.write("tools/AGENTS.md", f"# tools\n\n{partial} and that is all.\n")
        self.assertEqual(self.found(), [])  # 13 shared words, the default asks for 14
        self.assertEqual(len(self.found(min_words=12)), 1)
        code, out, _ = self.p.aw("dup", "--min-words", "12")
        self.assertEqual(code, 1)
        self.assertIn("13 words also in tools/AGENTS.md:3", out)
        self.p.write(".agents/agent-works.json", json.dumps({"dup": {"minWords": 12, "ignore": ["^Never start"]}}))
        self.assertEqual(dup.findings(self.p.root), [])

    def test_explicit_files(self):
        self.p.write("a.md", RULE)
        self.p.write("b.md", "Intro.\n\n" + RULE)
        got = self.found(paths=["a.md", "b.md"])
        self.assertEqual([(f.path, f.line) for f in got], [("a.md", 1)])
        self.assertIn("b.md:3", got[0].message)

    def test_runs_between(self):
        a = [(w, 1) for w in "one two three four five six seven eight".split()]
        b = [(w, 1) for w in "zero one two three four five six nine one two three four".split()]
        self.assertEqual(dup.runs_between(a, b, 4), [(0, 1, 6)])  # the repeat inside the longer run is not a second report
        self.assertEqual(dup.runs_between(a, b[:3], 4), [])


if __name__ == "__main__":
    unittest.main()
