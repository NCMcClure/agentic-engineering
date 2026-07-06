# Animated Storytelling

Most ideas don't fail because they're wrong — they fail because they're presented in bullet points.

This plugin works the overlooked intersection of three crafts: **narrative** (what order things land in), **visual design** (what the eye believes), and **motion** (what change feels like). Any one of them is nice. The intersection is what hooks people — a real arc, rendered with credible hierarchy, animated only where the story earns it.

## What's inside

One skill, five reference sections, 29 files of distilled craft:

| Section | One-liner |
|---------|-----------|
| `narrative/` | A deliberately minimal NCP storyform — throughlines, beats, dynamics — enough to give almost any idea a spine |
| `visual-design/` | The credibility layer: hierarchy, type scales, color roles, and the Craft Pass that separates "polished" from "something feels off" |
| `motion-design/` | When and why to animate — three designer philosophies, golden rules, durations, and non-negotiable accessibility |
| `motion-api/` | The how, in code: Motion (Framer Motion v12) — variants, layout animation, scroll-driven, performance |
| `creative-recipes/` | Bespoke showcase patterns: state machines, SVG choreography, streaming feeds, interactive mocks, visual metaphors |

## How to use

Invoke `/animated-storytelling`, or just ask for the outcome:

- "This deck reads flat."
- "Make this hero feel alive."
- "Why does this look cheap?"

The skill triggers itself on requests like these. If it triggers too eagerly for your taste, re-add `disable-model-invocation: true` to the SKILL.md frontmatter.

## Honesty box

- The motion **code** assumes React + Motion v12; the **principles** (timing, restraint, hierarchy, accessibility) are universal and port anywhere.
- NCP here is a deliberately minimal subset of the full theory — tuned for communication pieces, not screenplays.
- The recipes are starting points to adapt, not components to import.

## Changelog

- **0.1.0** — Promoted to a plugin; added the visual-design pillar.
