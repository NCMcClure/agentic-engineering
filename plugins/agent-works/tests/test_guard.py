"""The guard hook: command reading, git asks, generated files, resource locks, run budgets, project rules, the hook."""
import json
import subprocess
import sys
import unittest

from tests.clihelp import HOOKS, Project, load_hook

import common

guard = load_hook("guard")
ENV = {"branch": "feat/x", "agent": None, "locks": {}, "root": "/srv/work/acme"}


def cfg_with(**over):
    return common.merge(common.defaults(), over)


def run(command, cfg=None, tool="Bash", **env):
    return guard.decide(tool, {"command": command}, cfg or common.defaults(), dict(ENV, **env))


def rule(command, cfg=None, tool="Bash", **env):
    d = run(command, cfg, tool, **env)
    return d["rule"] if d else None


class ShellWords(unittest.TestCase):
    def test_separators_and_quotes(self):
        self.assertEqual(guard.shell_words("a b && c 'd e' | f; g || h\ni"),
                         [["a", "b"], ["c", "d e"], ["f"], ["g"], ["h"], ["i"]])
        self.assertEqual(guard.shell_words('git commit -m "a; b | c && d"'), [["git", "commit", "-m", "a; b | c && d"]])
        self.assertEqual(guard.shell_words('X="a b" run --flag=1 2>&1'), [["X=a b", "run", "--flag=1", "2>&1"]])
        self.assertEqual(guard.shell_words("a \\\n b"), [["a", "b"]])
        self.assertEqual(guard.shell_words("a `\r\n b"), [["a", "b"]])

    def test_substitutions_stay_one_word(self):
        self.assertEqual(guard.shell_words("git add $(git diff --name-only | head -3) x"),
                         [["git", "add", "$(git diff --name-only | head -3)", "x"]])
        self.assertEqual(guard.shell_words('echo "$(printf "a;b")" c'), [["echo", '$(printf "a;b")', "c"]])

    def test_heredocs_and_here_strings_are_not_commands(self):
        self.assertEqual(guard.shell_words("cat <<EOF > out.txt\nrm -rf /; git add -A\nEOF\necho done"),
                         [["cat", ">", "out.txt"], ["echo", "done"]])
        self.assertEqual(guard.shell_words("cat <<-'END'\n\tgit push --force\n\tEND\nls"), [["cat"], ["ls"]])
        self.assertEqual(guard.shell_words("x -m @'\none; two\n'@ tail"), [["x", "-m", "one; two", "tail"]])
        self.assertEqual(guard.shell_words('x @"\nbody | more\n"@'), [["x", "body | more"]])

    def test_assignments(self):
        seg = guard.shell_words('$env:AW_RUN = "verify: because of this"; AW_AGENT=a1 X=2 tool; export Y=3; $env:Z="4"')
        self.assertEqual(guard.assignments(seg), {"AW_RUN": "verify: because of this", "AW_AGENT": "a1", "X": "2", "Y": "3", "Z": "4"})

    def test_readers(self):
        w = lambda c: guard.command_words(guard.shell_words(c)[0])
        for c in ("git log --grep push", "git -C x show HEAD", "grep -rn foo .", "X=1 cat file", "sed -n 1,3p f",
                  "Get-Content f", "gh pr view 1", "find . -name x", "git commit -m 'run the tool'", "# a comment"):
            self.assertTrue(guard.is_reader(w(c)), c)
        for c in ("git push", "sed -i s/a/b/ f", "find . -delete", "python tool.py", "& 'C:/x/tool.exe' run", "git stash"):
            self.assertFalse(guard.is_reader(w(c)), c)


