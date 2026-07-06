# Progressive disclosure

The organizing idea behind the whole spec: make the cost of *knowing what to
read* much lower than the cost of *reading*. A reader — human skimming the
website, or an agent pulling context — should reach the one file they need
without loading the whole tree. Every layout and frontmatter rule exists to
protect this property.

## The problem it solves

A spec grows over weeks and months; a reader's attention (and an agent's context
window) does not. The naïve options all fail:

- **Read everything** — impossible past a trivial size, and wasteful.
- **Read nothing** — the reader rediscovers the same material every time.
- **Semantic/embedding retrieval** — adds a runtime dependency, drifts as files change, and answers "what's similar" rather than "what should I read".

Progressive disclosure sidesteps the false choice with cheap, curated layers.

## The five levels

| Level | Artifact | Question it answers |
|-------|----------|---------------------|
| 1 | Root `index.md` | Which category matters? |
| 2 | Category `index.md` | Which file in that category? |
| 3 | Frontmatter (`summary` + `tags`) | Is this file relevant, in its current state? |
| 4 | Full file body | What does it actually say? |
| 5 | `relates-to` cross-references | Where does the trail continue? |

A reader hits Level 1 once, Levels 2–3 a few times while narrowing, and Level 4
for one to three files. Level 5 only when one file wasn't enough. **The cardinal
rule: descend only when the cheaper level was insufficient.** If the summary
answered the question, don't open the body.

## How authoring decisions follow from it

Every rule in [FILE-LAYOUT.md](FILE-LAYOUT.md) and [FRONTMATTER.md](FRONTMATTER.md)
exists to keep one of these levels honest:

- **Thin, scoped indexes** (Levels 1–2) — if an index lists every file in the tree, Levels 1–2 collapse into one expensive read. One line per direct child.
- **Mandatory, accurate frontmatter** (Level 3) — triage only works if every file advertises its current state. A stale summary silently routes readers wrong.
- **Small, single-topic files** (Level 4) — an oversized file's summary can't accurately describe it, so Level 3 stops working for it.
- **`relates-to` trails** (Level 5) — the reader shouldn't have to *discover* the next file; the current one points at it.
- **Prefer updating over creating** — a new file adds a new summary the reader must learn at Level 3; updating refreshes one line. Create only when a topic has no home.

## It recurses

The same pattern shows up wherever cost-to-evaluate matters, including in this
skill suite itself: a `SKILL.md` is a hub that points at reference files which
load only when needed; the spec website is a root index pointing at categories
pointing at files. When you author, you're applying the same shape the reader
will use to navigate. Get the structure right and navigation stays cheap; let it
drift and the cost model quietly breaks — which is what the verifier is there to
catch.

## What it is not

- **Not lazy-loading for performance** — the motivation is attention and context, not disk speed.
- **Not RAG** — no embeddings, no vector store. Lexical matching on curated tags and summaries is enough *because* the summaries are curated.
- **Not access control** — anyone can read any file. The structure guides attention; it doesn't gate it.
