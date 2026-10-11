"""The guard's staging rules: the owner's files are never staged, by any spelling. (Made-up paths throughout.)"""
import unittest

from tests.clihelp import load_hook

import common

guard = load_hook("guard")

HOST = "apps/desktop/Host"
OWNER_FILES = [
    ".editor/settings.json",
    f"{HOST}/Config/LocalEditor.ini",
    f"{HOST}/Host.project",
    f"{HOST}/Config/LocalEngine.ini",
    f"{HOST}/Config/LocalGame.ini",
    f"{HOST}/.toolconfig",
    f"{HOST}/Content/Maps/",
]
ROOT = "/srv/work/acme"


def config(**guard_over):
    cfg = common.defaults()
    cfg["guard"]["ownerFiles"] = list(OWNER_FILES)
    cfg["guard"].update(guard_over)
    return cfg


ENV = {"branch": "feat/x", "agent": None, "locks": {}}


def run(command, tool="Bash", env=None, cfg=None):
    return guard.decide(tool, {"command": command}, cfg or config(), dict(ENV, **(env or {})))


def rule(command, env=None, tool="Bash"):
    d = run(command, tool, env)
    return d["rule"] if d else None


class OwnerFiles(unittest.TestCase):
    def test_the_list_is_the_one_the_edit_rule_reads(self):
        env = dict(ENV, root=ROOT)
        for f in OWNER_FILES:
            for root, sep in ((ROOT, "/"), ("Q:\\work\\acme", "\\")):
                path = root + sep + f.replace("/", sep) + ("Main.map" if f.endswith("/") else "")
                d = guard.decide("Edit", {"file_path": path}, config(), dict(ENV, root=root))
                self.assertEqual((f, d and d["rule"], d and d["kind"]), (f, "owner-file-edit", "ask"))
        self.assertIsNone(guard.decide("Edit", {"file_path": f"{HOST}/Config/LocalInput.ini"}, config(), env))
        # the same name somewhere else in the checkout is not the owner's file
        self.assertIsNone(guard.decide("Edit", {"file_path": f"{ROOT}/pkg/.editor/settings.json"}, config(), env))
        # ... but in another checkout the path is read by its tail
        d = guard.decide("Write", {"file_path": "/srv/other/tree/.editor/settings.json"}, config(), env)
        self.assertEqual(d["rule"], "owner-file-edit")
        d = guard.decide("Edit", {"file_path": f"{ROOT}/{HOST}/Host.project"}, config(ownerFilesEdit="deny"), env)
        self.assertEqual(d["kind"], "deny")
        self.assertIsNone(guard.decide("Edit", {"file_path": f"{ROOT}/{HOST}/Host.project"}, config(ownerFilesEdit="off"), env))

    def test_the_files_themselves(self):
        files = [f"{HOST}/Host.project", f"{HOST}/Config/LocalEngine.ini", f"{HOST}/Config/LocalGame.ini",
                 f"{HOST}/.toolconfig", f"{HOST}/Content/Maps", f"{HOST}/Content/Maps/", f"{HOST}/Content/Maps/Main.map",
                 HOST.replace("/", "\\") + "\\Config\\LocalEngine.ini", f"./{HOST}/../Host/.toolconfig",
                 "-f .editor/settings.json"]
        for f in files:
            for verb in ("git add", "git stage", "git commit -m x", "git commit -m x --", "git add tools/dev/guard.ts"):
                d = run(f"{verb} {f}", "PowerShell")
                self.assertEqual((verb, f, d and d["rule"], d and d["kind"]), (verb, f, "staging-owner-files", "deny"))

    def test_the_refusal_names_the_files_and_says_to_stage_by_exact_path(self):
        d = run("git add apps")
        self.assertEqual(d["kind"], "deny")
        for f in (f"{HOST}/Host.project", f"{HOST}/Config/LocalEngine.ini", f"{HOST}/Config/LocalGame.ini",
                  f"{HOST}/.toolconfig", f"{HOST}/Content/Maps/"):
            self.assertIn(f, d["message"])
        self.assertNotIn(".editor/settings.json", d["message"])
        self.assertIn("exact paths", d["message"])
        self.assertNotIn(".project", run(f"git add {HOST}/Config")["message"])

    def test_every_folder_above_them_in_both_shells(self):
        dirs = ["apps", "apps/", "apps/desktop", "apps\\desktop\\", HOST, f"{HOST}/Config", f"{HOST}/Content",
                f'"{HOST}"', f"'{HOST}/Config/'", ":/apps", ":(top)apps/desktop", "tools/../apps"]
        for d in dirs:
            for tool in ("Bash", "PowerShell"):
                for c in (f"git add {d}", f"git add docs/README.md {d}; git commit -m x", f'git commit -m "paint" {d}',
                          f'git commit --only -m "paint" -- {d}'):
                    self.assertEqual((c, rule(c, None, tool)), (c, "staging-owner-files"))

    def test_the_whole_tree(self):
        for c in ("git add .", "git add :/", "git add '*'", "git add -A", "git add --all", "git add -u",
                  "git add --update", "git add -u tools", "git add -Av", "git stage -A", "git add --no-ignore-removal",
                  "git commit -a -m x", "git commit --all -m x", "git commit -qam x", "git -C apps add .",
                  "git -c core.autocrlf=false add -A"):
            d = run(c)
            self.assertEqual((c, d and d["kind"], d and d["rule"]), (c, "deny", "staging-blanket"))
        self.assertIn(f"{HOST}/Host.project", run("git add -A")["message"])

    def test_blanket_staging_is_a_setting(self):
        ask = config(staging={"blanket": "ask", "unseen": "deny"})
        self.assertEqual(run("git add -A", cfg=ask)["kind"], "ask")
        off = config(staging={"blanket": "off", "unseen": "deny"})
        # with the blanket rule off, the whole tree still takes the owner's files
        self.assertEqual(run("git add .", cfg=off)["rule"], "staging-owner-files")
        self.assertEqual(run("git add -A", cfg=off)["rule"], "staging-owner-files")
        none = common.defaults()
        none["guard"]["staging"]["blanket"] = "off"
        self.assertIsNone(run("git add -A", cfg=none))
        self.assertEqual(run("git add -A", cfg=common.defaults())["rule"], "staging-blanket")

    def test_globs_that_reach_them(self):
        for g in ("apps/*", "'apps/**'", "app*", f"{HOST}/*.project", f"'{HOST}/Config/*.ini'",
                  f"{HOST}/Config/Local[EG]*.ini", f"{HOST}/Config/LocalGam?.ini", "'*.ini'", "'*.project'",
                  f"{HOST}/.tool*", f"{HOST}/Content/M*", f"'{HOST}/Content/Maps/*.map'", "apps/deskto?", ":/app*"):
            self.assertEqual((g, rule(f"git add {g}")), (g, "staging-owner-files"))
            self.assertEqual((g, rule(f"git commit -m x {g}")), (g, "staging-owner-files"))
        for g in (f"{HOST}/Source/*", "'*.ts'", f"{HOST}/Config/LocalInp*.ini", "apps/web/*", "docs/*.md"):
            self.assertEqual((g, rule(f"git add {g}")), (g, None))

    def test_from_another_folder(self):
        for c in ("cd apps && git add desktop", "cd apps/desktop; git add Host", f"cd {HOST} && git add Config/LocalEngine.ini",
                  f"cd {HOST}/Config && git add ../.toolconfig", "cd tools/dev && git add ../../apps",
                  "pushd apps/desktop && git add Host", "git -C apps add desktop", "git -C apps -C desktop add Host",
                  f"git -C {HOST} commit -m x Config", "(cd apps && git add desktop)",
                  f'cd "{ROOT}" && git add apps', "cd /e/elsewhere/acme/apps && git add desktop",
                  "cd $REPO && git add apps", "cd ~/acme/apps/desktop && git add Host"):
            self.assertEqual((c, rule(c, {"root": ROOT})), (c, "staging-owner-files"))
        self.assertEqual(rule("Set-Location apps\\desktop; git add Host", None, "PowerShell"), "staging-owner-files")
        for root, sep in ((ROOT, "/"), ("Q:/work/acme", "\\")):
            in_host = {"root": root, "cwd": root.replace("/", sep) + sep + HOST.replace("/", sep)}
            self.assertEqual(rule("git add Config", in_host), "staging-owner-files")
            self.assertEqual(rule("git add Host.project", in_host), "staging-owner-files")
            self.assertIsNone(rule("git add Source/Host/Host.cpp", in_host))
            self.assertIsNone(rule("git add ../Plugins/Acme/Acme.plugin", in_host))
            self.assertIsNone(rule("git add ../../../docs", in_host))
            self.assertEqual(rule("git add ../..", in_host), "staging-owner-files")
            self.assertIsNone(rule("git add :/tools/dev/guard.ts", in_host))
            self.assertEqual(rule(f'git add "{root}/apps/desktop"', {"root": root, "cwd": f"{root}/tools"}), "staging-owner-files")
            # Another checkout than the hook's: read by its tail.
            self.assertEqual(rule("git add desktop", {"root": f"{root}/.claude/worktrees/w1", "cwd": f"{root}/apps"}),
                             "staging-owner-files")
        self.assertIsNone(rule("cd tools && git add apps"))

    def test_what_the_guard_cannot_read_is_refused(self):
        for c in ("git add $(git diff --name-only)", 'git add "$f"', "git ls-files -m | xargs git add",
                  "git add --pathspec-from-file=list.txt", "git add --pathspec-from-file list.txt",
                  "git commit -m x --pathspec-from-file=list.txt", "git add `git ls-files -m`"):
            self.assertEqual((c, rule(c)), (c, "staging-owner-files"))
        self.assertEqual(rule("git add $files", None, "PowerShell"), "staging-owner-files")
        self.assertEqual(rule("git add @files", None, "PowerShell"), "staging-owner-files")
        self.assertIn("Write the paths out", run("git add $(git diff --name-only)")["message"])
        # nothing to protect: nothing to refuse
        self.assertIsNone(run("git add $(git diff --name-only)", cfg=common.defaults()))
        self.assertEqual(run('git add "$f"', cfg=config(staging={"blanket": "deny", "unseen": "ask"}))["kind"], "ask")

    def test_exclusions_are_honoured_when_they_cover_the_files(self):
        self.assertIsNone(rule(f"git add apps ':!{HOST}'"))
        self.assertIsNone(rule("git add apps ':(exclude)apps/desktop'"))
        self.assertIsNone(rule(f"git add apps ':^{HOST}/Config' ':!{HOST}/Content' ':!{HOST}/.toolconfig' ':!{HOST}/*.project'"))
        d = run(f"git add apps ':!{HOST}/Config'")
        self.assertEqual(d["rule"], "staging-owner-files")
        self.assertIn(".project", d["message"])
        self.assertNotIn("LocalEngine.ini", d["message"])
        self.assertEqual(rule("git add ':!docs'"), "staging-owner-files")
        self.assertEqual(rule(f"git add {HOST}/Content ':!{HOST}/Content/Maps/Main.map'"), "staging-owner-files")

    def test_exact_paths_dry_runs_and_everything_else_go_through(self):
        for c in ("git add tools/dev/guard.ts tools/dev/guard.test.ts AGENTS.md .gitignore",
                  f"git add {HOST}/Source/Host/Host.cpp {HOST}/Config/LocalInput.ini {HOST}/Content/.gitkeep",
                  "git add apps/desktop/Plugins/Acme apps/desktop/scripts apps/web apps/AGENTS.md",
                  "git add -p tools/dev/guard.ts",
                  "git add -n apps", "git add --dry-run -A", "git commit --dry-run -a",
                  "git commit -m x", "git commit --amend --no-edit", "git commit -F msg.txt",
                  "git commit -m x tools/dev/guard.ts",
                  "git commit -uno -m x", "git commit -S -m x", "git commit -m x 2>&1 | tail -3",
                  "git status --short apps", "git diff apps", "git log --oneline -- apps", "git restore --staged apps",
                  "git ls-files apps", "echo git add apps", 'gh pr create --title x --body "never git add apps"'):
            self.assertEqual((c, run(c)), (c, None))

    def test_a_commit_message_is_not_a_pathspec(self):
        for c in ('git commit -m "Guard: refuse git add apps; . and :/ too | see #196"',
                  "git commit -m 'apps && git add apps' -m \"apps\"",
                  'git commit --message "apps" --author "A <a@b.c>"',
                  'git commit -m "He said \\"git add apps\\"; apps"',
                  "git commit -m \"$(cat <<'EOF'\nThe guard refuses a folder add.\n\ngit add apps\n\"quoted\" (and a paren) ; apps\n\nCo-Authored-By: x <y@z>\nEOF\n)\"",
                  "git commit -F - <<EOF\ngit add apps\nEOF",
                  "git add tools/dev/guard.ts && git commit -m \"$(cat <<'EOF'\napps\nEOF\n)\" && git push -u origin fix/x"):
            self.assertEqual((c, run(c)), (c, None))
        ps = "git commit -m @'\nGuard: git add apps\n$literal; apps\n'@"
        self.assertIsNone(run(ps, "PowerShell"))
        # ... and what follows the message is still read.
        self.assertEqual(rule("git commit -m \"$(cat <<'EOF'\nmessage\nEOF\n)\" apps"), "staging-owner-files")
        self.assertEqual(rule(f"{ps} apps", None, "PowerShell"), "staging-owner-files")
        self.assertEqual(rule("git commit -m 'a; b' && git add apps"), "staging-owner-files")

    def test_a_shell_line_given_to_another_shell_is_read(self):
        self.assertEqual(rule('bash -c "git add -A"'), "staging-blanket")
        self.assertEqual(rule('powershell -NoProfile -Command "git add apps"', None, "PowerShell"), "staging-owner-files")
        self.assertIsNone(rule('bash -lc "git add tools/dev/guard.ts"'))


if __name__ == "__main__":
    unittest.main()
