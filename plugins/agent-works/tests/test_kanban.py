"""Tests of cli/kanban.py: the card grammar against the golden cards, the commands, the lint, the folder.

The golden cards (tests/fixtures/cards) are the contract between this CLI and the pane's hooks/kanban/cards.ts:

- ``cards/<name>.md`` is canonical: parse then serialise gives the same bytes. ``<name>.json`` beside it is the
  parsed card both implementations must produce.
- ``cards/loose/<name>.md`` is hand-written: ``<name>.json`` is the parsed card (``null`` when the file is no
  card), ``<name>.canon.md`` the file a write turns it into.
- The pane's tests cannot read files (a mod's test environment has no file system), so the same cards are laid
  out for them as a module, hooks/kanban/cards.golden.ts. After changing a card:

      python -B tests/test_kanban.py --write-golden

  rewrites the ``.json``, the ``.canon.md`` and that module from this implementation; a test here fails while the
  module is stale, and the pane's cards.test.ts then holds cards.ts to the same values.
"""
import json
import os
import shutil
import subprocess
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from clihelp import PLUGIN, Project  # noqa: E402  (puts the plugin's cli folder on the path)

import kanban  # noqa: E402

CARDS = PLUGIN / "tests" / "fixtures" / "cards"
LOOSE = CARDS / "loose"
GOLDEN_TS = PLUGIN / "hooks" / "kanban" / "cards.golden.ts"

OLD = "2020-01-01T00:00:00.000Z"


def _text(path):
    # A checkout that converted line endings must not fail the byte comparison for a reason that is not the card's.
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n")


def _names(folder):
    return sorted(p.name for p in folder.glob("*.md") if not p.name.endswith(".canon.md"))


def golden_entries():
    """Every fixture card as the module lays it out: file, text, the canonical file (None for no card), the card."""
    entries = []
    for folder in (CARDS, LOOSE):
        for name in _names(folder):
            text = _text(folder / name)
            card = kanban.parse_card(name, text)
            entries.append({"file": name, "text": text,
                            "canon": None if card is None else kanban.serialize_card(card), "card": card})
    return entries


def golden_module(entries):
    doc = json.dumps(entries, ensure_ascii=False, indent=2)
    return (
        "// Generated from tests/fixtures/cards by `python -B tests/test_kanban.py --write-golden`. Do not edit.\n"
        "// A mod's tests read no files, so the golden cards the Python twin reads from disk are laid out here.\n"
        "import type { Card } from '../../types'\n\n"
        "/** One fixture card: its file, its text, the file a write turns it into, and the card both parsers must give. */\n"
        "export type Golden = { file: string; text: string; canon: string | null; card: Card | null }\n\n"
        f"export const GOLDEN: readonly Golden[] = {doc}\n"
    )


def write_golden():
    for folder in (CARDS, LOOSE):
        for name in _names(folder):
            card = kanban.parse_card(name, _text(folder / name))
            stem = folder / name[:-3]
            with open(f"{stem}.json", "w", encoding="utf-8", newline="\n") as f:
                f.write(json.dumps(card, ensure_ascii=False, indent=2) + "\n")
            if folder == LOOSE and card is not None:
                with open(f"{stem}.canon.md", "w", encoding="utf-8", newline="\n") as f:
                    f.write(kanban.serialize_card(card))
    with open(GOLDEN_TS, "w", encoding="utf-8", newline="\n") as f:
        f.write(golden_module(golden_entries()))


