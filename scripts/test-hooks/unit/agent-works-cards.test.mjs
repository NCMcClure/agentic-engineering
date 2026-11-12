// A card is a markdown file a person can read and edit by hand, so the reader
// has to take what a person writes (CRLF, keys in any order, quotes of either
// kind, keys this version has never heard of) and the writer has to give back
// one canonical form. The goldens under cases/agent-works/cards pin both
// halves: <case>.md is a card as it was found, <case>.json is `{ file, slug,
// card }` (the parse; `card: null` for a file that is no card) and
// <case>.canon.md is the written form where it differs from the input.
//
// The cases named like card files (0001-..., 0020-...) were written before
// 1.0, every key on its own line and every string quoted. Their `view` is the
// JSON an earlier reader gave for them, which `cardView` must still give: it
// is what `list --json` prints, and what the pane draws from.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  KNOWN_KEYS, appendToSection, cardFile, cardView, doneCriteria, newCard, nextId, parseCard, section, sections, serializeCard, slugify,
} from "../../../plugins/agent-works/lib/cards.mjs";
import { REPO } from "./helpers.mjs";

const FIXTURES = path.join(REPO, "scripts", "test-hooks", "cases", "agent-works", "cards");
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8").replace(/\r\n/g, "\n");
const cases = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".md") && !f.endsWith(".canon.md")).map((f) => f.slice(0, -3)).sort();
const trimmed = (card) => ({ ...card, body: card.body.trim() });

test("the goldens cover the format", () => {
  for (const name of ["minimal", "full-with-lists", "unknown-keys", "unknown-nested-block", "crlf", "unicode-title-slug", "slug-cut-48",
    "unknown-status-and-kind", "gate", "epic", "every-loop-field", "linked-and-bound", "done-looks-like", "values-that-need-quotes", "notes"]) {
    assert.ok(cases.includes(name), `no golden for ${name}`);
  }
  const earlier = cases.filter((name) => /^\d{4}-/.test(name));
  assert.ok(earlier.length >= 19, `${earlier.length} cards from before 1.0`);
  const cards = cases.map((name) => JSON.parse(read(`${name}.json`)).card).filter(Boolean);
  assert.ok(cards.some((c) => c.remote?.provider === "github") && cards.some((c) => c.remote?.provider === "gitlab"));
  assert.ok(cards.some((c) => c.unknown.length) && cards.some((c) => c.kind === "gate") && cards.some((c) => c.kind === "epic"));
  assert.deepEqual([...new Set(cards.map((c) => c.priority))].sort(), ["high", "low", "normal"]);
  for (const key of ["owner", "needs", "ref", "epic", "sprint", "session", "branch", "worktree", "mr", "merged", "grant"]) {
    assert.ok(cards.some((c) => c[key] !== undefined), `no golden carries ${key}`);
  }
});

for (const name of cases) {
  const want = JSON.parse(read(`${name}.json`));
  // A tracked file may not carry CRLF, so the crlf case is stored with LF and converted here.
  const input = name === "crlf" ? read(`${name}.md`).replace(/\n/g, "\r\n") : read(`${name}.md`);

  if (want.card === null) {
    test(`card ${name}: is no card`, () => {
      assert.throws(() => parseCard(input, want.file), new RegExp(want.file.replace(/\./g, "\\.")));
      assert.equal(fs.existsSync(path.join(FIXTURES, `${name}.canon.md`)), false);
    });
    continue;
  }
  const canon = fs.existsSync(path.join(FIXTURES, `${name}.canon.md`)) ? read(`${name}.canon.md`) : read(`${name}.md`);

  test(`card ${name}: parses to the golden`, () => {
    assert.deepEqual(parseCard(input, want.file), want.card);
    assert.equal(slugify(want.card.title), want.slug);
    assert.ok(want.slug.length <= 48 && !want.slug.endsWith("-"), want.slug);
  });

  test(`card ${name}: writes the canonical form, and that form is stable`, () => {
    assert.equal(serializeCard(parseCard(input, want.file)), canon);
    const again = parseCard(canon, want.file);
    assert.deepEqual(again, trimmed(want.card));
    assert.equal(serializeCard(again), canon);
  });

  test(`card ${name}: reads the same with CRLF line endings`, () => {
    assert.deepEqual(parseCard(input.replace(/\r?\n/g, "\r\n"), want.file), want.card);
  });

  if (want.view) {
    test(`card ${name}: a card from before 1.0 still gives the view it gave`, () => {
      assert.deepEqual(cardView(parseCard(input, want.file)), want.view);
      // The canonical form says the same thing in fewer lines.
      assert.deepEqual(cardView(parseCard(canon, want.file)), { ...want.view, body: want.view.body.trim() });
    });
  }
}

