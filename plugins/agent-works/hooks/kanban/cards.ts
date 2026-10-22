import type {
  Board,
  BoardConfig,
  Card,
  CardPriority,
  CardRemote,
  ClientBoard,
  ClientLane,
  Column,
  Scope,
  Sprint,
  SprintState,
  StartMode,
} from '../../types'

export const SUGGESTED = 'suggested'
export const ARCHIVED = 'archived'
export const CONFIG_FILE = 'board.json'
export const TASK = 'task'
export const GATE = 'gate'
export const EPIC = 'epic'

const DEFAULT_COLUMNS: Column[] = [
  { id: 'backlog', title: 'Backlog', role: null },
  { id: 'in-progress', title: 'In progress', role: 'start' },
  { id: 'review', title: 'Review', role: null },
  { id: 'done', title: 'Done', role: 'done' },
]

export function defaultConfig(startMode: StartMode): BoardConfig {
  return {
    columns: DEFAULT_COLUMNS.map(column => ({ ...column })),
    startMode,
    remote: { enabled: false },
    sprints: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toStartMode(value: unknown, fallback: StartMode): StartMode {
  return value === 'queue' || value === 'new-session' ? value : fallback
}

function toSprintState(value: unknown): SprintState {
  return value === 'active' || value === 'closed' ? value : 'planned'
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

/** The sprints of board.json: an entry with no id is dropped, and only the first active one stays active. */
function toSprints(value: unknown): Sprint[] {
  if (!Array.isArray(value)) return []
  let hasActive = false

  return value.flatMap((one): Sprint[] => {
    if (!isRecord(one) || typeof one.id !== 'string' || one.id === '') return []
    let state = toSprintState(one.state)
    if (state === 'active' && hasActive) state = 'planned'
    if (state === 'active') hasActive = true
    const closed = isRecord(one.closed)
      ? {
          at: typeof one.closed.at === 'string' ? one.closed.at : '',
          done: toCount(one.closed.done),
          rolled: toCount(one.closed.rolled),
        }
      : null

    return [
      {
        id: one.id,
        title: typeof one.title === 'string' && one.title !== '' ? one.title : one.id,
        goal: typeof one.goal === 'string' ? one.goal : '',
        start: typeof one.start === 'string' ? one.start : '',
        end: typeof one.end === 'string' ? one.end : '',
        state,
        closed,
      },
    ]
  })
}

export function parseConfig(text: string, fallback: BoardConfig): BoardConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fallback
  }
  if (!isRecord(raw)) return fallback
  const columns = Array.isArray(raw.columns)
    ? raw.columns.flatMap((one): Column[] => {
        if (!isRecord(one) || typeof one.id !== 'string' || one.id === '') return []
        const role = one.role === 'start' || one.role === 'done' ? one.role : null

        return [{ id: one.id, title: typeof one.title === 'string' ? one.title : one.id, role }]
      })
    : []
  const remote = isRecord(raw.remote) ? raw.remote : {}

  return {
    columns: columns.length > 0 ? columns : fallback.columns,
    startMode: toStartMode(raw.startMode, fallback.startMode),
    remote: { enabled: remote.enabled === true },
    sprints: toSprints(raw.sprints),
  }
}

/** board.json: `sprints` only once there is one, so a board that never planned one keeps its file. */
export function serializeConfig(config: BoardConfig): string {
  const { sprints, ...rest } = config

  return `${JSON.stringify(sprints.length > 0 ? { ...rest, sprints } : rest, null, 2)}\n`
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')

  return slug === '' ? 'card' : slug
}

export function nextId(cards: readonly Card[]): string {
  const highest = cards.reduce((max, card) => Math.max(max, Number.parseInt(card.id, 10) || 0), 0)

  return String(highest + 1).padStart(4, '0')
}

export function fileName(id: string, title: string): string {
  return `${id}-${slugify(title)}.md`
}

function parseScalar(text: string): unknown {
  const value = text.trim()
  if (value.startsWith('[') || value.startsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      if (value.startsWith('[') && value.endsWith(']')) {
        return value
          .slice(1, -1)
          .split(',')
          .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
          .filter(part => part !== '')
      }
    }
  }
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)

  return value
}

const NESTED_KEY = 'remote'

