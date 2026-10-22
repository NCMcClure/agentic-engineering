"""docs_check and the two hooks, against small throwaway projects.

Run: python3 -m unittest discover -s plugins/docs-parity/tests
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

PLUGIN = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("docs_check", PLUGIN / "scripts" / "docs_check.py")
dc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dc)

PAGE = "---\ntitle: {t}\ndescription: Do the thing.\ntags: [a, b, c]\n---\n\nThis page explains {t}. It has a summary.\n\n## Section\n\n{body}\n"


class Project:
    """A temp directory with files, an optional config, and optional git history."""

    def __init__(self, files=None, config=None, git=False):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for path, text in (files or {}).items():
            self.write(path, text)
        if config is not None:
            self.write(".agents/docs-parity.json", json.dumps(config))
        if git:
            self.git("init", "-q", "-b", "main")
            self.commit("initial")

    def write(self, path, text=""):
        p = self.root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(text, bytes):
            p.write_bytes(text)
        else:
            p.write_text(text, encoding="utf-8")

    def git(self, *args):
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.invalid",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.invalid")
        return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True,
                              text=True, env=env).stdout

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD").strip()

    def check(self, **kw):
        return dc.run(self.root, **kw)

    def close(self):
        self.tmp.cleanup()


def codes(report):
    return sorted(f["code"] for f in report["findings"])


SITE = {
    "target": "site:fumadocs", "docsRoot": "content/docs", "nav": "meta.json",
    "frontmatter": ["title", "description"], "tags": [3, 7],
    "roots": [{"name": "guide", "path": "guide", "deny": [r"\bAPI_KEY\b"]}, {"name": "admin", "path": "admin", "private": True}],
    "images": {"dir": "public/images", "urlPrefix": "/images/", "themes": ["light", "dark"]},
}


def site_files(**over):
    files = {
        "content/docs/meta.json": json.dumps({"pages": ["index", "guide", "admin"]}),
        "content/docs/index.mdx": PAGE.format(t="Home", body="See [the guide](/guide/start)."),
        "content/docs/guide/meta.json": json.dumps({"pages": ["start"]}),
        "content/docs/guide/start.mdx": PAGE.format(t="Start", body='<Figure src="/images/guide/start.webp" alt="x" />'),
        "content/docs/admin/meta.json": json.dumps({"pages": ["deploy"]}),
        "content/docs/admin/deploy.mdx": PAGE.format(t="Deploy", body="Set `API_KEY`."),
        "public/images/guide/start.webp": b"img",
        "public/images/guide/start.dark.webp": b"img",
    }
    files.update(over)
    return files


class Tree(unittest.TestCase):
    def project(self, files, config=SITE):
        p = Project(files, config)
        self.addCleanup(p.close)
        return p

    def test_no_config_is_silent_and_clean(self):
        r = self.project({"docs/a.md": "# A"}, config=None).check()
        self.assertEqual((r["config"], r["findings"], dc.exit_code(r)), (None, [], 0))

    def test_a_consistent_site_is_clean(self):
        r = self.project(site_files()).check()
        self.assertEqual(r["findings"], [])
        self.assertEqual(dc.exit_code(r), 0)

    def test_images_missing_without_twin_and_orphaned(self):
        files = site_files(**{"public/images/guide/start.dark.webp": None, "public/images/guide/old.webp": b"x"})
        del files["public/images/guide/start.dark.webp"]
        files["content/docs/guide/start.mdx"] = PAGE.format(
            t="Start", body='<Figure src="/images/guide/start.webp" alt="x" />\n\n![gone](/images/guide/gone.webp)')
        self.assertEqual(codes(self.project(files).check()), ["IMAGE_MISSING", "IMAGE_NO_DARK", "IMAGE_ORPHAN"])

    def test_a_single_theme_project_needs_no_twin(self):
        cfg = dict(SITE, images={"dir": "public/images", "urlPrefix": "/images/", "themes": ["default"]})
        files = site_files()
        del files["public/images/guide/start.dark.webp"]
        self.assertEqual(codes(self.project(files, cfg).check()), [])

    def test_broken_links_and_a_leak_into_the_private_root(self):
        files = site_files(**{"content/docs/guide/start.mdx": PAGE.format(
            t="Start", body='<Figure src="/images/guide/start.webp" alt="x" />\n\n[deploy](/admin/deploy) and [x](/guide/nope)')})
        r = self.project(files).check()
        self.assertEqual(codes(r), ["LINK_BROKEN", "ROOT_LEAK"])
        self.assertEqual(dc.exit_code(r), 2)

    def test_findings_carry_the_file_line(self):
        files = {"docs/a.md": "---\ntitle: A\n---\n\nSummary.\n\n[x](nope.md)\n"}
        r = self.project(files, {"nav": "none"}).check()
        self.assertEqual([(f["code"], f["line"]) for f in r["findings"]], [("LINK_BROKEN", 7)])

    def test_links_and_images_inside_code_are_ignored(self):
        body = '<Figure src="/images/guide/start.webp" alt="x" />\n\n`[text](url)`\n\n```md\n![x](/images/none.webp) [y](/nope)\n```'
        files = site_files(**{"content/docs/guide/start.mdx": PAGE.format(t="Start", body=body)})
        self.assertEqual(codes(self.project(files).check()), [])

    def test_meta_json_missing_and_dead_entries(self):
        files = site_files(**{"content/docs/guide/meta.json": json.dumps({"pages": ["start", "gone"]}),
                              "content/docs/guide/extra.mdx": PAGE.format(t="Extra", body="x"),
                              "content/docs/guide/sub/index.mdx": PAGE.format(t="Sub", body="x")})
        r = self.project(files).check()
        self.assertEqual(codes(r), ["NAV_DEAD", "NAV_MISSING", "NAV_MISSING"])

    def test_meta_json_rest_marker_lists_everything(self):
        files = site_files(**{"content/docs/guide/meta.json": json.dumps({"pages": ["start", "..."]}),
                              "content/docs/guide/extra.mdx": PAGE.format(t="Extra", body="x")})
        self.assertEqual(codes(self.project(files).check()), [])

    def test_frontmatter_summary_budget_and_deny(self):
        cfg = dict(SITE, pageBudget=20)
        files = site_files(**{
            "content/docs/guide/start.mdx": "---\ntitle: Start\ntags: [a]\n---\n\n## Straight to a heading\n\nSet API_KEY.\n"
                                            '<Figure src="/images/guide/start.webp" alt="x" />\n' + "\n" * 20})
        self.assertEqual(codes(self.project(files, cfg).check()),
                         ["FRONTMATTER_MISSING", "FRONTMATTER_TAGS", "PAGE_BUDGET", "ROOT_DENY", "SUMMARY_MISSING"])

    def test_deny_patterns_skip_fenced_code_and_other_roots(self):
        files = site_files(**{"content/docs/guide/start.mdx": PAGE.format(
            t="Start", body='<Figure src="/images/guide/start.webp" alt="x" />\n\n```bash\nexport API_KEY=1\n```')})
        self.assertEqual(codes(self.project(files).check()), [])

    def test_accept_drops_a_finding_and_counts_it(self):
        cfg = dict(SITE, accept=[{"code": "IMAGE_ORPHAN", "why": "kept for the changelog"}])
        r = self.project(site_files(**{"public/images/guide/old.webp": b"x"}), cfg).check()
        self.assertEqual((codes(r), r["accepted"]), ([], 1))

    def test_mkdocs_nav(self):
        files = {"mkdocs.yml": "site_name: x\nnav:\n  - Home: index.md\n  - Gone: gone.md\ntheme: material\n",
                 "docs/index.md": "# Home\n\nWhat this is.\n", "docs/extra.md": "# Extra\n\nMore.\n"}
        r = self.project(files, {"docsRoot": "docs"}).check()
        self.assertEqual(codes(r), ["NAV_DEAD", "NAV_MISSING"])

    def test_mkdocs_without_nav_is_file_ordered(self):
        files = {"mkdocs.yml": "site_name: x\n", "docs/index.md": "# Home\n\nWhat this is.\n"}
        self.assertEqual(codes(self.project(files, {"docsRoot": "docs"}).check()), [])

    def test_mdbook_summary(self):
        files = {"src/SUMMARY.md": "# Summary\n\n- [Intro](intro.md)\n", "src/intro.md": "# Intro\n\nHello.\n",
                 "src/other.md": "# Other\n\nHi.\n"}
        self.assertEqual(codes(self.project(files, {"docsRoot": "src", "nav": "auto"}).check()), ["NAV_MISSING"])

    def test_plain_folder_with_relative_links_and_picture_twins(self):
        page = ("# Export\n\nHow to export.\n\n<picture>\n  <source media=\"(prefers-color-scheme: dark)\" "
                "srcset=\"images/menu.dark.png\">\n  <img src=\"images/menu.png\" alt=\"menu\">\n</picture>\n\n"
                "See [importing](importing.md) and [home](./).\n")
        files = {"docs/README.md": "# Docs\n\nThe user docs.\n\n- [Export](export.md)\n", "docs/export.md": page,
                 "docs/importing.md": "# Import\n\nHow to import.\n",
                 "docs/images/menu.png": b"x", "docs/images/menu.dark.png": b"x"}
        cfg = {"docsRoot": "docs", "nav": "none", "images": {"dir": "docs/images", "themes": ["light", "dark"]}}
        self.assertEqual(codes(self.project(files, cfg).check()), [])

    def test_github_wiki_links_by_name_and_sidebar(self):
        files = {"wiki/Home.md": "# Home\n\nWelcome. See [[Getting Started]] and [[the API|API-Reference]].\n",
                 "wiki/_Sidebar.md": "- [[Getting Started]]\n- [[API-Reference]]\n- [[Missing Page]]\n",
                 "wiki/guides/Getting-Started.md": "# Getting started\n\nStart here. Then [ref](API-Reference).\n",
                 "wiki/API-Reference.md": "# API\n\nThe calls.\n", "wiki/Orphan.md": "# Orphan\n\nAlone.\n"}
        cfg = {"target": "wiki:github", "docsRoot": "wiki", "nav": "sidebar"}
        self.assertEqual(codes(self.project(files, cfg).check()), ["NAV_DEAD", "NAV_MISSING"])

    def test_readme_only_reads_just_the_readme(self):
        files = {"README.md": "# Tool\n\nIt does a thing.\n\n![demo](docs/demo.png)\n", "docs/demo.png": b"x",
                 "AGENTS.md": "[broken](nowhere.md)\n"}
        cfg = {"target": "readme", "docsRoot": ".", "include": ["README.md"], "nav": "none"}
        self.assertEqual(codes(self.project(files, cfg).check()), [])


SURFACES = {
    "docsRoot": "docs", "nav": "none", "images": {"dir": "docs/images"},
    "surfaces": [{"name": "export", "code": ["src/export/**"], "pages": ["docs/export.md"],
                  "shots": ["docs/images/export/**"], "group": "export"}],
}


class Changed(unittest.TestCase):
    def setUp(self):
        self.p = Project({"src/export/menu.py": "a = 1\n", "src/other.py": "b = 1\n",
                          "docs/export.md": "# Export\n\nHow.\n\n![m](images/export/menu.png)\n",
                          "docs/images/export/menu.png": b"v1"}, SURFACES, git=True)
        self.addCleanup(self.p.close)

    def changed(self, base="HEAD", **kw):
        return self.p.check(changed=base, tree=False, **kw)

    def test_code_without_docs_is_parity_missing(self):
        self.p.write("src/export/menu.py", "a = 2\n")
        r = self.changed()
        self.assertEqual(codes(r), ["PARITY_MISSING"])
        self.assertIn("capture group export", r["findings"][0]["message"])

    def test_untracked_code_counts(self):
        self.p.write("src/export/new.py", "c = 1\n")
        self.assertEqual(codes(self.changed()), ["PARITY_MISSING"])

    def test_code_outside_every_surface_and_tests_are_quiet(self):
        self.p.write("src/other.py", "b = 2\n")
        self.p.write("src/export/tests/test_menu.py", "x = 1\n")
        self.assertEqual(codes(self.changed()), [])

    def test_pages_without_shots_is_an_info_reminder(self):
        self.p.write("src/export/menu.py", "a = 2\n")
        self.p.write("docs/export.md", "# Export\n\nHow, now.\n\n![m](images/export/menu.png)\n")
        r = self.changed()
        self.assertEqual((codes(r), dc.exit_code(r)), (["SHOTS_UNCHANGED"], 0))

    def test_a_range_with_a_docs_none_line_stands_down(self):
        base = self.p.git("rev-parse", "HEAD").strip()
        self.p.write("src/export/menu.py", "a = 3\n")
        self.p.commit("refactor export\n\nDocs: none, internal rename only.")
        r = self.changed(f"{base}..HEAD")
        self.assertEqual([(f["code"], f["severity"]) for f in r["findings"]], [("PARITY_MISSING", "info")])

    def test_a_note_stands_down_too(self):
        self.p.write("src/export/menu.py", "a = 2\n")
        self.assertEqual(self.changed(note="Docs: n/a, no visible change")["findings"][0]["severity"], "info")


class Stale(unittest.TestCase):
    def setUp(self):
        self.p = Project({"src/export/menu.py": "a = 1\n", "docs/export.md": "# Export\n\nHow.\n",
                          "docs/images/export/menu.png": b"v1"}, SURFACES, git=True)
        self.addCleanup(self.p.close)

    def test_fresh_shot_is_quiet(self):
        self.assertEqual(codes(self.p.check(stale=True, tree=False)), [])

    def test_code_changed_after_the_shot(self):
        self.p.write("src/export/menu.py", "a = 2\n")
        self.p.commit("change the menu")
        self.assertEqual(codes(self.p.check(stale=True, tree=False)), ["SHOT_STALE"])

    def test_the_manifest_records_a_retake_with_identical_bytes(self):
        self.p.write("src/export/menu.py", "a = 2\n")
        sha = self.p.commit("change the menu")
        self.p.write("docs/images/shots.json", json.dumps({"shots": {"export/menu.png": {"commit": sha}}}))
        self.p.commit("retake: same pixels")
        self.assertEqual(codes(self.p.check(stale=True, tree=False)), [])


def run_hook(name, root, payload=None, env=None):
    e = dict(os.environ, CLAUDE_PROJECT_DIR=str(root), **(env or {}))
    r = subprocess.run([sys.executable, "-B", str(PLUGIN / "hooks" / name)], input=json.dumps(payload or {}),
                       capture_output=True, text=True, env=e)
    return r.returncode, r.stdout


class Hooks(unittest.TestCase):
    def test_kernel_holds_its_target(self):
        kernel = dc_kernel()
        self.assertTrue(kernel)
        self.assertLessEqual(len(kernel) // 4, 120)

    def test_kernel_is_silent_without_config(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(run_hook("kernel_inject.py", d), (0, ""))

    def test_kernel_injects_with_config(self):
        p = Project({}, SURFACES)
        self.addCleanup(p.close)
        code, out = run_hook("kernel_inject.py", p.root, {"hook_event_name": "SubagentStart"})
        doc = json.loads(out)["hookSpecificOutput"]
        self.assertEqual((code, doc["hookEventName"]), (0, "SubagentStart"))
        self.assertIn("same change", doc["additionalContext"])

    def test_stop_warns_on_parity_and_is_silent_otherwise(self):
        p = Project({"src/export/menu.py": "a = 1\n", "docs/export.md": "# Export\n\nHow.\n"}, SURFACES, git=True)
        self.addCleanup(p.close)
        self.assertEqual(run_hook("stop_check.py", p.root), (0, ""))
        p.write("src/export/menu.py", "a = 2\n")
        code, out = run_hook("stop_check.py", p.root)
        self.assertEqual(code, 0)
        self.assertIn("surface export changed", json.loads(out)["systemMessage"])
        self.assertEqual(run_hook("stop_check.py", p.root, {"stop_hook_active": True}), (0, ""))

    def test_stop_fails_open_outside_git(self):
        p = Project({"src/export/menu.py": "a = 1\n"}, SURFACES)
        self.addCleanup(p.close)
        self.assertEqual(run_hook("stop_check.py", p.root), (0, ""))


def dc_kernel():
    spec = importlib.util.spec_from_file_location("kernel_inject", PLUGIN / "hooks" / "kernel_inject.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.extract_kernel((PLUGIN / "skills" / "docs-parity" / "SKILL.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
