import type { Card, Column } from '../../../types'
import {
  adoptColumns,
  asArray,
  doneColumn,
  isRecord,
  isStatusLabel,
  normalizeBody,
  parseJson,
  run,
  statusLabel,
  statusOf,
} from './provider'
import type { Connect, RemoteIssue } from './provider'

const OPEN = 'open'
const CLOSED = 'closed'

/**
 * GitLab through the person's own `glab` login: issues, and the project's
 * first issue board when it has lists (each list is a label; Open and Closed
 * bracket them); otherwise a `status:<column>` label per card.
 */
export const connectGitlab: Connect = async (host, root, config) => {
  const api = async (path: string, fields: Readonly<Record<string, string>> = {}, method = 'GET') =>
    parseJson(
      await run(host, root, [
        'glab',
        'api',
        `projects/:id/${path}`,
        '-X',
        method,
        ...Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`]),
      ]),
    )

  const boards = await api('boards').catch(() => undefined)
  const lists = asArray(isRecord(asArray(boards)[0]) ? (asArray(boards)[0] as Record<string, unknown>).lists : [])
    .flatMap(list => (isRecord(list) && isRecord(list.label) && typeof list.label.name === 'string' ? [list] : []))
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map(list => String((list.label as Record<string, unknown>).name))

  let board: { columns: Column[]; labelOf: Map<string, string> } | null = null
  if (lists.length > 0) {
    const middle = adoptColumns(lists).map(column => ({ ...column, role: column.role === 'done' ? null : column.role }))
    board = {
      columns: [{ id: OPEN, title: 'Open', role: null }, ...middle, { id: CLOSED, title: 'Closed', role: 'done' }],
      labelOf: new Map(middle.map((column, index) => [column.id, lists[index] ?? ''])),
    }
  }

  const columns = board?.columns ?? config.columns
  const done = doneColumn(columns)
  const first = columns[0]?.id ?? null
  const listLabels = board ? [...board.labelOf.values()] : []

  const toIssue = (raw: unknown): RemoteIssue[] => {
    if (!isRecord(raw) || typeof raw.iid !== 'number') return []
    const all = asArray(raw.labels).map(String)
    const isOpen = raw.state !== 'closed'
    const listed = board ? [...board.labelOf].find(([, label]) => all.includes(label))?.[0] : undefined
    const open = board ? (listed ?? OPEN) : (statusOf(all) ?? first)

    return [
      {
        number: raw.iid,
        title: String(raw.title ?? ''),
        body: normalizeBody(raw.description),
        url: String(raw.web_url ?? ''),
        updatedAt: String(raw.updated_at ?? ''),
        isOpen,
        status: isOpen ? open : done,
        labels: all.filter(label => !isStatusLabel(label) && !listLabels.includes(label)),
      },
    ]
  }

  const fieldsOf = (card: Card): Record<string, string> => {
    const column = board ? board.labelOf.get(card.status) : statusLabel(card.status)
    const labels = column === undefined || column === '' ? card.labels : [...card.labels, column]

    return { title: card.title, description: card.body, labels: labels.join(',') }
  }
  const one = (raw: unknown, what: string): RemoteIssue => {
    const issue = toIssue(raw)[0]
    if (!issue) throw new Error(`glab answered no issue for ${what}`)

    return issue
  }

  return {
    name: 'gitlab',
    columns: board?.columns ?? null,
    notice: null,
    list: async () =>
      asArray(await api('issues?per_page=100&order_by=updated_at&sort=desc')).flatMap(toIssue),
    create: async card => {
      const made = one(await api('issues', fieldsOf(card), 'POST'), card.title)
      if (card.status !== done) return made

      return one(await api(`issues/${made.number}`, { state_event: 'close' }, 'PUT'), card.title)
    },
    push: async (card, was) => {
      const shouldBeOpen = card.status !== done
      const state: Record<string, string> =
        shouldBeOpen === was.isOpen ? {} : { state_event: shouldBeOpen ? 'reopen' : 'close' }

      return one(await api(`issues/${was.number}`, { ...fieldsOf(card), ...state }, 'PUT'), card.title)
    },
  }
}