/** The frontmatter keys the board reads and writes itself; a line of any other key is kept as it is. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'status',
  'order',
  'priority',
  'labels',
  'skills',
  'source',
  'created',
  'updated',
  'kind',
  'owner',
  'needs',
  'ref',
  'epic',
  'sprint',
  'remote',
])

/**
 * The frontmatter cards are written with. It is not YAML, and `cli/kanban.py`
 * reads the same grammar line for line (the golden cards under
 * `tests/fixtures/cards` hold the two together):
 *
 * - `key: value` lines; a value that starts with `[` or `"` is JSON (a list
 *   that is not JSON is split at its commas), `'…'` is taken without its
 *   quotes, anything else is the text as written. No block scalars (`|`, `>`),
 *   no comments after a value, no anchors.
 * - One level of nesting, for `remote:` alone: the key with no value, then
 *   indented `key: value` lines. Any other known key with no value reads as
 *   absent (its default applies).
 * - A known key's list is one line (`labels: ["a","b"]`): a YAML block list
 *   under `labels:` reads as empty and is not written back.
 * - A line that is not indented and is not a key the board knows (an unknown
 *   key, a comment) is kept verbatim with the indented and blank lines under
 *   it, in `extra`, and written back after the board's own keys, in the order
 *   read. Its value is never read.
 * - An indented or blank line under a known key (other than `remote`'s own
 *   keys) is dropped at the next write.
 * - Indentation is spaces or tabs; a file may use LF or CRLF, and is written
 *   with LF.
 */
export function parseFrontmatter(
  text: string,
): { data: Record<string, unknown>; extra: string[]; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text)
  if (!match) return undefined
  const data: Record<string, unknown> = {}
  const extra: string[] = []
  let nested: Record<string, unknown> | undefined
  let isExtra = false
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const pair = /^([ \t]*)([\w-]+):[ \t]*(.*)$/.exec(line)
    const [, indent = '', key = '', value = ''] = pair ?? []
    if (pair && indent === '') {
      nested = undefined
      isExtra = !KNOWN_KEYS.has(key)
      if (isExtra) extra.push(line)
      else if (value.trim() !== '') data[key] = parseScalar(value)
      else if (key === NESTED_KEY) {
        nested = {}
        data[key] = nested
      }
    } else if (/^[^ \t]/.test(line)) {
      // Not indented and no key the board knows (a comment, say): it and what hangs under it are kept.
      nested = undefined
      isExtra = true
      extra.push(line)
    } else if (isExtra) extra.push(line)
    else if (pair && nested) nested[key] = parseScalar(value)
  }

  return { data, extra, body: (match[2] ?? '').replace(/^\r?\n/, '').replace(/\s+$/, '') }
}

function toStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(one => one !== '')

  return typeof value === 'string' && value !== '' ? [value] : []
}

/** A one-line text field: what was written, or nothing when the key held no plain value. */
function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim()

  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function toPriority(value: unknown): CardPriority {
  return value === 'low' || value === 'high' ? value : 'normal'
}

function toRemote(value: unknown): CardRemote | null {
  if (!isRecord(value)) return null
  const number = Number(value.number)
  if (!Number.isInteger(number) || number <= 0) return null

  return {
    provider: value.provider === 'gitlab' ? 'gitlab' : 'github',
    number,
    url: String(value.url ?? ''),
    updatedAt: String(value.updatedAt ?? ''),
    syncedHash: String(value.syncedHash ?? ''),
  }
}

export function isGate(card: Pick<Card, 'kind'>): boolean {
  return card.kind === GATE
}

export function isEpic(card: Pick<Card, 'kind'>): boolean {
  return card.kind === EPIC
}

export function parseCard(file: string, text: string): Card | undefined {
  const parsed = parseFrontmatter(text)
  if (!parsed) return undefined
  const { data, extra, body } = parsed
  const id = String(data.id ?? /^(\d+)/.exec(file)?.[1] ?? '')
  if (id === '') return undefined
  const kind = toText(data.kind)

  return {
    id,
    file,
    title: String(data.title ?? file.replace(/\.md$/, '')),
    status: String(data.status ?? 'backlog'),
    order: Number(data.order) || 0,
    priority: toPriority(data.priority),
    labels: toStrings(data.labels),
    skills: toStrings(data.skills),
    source: data.source === 'claude' ? 'claude' : 'user',
    created: String(data.created ?? ''),
    updated: String(data.updated ?? ''),
    kind: kind === '' ? TASK : kind,
    owner: toText(data.owner),
    needs: toText(data.needs),
    ref: toText(data.ref),
    epic: toText(data.epic),
    sprint: toText(data.sprint),
    body,
    remote: toRemote(data.remote),
    extra,
  }
}

