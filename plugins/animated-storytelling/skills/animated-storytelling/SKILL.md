---
name: animated-storytelling
description: >-
  Make an idea land by working three levers — narrative arc, visual hierarchy
  (type, color, composition), and tasteful accessible animation (Motion /
  Framer Motion). Use when content "reads flat" or "is just bullet points",
  when a page / hero / explainer / diagram should be animated or "brought to
  life", when a transition needs easing/timing/spring choices or polish, or
  when something should look more professional — fix hierarchy, pick type or
  color — even when the user never says "narrative" or "animation".
---

# Animated Storytelling

This skill helps you make an idea **land** — to take a concept, story, explainer, pitch, or page and either give it a real dramatic arc, bring it to life with motion, or both. It pulls together five bodies of craft knowledge: narrative structure (NCP), visual design (hierarchy, typography, color), motion-design philosophy, the Motion/Framer Motion API, and a catalog of production animation recipes.

The detailed knowledge lives in `references/`. This file is the map: it tells you which lever to reach for, how to sequence the work, and where to read for depth. **Read the relevant `references/*/overview.md` before making design decisions** — the overviews are short and route you to the deep files only when you need them.

## The three levers

Most requests want one or more of these. Name which you're doing before you start — it keeps the work honest.

### Lever 1 — Narrative (give the idea an arc)
Use this when content "reads flat," is "just a list," is ordered by topic instead of by tension, or needs to *persuade* or *transform* an audience rather than merely inform. Also use it to **diagnose and repair** an existing piece: find the missing beats, the throughline that never pays off, the reveal that comes too early.

→ Start at **`references/narrative/overview.md`** (NCP storyform: thesis, two throughlines, signposts, beats, dynamics). Then:
- `references/narrative/storybeats.md` — beat-by-beat structure + a full worked 10-beat example (read when actually drafting beats).
- `references/narrative/perspectives-and-dynamics.md` — POV choices and how `story_outcome` / `mc_resolve` shape the ending.
- `references/narrative/from-story-to-medium.md` — turning the storyform into concrete units (counts per act, transition intensity, the complexity tiers below).

### Lever 2 — Visual (make the idea credible)
Use this when a piece "looks amateur," everything on screen competes for attention, the type or color feels arbitrary, or it's pretty but doesn't sell. Visual design is the credibility layer: it decides what matters on screen *right now*, so the narrative gets a fair hearing and motion has a hierarchy to amplify.

→ Start at **`references/visual-design/overview.md`** (the three-lever handshake, symptom routing, the five-point quick audit). Then:
- `references/visual-design/hierarchy-and-composition.md` — the squint test, the ranked hierarchy toolkit, reading gravity, grids, whitespace as budget.
- `references/visual-design/persuasion-and-craft.md` — credibility signals, layout as story progression, hero moments, the Craft Pass.

### Lever 3 — Motion (make the idea felt)
Use this when something static should move, when an entrance/reveal needs polish, when a mechanism would "click" if you could *see* it animate, or when existing animation feels janky, gratuitous, or inaccessible.

→ Start at **`references/motion-design/overview.md`** (the *why* and *when*: three designer lenses, the enter recipe, the decision framework, the golden rules). Then drop down as needed:
- `references/motion-api/` — the *how* in code (Motion / Framer Motion: `motion.*`, `AnimatePresence`, `useScroll`/`useTransform`, variants, layout animations, performance; the pinned version lives in its overview.md).
- `references/creative-recipes/` — bespoke, memorable patterns for the 2-3 showcase moments (state machines, SVG choreography, streaming feeds, interactive mocks, visual metaphors). These are recipes to *adapt*, not components to import.
- Always honor `references/motion-design/accessibility.md` — `prefers-reduced-motion` is non-negotiable.

## A decision guide

