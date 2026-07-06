# Motion API Reference (Motion / Framer Motion v12+)

This is the API surface and pattern library for **Motion** (formerly Framer Motion, v12+) — the React animation library these recipes assume. If you're animating on a different target (vanilla CSS/JS, SVG, another framework), the *principles* in the motion-design references still apply; the specific code here would need porting. The presentation-style examples (slides, progress bars) are illustrative — the components and hooks are general-purpose.

## Import

```tsx
import { motion, AnimatePresence, MotionConfig } from "motion/react"
import { useInView, useScroll, useTransform, useSpring } from "motion/react"
```

## Core Components

### `motion.*` — Animated Elements

Any HTML/SVG element can be animated by prefixing with `motion.`:

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -10 }}
  transition={{ type: "spring", duration: 0.5, bounce: 0 }}
/>
```

Key props:
- `initial` — Starting state (or `false` to skip mount animation)
- `animate` — Target state
- `exit` — State when removed (requires `AnimatePresence` parent)
- `transition` — Timing/easing configuration
- `whileInView` — Animate when element enters viewport
- `whileHover` / `whileTap` — Gesture-driven states
- `variants` — Named animation states for orchestration
- `layout` — Animate layout changes automatically

### `AnimatePresence` — Exit Animations

Wraps children that may be conditionally rendered. Enables exit animations:

```tsx
<AnimatePresence mode="wait">
  {isVisible && (
    <motion.div
      key="unique"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    />
  )}
</AnimatePresence>
```

Modes:
- `"sync"` (default) — Children animate in/out simultaneously
- `"wait"` — Outgoing completes before incoming starts
- `"popLayout"` — Exiting element removed from layout flow immediately

### `MotionConfig` — Global Configuration

Wraps presentation to set defaults:

```tsx
<MotionConfig reducedMotion="user">
  {/* All motion.* children respect prefers-reduced-motion */}
</MotionConfig>
```

Props:
- `reducedMotion` — `"user"` (respect OS setting) or `"never"` (always animate)
- `transition` — Default transition for all children

## Hooks

### `useInView` — Viewport Detection

```tsx
const ref = useRef(null)
const isInView = useInView(ref, { once: true, amount: 0.5 })
```

Options:
- `once` — Only trigger once (good for slide content)
- `amount` — How much of element must be visible (0-1)
- `margin` — Expand/shrink detection area

### `useScroll` — Scroll Progress

```tsx
const { scrollYProgress } = useScroll({
  target: ref,
  offset: ["start end", "end start"]
})
```

Returns `MotionValue` objects (0-1 range) for scroll position.

### `useTransform` — Value Mapping

```tsx
const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 0])
const scale = useTransform(scrollYProgress, [0, 1], [0.8, 1])
```

Maps one MotionValue range to another. Runs on the animation frame, no re-renders.

### `useSpring` — Smooth Value Interpolation

```tsx
const smoothValue = useSpring(motionValue, {
  stiffness: 300,
  damping: 30,
  mass: 1
})
```

Adds spring physics to any MotionValue.

## Transition Types

### Spring (recommended for UI)

```tsx
transition={{ type: "spring", duration: 0.45, bounce: 0 }}
transition={{ type: "spring", stiffness: 300, damping: 30 }}
```

### Tween (explicit duration)

```tsx
transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
transition={{ duration: 0.3, ease: "easeOut" }}
```

### Per-Property

```tsx
transition={{
  opacity: { duration: 0.3 },
  y: { type: "spring", bounce: 0.1 },
  filter: { duration: 0.4 }
}}
```

## Variants — Orchestration Pattern

Used heavily in presentations for staggered reveals:

```tsx
const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } }
}

const item = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" }
}

<motion.div variants={container} initial="hidden" whileInView="visible">
  <motion.div variants={item} />
  <motion.div variants={item} />
  <motion.div variants={item} />
</motion.div>
```

## Layout Animations

```tsx
<motion.div layout />          // Animate when this element's layout changes
<motion.div layoutId="hero" /> // Animate between different instances sharing an ID
```

Layout animations use the FLIP technique. Pair with `AnimatePresence` carefully — exit animations can conflict.

## Presentation-Specific Patterns

### Slide Entrance (whileInView)

```tsx
<motion.section
  initial={{ opacity: 0.55 }}
  whileInView={{ opacity: 1 }}
  viewport={{ amount: 0.55 }}
  transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
/>
```

### Progress Bar (scaleX)

```tsx
<motion.div
  className="h-full origin-left rounded-full bg-primary"
  animate={{ scaleX: progress }}
  initial={false}
  transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
/>
```

### Staggered Content

```tsx
<motion.div
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, amount: 0.3 }}
  variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
>
  {items.map(item => (
    <motion.div key={item.id} variants={itemVariants} />
  ))}
</motion.div>
```

## Reference Files (this folder)

- [core-concepts.md](core-concepts.md) — motion components, variants, transitions
- [animation-patterns.md](animation-patterns.md) — Enter/exit, stagger, orchestration
- [layout-animations.md](layout-animations.md) — layout prop, layoutId, shared layout
- [scroll-driven.md](scroll-driven.md) — useScroll, useTransform, whileInView
- [performance.md](performance.md) — GPU properties, will-change, optimization
