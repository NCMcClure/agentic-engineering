# docs-parity

User docs drift for one reason: they ship after the code. A screen gets a new button on Tuesday, the docs
pass happens "later", and by then nobody remembers which three pages and which four screenshots showed the old
one. A careful docs sprint at the end does not fix this; it only moves the drift around. docs-parity makes the
docs part of the change, the way a test is: the commit that moves a button also rewrites the page that
describes it and retakes the picture that shows it, and a script checks that it did.

It works for any stack (web, desktop, CLI, Python, Rust, C++, Unreal Engine) and any docs target: a docs site,
a plain `docs/` folder of markdown, a GitHub or GitLab wiki, or a single README.

## How it works

**One rule, carried where it applies.** A project adopts the plugin with one file,
`.agents/docs-parity.json`. In that project a session-start hook gives the session one line: docs move in the
same change, screenshots come only from the capture harness, and the commit says `Docs: <pages>` or
`Docs: none, <why>`. The line comes back after a compaction or a `/clear`, and every sub-agent that acts gets
it too. Read-only agent types (a search, a planner) get nothing, and so does every project without the file.

**A writer contract.** Pages are split by reader into up to three roots (a Guide for users, Developers for
integrators, Admin for operators), each with a list of what it may and may not contain, and a public root never
links into a private one. Every page has the same frame: frontmatter where the target reads it, a two-to-four
sentence opening summary, one topic, a line budget, and its place in the nav manifest. Every command and flag
on a page was run before it was written. The project's copy lives at `.agents/docs-contract.md`, so nothing
written for agents lands in the user docs.

**Screenshots are code.** A picture is the output of a named shot in the project's capture harness, taken from
the built product on its own port with scratch data, a pinned clock, a fictional cast, faked third parties and
animations off; captured at 2x and shown at 1x; light and dark when the product themes; cropped, never scaled;
secrets masked. That is what lets a change retake exactly the pictures it made wrong. `capture-recipes.md` has
a harness per stack: Playwright for web and Electron, text-first output capture and VHS for terminals, an
automation test with `-RenderOffscreen` for Unreal, `QWidget::grab()` for Qt, simulator commands for mobile,
and executable examples for libraries with no UI.

**One checker.** `scripts/docs-check.mjs` (one file, Node standard library only, copyable into CI) checks what
a script can: images exist and have their dark twin, no image is orphaned, links resolve (markdown, MDX, and
wiki links), no public page leaks into a private root, the nav manifest and the pages agree, frontmatter,
summary, budget, and per-root deny patterns. With git it also maps code to docs: `--changed` reports a surface
whose code changed while its pages and shots did not, and `--stale` reports a shot taken before its surface's
code last changed. Exit 0, 1 or 2, so CI can gate on it.

**Told in session, failed in CI.** A Stop hook runs the checker on the working tree. When a turn's changes
left the docs behind it tells the agent, which gets one more go at the turn, and shows you one short line. The
same findings reach the agent once a session; after that only your line repeats. It never blocks. The same
script in CI fails the pull request.

**A README for people.** A README in a repo agents build fills up with prompts, rule restatements and
plumbing paths. `scripts/readme-check.mjs` holds one to 800 words, standard-readme's section order, and no
agent plumbing, and the `readme` skill rewrites one that fails, moving every sentence it cuts to
`CONTRIBUTING.md`, `docs/`, `AGENTS.md` or the changelog. It runs by hand anywhere; the Stop hook runs it on a
README a turn changed only where the config carries a `readme` block.

## Install

```
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install docs-parity@agentic-engineering
```

Then, in a project: `/docs-parity:docs-init`. Node 22 or newer is the only requirement; nothing is installed
into the project but the config and the contract, and a copy of the checker if you want it in CI.

Coming from 0.1: the config is read as it is. The writer contract moves from `.agents/contracts/docs.md` to
`.agents/docs-contract.md` at the next session start, and a `docs_check.py` your CI still runs keeps working
until you swap it for the Node copy.

## Skills

| Skill | Invoked by | What it does |
|---|---|---|
| `docs-parity` | the model | The rule and the router: what counts as user-visible, which skill to open. |
| `docs-init` | you | Detects the stack and the docs target, then writes the config, with a first code-to-docs surface map, and the writer contract. Copies the checker in for CI on request. |
| `docs-sync` | the model | The in-loop pass: diff to pages and shots, rewrite, retake, check, and write the `Docs:` line. |
| `docs-shots` | the model | Builds or extends the capture harness to the shot contract. |
| `docs-audit` | you or the model | Reads the whole docs set against the product and reports what drifted. Edits nothing. |
| `readme` | the model | Rewrites a README to the skeleton and moves the rest to its proper home. |

## Works with

- **but-first-planning**: `build-tdd` updates docs in the same change for every `User-facing: yes` issue, and
  `build-user-docs` becomes the coherence pass over the whole set, both deferring to this contract.
- **agent-works**: owed harness work and audit fixes go on its kanban as cards.
- **perceptual-loop**: any capture harness can double as its render command, so its gates catch a docs picture
  that changed when nothing should have, and `calibrate-gate` measures whether two runs of a shot agree.
- **write-like-me**: carries the prose voice when installed.

Each is optional; docs-parity runs alone.
