# SVG Choreography

SVG path drawing, offset-path travel, and coordinated animations for visualizing connections, flows, and topology.

## Generalized Patterns

### Path Drawing (pathLength animation)

Animate a stroke from invisible to fully drawn using `pathLength`:

```tsx
const PATH = "M 50 80 C 100 20 200 120 250 80"

<motion.path
  d={PATH}
  fill="none"
  stroke={palette.accent}
  strokeWidth="3"
  strokeLinecap="round"
  initial={{ pathLength: 0 }}
  animate={{ pathLength: [0, 1, 1, 1] }}
  transition={{
    duration: 6,
    times: [0, 0.35, 0.95, 1],
    repeat: Infinity,
    ease: [0.45, 0.05, 0.2, 1],
  }}
/>
```

The `times` array creates a **hold-draw-hold** sequence:
- `[0, 0.35]` — draw the path (35% of cycle)
- `[0.35, 0.95]` — hold fully drawn (60% of cycle)
- `[0.95, 1]` — reset to empty (brief gap before restart)

### Elements Traveling Paths (CSS offsetPath + offsetDistance)

Move an element along an SVG path using CSS `offset-path` with Motion's `animate`:

```tsx
<motion.circle
  r="4"
  fill={palette.accent}
  animate={{
    opacity: [0, 0, 1, 1, 0, 0],
    offsetDistance: ["0%", "0%", "0%", "100%", "100%", "100%"],
  }}
  transition={{
    duration: 6,
    times: [0, 0.4, 0.42, 0.7, 0.72, 1],
    repeat: Infinity,
    ease: "easeInOut",
  }}
  style={{ offsetPath: `path('${PATH}')` }}
/>
```

Key: the `times` array coordinates opacity with position so the circle:
- Fades in AFTER it starts moving (avoids a static flash at 0%)
- Fades out BEFORE the cycle restarts (avoids jump-back visibility)

### Bidirectional Travel

Two elements traveling the same path in opposite directions, staggered:

```tsx
// Forward traveler (starts at 0%, ends at 100%)
<motion.circle
  r="4"
  fill={colorA}
  animate={{
    opacity: [0, 0, 1, 1, 0, 0],
    offsetDistance: ["0%", "0%", "0%", "100%", "100%", "100%"],
  }}
  transition={{
    duration: 6,
    times: [0, 0.4, 0.42, 0.7, 0.72, 1],
    repeat: Infinity,
    ease: "easeInOut",
  }}
  style={{ offsetPath: `path('${PATH}')` }}
/>

// Reverse traveler (starts at 100%, ends at 0%)
<motion.circle
  r="4"
  fill={colorB}
  animate={{
    opacity: [0, 0, 1, 1, 0, 0],
    offsetDistance: ["100%", "100%", "100%", "0%", "0%", "0%"],
  }}
  transition={{
    duration: 6,
    times: [0, 0.55, 0.57, 0.85, 0.87, 1],
    repeat: Infinity,
    ease: "easeInOut",
  }}
  style={{ offsetPath: `path('${PATH}')` }}
/>
```

The reverse traveler uses later `times` values so the two never overlap — one finishes before the other starts.

### Dashed Guide Paths

A static dashed path underneath the animated one provides visual context:

```tsx
<path
  d={PATH}
  fill="none"
  stroke={palette.border}
  strokeWidth="2"
  strokeLinecap="round"
  opacity="0.6"
  strokeDasharray="3 5"
/>
```

### Node Choreography

SVG groups with multi-axis animate arrays for elements moving between positions:

```tsx
<motion.g
  animate={{
    x: [startX, startX, endX, endX],
    y: [startY, startY, endY, endY],
    opacity: [0, 1, 1, 0],
  }}
  transition={{
    duration: CYCLE,
    times: [0, t(1.0), t(2.6), t(5.0)],
    repeat: Infinity,
    ease: [0.2, 0.6, 0.2, 1],
  }}
>
  {/* SVG content (rect, text, etc.) */}
</motion.g>
```

---

## Production Example: Lacing Animation

Visualizes knowledge flowing between two laced repositories via a curved bezier bridge. From the loom-agent-website:

```tsx
import { motion } from "motion/react"

const BRIDGE_PATH = "M 110 70 C 150 26 178 114 210 70"

export function Lacing() {
  return (
    <svg viewBox="0 0 320 140" className="h-full w-full">
      {/* Endpoint nodes */}
      <circle cx="86" cy="70" r="30" fill={palette.bg}
        stroke={palette.orange} strokeWidth="3.5" />
      <circle cx="234" cy="70" r="30" fill={palette.bg}
        stroke={palette.blue} strokeWidth="3.5" />

      {/* Static dashed guide path */}
      <path
        d={BRIDGE_PATH}
        fill="none"
        stroke={palette.border}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.6"
        strokeDasharray="3 5"
      />

      {/* Animated path stroke (draws itself) */}
      <motion.path
        d={BRIDGE_PATH}
        fill="none"
        stroke={palette.orangeDark}
        strokeWidth="3.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: [0, 1, 1, 1] }}
        transition={{
          duration: 6,
          times: [0, 0.35, 0.95, 1],
          repeat: Infinity,
          ease: [0.45, 0.05, 0.2, 1],
        }}
      />

      {/* Forward traveler (orange, left → right) */}
      <motion.circle
        r="4"
        fill={palette.orange}
        animate={{
          opacity: [0, 0, 1, 1, 0, 0],
          offsetDistance: ["0%", "0%", "0%", "100%", "100%", "100%"],
        }}
        transition={{
          duration: 6,
          times: [0, 0.4, 0.42, 0.7, 0.72, 1],
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{ offsetPath: `path('${BRIDGE_PATH}')` }}
      />

      {/* Reverse traveler (blue, right → left) */}
      <motion.circle
        r="4"
        fill={palette.blue}
        animate={{
          opacity: [0, 0, 1, 1, 0, 0],
          offsetDistance: ["100%", "100%", "100%", "0%", "0%", "0%"],
        }}
        transition={{
          duration: 6,
          times: [0, 0.55, 0.57, 0.85, 0.87, 1],
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{ offsetPath: `path('${BRIDGE_PATH}')` }}
      />

      {/* Labels */}
      <text x="86" y="118" textAnchor="middle" className="font-mono text-[8px]">
        this project
      </text>
      <text x="234" y="118" textAnchor="middle" className="font-mono text-[8px]">
        peer
      </text>
    </svg>
  )
}
```

## Production Example: DynamicContext

Visualizes files cascading from storage into a cache, then being delivered to an agent. Uses multi-axis position arrays with per-element staggered timing:

```tsx
const CYCLE = 7
const t = (s: number) => s / CYCLE

const files = [
  { name: "auth.md", color: palette.orange },
  { name: "deploy.md", color: palette.blue },
  { name: "lacing.md", color: palette.green },
]

export function DynamicContext() {
  return (
    <svg viewBox="0 0 320 140" className="h-full w-full">
      {/* Cache box (static) */}
      <rect x="156" y="34" width="48" height="72" rx="10"
        fill={palette.surface} stroke={palette.yellow} strokeWidth="2" opacity="0.35" />

      {/* Cache highlight flash (timed to file arrival) */}
      <motion.rect
        x="156" y="34" width="48" height="72" rx="10"
        fill="none" stroke={palette.yellow} strokeWidth="2.5"
        animate={{ opacity: [0, 0, 1, 0, 0] }}
        transition={{
          duration: CYCLE,
          times: [0, t(0.7), t(1.0), t(1.4), 1],
          repeat: Infinity,
          ease: "easeOut",
        }}
      />

      {/* Speed badge ("<100ms") — appears briefly */}
      <motion.g
        animate={{ opacity: [0, 0, 1, 1, 0, 0] }}
        transition={{
          duration: CYCLE,
          times: [0, t(0.7), t(1.0), t(1.8), t(2.2), 1],
          repeat: Infinity,
        }}
      >
        <rect x="166" y="20" width="28" height="12" rx="6" fill={palette.yellow} />
        <text x="180" y="29" textAnchor="middle" fontSize="7" fontWeight="700"
          fill={palette.bg}>&lt;100ms</text>
      </motion.g>

      {/* File cards — staggered cascade into cache position */}
      {files.map((file, index) => {
        const startY = 30 + index * 30
        const dockY = 56 + index * 10 - 10
        return (
          <motion.g
            key={file.name}
            animate={{
              x: [220, 220, 220, 156, 156, 156],
              y: [startY, startY, startY, dockY, dockY, dockY],
              opacity: [0, 0, 1, 1, 0, 0],
            }}
            transition={{
              duration: CYCLE,
              times: [
                0,
                t(1.0 + index * 0.08),
                t(1.2 + index * 0.08),
                t(2.6 + index * 0.1),
                t(5.0),
                1,
              ],
              repeat: Infinity,
              ease: [0.2, 0.6, 0.2, 1],
            }}
          >
            <rect x="0" y="0" width="88" height="20" rx="6"
              fill={palette.bg} stroke={file.color} strokeWidth="2" />
            <text x="50" y="14" textAnchor="middle" fontSize="9">
              {file.name}
            </text>
          </motion.g>
        )
      })}
    </svg>
  )
}
```

### Key Techniques

- **`times` arrays** give precise control over when each phase of an animation occurs within a cycle
- **The `t()` helper** (`s / CYCLE`) converts absolute seconds to normalized [0,1] values for the times array
- **Per-element stagger via index offset** (`t(1.0 + index * 0.08)`) creates cascade effects without a stagger container
- **Coordinate opacity with position** so elements aren't visible during their reset/jump phases
- **Static + animated layers** (dashed guide path beneath animated stroke) provide visual context