- **Just informing, order is fine, but it's lifeless visually** → Motion only. Polish entrances with the Jakub enter recipe; pick 1-2 showcase moments.
- **Logically complete but unpersuasive / flat / arbitrary order** → Narrative first. Build or repair the arc, *then* decide where motion earns its keep.
- **Looks amateur / untrustworthy / "something is off"** → Visual first: hierarchy + type scale + one accent, before any motion.
- **A new explainer/pitch/story from scratch** → Narrative skeleton → visual system (scale, palette, grid) → motion on the beats that carry the insight.
- **"Make this feel alive"** on an existing UI/page → Motion-led, but ask what the *one* idea is so the showcase moment reinforces it.

### Spend effort where it lands: the complexity tiers
Not every moment deserves bespoke work — the contrast is what makes a showcase land. From `references/narrative/from-story-to-medium.md`:
- **Standard (60-70%)** — polished defaults: the enter recipe + stagger. Context, bullets, simple data.
- **Enhanced (20-30%)** — a default base with custom behavior: animated counters, highlighted code, a scroll-driven reveal. Evidence, process, before/after.
- **Showcase (2-3 total)** — fully bespoke, essentially a tiny interactive app. The pivot, the primary evidence, the emotional closer. Pull from `references/creative-recipes/`. Never more than three.

Standard presumes the visual system is already right; showcase moments stack all three levers per `references/visual-design/persuasion-and-craft.md`.

## The creative workflow

Each step ends on a checkable state — don't move on while one is unmet:

1. **Name the goal and the lever(s).** *Done when* you can state, in one
   sentence, what the audience should believe/feel/do after, and which
   lever(s) you're pulling.
2. **If story-shaped, build the narrative skeleton first** (NCP storyform).
   Motion on a broken arc is polish on sand. *Done when* the storyform names
   the thesis, both throughlines, and every act's beats — no empty slots.
3. **Establish the visual system.** *Done when* the type scale, spacing
   scale, palette roles, and grid are written down — every size and color
   used later must appear in them.
4. **Locate the moments worth a showcase.** Usually the narrative pivot and
   the primary evidence. *Done when* there are at most 3 showcases and each
   names the beat it serves; everything else is standard/enhanced.
5. **For each showcase, run the creative process** (from
   `creative-recipes/overview.md`). *Done when* concept, what makes it
   *visceral*, the closest recipe, and what you're adapting each have a
   written one-line answer.
6. **Implement with the right physics** (`motion-design/technical-principles.md`
   + `motion-api/`). *Done when* only GPU-friendly properties animate and a
   reduced-motion fallback exists for every animation.
7. **Review before shipping.** *Done when* the five-point audit in
   `visual-design/overview.md` passes (contrast pairs verified by
   `scripts/contrast_check.py`, exit 0) and every animation passes the golden
   rules (`motion-design/golden-rules.md`): names its job
   (orientation/feedback/continuity), survives the 10th viewing, exits
   subtler than entrances.

## Scope & honesty

- The motion **code** assumes a React + Motion web context (version pinned in `references/motion-api/overview.md`). The motion **principles** — timing, easing, restraint, staggering, accessibility, narrative arc — are universal; on other targets (vanilla CSS/JS, native, video), carry the principles over and port the code.
- NCP here is a deliberately minimal subset (2 throughlines) tuned for communication pieces, not the full theory. It's enough to give almost any idea a spine.
- When adapting a recipe, say what you changed and why — these are starting points, not drop-in components.

## Reference map

```
references/
├── narrative/         overview · schema-overview · storybeats · perspectives-and-dynamics · from-story-to-medium
├── visual-design/     overview · hierarchy-and-composition · typography · color-and-contrast · persuasion-and-craft
├── motion-design/     overview · golden-rules · emil-kowalski · jakub-krehel · jhey-tompkins · accessibility · technical-principles
├── motion-api/        overview · core-concepts · animation-patterns · layout-animations · scroll-driven · performance
└── creative-recipes/  overview · state-machines · svg-choreography · streaming-simulations · interactive-mocks · visual-metaphors
```