class GitAsks(unittest.TestCase):
    def test_force_push(self):
        for c in ("git push --force-with-lease origin feat/x", "git push -f", "git push --force", "git push origin +feat/x",
                  "git -C sub push -uf origin x", "cd a && git push --force"):
            d = run(c)
            self.assertEqual((c, d and d["rule"], d and d["kind"]), (c, "force-push", "ask"))
        for c in ("git push -u origin feat/x", "git push --follow-tags", "git commit -m 'git push --force'",
                  "echo git push --force", "git log --grep='push --force'", "cat <<EOF\ngit push --force\nEOF"):
            self.assertEqual((c, run(c)), (c, None))
        deny = cfg_with(guard={"defaultBranch": {"forcePush": "deny"}})
        self.assertEqual(run("git push -f", deny)["kind"], "deny")
        off = cfg_with(guard={"defaultBranch": {"forcePush": "off"}})
        self.assertIsNone(run("git push -f", off))

    def test_commit_on_the_default_branch(self):
        d = run("git commit -m x", branch="main")
        self.assertEqual((d["rule"], d["kind"]), ("default-branch-commit", "ask"))
        self.assertEqual(rule("git add a.txt && git commit -m x", branch="master"), "default-branch-commit")
        self.assertIsNone(run("git commit -m x", branch="feat/x"))
        self.assertIsNone(run("git commit --dry-run -m x", branch="main"))
        self.assertIsNone(run("git log -1 && echo git commit", branch="main"))
        trunk = cfg_with(guard={"defaultBranch": {"names": ["trunk"], "commit": "deny"}})
        self.assertIsNone(run("git commit -m x", trunk, branch="main"))
        self.assertEqual(run("git commit -m x", trunk, branch="trunk")["kind"], "deny")
        # a refusal wins over a question
        self.assertEqual(rule("git commit -am x", branch="main"), "staging-blanket")


class Files(unittest.TestCase):
    CFG = cfg_with(guard={"generated": [
        {"match": r"(^|/)src/gen/", "how": "Change src/schema and run `make codegen`."},
        {"match": r"^docs/layout\.md$", "how": "Codegen writes it."},
        {"match": "([broken", "how": "never matches"},
    ]})

    def edit(self, path, tool="Edit", **env):
        key = "notebook_path" if tool == "NotebookEdit" else "file_path"
        return guard.decide(tool, {key: path}, self.CFG, dict(ENV, **env))

    def test_generated_files(self):
        d = self.edit("/srv/work/acme/pkg/src/gen/layout.h")
        self.assertEqual((d["rule"], d["kind"]), ("generated-file", "deny"))
        self.assertIn("make codegen", d["message"])
        self.assertEqual(self.edit("Q:\\work\\acme\\pkg\\src\\gen\\layout.lua", root="Q:/work/acme")["kind"], "deny")
        self.assertEqual(self.edit("docs/layout.md", "Write")["rule"], "generated-file")
        self.assertEqual(self.edit("docs/layout.md", "MultiEdit")["rule"], "generated-file")
        self.assertEqual(self.edit("docs/layout.md", "NotebookEdit")["rule"], "generated-file")
        self.assertIsNone(self.edit("pkg/src/schema/frame.ts"))
        self.assertIsNone(self.edit("other/docs/layout.md"))
        self.assertIsNone(guard.decide("Read", {"file_path": "docs/layout.md"}, self.CFG, ENV))

    def test_relative_to_where_the_tool_runs(self):
        self.assertEqual(self.edit("gen/a.h", cwd="/srv/work/acme/pkg/src")["rule"], "generated-file")
        self.assertIsNone(self.edit("../gen.md", cwd="/srv/work/acme/pkg/src"))


