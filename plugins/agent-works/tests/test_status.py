"""aw status: derived from the board, the store and git; each part left out when its source is absent."""
import json
import shutil
import subprocess
import unittest

from tests.clihelp import Project

import status

CARD = "---\nid: \"{id}\"\ntitle: {title}\nstatus: {status}\norder: 1\npriority: normal\nlabels: []\nskills: []\nsource: user\n" \
       "created: 2026-01-05T10:00:00.000Z\nupdated: 2026-01-05T10:00:00.000Z\n{extra}---\n\nBody.\n"
BOARD = {"columns": [{"id": "todo", "title": "Todo"}, {"id": "doing", "title": "In Progress"}, {"id": "done", "title": "Done", "done": True}]}


class Status(unittest.TestCase):
    def setUp(self):
        self.p = Project(config={})

    def tearDown(self):
        self.p.close()

    def test_nothing_there(self):
        code, out, err = self.p.aw("status", "--json")
        self.assertEqual((code, err), (0, ""))
        doc = json.loads(out)
        self.assertRegex(doc["project"], r"^acme-[0-9a-f]{8}$")
        self.assertEqual((doc["branch"], doc["board"], doc["statusFile"], doc["done"]), ("feat/x", None, None, None))
        self.assertIn("board: none here", self.p.aw("status")[1])

    def test_board_gates_and_status_file(self):
        w = self.p.write
        w(".agents/kanban/board.json", json.dumps(BOARD))
        w(".agents/kanban/0001-first-thing.md", CARD.format(id="0001", title="First thing", status="todo", extra=""))
        w(".agents/kanban/0002-in-hand.md", CARD.format(id="0002", title="In hand", status="doing", extra="owner: a1\n"))
        w(".agents/kanban/0003-shipped.md", CARD.format(id="0003", title="Shipped", status="done", extra=""))
        w(".agents/kanban/0004-full-suite.md", CARD.format(id="0004", title="Full suite on the merged tree", status="todo",
                                                           extra="kind: gate\nneeds: the GPU\nref: \"PR 12\"\n"))
        w(".agents/kanban/0005-settled.md", CARD.format(id="0005", title="Settled gate", status="done", extra="kind: gate\n"))
        w(".agents/memory/project/2026-01-09-project-status.md",
          "---\nname: project-status\ndescription: d\ntype: status\nupdated: 2026-01-09\n---\n\n# Status\n")
        doc = status.collect(self.p.root)
        b = doc["board"]
        self.assertEqual([(c["id"], c["count"]) for c in b["columns"]], [("todo", 2), ("doing", 1), ("done", 2)])
        self.assertEqual([(g["id"], g["needs"], g["ref"]) for g in b["gates"]], [("0004", "the GPU", "PR 12")])
        self.assertEqual((doc["statusFile"]["path"], doc["statusFile"]["budget"]), (".agents/memory/project/2026-01-09-project-status.md", 120))
        text = self.p.aw("status")[1]
        self.assertIn("board: Todo 2, In Progress 1, Done 2", text)
        self.assertIn("[In Progress] 0002 In hand  (a1)", text)
        self.assertIn("gates owed: 1", text)
        self.assertIn("0004 Full suite on the merged tree  (for PR 12; needs the GPU)", text)
        self.assertNotIn("Shipped", text)  # done is not listed card by card

    def test_the_old_board_folder_is_read(self):
        self.p.write(".agents/board/board.json", json.dumps(BOARD))
        self.p.write(".agents/board/0001-x.md", CARD.format(id="0001", title="X", status="todo", extra=""))
        b = status.collect(self.p.root)["board"]
        self.assertTrue(b["dir"].endswith(".agents/board"))
        self.assertEqual(len(b["cards"]), 1)

    def test_locks_are_read_from_the_store(self):
        import common

        stamp = common.now_iso()
        import os
        pid = common.project_id(self.p.root)
        common.write_json(self.p.home / "locks" / pid / "editor.lock",
                          {"agent": "a1", "project": pid, "for": "tests", "pid": os.getpid(), "since": stamp, "refreshed": stamp})
        doc = json.loads(self.p.aw("status", "--json")[1])
        if doc["coordination"] is not None:  # the coordination modules are there
            self.assertEqual([(l["resource"], l["agent"]) for l in doc["coordination"]["locks"]], [("editor", "a1")])
            self.assertIn("editor held by a1 (tests)", self.p.aw("status")[1])

    @unittest.skipUnless(shutil.which("git"), "git is not installed")
    def test_done_is_the_git_log(self):
        real = Project(git=False)
        try:
            def git(*args):
                subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *args],
                               cwd=str(real.root), check=True, capture_output=True)
            git("init", "-q", "-b", "main")
            real.write("a.txt", "1")
            git("add", "a.txt")
            git("commit", "-q", "-m", "First")
            git("checkout", "-q", "-b", "topic")
            real.write("b.txt", "1")
            git("add", "b.txt")
            git("commit", "-q", "-m", "Second")
            done = status.merges(real.root, 5)
            self.assertEqual((done["kind"], [r["subject"] for r in done["rows"]]), ("commits", ["Second", "First"]))
            git("checkout", "-q", "main")
            git("merge", "-q", "--no-ff", "-m", "Merge topic", "topic")
            done = status.merges(real.root, 5)
            self.assertEqual((done["kind"], [r["subject"] for r in done["rows"]]), ("merges", ["Merge topic"]))
            self.assertIn("done (the last 1 merges on this branch)", real.aw("status")[1])
        finally:
            real.close()


if __name__ == "__main__":
    unittest.main()