test("a card keeps the file it has, whatever its title becomes", () => {
  const card = parseCard(read("0007-fix-the-sync-race-na-ve-caf.md"), "0007-fix-the-sync-race-na-ve-caf.md");
  assert.equal(card.file, "0007-fix-the-sync-race-na-ve-caf.md");
  // A new card of that title gets the slug that keeps the base letters.
  assert.equal(cardFile({ id: "0007", title: card.title }), "0007-fix-the-sync-race-naive-cafe.md");
  assert.equal(newCard("0009", "Café menu").file, "0009-cafe-menu.md");
  assert.equal(newCard("0009", "Renamed", { file: "0009-first-name.md" }).file, "0009-first-name.md");
});

test("parseCard refuses a file with no frontmatter or no id, naming the file", () => {
  assert.throws(() => parseCard("# just a heading\n", "0042-loose.md"), /0042-loose\.md: no --- fenced frontmatter/);
  assert.throws(() => parseCard("---\ntitle: no id anywhere\n---\n", "notes.md"), /notes\.md: no id/);
  assert.equal(parseCard("---\ntitle: No id line\nstatus: backlog\n---\n", "0042-no-id-line.md").id, "0042");
  assert.equal(parseCard("---\nplan: 01-02-03\nsession: s\n---\n", "plan-01-02-03.md").id, "01-02-03");
});

test("values read the way a person means them", () => {
  const card = parseCard('---\nlabels: [1, true, null, 2.5, "a"]\norder: 1e1\nmr: "12"\nowner: 7\n---\n', "0001-x.md");
  assert.deepEqual(card.labels, ["1", "true", "null", "2.5", "a"]);
  assert.equal(card.order, 10);
  assert.equal(card.mr, 12);
  assert.equal(card.owner, "7");
  assert.equal(parseCard("---\norder: soon\nmr: none\n---\n", "0001-x.md").order, 0);
  assert.equal(parseCard("---\nmr: none\n---\n", "0001-x.md").mr, undefined);
  assert.deepEqual(parseCard("---\nlabels: [NaN]\nskills: one\n---\n", "0001-x.md").labels, ["NaN"]);
  assert.deepEqual(parseCard("---\nskills: one\n---\n", "0001-x.md").skills, ["one"]);
  assert.equal(parseCard("---\ntitle:no space\n---   \nBody", "0001-x.md").title, "no space");
  assert.equal(parseCard("﻿---\ntitle: with a mark\n---\n", "0001-x.md").title, "with a mark");
});

test("unknown keys survive a change of the card, after the board's own", () => {
  const text = "---\nid: \"0001\"\ntitle: \"T\"\nstatus: backlog\ncustom: 1\nnested:\n  a: b\n---\n\nBody\n";
  const card = parseCard(text, "0001-t.md");
  assert.deepEqual(cardView(card).extra, ["custom: 1", "nested:", "  a: b"]);
  const out = serializeCard({ ...card, status: "done", owner: "pat" });
  assert.match(out, /owner: pat\ncustom: 1\nnested:\n  a: b\n---\n/);
});

