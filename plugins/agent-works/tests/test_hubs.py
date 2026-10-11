"""aw hubs: the hub contract, the skip marker, and the JSON other plugins read."""
import json
import unittest

from tests.clihelp import Project

import common
import hubs


def codes(res):
    return sorted((f.code, f.path) for f in res["findings"])


class Hubs(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.close()

    def verify(self, excludes=(), cfg=None):
        return hubs.verify(self.p.root, excludes, cfg)

    def good_tree(self):
        self.p.write("AGENTS.md", "# Root\n\n- `apps/` — the applications\n- `tools/` — scripts\n")
        self.p.write("apps/AGENTS.md", "# apps\n\n- [web/](web/AGENTS.md) — the site\n- `api/` — the service\n")
        self.p.write("apps/web/AGENTS.md", "# web\n\n| Path | What |\n|---|---|\n| `src/` | code |\n")
        self.p.write("apps/web/src/main.ts", "x")
        self.p.write("apps/api/server.py", "x")
        self.p.write("tools/run.sh", "x")

    def test_no_code_is_clean(self):
        self.p.write("README.md", "hi")
        self.assertEqual(self.verify(), {"findings": [], "hubs": 0, "claude_chain": False})

    def test_a_good_tree_is_clean(self):
        self.good_tree()
        res = self.verify()
        self.assertEqual((codes(res), res["hubs"]), ([], 3))

    def test_root_missing_and_ramp_in(self):
        self.p.write("pkg/AGENTS.md", "# pkg\n- `sub/`\n")
        self.p.write("pkg/loose.py", "x")
        self.p.write("pkg/sub/a.py", "x")
        res = self.verify()
        self.assertIn(("HUB_ROOT_MISSING", "."), codes(res))
        iso = [f for f in res["findings"] if f.code == "HUB_ISOLATION"]
        self.assertEqual([(f.path, f.level) for f in iso], [("pkg", "warning")])
        self.p.write("AGENTS.md", "# Root\n- `pkg/`\n")
        iso = [f for f in self.verify()["findings"] if f.code == "HUB_ISOLATION"]
        self.assertEqual([(f.path, f.level) for f in iso], [("pkg", "critical")])
        self.assertEqual(common.exit_for(self.verify()["findings"]), 2)

    def test_missing_and_mixed(self):
        self.p.write("AGENTS.md", "# Root\n- `a/`\n- `b/`\n")
        self.p.write("a/x/one.py", "x")
        self.p.write("b/loose.py", "x")
        self.p.write("b/y/two.py", "x")
        self.p.write("a/x/__init__.py", "")
        self.assertEqual(codes(self.verify()), [("HUB_MISSING", "a"), ("HUB_MIXED_DIR", "b")])

    def test_package_markers_and_manifests_do_not_break_isolation(self):
        self.p.write("AGENTS.md", "# Root\n- `pkg/`\n")
        self.p.write("pkg/AGENTS.md", "# pkg\n- `core/`\n")
        self.p.write("pkg/__init__.py", "")
        self.p.write("pkg/package.json", "{}")
        self.p.write("pkg/README.md", "x")
        self.p.write("pkg/core/a.py", "x")
        self.assertEqual(codes(self.verify()), [])

    def test_never_walked(self):
        self.p.write("AGENTS.md", "# Root\n- `src/`\n\n<!-- verify-agents-tree: skip generated/ data/fixtures -->\n")
        self.p.write("src/a.py", "x")
        for skipped in (".agents/plan/plan/verify.py", ".agents/scripts/x/y.py", ".plan/plan/v.py", "node_modules/m/i.js",
                        "archive/old/a/b.py", ".hidden/a/b.py", "generated/a/b.py", "data/fixtures/a/b.py", "extra/a/b.py"):
            self.p.write(skipped, "x")
        self.assertEqual(codes(self.verify()), [("HUB_MISSING", "extra"), ("HUB_UNLISTED_CHILD", "AGENTS.md")])
        self.assertEqual(codes(self.verify(["extra/"])), [])

    def test_size_budgets(self):
        self.good_tree()
        self.p.write("apps/AGENTS.md", "# apps\n- `web/`\n- `api/`\n" + "line\n" * 40)
        self.p.write("AGENTS.md", "# Root\n- `apps/`\n- `tools/`\n" + "line\n" * 200)
        got = {(f.code, f.path): f.message for f in self.verify()["findings"]}
        self.assertEqual(sorted(got), [("HUB_SIZE", "apps/AGENTS.md"), ("ROOT_SIZE", "AGENTS.md")])
        self.assertIn("43 lines, the budget is 40", got[("HUB_SIZE", "apps/AGENTS.md")])
        roomy = common.merge(common.defaults(), {"budgets": {"hubLines": 50, "rootAgentsLines": 300}})
        self.assertEqual(codes(self.verify(cfg=roomy)), [])

    def test_stale_and_unlisted_children(self):
        self.good_tree()
        self.p.write("apps/AGENTS.md", "# apps\n\n- `web/` — the site\n- `gone/` — was here\n- [old.md](old.md) — a page\n"
                                       "- `make build` — a command, not a child\n- `<name>/` and `*.ts` are patterns\n"
                                       "```\n- `fenced/` is an example\n```\n")
        got = [(f.code, f.path, f.line, f.message) for f in self.verify()["findings"]]
        self.assertEqual([g[:3] for g in got], [("HUB_STALE_CHILD", "apps/AGENTS.md", 4), ("HUB_STALE_CHILD", "apps/AGENTS.md", 5),
                                                 ("HUB_UNLISTED_CHILD", "apps/AGENTS.md", 0)])
        self.assertIn("`gone/`", got[0][3])
        # The root file is prose as well as a hub: a bullet that leads with a file name is no child line there,
        # a folder that is gone still is.
        root = self.p.read("AGENTS.md")
        self.p.write("AGENTS.md", root + "\n- `INDEX.md` files are never dated\n- `vanished/` — was here\n")
        stale = [f.message for f in self.verify()["findings"] if f.code == "HUB_STALE_CHILD" and f.path == "AGENTS.md"]
        self.assertEqual(len(stale), 1)
        self.assertIn("`vanished/`", stale[0])
        self.p.write("AGENTS.md", root)
        self.assertIn("`api/`", got[2][3])

    def test_claude_chain_only_when_opted_in(self):
        self.good_tree()
        self.p.write("apps/CLAUDE.md", "own words")
        self.p.write("tools/CLAUDE.md", "@AGENTS.md\n")
        self.assertEqual(codes(self.verify()), [])
        self.p.write("CLAUDE.md", "@AGENTS.md\n")
        res = self.verify()
        self.assertTrue(res["claude_chain"])
        self.assertEqual(codes(res), [("CLAUDE_CHAIN", "apps/CLAUDE.md"), ("CLAUDE_CHAIN", "apps/web"), ("CLAUDE_CHAIN", "tools/CLAUDE.md")])

    def test_the_command_other_plugins_run(self):
        """`aw hubs . --json`: a positional path, then --json; one JSON document of the agreed shape; exit 0/1/2."""
        code, out, err = self.p.aw("hubs", ".", "--json")
        self.assertEqual((code, err), (0, ""))
        doc = json.loads(out)
        self.assertEqual((doc["summary"], doc["findings"]), ({"critical": 0, "warning": 0, "info": 0}, []))
        self.p.write("src/deep/a.py", "x")
        code, out, _ = self.p.aw("hubs", ".", "--json")
        doc = json.loads(out)
        self.assertEqual(code, 1)
        self.assertEqual(doc["summary"], {"critical": 0, "warning": 3, "info": 0})  # no root hub; "." and "src" are non-leaf
        self.assertEqual(sorted(doc["findings"][0]), ["code", "level", "line", "message", "path"])
        self.assertEqual({f["code"] for f in doc["findings"]}, {"HUB_ROOT_MISSING", "HUB_MISSING"})
        self.p.write("AGENTS.md", "# Root\n- `src/`\n")
        self.p.write("src/AGENTS.md", "# src\n- `deep/`\n")
        self.p.write("src/loose.py", "x")
        code, out, _ = self.p.aw("hubs", ".", "--json")
        self.assertEqual((code, json.loads(out)["summary"]["critical"]), (2, 1))
        # without a path the root is found from below
        code, out, _ = self.p.aw("hubs", "--json", "--exclude", "src", cwd=self.p.root / "src" / "deep")
        self.assertEqual((code, json.loads(out)["findings"]), (0, []))
        code, out, _ = self.p.aw("hubs", str(self.p.root))
        self.assertEqual(code, 2)
        self.assertIn("HUB_ISOLATION", out)
        self.assertEqual(self.p.aw("hubs", "no/such/dir")[0], 2)


if __name__ == "__main__":
    unittest.main()