class ResourceLocks(unittest.TestCase):
    CFG = cfg_with(resources={
        "editor": {"scope": "project", "match": [r"scripts/(render|run-tests)\.ps1", r"\bbuild\.sh\b"], "unless": [r"(^|\s)(-List|--dry-run)\b"]},
        "sim": {"scope": "machine", "match": [r"run-in-session\.ps1"]},
    }, lockOrder=["sim", "editor"])
    ED = "powershell -NoProfile -File scripts/run-tests.ps1"
    SIM = "powershell -NoProfile -File tools/run-in-session.ps1 app run demo --duration 60"

    def test_without_the_lock_or_without_a_name_starting_is_refused(self):
        self.assertEqual(rule(self.ED, self.CFG, "PowerShell"), "resource-lock")
        self.assertEqual(rule(f'$env:AW_AGENT = "a1"; {self.ED}', self.CFG, "PowerShell"), "resource-lock")
        d = run(f'$env:AW_AGENT = "a1"; {self.ED}', self.CFG, "PowerShell", locks={"editor": "a2"})
        self.assertIn("held by a2", d["message"])
        self.assertIn("aw lock run editor", d["message"])
        self.assertEqual(rule(self.SIM, self.CFG, "PowerShell", locks={"editor": "a1"}), "resource-lock")
        self.assertEqual(rule(f"AW_AGENT=a1 ./build.sh all", self.CFG, locks={"sim": "a1"}), "resource-lock")
        both = run(f"{self.ED}; {self.SIM}", self.CFG, "PowerShell")
        self.assertIn("sim, editor", both["message"])

    def test_the_holder_goes_through(self):
        self.assertIsNone(run(f'$env:AW_AGENT = "a1"; {self.ED}', self.CFG, "PowerShell", locks={"editor": "a1"}))
        self.assertIsNone(run(f"AW_AGENT=a1 ./build.sh all", self.CFG, locks={"editor": "a1"}))
        self.assertIsNone(run(f"PL_AGENT=a1 ./build.sh all", self.CFG, locks={"editor": "a1"}))  # the alias
        self.assertIsNone(run("./build.sh all", self.CFG, locks={"editor": "a1"}, agent="a1"))  # the session's own name
        named = cfg_with(resources=self.CFG["resources"], guard={"agentVar": "ACME_AGENT"})
        self.assertIsNone(run("ACME_AGENT=a1 ./build.sh", named, locks={"editor": "a1"}))

    def test_the_wrapper_holds_the_lock(self):
        self.assertIsNone(run(f'aw lock run editor --for "tests, 5 min" -- {self.ED}', self.CFG, "PowerShell"))
        self.assertIsNone(run('aw lock run editor --for "build" -- "./build.sh all && ./build.sh test"', self.CFG))
        self.assertIsNone(run(f'python -B "$CLAUDE_PLUGIN_ROOT/cli/aw.py" lock run editor --for x -- ./build.sh', self.CFG))
        # the wrong resource, or a lease, holds nothing
        self.assertEqual(rule(f"aw lock run sim --for x -- ./build.sh", self.CFG), "resource-lock")
        self.assertEqual(rule(f"aw lease gpu --share 0.5 --for x -- ./build.sh", self.CFG), "resource-lock")
        self.assertIsNone(run(f"aw lock run sim --for x -- aw lock run editor --for x -- ./build.sh && {self.SIM}".replace(f" && {self.SIM}", ""), self.CFG))

    def test_what_starts_nothing_needs_no_lock(self):
        for c in (f"{self.ED} -List", "./build.sh --dry-run", "git log --grep run-tests.ps1", "grep -rn build.sh .",
                  'aw lock acquire editor --as a1 --for "run-tests.ps1"', 'aw note "build.sh is slow today"',
                  "git commit -m 'Speed up build.sh'", "cat scripts/render.ps1", "echo ./build.sh", "make test"):
            self.assertEqual((c, run(c, self.CFG)), (c, None))

    def test_the_store_is_read_by_its_documented_layout(self):
        p = Project(config={"resources": {"editor": {"scope": "project", "match": ["build\\.sh"]},
                                          "gpu": {"scope": "machine", "match": ["train\\.py"]}}})
        try:
            import os
            old = os.environ.get("AGENT_WORKS_HOME")
            os.environ["AGENT_WORKS_HOME"] = str(p.home)
            try:
                cfg = common.load_config(p.root)
                env = {"branch": "x", "agent": None, "root": str(p.root), "cwd": str(p.root)}
                self.assertEqual(guard.lock_holders(cfg, env), ({}, set()))
                pid = common.project_id(p.root)
                stamp = common.now_iso()
                common.write_json(p.home / "locks" / pid / "editor.lock",
                                  {"agent": "a1", "project": pid, "for": "x", "pid": os.getpid(), "since": stamp, "refreshed": stamp})
                common.write_json(p.home / "locks" / "machine" / "gpu.lock",
                                  {"agent": "b2", "project": "other-00000000", "for": "y", "pid": os.getpid(), "since": stamp, "refreshed": stamp})
                self.assertEqual(guard.lock_holders(cfg, env, "a1"), ({"editor": "a1", "gpu": "b2"}, {"editor"}))
                self.assertIsNone(guard.decide("Bash", {"command": "AW_AGENT=a1 ./build.sh"}, cfg, env))
                self.assertEqual(guard.decide("Bash", {"command": "AW_AGENT=a1 python train.py"}, cfg, env)["rule"], "resource-lock")
            finally:
                if old is None:
                    os.environ.pop("AGENT_WORKS_HOME", None)
                else:
                    os.environ["AGENT_WORKS_HOME"] = old
        finally:
            p.close()


