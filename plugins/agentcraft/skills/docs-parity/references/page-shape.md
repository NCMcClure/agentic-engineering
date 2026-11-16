# Page shape

Every page has the same frame, so a reader can tell in five seconds whether the page answers their question,
and a script can check the frame.

## The frame

1. **Frontmatter** where the target reads it (sites always; plain markdown folders when a tool consumes it;
   wikis and READMEs never). The usual keys: `title`, `description` (one sentence: what the page lets the
   reader do), and `tags` (three to seven lowercase-hyphenated terms) when anything indexes them. The config's
   `frontmatter` list and `tags` range make them checkable.
2. **An opening summary**: two to four sentences right after the title that answer the page's question or say
   exactly where the answer is. No heading above it, no list, no picture first. A reader who stops here has
   what they came for. (`SUMMARY_MISSING`)
3. **Sections as the content demands,** each H2 a task or a concept the reader would search for. A screenshot
   sits right after the heading of the section it illustrates.
4. **One topic per page, under budget.** About 120 lines; the config's `pageBudget` (`PAGE_BUDGET`). A page
   that outgrows it splits by topic, not into "part 1" and "part 2".

## Order

The sidebar follows the nav manifest, never the file system: Fumadocs `meta.json`, MkDocs `nav:`, mdBook
`SUMMARY.md`, a wiki's `_Sidebar.md`, a Docusaurus `sidebars.*`. Pages are paced in the order a new reader
meets the product: what it is and install, a first task, one page per topic, then reference. A new page goes
into the manifest in that order (`NAV_MISSING`); a deleted page leaves it (`NAV_DEAD`).

## Form

- **Tables for structured facts** (roles and what each can do, options and defaults, steps and their result).
- **Prose for reasoning.** Why a step exists goes next to the step.
- **Bullets only for real lists.** Numbered steps for a procedure (a site's `Steps` component where it has
  one).
- **Callouts sparingly,** for the one warning that costs the reader something if missed.
- **Bold the UI's own words** (**Commit**, **Download at this version**) exactly as the screen spells them,
  so the reader can scan for them.

## Components (MDX sites)

Keep the set closed and listed in the contract: the site's own (`Callout`, `Cards`, `Steps`, `Tabs`) plus the
project's (`Figure`, a diagram set). A closed set is what lets a script convert the pages into anything else
(a handbook, a knowledge base, a PDF) and refuse a page that uses something it cannot convert, failing the
build with the file and line. Any derived copy should work this way.

## Voice

The project's voice, written once in the contract. The defaults: warm and specific, the reader as "you", no
em-dashes, no emoji, no hype words ("powerful", "seamless", "blazing"), state the mechanism instead. With
write-like-me installed, it carries the voice.

## Grounding

Every command, flag, path, default, limit and example on a page was run or read from the built product before
it was written. Spec documents and issue text supply the vocabulary; they are never evidence that a flag
exists.
