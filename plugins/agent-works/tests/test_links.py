"""aw links: relative links and repository paths written in code."""
import json
import unittest

from tests.clihelp import Project

import links


class Links(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={})
        w = self.p.write
        w("src/app/cli.ts", "x")
        w("src/app/util.ts", "x")
        w("tools/run.sh", "x")
        w("docs/guide.md", "user docs\n")
        w(".agents/contracts/protocol.md", "# Protocol\n")

    def tearDown(self):
        self.p.close()

    def found(self, targets=None):
        res = links.findings(self.p.root, None, targets)
        return res, sorted((f.code, f.path, f.line, f.message) for f in res["findings"])

    def test_clean(self):
        self.p.write("AGENTS.md", "# Root\n\nSee [the protocol](.agents/contracts/protocol.md#frames), [docs](docs/), <https://example.com> and\n"
                                  "[the web](https://example.com/a) or [an anchor](#top). Run `tools/run.sh --fast` on `src/app/cli.ts`.\n"
                                  "Every `src/app/*.ts`, `src/{app,lib}/cli.ts`, `src/app/<name>.ts` and `tools/…`.\n\n"
                                  "```bash\nbash tools/run.sh src/app/cli.ts\n```\n")
        res, found = self.found()
        self.assertEqual(found, [])
        self.assertEqual((res["files"], res["links"], res["paths"]), (2, 2, 8))

    def test_broken_links_and_missing_paths(self):
        self.p.write("AGENTS.md", "# Root\n\n[gone](docs/missing.md) and [ok](docs/guide.md) and `[not a link](in/code.md)`.\n"
                                  "Run `tools/gone.sh` and `src/app/nope/*.ts` and `src/lib/<name>.ts`, not `other/thing.ts`.\n"
                                  "```\n[fenced](no/link.md) tools/absent.py\n```\n")
        self.p.write("src/AGENTS.md", "# src\n\n[up](../AGENTS.md) [bad](app/none.ts) [rooted](/tools/run.sh) [spaced](<../docs/guide.md>)\n")
        _, found = self.found()
        self.assertEqual(found, [
            ("LINK_BROKEN", "AGENTS.md", 3, "broken link: docs/missing.md"),
            ("LINK_BROKEN", "src/AGENTS.md", 3, "broken link: app/none.ts"),
            ("PATH_MISSING", "AGENTS.md", 4, "no such path: src/app/nope/*.ts"),
            ("PATH_MISSING", "AGENTS.md", 4, "no such path: src/lib/<name>.ts"),
            ("PATH_MISSING", "AGENTS.md", 4, "no such path: tools/gone.sh"),
            ("PATH_MISSING", "AGENTS.md", 6, "no such path: tools/absent.py"),
        ])
        code, out, _ = self.p.aw("links", "--json")
        doc = json.loads(out)
        self.assertEqual((code, doc["summary"]["warning"], doc["files"]), (1, 6, 3))

    def test_planned_and_not_checked(self):
        self.p.write("AGENTS.md", "`src/next/thing.ts` is planned; `tools/out/bin` is build output; [later](src/next/README.md).\n")
        self.assertEqual(len(self.found()[1]), 3)
        self.p.write(".agents/agent-works.json", json.dumps({"links": {"planned": ["src/next"], "notChecked": ["tools/out/"]}}))
        self.assertEqual(self.found()[1], [])

    def test_roots_are_a_setting(self):
        self.p.write("AGENTS.md", "`src/none.ts` and `tools/none.sh`\n")
        self.assertEqual(len(self.found()[1]), 2)
        self.p.write(".agents/agent-works.json", json.dumps({"links": {"roots": ["tools"]}}))
        self.assertEqual([f[3] for f in self.found()[1]], ["no such path: tools/none.sh"])

    def test_files_are_a_setting(self):
        bad = "[x](nowhere.md) and `src/none.ts`\n"
        self.p.write("AGENTS.md", "# Root\n")
        self.p.write("README.md", bad)
        self.p.write("docs/guide.md", bad)
        self.p.write("docs/more/deep.md", bad)
        self.assertEqual(self.found()[1], [])                              # the default: neither is an agent file
        self.p.write(".agents/agent-works.json", json.dumps({"links": {"files": ["README.md", "AGENTS.md", "no/such.md"]}}))
        res, found = self.found()
        self.assertEqual([(c, p) for c, p, _, _ in found], [("LINK_BROKEN", "README.md"), ("PATH_MISSING", "README.md")])
        self.assertEqual(res["files"], 3)                                  # AGENTS.md once, the missing one skipped
        self.p.write(".agents/agent-works.json", json.dumps({"links": {"files": ["README.md", "docs"]}}))
        self.assertEqual(sorted({p for _, p, _, _ in self.found()[1]}), ["README.md", "docs/guide.md", "docs/more/deep.md"])
        self.assertEqual(self.p.aw("links")[0], 1)

    def test_what_is_read_and_what_is_not(self):
        bad = "[x](nowhere.md) and `src/none.ts`\n"
        self.p.write("AGENTS.md", "# Root\n")
        self.p.write(".agents/memory/tooling/2026-01-05-old.md", bad)   # links yes, paths no: memory is dated
        self.p.write(".agents/README.md", bad)                           # the generated page: links yes, paths no
        self.p.write(".agents/decisions/0001-x.md", bad)                 # both
        self.p.write(".agents/kanban/0001-card.md", bad)                 # not read
        self.p.write(".agents/plan/spec/a.md", bad)                      # not read
        self.p.write("docs/guide.md", bad)                               # user docs: not an agent file
        self.p.write("src/notes.md", bad)                                # not an agent file
        _, found = self.found()
        self.assertEqual([(c, p) for c, p, _, _ in found], [
            ("LINK_BROKEN", ".agents/README.md"), ("LINK_BROKEN", ".agents/decisions/0001-x.md"),
            ("LINK_BROKEN", ".agents/memory/tooling/2026-01-05-old.md"), ("PATH_MISSING", ".agents/decisions/0001-x.md")])
        # explicit targets are read whatever they are
        _, found = self.found(["docs", "src/notes.md"])
        self.assertEqual([(c, p) for c, p, _, _ in found], [("LINK_BROKEN", "docs/guide.md"), ("LINK_BROKEN", "src/notes.md"),
                                                            ("PATH_MISSING", "docs/guide.md"), ("PATH_MISSING", "src/notes.md")])
        self.assertEqual(self.p.aw("links", "no/such.md")[0], 2)


if __name__ == "__main__":
    unittest.main()
