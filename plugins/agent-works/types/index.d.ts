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
  /** `task` (the default, not written to the file), `gate` or `epic`; any other word is kept as written. */
  kind: string
  /** Who works the card or can run the gate; empty when nobody is named. */
  owner: string
  /** What is needed to do it (a gate: "the main checkout"); empty when nothing is. */
  needs: string
  /** What it is for: a pull request, an issue, another card; empty when nothing is. */
  ref: string
  /** The id of the epic card this card belongs to; empty when none. */
  epic: string
  /** The id of the sprint (`s3`) this card is planned into; empty when none. */
  sprint: string
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

export type SprintState = 'planned' | 'active' | 'closed'

export type Sprint = {
  id: string
  title: string
  /** What the sprint is for, in a sentence; empty when unsaid. */
  goal: string
  /** ISO dates (`2026-10-22`); empty when unset. */
  start: string
  end: string
  state: SprintState
  /** When it closed, how many done cards were archived and how many rolled on. */
  closed: { at: string; done: number; rolled: number } | null
}

export type BoardConfig = {
  columns: Column[]
  startMode: StartMode
  remote: { enabled: boolean }
  /** At most one active. Written to board.json only while there is one. */
  sprints: Sprint[]
}

/** What the board's lanes hold: the active sprint, the cards of no sprint, one epic's cards, or every card. */
export type Scope = { kind: 'sprint' } | { kind: 'backlog' } | { kind: 'epic'; id: string } | { kind: 'all' }

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
  | { kind: 'epics' }
  | { kind: 'sprints' }

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
  /** What the empty board says: the scope it is narrowed to, when it is. */
  empty: string
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
      /** What the lanes hold; null until the board is first read, then the board's default. */
      scope: Scope | null
    }
  }
}
