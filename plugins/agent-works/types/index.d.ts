export type CardRemote = {
  provider: 'github' | 'gitlab'
  number: number
  url: string
  updatedAt: string
  syncedHash: string
}

export type CardPriority = 'low' | 'normal' | 'high'

export type Card = {
  id: string
  file: string
  title: string
  status: string
  order: number
  priority: CardPriority
  labels: string[]
  skills: string[]
  source: 'user' | 'claude'
  created: string
  updated: string
  /** `task` (the default, not written to the file) or `gate`; any other word is kept as written. */
  kind: string
  /** Who works the card or can run the gate; empty when nobody is named. */
  owner: string
  /** What is needed to do it (a gate: "the main checkout"); empty when nothing is. */
  needs: string
  /** What it is for: a pull request, an issue, another card; empty when nothing is. */
  ref: string
  body: string
  remote: CardRemote | null
  /** Frontmatter lines of keys the board does not know, verbatim: written back as they were read. */
  extra: string[]
}

export type Column = {
  id: string
  title: string
  role: 'start' | 'done' | null
}

export type StartMode = 'new-session' | 'queue'

export type BoardConfig = {
  columns: Column[]
  startMode: StartMode
  remote: { enabled: boolean }
}

export type Board = {
  dir: string
  /** The cards are still in the folder of before the rename (`.agents/board`). */
  isOldFolder: boolean
  config: BoardConfig
  cards: Card[]
  stamp: string
}

export type View =
  | { kind: 'board' }
  | { kind: 'card'; id: string }
  | { kind: 'new'; status: string }
  | { kind: 'settings' }

export type SyncState = {
  status: 'off' | 'idle' | 'running' | 'error'
  message: string
  at: number
}

export type ClientCard = {
  id: string
  title: string
  meta: string
  isQueued: boolean
  isGate: boolean
}

export type ClientLane = {
  id: string
  title: string
  role: 'start' | 'done' | 'suggested' | null
  cards: ClientCard[]
}

export type ClientBoard = {
  lanes: ClientLane[]
  selected: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-works': {
      board: Board | null
      view: View
      selected: string | null
      queue: string[]
      sync: SyncState
      isTurnRunning: boolean
      isClientBroken: boolean
      /** The board's filter: only the gate cards are drawn. */
      isGatesOnly: boolean
    }
  }
}