test("a value that would read back as something else is quoted on write", () => {
  const card = parseCard("---\nid: 0001\ntitle: plain\n---\n", "0001-plain.md");
  for (const title of ['"quoted" at the start', "[bracket] first", "'single' quoted", " leading space", "trailing space ", ""]) {
    const written = serializeCard({ ...card, title });
    assert.equal(parseCard(written, "0001-x.md").title, title, written);
  }
  assert.match(serializeCard({ ...card, title: "a: colon, a # hash" }), /^title: a: colon, a # hash$/m);
});

test("defaults are left out of the file and come back on a read", () => {
  const card = newCard("0003", "Small", {}, "2026-10-01T09:00:00.000Z");
  const written = serializeCard(card);
  assert.equal(written, "---\nid: 0003\ntitle: Small\nstatus: backlog\norder: 0\nsource: user\ncreated: 2026-10-01T09:00:00.000Z\nupdated: 2026-10-01T09:00:00.000Z\n---\n");
  assert.deepEqual(parseCard(written, card.file), card);
});

test("cardView fills every field a reader of --json counts on", () => {
  const view = cardView(parseCard("---\nid: 0001\n---\n", "0001-x.md"));
  assert.deepEqual(view, {
    id: "0001", file: "0001-x.md", title: "0001-x", status: "backlog", order: 0, priority: "normal", labels: [], skills: [], source: "user",
    created: "", updated: "", kind: "task", owner: "", needs: "", ref: "", epic: "", sprint: "", body: "", remote: null, extra: [],
  });
  const bound = cardView({ ...parseCard("---\nid: 0001\nmr: 4\nfiles: [\"a\"]\n---\n", "0001-x.md"), session: "s1" });
  assert.deepEqual([bound.mr, bound.files, bound.session, "after" in bound], [4, ["a"], "s1", false]);
});

test("slugify drops what is not ascii, keeps base letters, and never comes back empty", () => {
  assert.equal(cardFile({ id: "0010", title: "Fix the Flaky  Sync!" }), "0010-fix-the-flaky-sync.md");
  assert.equal(slugify("???"), "card");
  assert.equal(slugify("看板"), "card");
  assert.equal(slugify("Über naïve café"), "uber-naive-cafe");
  assert.ok(slugify("x".repeat(80)).length <= 48);
});

test("nextId pads to four digits and skips ids that are not numbers", () => {
  assert.equal(nextId([]), "0001");
  assert.equal(nextId([{ id: "0002" }, { id: "0009" }, { id: "abc" }, { id: "01-02-03" }]), "0010");
  assert.equal(nextId([{ id: "9999" }]), "10000");
});

test("KNOWN_KEYS is the write order", () => {
  assert.deepEqual(KNOWN_KEYS, ["id", "title", "status", "order", "priority", "labels", "skills", "source", "created", "updated",
    "kind", "owner", "needs", "ref", "epic", "sprint", "after", "files", "plan", "grant", "session", "branch", "worktree", "mr", "merged"]);
});

test("the done criteria are read under either heading", () => {
  assert.equal(doneCriteria("Intro\n\n## Done when\n\n- [ ] a\n\n## Notes\n"), "- [ ] a");
  assert.equal(doneCriteria("## What was seen\n\nx\n\n## Done looks like\n\nThe test passes.\n"), "The test passes.");
  assert.equal(doneCriteria("## Done when\n\n## Notes"), "");
  assert.equal(section("## A\n\none\n\n## B\ntwo", "B"), "two");
  assert.deepEqual(sections("lead\n## A\none").map((s) => s.head), [null, "A"]);
});

test("appendToSection adds a line at the end of a section, or makes the section", () => {
  assert.equal(appendToSection("## Done when\n\n- a\n\n## Notes", "Notes", "- one"), "## Done when\n\n- a\n\n## Notes\n\n- one");
  assert.equal(appendToSection("## Notes\n\n- one\n\n## Review\n\nfine", "Notes", "- two"), "## Notes\n\n- one\n- two\n\n## Review\n\nfine");
  assert.equal(appendToSection("Just text.", "Notes", "- one"), "Just text.\n\n## Notes\n\n- one");
  assert.equal(appendToSection("", "Evidence", "Settled"), "## Evidence\n\nSettled");
});
