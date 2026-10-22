# Test fixtures

## `cards/`: the golden cards

The kanban card grammar has two implementations that must agree byte for byte: `cli/kanban.py` (the `aw kanban`
commands) and `hooks/kanban/cards.ts` (the pane). These cards are the contract between them. `tests/test_kanban.py`
reads them from disk; a mod's tests read no files, so the same cards are laid out for `cards.test.ts` as the
generated module `hooks/kanban/cards.golden.ts`.

After changing or adding a card, regenerate what is derived from it, from the plugin's folder:

```
python -B tests/test_kanban.py --write-golden
```

It rewrites every expected `.json`, every `.canon.md` and `cards.golden.ts` from the Python implementation; a test
fails while the module is stale. Read the diff before keeping it: the expected files are what the *other*
implementation is then held to.

This page lives one level above the cards on purpose: every `*.md` in the two card folders is read as a fixture.

### Canonical cards

`cards/<name>.md` is a card as the board writes it: parsing and writing it again gives the same bytes. The `.json`
beside it is the card both parsers must return.

| Card | Expected | Pins |
|---|---|---|
| `0001-write-the-readme.md` | `0001-write-the-readme.json` | the smallest card: every default, no body |
| `0002-fix-race-in-session-cache.md` | `0002-fix-race-in-session-cache.json` | labels and skills with spaces and colons, `owner`, `needs`, `ref`, a body with a list |
| `0003-linked-to-a-github-issue.md` | `0003-linked-to-a-github-issue.json` | the nested `remote` block of a GitHub issue |
| `0004-linked-to-a-gitlab-issue.md` | `0004-linked-to-a-gitlab-issue.json` | the same for GitLab, with an `owner` |
| `0005-keys-the-board-does-not-know.md` | `0005-keys-the-board-does-not-know.json` | unknown scalar and list keys survive a round trip |
| `0006-a-nested-block-the-board-does-not-know.md` | `0006-a-nested-block-the-board-does-not-know.json` | unknown nested blocks and a comment come back verbatim, after the board's own keys |
| `0007-fix-the-sync-race-na-ve-caf.md` | `0007-fix-the-sync-race-na-ve-caf.json` | quotes, backslashes and non-ASCII text in a title and in labels; how the slug drops them |
| `0008-draft-not-a-comment-100-yes-single-tag.md` | `0008-draft-not-a-comment-100-yes-single-tag.json` | a title made of YAML's special characters; a body that holds a `---` rule and a fenced block |
| `0009-run-the-smoke-gate-on-main.md` | `0009-run-the-smoke-gate-on-main.json` | a gate that is owed: `kind: gate` with `owner`, `needs`, `ref` |
| `0010-full-test-pass-before-release.md` | `0010-full-test-pass-before-release.json` | a settled gate: done, with its evidence line in the body |
| `0011-stale-docs-for-the-export-command.md` | `0011-stale-docs-for-the-export-command.json` | a card in the Suggested lane |
| `0012-a-title-long-enough-that-its-slug-is-cut-at-fort.md` | `0012-a-title-long-enough-that-its-slug-is-cut-at-fort.json` | the slug cut at 48 characters; an archived card |
| `0013-a-status-and-a-kind-of-its-own.md` | `0013-a-status-and-a-kind-of-its-own.json` | a status and a kind the board does not know, and a fractional `order`: kept, and named by lint |
| `0014-move-the-sync-to-graphql.md` | `0014-move-the-sync-to-graphql.json` | a card in an epic and a sprint: `epic` and `sprint`, written after `ref` |
| `0015-sync-that-scales-to-a-thousand-issues.md` | `0015-sync-that-scales-to-a-thousand-issues.json` | an epic: `kind: epic`, its goal in the body |

### Loose cards

`cards/loose/<name>.md` is a card as a person or a script wrote it. The `.json` is what both parsers read from it
(`null`: the file is no card), and the `.canon.md` is the file a write turns it into.

| Card | Expected | Written back as | Pins |
|---|---|---|---|
| `0003-by-hand.md` | `0003-by-hand.json` | `0003-by-hand.canon.md` | two keys and a body with no blank line or final newline; the id comes from the file name |
| `0020-crlf-and-quotes.md` | `0020-crlf-and-quotes.json` | `0020-crlf-and-quotes.canon.md` | single quotes, a trailing comma, a bare label, an unknown priority and source, stray spaces. Its line ends are LF on disk (git checks Markdown out that way); the CRLF case is a test that rewrites every card with CRLF |
| `0021-keys-in-any-order.md` | `0021-keys-in-any-order.json` | `0021-keys-in-any-order.canon.md` | keys in any order, a comment, a block list, an unknown provider, a stray line under a known key |
| `0022-no-id-no-number.md` | `0022-no-id-no-number.json` | `0022-no-id-no-number.canon.md` | no `id` and a `remote` without a number: the id is the file's, the remote is dropped |
| `notes.md` | `notes.json` | none | a Markdown file without frontmatter is not a card |
