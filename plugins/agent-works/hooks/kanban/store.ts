import type { PluginOptions } from 'claude-code'

import type { Host } from './host'
import type { Board, BoardConfig, Card } from '../../types'
import {
  CONFIG_FILE,
  TASK,
  defaultConfig,
  fileName,
  nextId,
  parseCard,
  parseConfig,
  serializeCard,
  serializeConfig,
  toStartMode,
} from './cards'

const PROJECT_CONFIG = '.agents/agent-works.json'
const DEFAULT_DIR = '.agents/kanban'
/** The board's folder before the rename: honoured while the new one does not exist. */
const OLD_DIR = '.agents/board'

let options: PluginOptions = {}
let located: { dir: string; isOldFolder: boolean } | undefined

export function configure(given: PluginOptions): void {
  options = given
  located = undefined
}

export function syncIntervalMs(): number {
  const seconds = Number(options.syncIntervalSeconds)

  return (Number.isFinite(seconds) && seconds >= 30 ? seconds : 120) * 1000
}

function fallbackConfig(): BoardConfig {
  return defaultConfig(toStartMode(options.startMode, 'new-session'))
}

/** `paths.kanban` of the project's own config: what the `aw` CLI goes by, so the pane goes by it first. */
async function projectFolder(host: Host, root: string): Promise<string | undefined> {
  try {
    const raw: unknown = JSON.parse(await host.readFile(`${root}/${PROJECT_CONFIG}`))
    const paths: unknown = typeof raw === 'object' && raw !== null && 'paths' in raw ? raw.paths : undefined
    const folder: unknown = typeof paths === 'object' && paths !== null && 'kanban' in paths ? paths.kanban : undefined

    return typeof folder === 'string' && folder.trim() !== '' ? folder.trim() : undefined
  } catch {
    return undefined
  }
}

async function find(host: Host): Promise<{ dir: string; isOldFolder: boolean }> {
  const repo = await host.repo().catch(() => null)
  const root = (repo?.root ?? (await host.root())).replace(/[\\/]+$/, '')
  const option = typeof options.kanbanDir === 'string' && options.kanbanDir.trim() !== '' ? options.kanbanDir : DEFAULT_DIR
  const folder = (await projectFolder(host, root)) ?? option
  const dir = `${root}/${folder.replace(/^[\\/]+|[\\/]+$/g, '')}`
  const old = `${root}/${OLD_DIR}`
  if (dir !== old && !(await host.exists(dir)) && (await host.exists(`${old}/${CONFIG_FILE}`).catch(() => false))) {
    return { dir: old, isOldFolder: true }
  }

  return { dir, isOldFolder: false }
}

/**
 * The kanban folder, absolute: `paths.kanban` of the project's
 * `.agents/agent-works.json`, else the `kanbanDir` option, under the
 * repository's root (the main working tree's, so worktrees share one board),
 * or the session's root outside one. While that folder does not exist and
 * `.agents/board/board.json` does, the old folder is the board.
 */
export async function locate(host: Host, isFresh = false): Promise<string> {
  if (located === undefined || isFresh) located = await find(host)

  return located.dir
}

export async function nowIso(host: Host): Promise<string> {
  return new Date(await host.now()).toISOString()
}

/**
 * Reads the board from disk into `$.state` when its files changed since the
 * last read (or `isForced`), and answers it.
 */
export async function reload(host: Host, isForced = false): Promise<Board> {
  const dir = await locate(host)
  const isOldFolder = located?.isOldFolder === true
  const entries = (await host.exists(dir)) ? await host.list(dir) : []
  const files = entries.filter(
    entry => entry.kind === 'file' && (entry.name.endsWith('.md') || entry.name === CONFIG_FILE),
  )
  const stamp = files
    .map(file => `${file.name}:${file.mtimeMs}:${file.size}`)
    .sort()
    .join('|')
  const current = await host.state.board.get()
  if (!isForced && current !== null && current.dir === dir && current.stamp === stamp) return current

  let config = fallbackConfig()
  const cards: Card[] = []
  for (const file of files) {
    const text = await host.readFile(`${dir}/${file.name}`).catch(() => undefined)
    if (text === undefined) continue
    if (file.name === CONFIG_FILE) config = parseConfig(text, config)
    else {
      const card = parseCard(file.name, text)
      if (card) cards.push(card)
    }
  }
  const board: Board = { dir, isOldFolder, config, cards, stamp }
  await host.state.board.set(() => board)

  return board
}

export async function getBoard(host: Host): Promise<Board> {
  return (await host.state.board.get()) ?? (await reload(host))
}

export async function writeCards(host: Host, cards: readonly Card[]): Promise<Board> {
  const board = await getBoard(host)
  const updated = await nowIso(host)
  for (const card of cards) {
    await host.writeFile(`${board.dir}/${card.file}`, serializeCard({ ...card, updated }))
  }

  return reload(host, true)
}

/**
 * Writes cards as a pull from the remote left them: `updated` is theirs, so
 * the write itself is no local change to push back.
 */
export async function writeCardsAsIs(host: Host, cards: readonly Card[]): Promise<Board> {
  const board = await getBoard(host)
  for (const card of cards) await host.writeFile(`${board.dir}/${card.file}`, serializeCard(card))

  return reload(host, true)
}

export async function writeConfig(host: Host, config: BoardConfig): Promise<Board> {
  const board = await getBoard(host)
  await host.writeFile(`${board.dir}/${CONFIG_FILE}`, serializeConfig(config))

  return reload(host, true)
}

export type NewCard = Pick<Card, 'title' | 'status'> & Partial<Omit<Card, 'id' | 'file' | 'title' | 'status'>>

export async function addCard(host: Host, given: NewCard): Promise<Card> {
  const board = await reload(host)
  const id = nextId(board.cards)
  const now = await nowIso(host)
  const order = board.cards.reduce(
    (max, card) => (card.status === given.status ? Math.max(max, card.order + 1) : max),
    0,
  )
  const card: Card = {
    order,
    priority: 'normal',
    labels: [],
    skills: [],
    source: 'user',
    kind: TASK,
    owner: '',
    needs: '',
    ref: '',
    body: '',
    remote: null,
    extra: [],
    ...given,
    id,
    file: fileName(id, given.title),
    created: given.created ?? now,
    updated: given.updated ?? now,
  }
  await host.writeFile(`${board.dir}/${card.file}`, serializeCard(card))
  await reload(host, true)

  return card
}