/**
 * The card as its file: the board's keys in a fixed order (`kind` only when it
 * is not a plain task; `owner`, `needs`, `ref`, `epic` and `sprint` only when set), the `remote`
 * block, then the lines of the keys the board does not know, as they were read.
 */
export function serializeCard(card: Card): string {
  const lines = [
    '---',
    `id: ${JSON.stringify(card.id)}`,
    `title: ${JSON.stringify(card.title)}`,
    `status: ${card.status}`,
    `order: ${card.order}`,
    `priority: ${card.priority}`,
    `labels: ${JSON.stringify(card.labels)}`,
    `skills: ${JSON.stringify(card.skills)}`,
    `source: ${card.source}`,
    `created: ${card.created}`,
    `updated: ${card.updated}`,
  ]
  if (card.kind !== TASK && card.kind !== '') lines.push(`kind: ${card.kind}`)
  if (card.owner !== '') lines.push(`owner: ${JSON.stringify(card.owner)}`)
  if (card.needs !== '') lines.push(`needs: ${JSON.stringify(card.needs)}`)
  if (card.ref !== '') lines.push(`ref: ${JSON.stringify(card.ref)}`)
  if (card.epic !== '') lines.push(`epic: ${JSON.stringify(card.epic)}`)
  if (card.sprint !== '') lines.push(`sprint: ${JSON.stringify(card.sprint)}`)
  if (card.remote) {
    lines.push(
      'remote:',
      `  provider: ${card.remote.provider}`,
      `  number: ${card.remote.number}`,
      `  url: ${card.remote.url}`,
      `  updatedAt: ${card.remote.updatedAt}`,
      `  syncedHash: ${card.remote.syncedHash}`,
    )
  }
  lines.push(...card.extra, '---', '')
  if (card.body.trim() !== '') lines.push(card.body.trim(), '')

  return lines.join('\n')
}

/**
 * What of a card the remote holds too: a change here is a change to push.
 */
export function cardHash(card: Card): string {
  const text = JSON.stringify([card.title, card.status, card.body.trim(), [...card.labels].sort()])
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0

  return hash.toString(16)
}

export function byOrder(a: Card, b: Card): number {
  return a.order - b.order || a.id.localeCompare(b.id)
}

export function cardsIn(cards: readonly Card[], status: string): Card[] {
  return cards.filter(card => card.status === status).sort(byOrder)
}

export function isKnownStatus(config: BoardConfig, status: string): boolean {
  return status === SUGGESTED || status === ARCHIVED || config.columns.some(column => column.id === status)
}

/**
 * The cards a move changes, with their new status and order: the moved card
 * at `index` of its target lane (the end when absent), the lane renumbered.
 */
export function planMove(cards: readonly Card[], id: string, to: string, index?: number): Card[] {
  const moved = cards.find(card => card.id === id)
  if (!moved) return []
  const lane = cardsIn(cards, to).filter(card => card.id !== id)
  const at = Math.max(0, Math.min(index ?? lane.length, lane.length))
  lane.splice(at, 0, { ...moved, status: to })

  return lane
    .map((card, order) => ({ ...card, order }))
    .filter(card => {
      const before = cards.find(one => one.id === card.id)

      return before === undefined || before.order !== card.order || before.status !== card.status
    })
}

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * An open card of the same title. With `ref`, the search is for a gate: the
 * same check owed for another pull request is another gate.
 */
export function findDuplicate(board: Board, title: string, ref?: string): Card | undefined {
  const done = new Set(board.config.columns.filter(column => column.role === 'done').map(column => column.id))
  const wanted = normalize(title)

  return board.cards.find(
    card =>
      card.status !== ARCHIVED &&
      !done.has(card.status) &&
      normalize(card.title) === wanted &&
      (ref === undefined || (isGate(card) && card.ref === ref)),
  )
}

/** The column a finished card goes to: the one with the done role, else the last. */
export function doneColumnOf(config: BoardConfig): Column | undefined {
  return config.columns.find(column => column.role === 'done') ?? config.columns.at(-1)
}

/** One card as the tools list it: id, column, kind, owner, title, what a gate is owed for, its epic and sprint. */
export function cardLine(card: Card): string {
  const owner = card.owner === '' ? '' : ` @${card.owner}`
  const owed = [
    card.ref === '' ? '' : `for ${card.ref}`,
    card.needs === '' ? '' : `needs ${card.needs}`,
    card.epic === '' ? '' : `epic ${card.epic}`,
    card.sprint === '' ? '' : `sprint ${card.sprint}`,
  ]
    .filter(part => part !== '')
    .join('; ')

  return `${card.id} [${card.status}] ${card.kind}${owner}: ${card.title}${owed === '' ? '' : ` (${owed})`}`
}

