# Persuasion & Craft — Designing to Sell an Idea

The other files in this section make a piece *correct*. This one makes it *convincing*. The difference is real and measurable: audiences extend more patience, more belief, and more benefit of the doubt to work that looks cared-for. Use that honestly.

## The Aesthetic-Usability Effect, Framed Honestly

People rate attractive things as easier to use and more trustworthy — before and even after evidence says otherwise. That's the aesthetic-usability effect, and it cuts both ways: polish buys patience and belief, and its absence taxes them. A rough-looking piece makes the audience audit every claim; a crafted one makes them lean in.

This isn't cheating. **Craft is evidence of care, and care is the argument.** An audience reasoning "they sweated the pixel grid, they probably sweated the data" is making a mostly-valid inference — sloppiness genuinely does correlate across a piece of work. Your job is to make sure the inference available to them is true: polish the presentation *because* the substance deserves a fair hearing, never to paper over substance that's missing.

## The Credibility-Signals Checklist

These are the details audiences never consciously notice but always subconsciously score. All are cheap; run the list:

- **Aligned everything** — every edge on the grid; one 3px orphan undoes fifty aligned elements
- **Consistent spacing scale** — all gaps from the 4/8px scale (see [hierarchy-and-composition.md](hierarchy-and-composition.md)); no freehand values
- **Real content over lorem** — placeholder text in a pitch says "we didn't finish"; write plausible real copy even for mocks
- **Coherent icon weights** — one icon set, one stroke width; a 1.5px icon beside a 2px icon reads as "assembled from parts"
- **No default-blue links in a branded piece** — `#0000EE` announces that nobody styled this
- **Favicon-level details** — the tab title, the favicon, the social-card image, the `::selection` color; the audience meets these before your headline

None of these will be praised. All of them are being counted.

## Layout as Story Progression

The scroll is the act structure. If every viewport of a piece has the same density and layout, the story has a monotone voice no matter what the words say. Change the visual register at the signposts — the act boundaries defined in `../narrative/storybeats.md`:

| Act | Layout register | Why |
|-----|----------------|-----|
| Opening / hook | Full-bleed hero, one claim, maximum whitespace | Confidence; nothing to hide |
| Evidence / body | Measured columns, grid-disciplined, denser | Rigor; the receipts section should *look* like receipts |
| Pivot | A deliberate layout break — full-bleed again, or an escape from the grid | The audience feels the turn before reading it |
| Closer / CTA | Spacious again, single focal point | Room for the decision you're asking for |

**One idea per viewport** for pitch pieces: if a scroll position shows two competing messages, split them. The audience scrolls at their own pace; each stop on that scroll is a slide, whether you designed it as one or not.

## Hero Moments: All Three Levers Stacked

A hero moment is where narrative, visual, and motion converge on the same beat — the showcase tier from `../creative-recipes/overview.md`, seen from the visual side. What earns full-bleed treatment:

- **The pivot** — the paradigm shift the piece exists to deliver
- **The number that matters** — the one stat the audience must repeat tomorrow
- **The demo** — the mechanism, seen working

And only those. A hero moment stacks all three levers deliberately: maximum hierarchy (biggest type on any view, most whitespace, the grid break if you're spending one), the accent color (this is where the story *is*), and the bespoke motion treatment (the 600–1000ms earned reveal). Budget 2–3 per piece — the same budget as showcase animations, because they're the same moments. A fourth hero is how the first three stop being heroes.

## Before/After: The Highest-Leverage Persuasion Pattern

Nothing sells like a delta the audience can *see*. The pattern:

1. **Make the before honestly drab.** Muted neutrals, flat layout, no motion — recognizably the mediocre reality, not a strawman. A cartoonishly broken "before" tells the audience you needed to cheat, and they'll re-audit everything else.
2. **Let visual + motion carry the delta.** The "after" gets the accent, the contrast, the spring physics. The palette shift and the animation *are* the argument — see [color-and-contrast.md](color-and-contrast.md) on before/after color, and `../creative-recipes/interactive-mocks.md` for the interactive version where the audience triggers the transformation themselves. A delta they cause lands harder than one they watch.
3. Keep both sides structurally identical — same content, same layout skeleton — so the only variable is the thing you're selling.

## The Craft Pass

A named final sweep, run once on the finished piece, no exceptions. Ten items, each pass/fail:

1. Orphans — no lone word stranded on the last line of a display heading
2. Ragged edges — no jarring rag in large type; rebreak lines by hand if needed
3. Inconsistent radii — one radius scale (e.g. 4/8/16px), applied by element size
4. Misaligned baselines — text in side-by-side columns sits on a shared baseline
5. Contrast fails — re-check muted text and accent-on-surface (4.5:1 / 3:1)
6. Mixed icon weights — one set, one stroke width, everywhere
7. Off-scale spacing values — grep the styles for gaps not on the spacing scale
8. Default focus rings in a branded piece — style `:focus-visible`; never remove it
9. Fake data that reads fake — "$1,234,567" and "John Doe" break the spell; use plausible values
10. Unstyled scrollbars where they matter — a default gray scrollbar inside a polished dark panel is a costume tear

Thirty minutes, once, at the end. It's the difference between "this looks professional" and "something feels off" — and the audience will never tell you which item tipped them, because they don't know.

## When NOT — Persuasion ≠ Deception

Every technique here amplifies a true argument; none may replace one.

- **Polish the argument, never fake the evidence.** Real numbers in the hero stat, honest axes on charts, a "before" that's fair. If the piece only works with a rigged comparison, the problem is upstream of design.
- **Don't stack persuasion patterns on weak claims.** A hero moment spent on a stat that can't survive a follow-up question converts credibility into liability at the worst possible moment.
- **Skip the theater for internal/technical audiences.** A design-savvy or engineering audience reads excessive polish on thin content as *inverse* signal. For them, run the Craft Pass, keep the hierarchy clean, and cut the drama — density and precision are what read as care.
