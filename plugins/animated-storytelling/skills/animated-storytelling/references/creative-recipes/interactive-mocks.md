# Interactive Mocks

Scrollable, clickable UI simulations embedded within presentation slides. These create "try it yourself" moments where the audience can interact with a faithful recreation of the product being presented.

## Generalized Patterns

### Scrollable Content Panel

An independently scrollable region within a slide:

```tsx
function ScrollablePanel({ children }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight // Anchor to bottom on mount
  }, [])

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3"
    >
      <div className="flex flex-col gap-3 pb-3">
        {children}
      </div>
    </div>
  )
}
```

Key: `overscroll-contain` prevents the outer page from scrolling when the panel hits its bounds.

### Sliding Panel (onClick → state → animate in)

A side panel that slides in from an edge when triggered:

```tsx
function SlidingPanel({ isOpen, onClose, children }) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          key="panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex shrink-0 flex-col overflow-hidden border-l"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold">Panel Title</span>
            <button onClick={onClose} aria-label="Close">
              <XIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

### Typed Block Rendering

A discriminated union for rendering different content block types:

```tsx
type ContentBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet-list"; items: string[] }
  | { kind: "code"; text: string; language?: string }
  | { kind: "table"; headers: string[]; rows: string[][] }

function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.kind) {
    case "heading":
      return <h3 className="font-semibold">{block.text}</h3>
    case "paragraph":
      return <p>{block.text}</p>
    case "bullet-list":
      return (
        <ul className="list-disc pl-4">
          {block.items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )
    case "code":
      return <pre className="rounded bg-muted p-2 font-mono text-xs">{block.text}</pre>
    case "table":
      return (
        <table className="w-full text-xs">
          <thead>
            <tr>{block.headers.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
  }
}
```

### Faithful UI Chrome

Window decorations that ground the mock in a recognizable application context:

```tsx
function WindowChrome({ title, children }) {
  return (
    <div className="flex h-full flex-col rounded-xl border overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-1.5 border-b px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="h-2 w-2 rounded-full bg-yellow-500" />
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span className="ml-3 font-mono text-[9px] uppercase tracking-wider text-muted">
          {title}
        </span>
      </div>
      {/* Content */}
      <div className="flex min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}
```

### Stacked Layout (Base + Overlay)

The main feed + sliding panel pattern:

```tsx
function InteractiveMock() {
  const [activePanel, setActivePanel] = useState<string | null>(null)

  return (
    <WindowChrome title="Application">
      <div className="flex min-w-0 flex-1">
        {/* Main content (shrinks when panel opens) */}
        <MainFeed onOpenPanel={setActivePanel} activeId={activePanel} />
        {/* Overlay panel (slides in from right) */}
        <SlidingPanel
          isOpen={!!activePanel}
          onClose={() => setActivePanel(null)}
        >
          {activePanel && <PanelContent id={activePanel} />}
        </SlidingPanel>
      </div>
    </WindowChrome>
  )
}
```

---

## Production Example: TimmyTeamsThreads

A fully interactive Teams chat mock with scrollable feed, clickable reply affordances, and a sliding thread panel that shows bot responses. From the loom-agent-website:

### Data Model

```tsx
type AdaptiveBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet-list"; items: string[] }
  | { kind: "numbered-list"; items: string[] }
  | { kind: "code"; text: string; language?: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "factset"; facts: { title: string; value: string }[] }

interface TimmyExchange {
  id: string
  user: {
    author: string
    initials: string
    color: string
    time: string
    text: string
  }
  timmy: {
    time: string
    blocks: AdaptiveBlock[]
    askedBy: string
    sources?: string[]
  }
}
```

### Top-Level Layout

```tsx
export function TimmyTeamsThreads() {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const activeThread = TIMMY_THREADS.find(t => t.id === activeThreadId) ?? null

  return (
    <div className="flex h-full overflow-hidden rounded-xl border bg-[#1f1f1f]">
      {/* Sidebar: activity rail + channel list */}
      <div className="flex shrink-0">
        <ActivityRail />
        <ChannelList active="studiolab-timmy" />
      </div>
      {/* Main chat + thread panel */}
      <div className="flex min-w-0 flex-1">
        <ChatPane
          threads={TIMMY_THREADS}
          activeThreadId={activeThreadId}
          onOpenThread={setActiveThreadId}
        />
        <ThreadPanel thread={activeThread} onClose={() => setActiveThreadId(null)} />
      </div>
    </div>
  )
}
```

### Scrollable Chat Feed

```tsx
function ChatPane({ threads, activeThreadId, onOpenThread }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[#292828]">
      <ChannelHeader />
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3"
      >
        <div className="flex flex-col gap-3 pb-3">
          {threads.map(thread => (
            <ChannelPost
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onOpenThread={() => onOpenThread(thread.id)}
            />
          ))}
        </div>
      </div>
      <Composer />
    </div>
  )
}
```

### Clickable Reply Affordance

```tsx
function ChannelPost({ thread, isActive, onOpenThread }) {
  return (
    <div className="flex items-start gap-2">
      <Avatar initials={thread.user.initials} color={thread.user.color} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AuthorLine author={thread.user.author} time={thread.user.time} />
        <MessageBubble text={thread.user.text} />
        <button
          type="button"
          onClick={onOpenThread}
          className={`mt-1 flex w-fit items-center gap-1.5 rounded-sm px-1.5 py-[2px] text-[10px] ${
            isActive ? "font-semibold text-purple-300" : "text-muted hover:bg-surface"
          }`}
        >
          <BotMark />
          <span className="font-semibold">1 reply</span>
          <span className="font-normal text-muted">· Last reply {thread.timmy.time}</span>
        </button>
      </div>
    </div>
  )
}
```

### Animated Thread Panel

```tsx
function ThreadPanel({ thread, onClose }) {
  return (
    <AnimatePresence initial={false}>
      {thread ? (
        <motion.div
          key="thread-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex shrink-0 flex-col overflow-hidden border-l border-[#3d3c3c] bg-[#292828]"
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold">Thread</span>
              <span className="text-[9px] text-muted">in #channel-name</span>
            </div>
            <button onClick={onClose} aria-label="Close thread"
              className="h-5 w-5 rounded-sm text-muted hover:bg-surface hover:text-foreground">
              <CloseIcon />
            </button>
          </div>
          {/* Independently scrollable thread content */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3">
            <div className="flex flex-col gap-3 pb-3">
              <ThreadParent user={thread.user} />
              <BotReply blocks={thread.timmy.blocks} />
            </div>
          </div>
          {/* Reply composer */}
          <div className="border-t px-2 py-1.5">
            <div className="flex items-center gap-1.5 rounded-sm border px-1.5 py-1">
              <span className="text-[9px] text-muted">Reply in thread</span>
              <span className="ml-auto h-4 w-4 rounded-sm bg-purple-500" />
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
```

### Key Techniques

- **`overflow-y-auto overscroll-contain`** makes panels independently scrollable without affecting the slide's scroll-snap
- **`AnimatePresence` on the panel** enables smooth enter/exit width transitions
- **Width animation (0 → 280px)** rather than translateX prevents layout shift in the adjacent content
- **`min-w-0 flex-1`** on the main content ensures it shrinks when the panel opens (flexbox min-width trap)
- **Active state highlighting** on the reply button shows which thread is currently open
- **Typed block rendering** via discriminated union makes the bot responses render different content types faithfully
- **UI chrome density** (title bar, tabs, channel list, composer) establishes context without being functional — the audience instantly recognizes "this is Teams" without needing real navigation