function metaOf(card: Card, epicTitle: string): string {
  return [
    epicTitle === '' ? '' : `◆ ${epicTitle.length > 24 ? `${epicTitle.slice(0, 23)}…` : epicTitle}`,
    card.ref === '' ? '' : `for ${card.ref}`,
    card.owner === '' ? '' : `@${card.owner}`,
    card.remote ? `#${card.remote.number}` : '',
    card.priority === 'normal' ? '' : card.priority,
    card.labels.join(', '),
    card.source === 'claude' ? 'by Claude' : '',
    card.skills.length > 0 ? `skills: ${card.skills.length}` : '',
  ]
    .filter(part => part !== '')
    .join(' · ')
}

/** The sprint the board is working in, if one is. */
export function activeSprint(config: BoardConfig): Sprint | undefined {
  return config.sprints.find(sprint => sprint.state === 'active')
}

/** The id the next sprint gets: `s` and one past the highest number in use. */
export function nextSprintId(config: BoardConfig): string {
  const highest = config.sprints.reduce(
    (max, sprint) => Math.max(max, Number.parseInt(sprint.id.replace(/^s/, ''), 10) || 0),
    0,
  )

  return `s${highest + 1}`
}

/** What the lanes hold when the person has not chosen: the active sprint while there is one, else every card. */
export function defaultScope(config: BoardConfig): Scope {
  return activeSprint(config) ? { kind: 'sprint' } : { kind: 'all' }
}

/**
 * Whether a card belongs in the lanes of a scope. Epics are never in a lane
 * (the Epics view holds them); the Suggested lane is shown whatever the scope.
 * The sprint scope with no active sprint is every card.
 */
export function inScope(config: BoardConfig, card: Card, scope: Scope): boolean {
  if (isEpic(card)) return false
  if (card.status === SUGGESTED) return true
  switch (scope.kind) {
    case 'sprint': {
      const active = activeSprint(config)

      return active === undefined || card.sprint === active.id
    }
    case 'backlog':
      return card.sprint === ''
    case 'epic':
      return card.epic === scope.id
    default:
      return true
  }
}

/** A scope in a few words, as the toolbar and the tools name it. */
export function scopeLabel(config: BoardConfig, scope: Scope): string {
  switch (scope.kind) {
    case 'sprint': {
      const active = activeSprint(config)

      return active ? `sprint ${active.id}` : 'all'
    }
    case 'backlog':
      return 'backlog'
    case 'epic':
      return `epic ${scope.id}`
    default:
      return 'all'
  }
}

/** The ids of the columns a finished card sits in. */
export function doneIds(config: BoardConfig): Set<string> {
  return new Set(config.columns.filter(column => column.role === 'done').map(column => column.id))
}

/** An epic's children: how many there are and how many are finished (done, or archived out of the way). */
export function epicProgress(board: Board, id: string): { done: number; total: number } {
  const done = doneIds(board.config)
  const children = board.cards.filter(card => card.epic === id && !isEpic(card) && card.status !== SUGGESTED)

  return {
    done: children.filter(card => card.status === ARCHIVED || done.has(card.status)).length,
    total: children.length,
  }
}

/** The epics still open: neither archived nor in a done column. */
export function openEpics(board: Board): Card[] {
  const done = doneIds(board.config)

  return board.cards.filter(card => isEpic(card) && card.status !== ARCHIVED && !done.has(card.status)).sort(byOrder)
}

