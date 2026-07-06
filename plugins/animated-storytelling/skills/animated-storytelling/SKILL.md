---
name: animated-storytelling
description: >-
  Craft, revise, and enhance concepts, ideas, stories, explainers, and pitches
  by giving them an intentional narrative arc and/or bringing them to life with
  animation. Three levers: (1) NARRATIVE — diagnose or build a dramatic arc with
  perspectives, beats, and tension so a piece stops reading like a flat list;
  (2) VISUAL — establish hierarchy, typography, color, and composition so the
  piece looks credible and the eye lands where the story needs it;
  (3) MOTION — design and implement tasteful, accessible animation (Motion /
  Framer Motion, scroll-driven, SVG choreography, streaming feeds, interactive
  mocks, visual metaphors) that makes an idea felt, not just stated. Use this
  whenever the user wants to make a concept land harder, restructure something
  that "reads flat" or "is just bullet points," add story/dramatic arc to
  content, animate or "bring to life" a webpage / hero / explainer / diagram /
  data story, pick easing/timing/spring for a transition, decide which moments
  deserve bespoke animation, or polish existing animation — even when they don't
  say "narrative" or "animation" outright but are reworking how an idea is told
  or shown. Also use it to make something look more polished, professional, or
  premium, fix visual hierarchy, or choose type or color for a pitch or landing
  page.
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
- `references/motion-api/` — the *how* in code (Motion / Framer Motion v12: `motion.*`, `AnimatePresence`, `useScroll`/`useTransform`, variants, layout animations, performance). Code assumes React + Motion; the principles port, the syntax may not.
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

1. **Name the goal and the lever(s).** What should the audience believe/feel/do after? Narrative, motion, or both?
2. **If story-shaped, build the narrative skeleton first** (NCP storyform). Get the arc and the throughline tension right before any visuals — motion on a broken arc is polish on sand.
3. **Establish the visual system** (type scale, spacing scale, palette roles, grid) — 15 minutes here saves every later step.
4. **Locate the 1-3 moments worth a showcase.** Usually the narrative pivot and the primary evidence. Everything else is standard/enhanced.
5. **For each showcase, run the creative process** (from `creative-recipes/overview.md`): What's the concept? What makes it *visceral*? Which recipe is closest? What do I adapt?
6. **Implement with the right physics** (`motion-design/technical-principles.md` + `motion-api/`): real spring/easing values, GPU-friendly properties, reduced-motion fallback.
7. **Review against the golden rules** (`motion-design/golden-rules.md`): does each animation serve orientation/feedback/continuity? Does it survive the 10th viewing? Are exits subtler than entrances?

## Scope & honesty

- The motion **code** assumes a React + Motion (Framer Motion v12) web context. The motion **principles** — timing, easing, restraint, staggering, accessibility, narrative arc — are universal; on other targets (vanilla CSS/JS, native, video), carry the principles over and port the code.
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
