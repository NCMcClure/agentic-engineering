# Jakub Krehel — Production Polish

Frontend designer known for refined, production-ready motion. His work emphasizes subtle details that make interfaces feel premium without being flashy.

## Core Philosophy

> "The difference between good and great is in the details nobody can point to but everyone can feel."

Jakub's approach centers on **polish recipes** — repeatable patterns that consistently produce professional results.

## The Enter Animation Recipe

The foundational pattern for any element appearing on screen. **This file is
the canonical home of the recipe's values** — other references point here
rather than restating them:

```tsx
initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
transition={{ type: "spring", duration: 0.45, bounce: 0 }}
```

Three properties working together:
- **Opacity** — Element materializes (not just appearing)
- **TranslateY** — Slight upward motion creates "rising into place"
- **Blur** — Creates a "coming into focus" effect

Adjust `y` offset by element size:
- Small elements (badges, icons): 4-6px
- Standard content (cards, text blocks): 8-12px
- Large elements (hero sections, full images): 16-24px

## Exit Animation Subtlety

Exits should be quieter than entrances:

```tsx
// Entrance: full movement
initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}

// Exit: subtle, doesn't compete
exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
```

Use fixed small values for exit translateY rather than mirroring the entrance distance.

## Shadows Over Borders

On varied or dynamic backgrounds, prefer multi-layer box-shadows:

```css
box-shadow:
  0px 0px 0px 1px rgba(0, 0, 0, 0.06),
  0px 1px 2px -1px rgba(0, 0, 0, 0.06),
  0px 2px 4px 0px rgba(0, 0, 0, 0.04);
```

**Why:** Shadows use transparency and adapt to any background. Solid borders are absolute colors that can clash.

For presentations: Use shadows on floating elements (cards, concept tiles) and borders only for deliberate structural lines.

## Optical Alignment

Mathematical centering isn't always visual centering:
- **Play button icons** — Shift right ~2px to account for triangle weight
- **Buttons with icons** — Reduce padding on the icon side
- **Asymmetric shapes** — Trust your eyes over the pixel grid

## Spring Configuration

| Context | Config | Effect |
|---------|--------|--------|
| Professional UI | `bounce: 0` | Smooth stop, no overshoot |
| Slight life | `bounce: 0.05` | Nearly imperceptible bounce |
| Playful | `bounce: 0.15-0.25` | Visible bounce, friendly |
| Celebration | `bounce: 0.3+` | Exuberant, use sparingly |

For presentations: Default to `bounce: 0`. Use `0.05-0.1` for title slides and key reveals. Reserve higher for playful content.

## Icon State Transitions

When icons change (loading → done, copy → check):

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={state}
    initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
    exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
    transition={{ duration: 0.2 }}
  />
</AnimatePresence>
```

## Hover State Minimums

Any hoverable element needs at minimum 150ms transition on color/background changes. Instant hover flashes feel broken.

## Layout Animations (FLIP)

Use `layoutId` for elements that move between positions:
- Cards expanding to modals
- Tab content switching
- Grid items rearranging

Keep `layoutId` elements outside `AnimatePresence` to avoid animation conflicts.

## For Presentations

Jakub's recipes are the **backbone of slide content**:
- Every bullet point entering: use the enter recipe
- Every card/tile appearing: enter recipe + stagger
- Every comparison revealing: layout animation
- Every transition between slides: opacity recipe on the section
- Every floating element (chrome, navigation): shadow treatment
