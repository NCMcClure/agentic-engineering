# The repository-layout page

Progressive disclosure is not only how the spec is organized
([PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md)); it is how the built
source tree should read too. An agent dropped into the repo should learn what
to read before it reads: orient at the root, descend one hub at a time, open
only the files that matter.

That gives this file two jobs: what the *spec* must say about the tree before
any of it exists, and the three hub rules a drawn tree has to obey. Checking a
built tree against those rules is not this plugin's: if agent-works is
installed, its hub check does it; without it the rules are kept by hand.

## The mandatory page: `repository-layout.md`

A content file named exactly `repository-layout.md` (the exact filename is the
machine contract: `verify-spec-tree.mjs` warns when it is missing), in
whichever category fits (a platform or engineering category is the usual
home). Nothing on it is a new decision: the layout is derived from decisions
the spec already made, which is exactly why it belongs in the spec. Two
implementers starting from these pages should produce the same tree.

It carries:

- **Organizing rules**, a handful, stated as rules with consequences. The
  first is always some form of *the source tree mirrors the spec*: one module
  directory per spec category (or an explicit, justified mapping), so a reader
  goes from any spec page to the directory that implements it without needing
  a mapping document.
- **The top-level tree**, a fenced tree of the repo root with a one-line
  comment per entry, including where the `AGENTS.md` hubs sit.
- **The module map**, a table: directory, spec category, what lives inside.
  This is the 1:1 map the mirror rule promises.
- **Thin entrypoints**: where the `main`s live, and the rule that they carry
  wiring only. Logic in an entrypoint is a layout bug.

`spec-architect` pressure-tests this page like any interface: does each module
have locality (one place per concern), do the hub rules hold on the drawn
tree, would a change ripple across module boundaries?

## What the page must respect

Draw the tree so it already satisfies the hub rules, rather than leaving the
first builder to discover the conflict:

- A directory that carries an `AGENTS.md` holds no source files directly. Code
  lives in subdirectories. Manifests, README, LICENSE, dotfiles, CI config,
  and tool config files are exempt, as is a language's package marker where
  one is mandatory (`__init__.py`, for instance): keep it a thin marker, never
  a module.
- Every non-leaf code directory has a hub; a leaf directory does not, because
  its parent's one line already covers it.
- A hub names its direct children only. Files two levels down are found by
  descending, not by reading a manifest at the root.

Do not restate them on the spec page: the repo's root `AGENTS.md` carries
them. Draw a tree that obeys them.

## Who fills the hubs in

The root `AGENTS.md` exists before any code does: `spec-init` writes it when
the repo has none, and in a repo on team conventions it was already there.

Below the root, hubs appear as the tree from `repository-layout.md`
materializes: a builder that creates a directory writes its hub in the same
change (`build-tdd`'s hub duty). Where the root has a `CLAUDE.md` that
imports `AGENTS.md`, each new hub gets the same sibling (a `CLAUDE.md` whose
whole content is `@AGENTS.md`), so a Claude Code session working in that
directory loads the hub.
