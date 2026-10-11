import type {
  CommandInfo,
  FsEntry,
  McpToolResult,
  ProcessRunInit,
  ProcessRunResult,
  SessionRepo,
  Timer,
} from 'claude-code'

import type { Board, SyncState, View } from '../../types'

/** One value the session holds for the mod: read, or changed from what it was. */
export type Cell<T> = {
  get: () => Promise<T>
  set: (change: (value: T) => T) => Promise<T>
}

/**
 * What the board's code reaches the engine through. A hooks module's `$` is
 * never handed across an import, so `register.tsx` builds one of these from
 * its `$` and every other file of the mod takes it in `$`'s place.
 */
export type Host = {
  exists: (path: string) => Promise<boolean>
  list: (path: string) => Promise<FsEntry[]>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, text: string) => Promise<void>
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  repo: () => Promise<SessionRepo | null>
  root: () => Promise<string>
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  mcp: (server: string, tool: string, args: Record<string, unknown>) => Promise<McpToolResult>
  /** Submits a prompt as the person's own; false when a hook dropped it. */
  submit: (text: string) => Promise<boolean>
  toast: (text: string) => void
  /** Asks the surface to give the pane the keyboard back, once the redraw under way has landed. */
  refocus: () => void
  ask: (question: string, options: readonly string[]) => Promise<string>
  commands: () => Promise<CommandInfo[]>
  state: {
    board: Cell<Board | null>
    view: Cell<View>
    selected: Cell<string | null>
    queue: Cell<string[]>
    sync: Cell<SyncState>
    isTurnRunning: Cell<boolean>
    isClientBroken: Cell<boolean>
    isGatesOnly: Cell<boolean>
  }
}