class GoldenCards(unittest.TestCase):
    def test_there_are_golden_cards(self):
        self.assertGreaterEqual(len(_names(CARDS)), 12)

    def test_parse_then_serialise_is_byte_identical(self):
        for name in _names(CARDS):
            with self.subTest(card=name):
                text = _text(CARDS / name)
                card = kanban.parse_card(name, text)
                self.assertIsNotNone(card)
                self.assertEqual(kanban.serialize_card(card), text)

    def test_parsed_values_are_the_expected_json(self):
        for folder in (CARDS, LOOSE):
            for name in _names(folder):
                with self.subTest(card=name):
                    expected = json.loads(_text(folder / f"{name[:-3]}.json"))
                    self.assertEqual(kanban.parse_card(name, _text(folder / name)), expected)

    def test_expected_json_serialises_to_the_card(self):
        for name in _names(CARDS):
            with self.subTest(card=name):
                expected = json.loads(_text(CARDS / f"{name[:-3]}.json"))
                self.assertEqual(kanban.serialize_card(expected), _text(CARDS / name))

    def test_a_golden_card_is_named_by_its_id_and_title(self):
        for name in _names(CARDS):
            card = kanban.parse_card(name, _text(CARDS / name))
            self.assertEqual(kanban.file_name(card["id"], card["title"]), name)

    def test_crlf_line_endings_read_the_same(self):
        for name in _names(CARDS):
            with self.subTest(card=name):
                text = _text(CARDS / name)
                # The body keeps its own line endings; everything else must not care.
                want = kanban.parse_card(name, text)
                got = kanban.parse_card(name, text.replace("\n", "\r\n"))
                got["body"] = got["body"].replace("\r\n", "\n")
                self.assertEqual(got, want)

    def test_a_loose_card_is_written_back_canonical_and_stays_so(self):
        for name in _names(LOOSE):
            card = kanban.parse_card(name, _text(LOOSE / name))
            if card is None:
                self.assertFalse((LOOSE / f"{name[:-3]}.canon.md").exists())
                continue
            with self.subTest(card=name):
                canon = _text(LOOSE / f"{name[:-3]}.canon.md")
                self.assertEqual(kanban.serialize_card(card), canon)
                self.assertEqual(kanban.serialize_card(kanban.parse_card(name, canon)), canon)

    def test_the_fixtures_cover_every_field(self):
        cards = [kanban.parse_card(n, _text(CARDS / n)) for n in _names(CARDS)]
        self.assertTrue(any(c["remote"] and c["remote"]["provider"] == "github" for c in cards))
        self.assertTrue(any(c["remote"] and c["remote"]["provider"] == "gitlab" for c in cards))
        self.assertTrue(any(c["extra"] for c in cards))
        self.assertTrue(any(c["kind"] == "gate" for c in cards))
        self.assertTrue(any(c["kind"] not in kanban.KINDS for c in cards))
        self.assertEqual({c["priority"] for c in cards}, {"low", "normal", "high"})
        self.assertEqual({c["source"] for c in cards}, {"user", "claude"})
        for key in ("owner", "needs", "ref", "labels", "skills", "body"):
            self.assertTrue(any(c[key] for c in cards), key)
        self.assertTrue({"suggested", "archived", "backlog", "done"} <= {c["status"] for c in cards})

    def test_the_module_the_pane_tests_read_is_current(self):
        self.assertTrue(GOLDEN_TS.is_file(), "run: python -B tests/test_kanban.py --write-golden")
        self.assertEqual(_text(GOLDEN_TS), golden_module(golden_entries()),
                         "cards.golden.ts is stale: python -B tests/test_kanban.py --write-golden")


class Grammar(unittest.TestCase):
    def test_slug_and_ids(self):
        self.assertEqual(kanban.file_name("0010", "Fix the Flaky  Sync!"), "0010-fix-the-flaky-sync.md")
        self.assertEqual(kanban.slugify("???"), "card")
        self.assertLessEqual(len(kanban.slugify("x" * 80)), 48)
        self.assertEqual(kanban.next_id([{"id": "0002"}, {"id": "0009"}, {"id": "abc"}]), "0010")
        self.assertEqual(kanban.next_id([]), "0001")

    def test_unknown_keys_survive_a_change_of_the_card(self):
        text = "---\nid: \"0001\"\ntitle: \"T\"\nstatus: backlog\ncustom: 1\nnested:\n  a: b\n---\n\nBody\n"
        card = kanban.parse_card("0001-t.md", text)
        self.assertEqual(card["extra"], ["custom: 1", "nested:", "  a: b"])
        out = kanban.serialize_card(dict(card, status="done", owner="pat"))
        self.assertIn("custom: 1\nnested:\n  a: b\n---\n", out)
        self.assertIn('owner: "pat"\n', out)

    def test_what_is_no_card(self):
        self.assertIsNone(kanban.parse_card("README.md", "# Notes"))
        self.assertIsNone(kanban.parse_card("notes.md", "---\ntitle: no id anywhere\n---\n"))

    def test_values_as_javascript_reads_them(self):
        card = kanban.parse_card("0001-x.md", "---\nlabels: [1, true, null, 2.5, \"a\"]\norder: 1e1\n---\n")
        self.assertEqual(card["labels"], ["1", "true", "null", "2.5", "a"])
        self.assertEqual(card["order"], 10)
        self.assertEqual(kanban.parse_card("0001-x.md", "---\norder: soon\n---\n")["order"], 0)
        self.assertEqual(kanban.parse_card("0001-x.md", "---\nlabels: [NaN]\n---\n")["labels"], ["NaN"])


