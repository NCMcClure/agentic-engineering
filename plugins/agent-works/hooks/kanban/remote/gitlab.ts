import type { Card, Column, Sprint } from '../../../types'
import { isEpic } from '../cards'
import {
  adoptColumns,
  asArray,
  doneColumn,
  epicLabel,
  epicOfLabels,
  isBoardLabel,
  isRecord,
  milestoneTitle,
  normalizeBody,
  parseJson,
  run,
  statusLabel,
  statusOf,
} from './provider'
import type { Connect, ParentRef, Plan, RemoteIssue } from './provider'

const OPEN = 'open'
const CLOSED = 'closed'

/**
 * GitLab through the person's own `glab` login: issues, and the project's
 * first issue board when it has lists (each list is a label; Open and Closed
 * bracket them); otherwise a `status:<column>` label per card. A sprint is a
 * milestone of its title (made when missing, due on the sprint's end). Where
 * the project's group has epics, an epic card is a group epic and its cards'
 * issues belong to it; elsewhere they carry an `epic:<id>` label.
 */
export const connectGitlab: Connect = async (host, root, config) => {
  const call = async (path: string, fields: Readonly<Record<string, string>> = {}, method = 'GET') =>
    parseJson(
      await run(host, root, [
        'glab',
        'api',
        path,
        '-X',
        method,
        ...Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`]),
      ]),
    )
  const api = (path: string, fields: Readonly<Record<string, string>> = {}, method = 'GET') =>
    call(`projects/:id/${path}`, fields, method)

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

  // Epics live on the group (and need a tier that has them): a project in a user namespace, or a group that
  // answers no epics, keeps epics as labels.
  const project = await call('projects/:id').catch(() => undefined)
  const namespace: Record<string, unknown> = isRecord(project) && isRecord(project.namespace) ? project.namespace : {}
  let group: string | null = null
  if (namespace.kind === 'group' && typeof namespace.id === 'number') {
    const probe = await call(`groups/${namespace.id}/epics?per_page=1`).catch(() => undefined)
    if (Array.isArray(probe)) group = `groups/${namespace.id}`
  }

  const columns = board?.columns ?? config.columns
  const done = doneColumn(columns)
  const first = columns[0]?.id ?? null
  const listLabels = board ? [...board.labelOf.values()] : []
  /** A group epic's iid to its global id, which is what an issue names. */
  const epicIds = new Map<number, number>()
  let milestones: Map<string, { id: number; due: string }> | null = null

  const parentOf = (raw: Record<string, unknown>, labels: readonly string[]): ParentRef | null => {
    const epic = raw.epic
    if (group !== null && isRecord(epic) && typeof epic.iid === 'number') {
      if (typeof epic.id === 'number') epicIds.set(epic.iid, epic.id)

      return { number: epic.iid, isEpic: true }
    }

    return epicOfLabels(labels)
  }

  const toIssue = (raw: unknown): RemoteIssue[] => {
    if (!isRecord(raw) || typeof raw.iid !== 'number') return []
    const all = asArray(raw.labels).map(String)
    const isOpen = raw.state !== 'closed' && raw.state !== 'closed_state'
    const isGroupEpic = /\/-\/epics\//.test(String(raw.web_url ?? ''))
    if (isGroupEpic && typeof raw.id === 'number') epicIds.set(raw.iid, raw.id)
    const listed = board ? [...board.labelOf].find(([, label]) => all.includes(label))?.[0] : undefined
    const open = board ? (listed ?? OPEN) : (statusOf(all) ?? first)
    const milestone = isRecord(raw.milestone) && typeof raw.milestone.title === 'string' ? raw.milestone.title : null

    return [
      {
        number: raw.iid,
        title: String(raw.title ?? ''),
        body: normalizeBody(raw.description),
        url: String(raw.web_url ?? ''),
        updatedAt: String(raw.updated_at ?? ''),
        isOpen,
        // An epic has no column on the remote: open keeps the card's, closed is done.
        status: isOpen ? (isGroupEpic ? null : open) : done,
        labels: all.filter(label => !isBoardLabel(label) && !listLabels.includes(label)),
        milestone: isGroupEpic ? null : milestone,
        parent: isGroupEpic ? null : parentOf(raw, all),
        isEpic: isGroupEpic,
      },
    ]
  }

  /** The sprint's milestone id, made when the project (or its group) has none of its title. */
  const ensureMilestone = async (sprint: Sprint): Promise<number> => {
    const title = milestoneTitle(sprint)
    if (milestones === null) {
      milestones = new Map()
      for (const one of asArray(await api('milestones?per_page=100&include_ancestors=true'))) {
        if (!isRecord(one) || typeof one.title !== 'string' || typeof one.id !== 'number') continue
        milestones.set(one.title, { id: one.id, due: String(one.due_date ?? '') })
      }
    }
    const had = milestones.get(title)
    if (had !== undefined) {
      if (sprint.end !== '' && had.due !== sprint.end) {
        await api(`milestones/${had.id}`, { due_date: sprint.end }, 'PUT').catch(() => undefined)
        milestones.set(title, { ...had, due: sprint.end })
      }

      return had.id
    }
    const fields = {
      title,
      ...(sprint.end === '' ? {} : { due_date: sprint.end }),
      ...(sprint.goal === '' ? {} : { description: sprint.goal }),
    }
    const made = await api('milestones', fields, 'POST')
    const id = isRecord(made) && typeof made.id === 'number' ? made.id : null
    if (id === null) throw new Error(`glab made no milestone for sprint ${sprint.id}`)
    milestones.set(title, { id, due: sprint.end })

    return id
  }

  /** The group epic the card's issue belongs to, when its epic is one; null leaves it to a label. */
  const epicOf = (plan: Plan): number | null => {
    const remote = plan.epic?.remote
    if (group === null || !remote?.isEpic) return null

    return epicIds.get(remote.number) ?? null
  }

  const fieldsOf = async (card: Card, plan: Plan, was?: RemoteIssue): Promise<Record<string, string>> => {
    const column = board ? board.labelOf.get(card.status) : statusLabel(card.status)
    const epic = epicOf(plan)
    const labels = [
      ...card.labels,
      ...(column === undefined || column === '' ? [] : [column]),
      ...(plan.epic !== null && epic === null ? [epicLabel(plan.epic.id)] : []),
    ]
    const hadEpic = was !== undefined && was.parent !== null && 'number' in was.parent
    const hadMilestone = was !== undefined && was.milestone !== null
    const milestone = plan.sprint === null ? (hadMilestone ? '0' : null) : String(await ensureMilestone(plan.sprint))

    return {
      title: card.title,
      description: card.body,
      labels: labels.join(','),
      ...(milestone === null ? {} : { milestone_id: milestone }),
      ...(epic !== null ? { epic_id: String(epic) } : hadEpic ? { epic_id: '0' } : {}),
    }
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
    list: async () => [
      ...asArray(await api('issues?per_page=100&order_by=updated_at&sort=desc')).flatMap(toIssue),
      ...(group === null
        ? []
        : asArray(await call(`${group}/epics?per_page=100&order_by=updated_at&sort=desc`)).flatMap(toIssue)),
    ],
    create: async (card, plan) => {
      if (group !== null && isEpic(card)) {
        const fields = { title: card.title, description: card.body, labels: card.labels.join(',') }
        const made = one(await call(`${group}/epics`, fields, 'POST'), card.title)
        if (card.status !== done) return made

        return one(await call(`${group}/epics/${made.number}`, { state_event: 'close' }, 'PUT'), card.title)
      }
      const made = one(await api('issues', await fieldsOf(card, plan), 'POST'), card.title)
      if (card.status !== done) return made

      return one(await api(`issues/${made.number}`, { state_event: 'close' }, 'PUT'), card.title)
    },
    push: async (card, was, plan) => {
      const shouldBeOpen = card.status !== done
      const state: Record<string, string> =
        shouldBeOpen === was.isOpen ? {} : { state_event: shouldBeOpen ? 'reopen' : 'close' }
      if (group !== null && was.isEpic) {
        const fields = { title: card.title, description: card.body, labels: card.labels.join(','), ...state }

        return one(await call(`${group}/epics/${was.number}`, fields, 'PUT'), card.title)
      }

      return one(await api(`issues/${was.number}`, { ...(await fieldsOf(card, plan, was)), ...state }, 'PUT'), card.title)
    },
  }
}