class RunBudget(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        for i in range(40):
            self.p.write(f"shots/item{i % 4}__view{i}/shot.json", "{}")
        self.p.write("groups.json", json.dumps({"smoke": ["item1__*", "!*view5"], "one": ["*view7"]}))
        self.cfg = cfg_with(runs=[{
            "id": "render", "match": [r"render\.(py|ps1)\b", r"\bsuite\s+iterate\b"], "reasonVar": "AW_RUN", "free": 3, "fullAt": 100,
            "count": {"names": True, "allFlags": ["--all"], "groupFlag": "--group", "matchFlag": "--match",
                      "valueFlags": ["--out", "--port"], "groupsFile": "groups.json", "itemsDir": "shots"},
            "dryFlags": ["--dry-run", "--list", "--skip-render"]}])
        self.env = dict(ENV, root=str(self.p.root))

    def tearDown(self):
        self.p.close()

    def run_(self, c, tool="Bash"):
        return guard.decide(tool, {"command": c}, self.cfg, self.env)

    def test_up_to_three_named_items_go_through(self):
        for c in ("python render.py a b c", "python render.py a,b,c --out dir --port 9", "suite iterate a b", "python render.py"):
            self.assertEqual((c, self.run_(c)), (c, None))

    def test_a_fourth_is_refused_with_the_way_out(self):
        d = self.run_("python render.py a b c d")
        self.assertEqual((d["kind"], d["rule"]), ("deny", "run-budget"))
        self.assertIn('AW_RUN="verify:', d["message"])
        self.assertIn("4 items", d["message"])
        self.assertEqual(self.run_("PASSES=beauty suite iterate a b c d")["kind"], "deny")

    def test_all_is_refused_in_every_spelling(self):
        for c in ("python render.py --all", "powershell -File render.ps1 -All", "suite iterate --all --engine x",
                  "cd x && python render.py --all 2>&1 | tail -5"):
            d = self.run_(c)
            self.assertEqual((c, d and d["kind"]), (c, "deny"))
            self.assertIn('"full:', d["message"])

    def test_all_narrowed_to_a_few_is_an_iteration(self):
        self.assertIsNone(self.run_("python render.py --all --match *view7"))
        self.assertEqual(self.run_("python render.py --all --match item1__*")["kind"], "deny")

    def test_groups(self):
        self.assertIsNone(self.run_("suite iterate --group one"))
        d = self.run_("suite iterate --group smoke")
        self.assertEqual(d["kind"], "deny")
        self.assertIn("9 items", d["message"])  # 10 of item1, less view5
        self.assertIsNone(self.run_("suite iterate --group smoke --match *view9"))

    def test_an_unknown_group_is_refused_rather_than_guessed(self):
        self.assertEqual(self.run_("suite iterate --group no-such-group")["kind"], "deny")

    def test_listing_and_dry_runs_start_nothing(self):
        for c in ("python render.py --all --list", "suite iterate --all --dry-run", "suite iterate --group smoke --skip-render",
                  "powershell -File render.ps1 -All -List", "suite compare --group smoke"):
            self.assertEqual((c, self.run_(c)), (c, None))

    def test_a_stated_reason_lets_a_larger_run_through_and_is_on_record(self):
        d = self.run_('$env:AW_RUN = "verify: dither works on one wheel, checking the others"; python render.py a b c d e', "PowerShell")
        self.assertEqual(d["kind"], "warn")
        self.assertIn("5 items", d["notice"])
        self.assertIn("verify: dither works", d["notice"])
        self.assertEqual(self.run_('AW_RUN="full: the work is finished, the one pass before the baseline" python render.py --all')["kind"], "warn")

    def test_verify_does_not_buy_everything_and_a_token_reason_buys_nothing(self):
        self.assertEqual(self.run_('AW_RUN="verify: checking everything after the change" python render.py --all')["kind"], "deny")
        d = self.run_('AW_RUN="full: ok" python render.py --all')
        self.assertEqual(d["kind"], "deny")
        self.assertIn("too short", d["message"])
        self.assertIn("must start with", self.run_('AW_RUN="because I want to see it all" python render.py a b c d')["message"])

    def test_talking_about_a_run_is_not_running_it(self):
        for c in ("git grep -n 'render.py --all' docs", "git log --oneline -- tools/render.py",
                  "git commit -m 'render.py --all is slow'", "echo python render.py --all", 'aw note "ran render.py --all"'):
            self.assertEqual((c, self.run_(c)), (c, None))

    def test_without_an_items_folder_all_needs_full(self):
        cfg = cfg_with(runs=[{"id": "t", "match": [r"\bpytest\b"], "free": 5, "count": {"names": False, "allFlags": ["--everything"]}}])
        self.assertIsNone(guard.decide("Bash", {"command": "pytest tests/a.py tests/b.py -k x"}, cfg, self.env))
        self.assertEqual(guard.decide("Bash", {"command": "pytest --everything"}, cfg, self.env)["kind"], "deny")
        ok = guard.decide("Bash", {"command": 'AW_RUN="full: release candidate, the one pass" pytest --everything'}, cfg, self.env)
        self.assertEqual(ok["kind"], "warn")


class ProjectRules(unittest.TestCase):
    CFG = cfg_with(guard={"rules": [
        {"id": "no-direct-launch", "decision": "deny", "match": [r"(^|[\\/\s])sim(\.exe)?(\s|$)", r"steam://run"],
         "unless": [r"run-in-session"], "message": "Launch through the session runner."},
        {"id": "live-mode", "decision": "deny", "match": [r"--live-wheel|LIVE_MODE"], "skipReaders": False, "scope": "command",
         "message": "Live mode is started by a person."},
        {"id": "slow-import", "decision": "warn", "match": [r"import\.ps1.*\s-All\b.*\s-Force\b"], "message": "Name what changed."},
        {"id": "release-only", "decision": "ask", "match": [r"\bnpm publish\b"], "when": {"branch": ["main"]}, "message": "Publishing."},
        {"id": "lockfile", "decision": "ask", "scope": "file", "match": [r"(^|/)package-lock\.json$"], "message": "Use npm install."},
        {"id": "broken", "decision": "deny", "match": ["([a"], "message": "never"},
        {"id": "off", "decision": "off", "match": ["."], "message": "never"},
        "not a rule",
    ]})

    def test_segment_rules_skip_readers(self):
        d = run('& "C:\\Games\\sim.exe" -fast', self.CFG, "PowerShell")
        self.assertEqual((d["rule"], d["kind"], d["message"]), ("no-direct-launch", "deny", "Launch through the session runner."))
        self.assertEqual(rule("sim --headless", self.CFG), "no-direct-launch")
        self.assertEqual(rule("start steam://run/123", self.CFG), "no-direct-launch")
        self.assertIsNone(run("powershell -File tools/run-in-session.ps1 sim --headless", self.CFG))
        for c in ("tasklist | grep -i sim.exe", "git log --grep 'sim --headless'", "echo sim", "git commit -m 'sim launch'"):
            self.assertEqual((c, run(c, self.CFG)), (c, None))

    def test_a_rule_may_read_readers_too(self):
        self.assertEqual(rule("echo '{\"mode\":\"LIVE_MODE\"}' > scenario.json", self.CFG), "live-mode")
        self.assertEqual(rule("app run demo --live-wheel", self.CFG), "live-mode")
        self.assertIsNone(run("app run demo", self.CFG))

    def test_warn_ask_branch_and_file_scope(self):
        d = run("powershell -File import.ps1 -All -Force", self.CFG, "PowerShell")
        self.assertEqual((d["rule"], d["kind"]), ("slow-import", "warn"))
        self.assertIsNone(run("npm publish", self.CFG, branch="feat/x"))
        self.assertEqual(run("npm publish", self.CFG, branch="main")["kind"], "ask")
        d = guard.decide("Edit", {"file_path": "web/package-lock.json"}, self.CFG, ENV)
        self.assertEqual((d["rule"], d["kind"]), ("lockfile", "ask"))
        self.assertIsNone(run("cat web/package-lock.json && rm web/package-lock.json", self.CFG))


class Hook(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={"guard": {"ownerFiles": ["local.ini"], "generated": [{"match": "^gen/", "how": "Run codegen."}]}})

    def tearDown(self):
        self.p.close()

    def payload(self, command=None, file_path=None, tool=None, cwd=None):
        return {"tool_name": tool or ("Edit" if file_path else "Bash"), "cwd": str(cwd or self.p.root),
                "tool_input": {"file_path": file_path} if file_path else {"command": command}}

    def test_deny_ask_and_allow(self):
        code, out, err = self.p.hook("guard", self.payload("git add -A"))
        self.assertEqual((code, err), (0, ""))
        doc = json.loads(out)["hookSpecificOutput"]
        self.assertEqual((doc["hookEventName"], doc["permissionDecision"]), ("PreToolUse", "deny"))
        self.assertIn("Stage files by path", doc["permissionDecisionReason"])
        code, out, _ = self.p.hook("guard", self.payload(file_path=str(self.p.root / "local.ini")))
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "ask")
        code, out, _ = self.p.hook("guard", self.payload(file_path="gen/x.h", tool="Write"))
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertEqual(self.p.hook("guard", self.payload("git add src/a.py && git commit -m x")), (0, "", ""))
        self.assertEqual(self.p.hook("guard", self.payload("ls", tool="Read")), (0, "", ""))

    def test_every_decision_is_logged_in_the_store(self):
        self.p.hook("guard", self.payload("git add -A"), AW_AGENT="a7")
        self.p.hook("guard", self.payload("git status"))
        log = self.p.home / "projects" / common.project_id(self.p.root) / "guard.log"
        lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(lines), 1)
        self.assertEqual((lines[0]["decision"], lines[0]["rule"], lines[0]["agent"], lines[0]["subject"]),
                         ("deny", "staging-blanket", "a7", "git add -A"))
        self.p.write(".agents/agent-works.json", json.dumps({"guard": {"log": False}}))
        log.unlink()
        self.p.hook("guard", self.payload("git add -A"))
        self.assertFalse(log.exists())

    def test_the_commit_ask_reads_the_branch_of_the_checkout(self):
        (self.p.root / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        _, out, _ = self.p.hook("guard", self.payload("git commit -m x"))
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "ask")

    def test_inert_without_a_config_and_open_on_failure(self):
        bare = Project()
        try:
            self.assertEqual(bare.hook("guard", self.payload("git add -A", cwd=bare.root)), (0, "", ""))
        finally:
            bare.close()
        for raw in ("", "not json", "[1, 2]", '{"cwd": 5}', '{"tool_name": "Bash", "tool_input": "x", "cwd": %s}' % json.dumps(str(self.p.root))):
            r = subprocess.run([sys.executable, "-B", str(HOOKS / "guard.py")], input=raw, capture_output=True, text=True,
                               cwd=str(self.p.root), env=self.p.env(), timeout=60)
            self.assertEqual((raw, r.returncode, r.stdout), (raw, 0, ""))
        self.p.write(".agents/agent-works.json", "{ broken")
        code, out, _ = self.p.hook("guard", self.payload("git add -A"))  # the defaults still guard
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_the_fast_exit_imports_nothing(self):
        bare = Project()
        try:
            probe = ("import sys, io, json, runpy\n"
                     "before = set(sys.modules)\n"
                     f"sys.stdin = io.TextIOWrapper(io.BytesIO(json.dumps({{'tool_name': 'Bash', 'tool_input': {{'command': 'x'}}, 'cwd': {str(bare.root)!r}}}).encode()))\n"
                     "sys.argv = ['guard.py']\n"
                     "try:\n"
                     f"    runpy.run_path({str(HOOKS / 'guard.py')!r}, run_name='__main__')\n"
                     "except SystemExit:\n    pass\n"
                     "new = set(sys.modules) - before\n"
                     "print(sorted(m for m in new if m in ('re', 'common', 'argparse', 'subprocess', 'coord')))\n")
            r = subprocess.run([sys.executable, "-B", "-c", probe], capture_output=True, text=True, env=bare.env(), timeout=60)
            self.assertEqual(r.stdout.strip(), "[]", r.stderr)
        finally:
            bare.close()

    def test_explain(self):
        r = subprocess.run([sys.executable, "-B", str(HOOKS / "guard.py"), "--explain", "git add -A", "--cwd", str(self.p.root), "--json"],
                           capture_output=True, text=True, env=self.p.env(), timeout=60)
        doc = json.loads(r.stdout)
        self.assertEqual((doc["decision"], doc["rule"], doc["segments"]), ("deny", "staging-blanket", [["git", "add", "-A"]]))
        r = subprocess.run([sys.executable, "-B", str(HOOKS / "guard.py"), "--explain", "--file", "gen/a.h", "--cwd", str(self.p.root)],
                           capture_output=True, text=True, env=self.p.env(), timeout=60)
        self.assertIn("decision: deny   rule: generated-file", r.stdout)
        r = subprocess.run([sys.executable, "-B", str(HOOKS / "guard.py"), "--explain", "git status", "--cwd", str(self.p.root)],
                           capture_output=True, text=True, env=self.p.env(), timeout=60)
        self.assertIn("decision: allow", r.stdout)
        self.assertFalse((self.p.home / "projects").exists())  # explaining is not logged


if __name__ == "__main__":
    unittest.main()