class Commands(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        self.addCleanup(self.p.close)
        self.dir = self.p.root / ".agents" / "kanban"

    def cards(self):
        return {c["id"]: c for c in kanban.load(self.dir)["cards"]}

    def test_add_list_move(self):
        code, out, err = self.p.aw("kanban", "add", "Write the README", "--details", "Start with install.",
                                   "--priority", "high", "--labels", "docs, readme", CLAUDECODE="")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Added card 0001 [backlog]", out)
        card = self.cards()["0001"]
        self.assertEqual((card["file"], card["priority"], card["labels"], card["body"], card["source"]),
                         ("0001-write-the-readme.md", "high", ["docs", "readme"], "Start with install.", "user"))
        self.assertRegex(card["created"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

        code, out, _ = self.p.aw("kanban", "add", "write the readme!")
        self.assertEqual(code, 1)
        self.assertIn("Already on the kanban board as card 0001", out)

        self.p.aw("kanban", "add", "Second", "--from-file", "-", stdin="From stdin.\n")
        self.assertEqual(self.cards()["0002"]["body"], "From stdin.")
        self.assertEqual(self.cards()["0002"]["order"], 1)

        code, out, _ = self.p.aw("kanban", "move", "1", "review")
        self.assertEqual(code, 0)
        self.assertEqual(self.cards()["0001"]["status"], "review")
        code, _, err = self.p.aw("kanban", "move", "0001", "nowhere")
        self.assertEqual(code, 2)
        self.assertIn('no column "nowhere"', err)
        code, _, err = self.p.aw("kanban", "move", "77", "done")
        self.assertEqual(code, 2)

        code, out, _ = self.p.aw("kanban", "list")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), ["Columns: backlog, in-progress, review, done (plus suggested)",
                                            "0002 [backlog] task: Second", "0001 [review] task: Write the README"])
        code, out, _ = self.p.aw("kanban", "list", "--json", "--status", "review")
        doc = json.loads(out)
        self.assertEqual([c["id"] for c in doc["cards"]], ["0001"])
        self.assertEqual([c["id"] for c in doc["columns"]], ["backlog", "in-progress", "review", "done"])

    def test_an_agent_is_the_source_and_suggestions_wait(self):
        self.p.aw("kanban", "add", "Seen in passing", "--suggest", AW_AGENT="worker-1")
        card = self.cards()["0001"]
        self.assertEqual((card["status"], card["source"]), ("suggested", "claude"))
        self.p.aw("kanban", "move", "0001", "archived")
        _, out, _ = self.p.aw("kanban", "list")
        self.assertNotIn("0001", out)
        _, out, _ = self.p.aw("kanban", "list", "--all")
        self.assertIn("0001 [archived]", out)

    def test_owe_and_settle_a_gate(self):
        code, out, _ = self.p.aw("kanban", "owe", "Run the smoke gate", "--ref", "#213", "--needs",
                                 "the main checkout", "--details", "`npm run smoke`", "--owner", "integrator")
        self.assertEqual(code, 0)
        self.assertIn("Owed as gate card 0001", out)
        gate = self.cards()["0001"]
        self.assertEqual((gate["kind"], gate["status"], gate["ref"], gate["needs"], gate["owner"]),
                         ("gate", "backlog", "#213", "the main checkout", "integrator"))
        self.assertIn("kind: gate\n", self.p.read(".agents/kanban/0001-run-the-smoke-gate.md"))

        self.assertEqual(self.p.aw("kanban", "owe", "run the smoke gate", "--ref", "#213", "--needs", "x")[0], 1)
        self.assertEqual(self.p.aw("kanban", "owe", "Run the smoke gate", "--ref", "#214", "--needs", "x")[0], 0)
        self.assertEqual(self.p.aw("kanban", "owe", "No ref")[0], 2)

        _, out, _ = self.p.aw("kanban", "list", "--kind", "gate")
        self.assertIn("0001 [backlog] gate @integrator: Run the smoke gate (for #213; needs the main checkout)", out)

        self.p.aw("kanban", "add", "A task")
        code, _, err = self.p.aw("kanban", "settle", "0003", "--evidence", "ran")
        self.assertEqual(code, 2)
        self.assertIn("not a gate", err)
        self.assertEqual(self.p.aw("kanban", "settle", "0001", "--evidence", " ")[0], 2)

        code, out, _ = self.p.aw("kanban", "settle", "1", "--evidence", "npm run smoke: 27 of 27", AW_AGENT="w1")
        self.assertEqual(code, 0)
        settled = self.cards()["0001"]
        self.assertEqual(settled["status"], "done")
        self.assertTrue(settled["body"].startswith("`npm run smoke`\n\nSettled "))
        self.assertTrue(settled["body"].endswith(" by w1: npm run smoke: 27 of 27"))
        self.assertEqual(self.p.aw("kanban", "settle", "0001", "--evidence", "again")[0], 2)

    def test_a_card_written_by_the_pane_keeps_its_fields_through_the_cli(self):
        self.dir.mkdir(parents=True)
        name = "0006-a-nested-block-the-board-does-not-know.md"
        shutil.copy(CARDS / name, self.dir / name)
        before = _text(self.dir / name)
        self.assertEqual(self.p.aw("kanban", "move", "6", "review")[0], 0)
        after = _text(self.dir / name)
        changed = [(a, b) for a, b in zip(before.splitlines(), after.splitlines()) if a != b]
        self.assertEqual([a.split(":")[0] for a, _ in changed], ["status", "order", "updated"])
        self.assertEqual(len(before.splitlines()), len(after.splitlines()))

    def test_ids_do_not_collide_between_writers(self):
        with ThreadPoolExecutor(max_workers=6) as pool:
            codes = list(pool.map(lambda i: self.p.aw("kanban", "add", f"Card number {i}")[0], range(6)))
        self.assertEqual(codes, [0] * 6)
        self.assertEqual(sorted(self.cards()), ["0001", "0002", "0003", "0004", "0005", "0006"])
        self.assertFalse((self.dir / kanban.LOCK_FILE).exists())

    def test_the_board_json_of_the_pane_names_the_columns(self):
        self.p.write(".agents/kanban/board.json", json.dumps({"columns": [
            {"id": "todo", "title": "To do", "role": None}, {"id": "doing", "title": "Doing", "role": "start"},
            {"id": "shipped", "title": "Shipped", "role": "done"}], "startMode": "queue"}))
        self.p.aw("kanban", "owe", "Gate", "--ref", "#1", "--needs", "x")
        self.assertEqual(self.cards()["0001"]["status"], "todo")
        self.p.aw("kanban", "settle", "0001", "--evidence", "ok")
        self.assertEqual(self.cards()["0001"]["status"], "shipped")
        self.assertEqual(self.p.aw("kanban", "move", "0001", "review")[0], 2)

    def test_no_action_prints_help(self):
        code, out, _ = self.p.aw("kanban")
        self.assertEqual(code, 2)
        self.assertIn("settle", out)


class Folder(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        self.addCleanup(self.p.close)

    def test_the_old_folder_is_the_board_until_the_new_one_exists(self):
        self.p.write(".agents/board/board.json", "{}")
        self.p.aw("kanban", "add", "In the old folder")
        self.assertTrue((self.p.root / ".agents/board/0001-in-the-old-folder.md").is_file())
        self.assertFalse((self.p.root / ".agents/kanban").exists())
        code, out, _ = self.p.aw("kanban", "lint")
        self.assertEqual(code, 1)
        self.assertIn("KANBAN_OLD_FOLDER", out)
        (self.p.root / ".agents/board").rename(self.p.root / ".agents/kanban")
        code, out, _ = self.p.aw("kanban", "lint")
        self.assertEqual((code, out.strip()), (0, "kanban: clean"))

    def test_an_old_folder_without_board_json_is_not_the_board(self):
        self.p.write(".agents/board/0001-x.md", "---\nid: \"0001\"\n---\n")
        folder, is_old, _ = kanban.resolve(self.p.root)
        self.assertEqual((folder, is_old), (self.p.root / ".agents" / "kanban", False))

    def test_the_config_names_the_folder(self):
        self.p.write(".agents/agent-works.json", json.dumps({"paths": {"kanban": "work/cards"}}))
        self.p.aw("kanban", "add", "Elsewhere")
        self.assertTrue((self.p.root / "work/cards/0001-elsewhere.md").is_file())

    def test_a_worktree_works_the_main_trees_board(self):
        tree = self.p.tmp / "wt"
        meta = self.p.root / ".git" / "worktrees" / "wt"
        meta.mkdir(parents=True)
        (meta / "commondir").write_text("../..\n", encoding="utf-8")
        (meta / "HEAD").write_text("ref: refs/heads/feat/y\n", encoding="utf-8")
        tree.mkdir()
        (tree / ".git").write_text(f"gitdir: {meta}\n", encoding="utf-8")
        code, _, err = self.p.aw("kanban", "add", "From a worktree", cwd=tree)
        self.assertEqual((code, err), (0, ""))
        self.assertTrue((self.p.root / ".agents/kanban/0001-from-a-worktree.md").is_file())
        self.assertFalse((tree / ".agents").exists())


class Lint(unittest.TestCase):
    def setUp(self):
        self.p = Project()
        self.addCleanup(self.p.close)

    def card(self, card_id, title, **more):
        card = kanban.new_card(card_id, title, more.pop("status", "backlog"), 0, more.pop("now", kanban.now_iso()), **more)
        self.p.write(f".agents/kanban/{card['file']}", kanban.serialize_card(card))
        return card

    def codes(self):
        return sorted(f.code for f in kanban.findings(self.p.root))

    def test_no_board_no_findings(self):
        self.assertEqual(kanban.findings(self.p.root), [])
        self.assertEqual(self.p.aw("kanban", "lint")[0], 0)

    def test_a_clean_board(self):
        self.card("0001", "Fine")
        self.card("0002", "A gate", kind="gate", ref="#1", needs="x")
        self.p.write(".agents/kanban/README.md", "# Notes beside the cards\n")
        self.assertEqual(self.codes(), [])

    def test_invalid_cards(self):
        self.p.write(".agents/kanban/0003-broken.md", "no frontmatter here\n")
        self.card("0004", "Twin")
        self.p.write(".agents/kanban/0005-twin-two.md", kanban.serialize_card(
            kanban.new_card("0004", "Twin two", "backlog", 1, kanban.now_iso())))
        self.card("0006", "An epic", kind="epic")
        self.card("0007", "Gate with no ref", kind="gate")
        found = kanban.findings(self.p.root)
        self.assertEqual({f.code for f in found}, {"KANBAN_CARD_INVALID"})
        self.assertEqual({f.level for f in found}, {"warning"})
        text = "\n".join(f"{f.path} {f.message}" for f in found)
        for part in ("0003-broken.md", "also the id of 0004-twin.md", "disagree", 'kind "epic"', "a gate without ref"):
            self.assertIn(part, text)

    def test_unknown_status_stale_start_and_old_gate(self):
        self.card("0001", "Lost", status="blocked")
        self.card("0002", "Forgotten", status="in-progress", now=OLD)
        self.card("0003", "Fresh", status="in-progress")
        self.card("0004", "Owed long", kind="gate", ref="#9", needs="the main checkout", now=OLD)
        self.card("0005", "Settled long ago", kind="gate", ref="#8", status="done", now=OLD)
        found = {f.code: f for f in kanban.findings(self.p.root)}
        self.assertEqual(sorted(found), ["GATE_OWED_OLD", "KANBAN_STALE_START", "KANBAN_STATUS_UNKNOWN"])
        self.assertTrue(found["KANBAN_STATUS_UNKNOWN"].path.endswith("0001-lost.md"))
        self.assertTrue(found["KANBAN_STALE_START"].path.endswith("0002-forgotten.md"))
        self.assertIn("owed for #9", found["GATE_OWED_OLD"].message)
        code, out, _ = self.p.aw("kanban", "lint", "--json")
        self.assertEqual(code, 1)
        self.assertEqual(sorted(f["code"] for f in json.loads(out)["findings"]), sorted(found))

    def test_the_project_sets_the_ages(self):
        self.p.write(".agents/agent-works.json", json.dumps({"kanban": {"gateOwedDays": 100000}}))
        self.card("0001", "Owed long", kind="gate", ref="#9", now=OLD)
        self.assertEqual(self.codes(), [])

    @unittest.skipUnless(shutil.which("git"), "git is not installed")
    def test_a_board_neither_committed_nor_ignored(self):
        shutil.rmtree(self.p.root / ".git")
        run = lambda *a: subprocess.run(["git", *a], cwd=str(self.p.root), capture_output=True, env=self.p.env())
        if run("init", "-q").returncode != 0:
            self.skipTest("git init failed")
        self.card("0001", "Fine")
        self.assertEqual(self.codes(), ["KANBAN_UNTRACKED"])
        self.p.write(".gitignore", ".agents/kanban/\n")
        self.assertEqual(self.codes(), [])


if __name__ == "__main__":
    if "--write-golden" in sys.argv:
        write_golden()
        print(f"wrote the expected JSON, the canonical files and {os.path.relpath(GOLDEN_TS, PLUGIN)}")
    else:
        unittest.main()