/** `▰▰▱▱ 2/4`: an epic's progress in a line of text. */
export function progressBar({ done, total }: { done: number; total: number }, width = 8): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)} ${done}/${total}`
}

/**
 * Closing a sprint: its cards in a done column are archived, the rest roll on
 * to the next planned sprint (the first in the list), else to no sprint. The
 * sprint is marked closed with the counts. Undefined when there is no such
 * open sprint.
 */
export function planSprintClose(
  board: Board,
  id: string,
  now: string,
): { cards: Card[]; config: BoardConfig; next: Sprint | undefined } | undefined {
  const sprint = board.config.sprints.find(one => one.id === id)
  if (!sprint || sprint.state === 'closed') return undefined
  const done = doneIds(board.config)
  const next = board.config.sprints.find(one => one.id !== id && one.state === 'planned')
  const cards = board.cards
    .filter(card => card.sprint === id && card.status !== ARCHIVED)
    .map(card => (done.has(card.status) ? { ...card, status: ARCHIVED } : { ...card, sprint: next?.id ?? '' }))
  const archived = cards.filter(card => card.status === ARCHIVED).length
  const closed = { at: now, done: archived, rolled: cards.length - archived }

  return {
    cards,
    next,
    config: {
      ...board.config,
      sprints: board.config.sprints.map(one => (one.id === id ? { ...one, state: 'closed' as const, closed } : one)),
    },
  }
}

/**
 * A scope as an agent or a command names it: `sprint`, `backlog`, `all`, or an
 * epic's card id. Empty is the board's default; undefined when it names nothing.
 */
export function parseScope(text: string, board: Board): Scope | undefined {
  const wanted = text.trim().toLowerCase()
  if (wanted === '') return defaultScope(board.config)
  if (wanted === 'sprint' || wanted === 'backlog' || wanted === 'all') return { kind: wanted }
  const epic = board.cards.find(card => isEpic(card) && (card.id === wanted || card.id === wanted.padStart(4, '0')))

  return epic ? { kind: 'epic', id: epic.id } : undefined
}

/** The active sprint in a line: id, title, end and goal. */
export function sprintLine(sprint: Sprint): string {
  const when = sprint.end === '' ? '' : `, ends ${sprint.end}`
  const goal = sprint.goal === '' ? '' : `: ${sprint.goal}`

  return `Sprint ${sprint.id} "${sprint.title}" (${sprint.state}${when})${goal}`
}

/**
 * What the tools answer for a listing: the columns, the active sprint, the open
 * epics with their progress, the cards of `scope` in column order, and how many
 * open cards the scope left out. An agent reads a sprint, not the whole history.
 */
export function listing(board: Board, scope: Scope): string[] {
  const order = [SUGGESTED, ...board.config.columns.map(column => column.id)]
  const rank = (card: Card) => (order.includes(card.status) ? order.indexOf(card.status) : order.length)
  const open = board.cards.filter(card => card.status !== ARCHIVED && !isEpic(card))
  const shown = open
    .filter(card => inScope(board.config, card, scope))
    .sort((a, b) => rank(a) - rank(b) || byOrder(a, b))
  const active = activeSprint(board.config)
  const hidden = open.length - shown.length
  const label = scopeLabel(board.config, scope)

  return [
    `Columns: ${board.config.columns.map(column => column.id).join(', ')} (plus ${SUGGESTED})`,
    active ? sprintLine(active) : '',
    ...openEpics(board).map(epic => `Epic ${epic.id} ${progressBar(epicProgress(board, epic.id))}: ${epic.title}`),
    label === 'all' ? '' : `Scope: ${label}`,
    ...shown.map(cardLine),
    shown.length === 0 ? 'No cards in this scope.' : '',
    hidden > 0 ? `${hidden} more open card(s) outside this scope (scope "all" lists them).` : '',
  ].filter(line => line !== '')
}

/**
 * The board as the surface module draws it: the Suggested lane first while it
 * holds a card, then the columns; a card of an unknown status in the first.
 * Only the cards of `scope`; with `isGatesOnly`, only its gate cards.
 */
export function toClientBoard(
  board: Board,
  queue: readonly string[],
  selected: string | null,
  isGatesOnly = false,
  scope: Scope = { kind: 'all' },
): ClientBoard {
  const shown = board.cards.filter(card => inScope(board.config, card, scope) && (!isGatesOnly || isGate(card)))
  const first = board.config.columns[0]?.id
  const epicTitles = new Map(board.cards.filter(isEpic).map(card => [card.id, card.title]))
  const toClient = (card: Card) => ({
    id: card.id,
    title: card.title,
    meta: metaOf(card, card.epic === '' ? '' : (epicTitles.get(card.epic) ?? card.epic)),
    isQueued: queue.includes(card.id),
    isGate: isGate(card),
  })
  const lanes: ClientLane[] = board.config.columns.map(column => ({
    id: column.id,
    title: column.title,
    role: column.role,
    cards: shown
      .filter(card => card.status === column.id || (column.id === first && !isKnownStatus(board.config, card.status)))
      .sort(byOrder)
      .map(toClient),
  }))
  const suggested = cardsIn(shown, SUGGESTED).map(toClient)
  if (suggested.length > 0) lanes.unshift({ id: SUGGESTED, title: 'Suggested', role: 'suggested', cards: suggested })
  const label = scopeLabel(board.config, scope)
  const empty =
    label === 'all'
      ? 'No cards yet. Add one with + New, or press n here.'
      : `No cards in ${label}. Press n to add one here, or v for another scope.`

  return { lanes, selected, empty }
}
