# Core Concepts

## Motion Components

Any HTML or SVG element can be animated by using the `motion` prefix:

```tsx
import { motion } from "motion/react"

<motion.div />
<motion.span />
<motion.svg />
<motion.path />
<motion.button />
```

Motion components accept all standard props plus animation props.

## Animation Props

| Prop | Purpose | Type |
|------|---------|------|
| `initial` | Starting state (or `false` to skip) | Object or string (variant name) |
| `animate` | Target state | Object or string |
| `exit` | State when removed from DOM | Object or string |
| `transition` | Timing/easing config | Object |
| `whileInView` | State when in viewport | Object or string |
| `whileHover` | State on hover | Object or string |
| `whileTap` | State while pressed | Object or string |
| `whileFocus` | State while focused | Object or string |
| `whileDrag` | State while dragging | Object or string |

## Variants

Named animation states that enable orchestration:

```tsx
const variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
}

<motion.div
  variants={variants}
  initial="hidden"
  animate="visible"
/>
```

### Variant Propagation

When a parent has variants, children automatically inherit the same variant names:

```tsx
const parent = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } }
}

const child = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 }
}

<motion.ul variants={parent} initial="hidden" animate="visible">
  <motion.li variants={child} /> {/* Inherits "hidden"/"visible" from parent */}
  <motion.li variants={child} />
  <motion.li variants={child} />
</motion.ul>
```

Children don't need their own `initial`/`animate` — they follow the parent's current variant.

### Orchestration Properties (in parent variants)

| Property | Effect |
|----------|--------|
| `staggerChildren` | Delay between each child's animation start |
| `delayChildren` | Delay before first child starts |
| `staggerDirection` | 1 (forward) or -1 (reverse) |
| `when` | "beforeChildren" or "afterChildren" |

## Transition Types

### Spring (default for physical values)

```tsx
transition={{ type: "spring", duration: 0.5, bounce: 0 }}
transition={{ type: "spring", stiffness: 200, damping: 20 }}
```

### Tween (explicit control)

```tsx
transition={{ type: "tween", duration: 0.4, ease: "easeOut" }}
transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
```

### Inertia (velocity-based)

```tsx
transition={{ type: "inertia", velocity: 200 }}
```

### Per-Property Transitions

```tsx
transition={{
  default: { type: "spring", duration: 0.4 },
  opacity: { duration: 0.2, ease: "linear" },
  filter: { duration: 0.3 }
}}
```

## Keyframes

Animate through multiple values:

```tsx
<motion.div
  animate={{
    x: [0, 100, 50, 100],
    opacity: [0, 1, 1, 0]
  }}
  transition={{
    duration: 2,
    times: [0, 0.3, 0.7, 1], // Normalized time points
    repeat: Infinity
  }}
/>
```

## MotionValue

Reactive values that bypass React renders:

```tsx
import { useMotionValue, useTransform } from "motion/react"

const x = useMotionValue(0)
const opacity = useTransform(x, [-100, 0, 100], [0, 1, 0])

<motion.div style={{ x, opacity }} />
```

MotionValues update on the animation frame without triggering component re-renders.

## Gestures

```tsx
<motion.button
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
  transition={{ type: "spring", stiffness: 400, damping: 17 }}
/>
```

## Viewport Detection

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.5 }}
/>
```

`viewport` options:
- `once` — Only animate on first entry (default: false)
- `amount` — Required visibility ratio (0-1)
- `margin` — Expand/shrink trigger area (CSS margin syntax)
- `root` — Custom scroll container (default: window)
