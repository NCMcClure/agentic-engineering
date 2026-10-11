"""The dispatcher, the launchers and the hooks file."""
import json
import os
import shutil
import subprocess
import unittest

from tests.clihelp import CLI, PLUGIN, Project

import aw


class Dispatcher(unittest.TestCase):
    def setUp(self):
        self.p = Project()

    def tearDown(self):
        self.p.close()

    def test_help_lists_every_command(self):
        code, out, err = self.p.aw("--help")
        self.assertEqual((code, err), (0, ""))
        for _module, commands, _text in aw.MODULES:
            for c in commands:
                self.assertRegex(out, rf"(?m)^  [a-z, ]*\b{c}\b")
        self.assertIn("exit codes: 0 clean, 1 warnings or not now, 2 critical or a usage error", out)
        self.assertEqual(self.p.aw()[0], 0)

    def test_the_commands_of_this_plugin_s_own_modules_are_available(self):
        _, failed = aw.build_parser()
        mine = {"setup", "doctor", "status", "hubs", "twins", "memory", "decisions", "links", "dup"}
        self.assertEqual(sorted(mine & set(failed)), [], failed)

    def test_names_other_plugins_rely_on(self):
        """Named in other plugins' skill text: they must stay under these names."""
        parser, failed = aw.build_parser()
        if failed:
            self.skipTest(f"modules of other owners are not importable here: {sorted(failed)}")
        for argv in (["hubs", ".", "--json"], ["twins"], ["memory", "new", "f", "s", "--type", "learning", "--description", "d"],
                     ["decisions", "new", "t"], ["kanban", "owe", "--ref", "PR 1", "--needs", "a GPU", "Full suite"], ["sys", "--quiet-for", "timing"], ["note", "text"],
                     ["claim", "counter"], ["lock", "run", "gpu", "--for", "x", "--", "echo", "hi"],
                     ["lease", "gpu", "--for", "x", "--", "echo", "hi"]):
            try:
                args = parser.parse_args(argv)
            except SystemExit as e:  # --help exits 0; a parse error exits 2
                self.assertEqual((argv, e.code), (argv, 0))
                continue
            self.assertTrue(callable(args.func), argv)

    def test_unknown_command_and_usage_errors_exit_2(self):
        code, out, err = self.p.aw("no-such-command")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("no command 'no-such-command'", err)
        self.assertEqual(self.p.aw("hubs", "--no-such-flag")[0], 2)

    def test_a_broken_module_does_not_break_the_others(self):
        saved = list(aw.MODULES)
        try:
            aw.MODULES.insert(0, ("no_such_module_xyz", ("ghost",), "never there"))
            parser, failed = aw.build_parser()
            self.assertIn("no_such_module_xyz", failed)
            self.assertIn("ghost", aw._help_text(failed))
            self.assertIn("(unavailable)", aw._help_text(failed))
            self.assertTrue(callable(parser.parse_args(["hubs"]).func))
            self.assertEqual(aw.main(["ghost"]), 2)
        finally:
            aw.MODULES[:] = saved

    def test_root_option(self):
        self.p.write("src/deep/a.py", "x")
        elsewhere = Project(git=False)
        try:
            for argv in (("--root", str(self.p.root), "hubs", "--json"), ("hubs", "--json", "--root", str(self.p.root)),
                         (f"--root={self.p.root}", "hubs", "--json")):
                code, out, _ = self.p.aw(*argv, cwd=elsewhere.root)
                self.assertEqual((code, json.loads(out)["summary"]["warning"]), (1, 3), argv)
            self.assertEqual(self.p.aw("--root", str(self.p.root / "nope"), "hubs")[0], 2)
        finally:
            elsewhere.close()

    def test_one_json_document_of_one_shape_from_every_finding_list(self):
        for argv in (("hubs", ".", "--json"), ("memory", "lint", "--json"), ("decisions", "lint", "--json"), ("links", "--json"),
                     ("dup", "--json"), ("doctor", "--json"), ("twins", "--check", "--json"), ("kanban", "lint", "--json")):
            code, out, err = self.p.aw(*argv)
            doc = json.loads(out)
            self.assertEqual((argv, code, doc["summary"], doc["findings"]), (argv, 0, {"critical": 0, "warning": 0, "info": 0}, []))

    def test_no_bytecode_is_left_behind(self):
        self.p.aw("doctor")
        self.assertEqual([p for p in PLUGIN.rglob("__pycache__") if "node_modules" not in p.parts], [])


class Shipping(unittest.TestCase):
    def test_hooks_json(self):
        doc = json.loads((PLUGIN / "hooks" / "hooks.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(doc), ["description", "hooks", "modules"])
        self.assertEqual(doc["modules"], ["./kanban/register.tsx"])
        pre = doc["hooks"]["PreToolUse"][0]
        self.assertEqual(pre["matcher"], "Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit")
        for event, script in (("PreToolUse", "guard.py"), ("SessionStart", "session.py")):
            hook = doc["hooks"][event][0]["hooks"][0]
            self.assertEqual(hook["type"], "command")
            self.assertIn("${CLAUDE_PLUGIN_ROOT}/hooks/" + script, hook["command"])
            self.assertIn("WindowsApps", hook["command"])           # the Store stub is not a Python
            self.assertTrue(hook["command"].endswith("|| true"))    # a missing interpreter never blocks a tool
            self.assertTrue((PLUGIN / "hooks" / script).is_file())

    def test_launchers(self):
        sh = (PLUGIN / "bin" / "aw").read_bytes()
        cmd = (PLUGIN / "bin" / "aw.cmd").read_bytes()
        self.assertTrue(sh.startswith(b"#!/bin/sh\n"))
        for data in (sh, cmd):
            self.assertNotIn(b"\r", data)
            self.assertIn(b"WindowsApps", data)
            self.assertIn(b"aw.py", data)
        p = Project()
        try:
            launcher = [str(PLUGIN / "bin" / "aw.cmd")] if os.name == "nt" else ["sh", str(PLUGIN / "bin" / "aw")]
            r = subprocess.run([*launcher, "hubs", ".", "--json"], cwd=str(p.root), capture_output=True, text=True,
                               encoding="utf-8", env=p.env(), timeout=60)
            self.assertEqual((r.returncode, json.loads(r.stdout)["findings"]), (0, []), r.stderr)
            if os.name == "nt" and shutil.which("sh"):
                r = subprocess.run(["sh", (PLUGIN / "bin" / "aw").as_posix(), "no-such"], cwd=str(p.root), capture_output=True,
                                   text=True, encoding="utf-8", env=p.env(), timeout=60)
                self.assertEqual(r.returncode, 2, r.stderr)
        finally:
            p.close()

    def test_no_machine_paths_in_my_files(self):
        import re

        bad = re.compile(r"(/fast/|/Users/|/home/[a-z]|\b[A-Z]:\\\\?Users\b|Personal Projects)")
        names = ["bin/aw", "bin/aw.cmd", "hooks/hooks.json", "hooks/guard.py", "hooks/session.py", "core/references/guard-config.md",
                 *[f"cli/{n}.py" for n in ("aw", "common", "hubs", "twins", "memory", "decisions", "links", "dup", "status", "doctor", "setup")]]
        for name in names:
            path = PLUGIN / name
            if path.is_file():
                self.assertIsNone(bad.search(path.read_text(encoding="utf-8")), name)
        self.assertTrue((CLI / "aw.py").is_file())


if __name__ == "__main__":
    unittest.main()
