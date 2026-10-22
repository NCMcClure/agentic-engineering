import type { BoardConfig, Card, Column, Sprint } from '../../../types'
import { slugify } from '../cards'
import type { Host } from '../host'

/** An issue as the board reads it: `status` a column id, null when the remote names none. */
export type RemoteIssue = {
  number: number
  title: string
  body: string
  url: string
  updatedAt: string
  isOpen: boolean
  status: string | null
  labels: string[]
  /** The milestone's title; null when the issue has none. */
  milestone: string | null
  /** What the issue names as its epic: a parent issue (or GitLab epic), or an `epic:<id>` label; null when nothing. */
  parent: ParentRef | null
  /** A GitLab group epic rather than an issue: its number is the epic's iid. */
  isEpic: boolean
}

export type ParentRef = { number: number; isEpic: boolean } | { label: string }

/** What a card is planned into, as the remote should show it. */
export type Plan = {
  /** The card's sprint, for its milestone; null when it has none the board knows. */
  sprint: Sprint | null
  /** The card's epic: its card id, and its remote once it has one. */
  epic: { id: string; remote: { number: number; isEpic: boolean } | null } | null
}

export type Provider = {
  name: 'github' | 'gitlab'
  /** The remote board's columns, for the local board to adopt; null where the remote has no board. */
  columns: Column[] | null
  /** Said once to the person when the provider settled for less (no project scope). */
  notice: string | null
  list: () => Promise<RemoteIssue[]>
  create: (card: Card, plan: Plan) => Promise<RemoteIssue>
  push: (card: Card, was: RemoteIssue, plan: Plan) => Promise<RemoteIssue>
}

export type Connect = (host: Host, root: string, config: BoardConfig) => Promise<Provider>

const STATUS_LABEL = 'status:'

export function statusLabel(column: string): string {
  return `${STATUS_LABEL}${column}`
}

export function isStatusLabel(label: string): boolean {
  return label.startsWith(STATUS_LABEL)
}

export function statusOf(labels: readonly string[]): string | null {
  const label = labels.find(isStatusLabel)

  return label === undefined ? null : label.slice(STATUS_LABEL.length)
}

const EPIC_LABEL = 'epic:'

/** The label that names a card's epic where the remote has no parent link to give it. */
export function epicLabel(id: string): string {
  return `${EPIC_LABEL}${id}`
}

export function isEpicLabel(label: string): boolean {
  return label.startsWith(EPIC_LABEL)
}

export function epicOfLabels(labels: readonly string[]): ParentRef | null {
  const label = labels.find(isEpicLabel)

  return label === undefined ? null : { label: label.slice(EPIC_LABEL.length) }
}

/** A label the board keeps for itself: a column or an epic, never one of the card's own. */
export function isBoardLabel(label: string): boolean {
  return isStatusLabel(label) || isEpicLabel(label)
}

/** A sprint's milestone: matched by title, so a milestone renamed on the remote stops being the sprint's. */
export function milestoneTitle(sprint: Sprint): string {
  return sprint.title.trim() === '' ? sprint.id : sprint.title.trim()
}

/** Where a linked issue lives, so a GitLab epic and an issue of the same number stay apart. */
export function remoteKey(number: number, isEpic: boolean): string {
  return `${isEpic ? 'epic' : 'issue'}#${number}`
}

export function isEpicUrl(url: string): boolean {
  return /\/-\/epics\/\d+/.test(url)
}

export function normalizeBody(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : ''
}

export function doneColumn(columns: readonly Column[]): string | null {
  return columns.find(column => column.role === 'done')?.id ?? null
}

/**
 * A remote board's column names as local columns: the first that reads as in
 * progress starts tasks, the last that reads as finished closes issues.
 */
export function adoptColumns(names: readonly string[]): Column[] {
  const columns: Column[] = names.map(title => ({ id: slugify(title), title, role: null }))
  const start = columns.find(column => /progress|doing|active|wip/i.test(column.title))
  const done = columns.findLast(column => /done|closed|complete|shipped|merged/i.test(column.title))
  if (start) start.role = 'start'
  if (done && done !== start) done.role = 'done'

  return columns
}

/** Runs a CLI by argv in the repository and answers its stdout, or throws its first error line. */
export async function run(host: Host, root: string, argv: readonly string[], stdin?: string): Promise<string> {
  const ran = await host.run(argv, { cwd: root, timeoutMs: 60_000, ...(stdin === undefined ? {} : { stdin }) })
  if (ran.exitCode !== 0) {
    const reason = (ran.stderr.trim() || ran.stdout.trim()).split(/\r?\n/)[0] ?? ''
    throw new Error(`${argv[0]} ${argv[1] ?? ''}: ${reason === '' ? `exit ${ran.exitCode}` : reason}`.slice(0, 200))
  }

  return ran.stdout
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
