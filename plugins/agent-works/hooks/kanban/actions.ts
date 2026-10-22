import type { Board, BoardConfig, Card, Scope, Sprint, StartMode, View } from '../../types'
import {
  ARCHIVED,
  EPIC,
  SUGGESTED,
  activeSprint,
  defaultScope,
  doneColumnOf,
  nextSprintId,
  planMove,
  planSprintClose,
} from './cards'
import { launch } from './launch'
import { addCard, getBoard, nowIso, writeCards, writeConfig } from './store'
import type { Host } from './host'

let onChange: (host: Host) => void = () => undefined

/** Names what runs after each local change to the board: the remote sync's debounce. */
export function setChangeListener(listener: (host: Host) => void): void {
  onChange = listener
}

/**
 * Shows another view of the pane. The redraw takes away the element that held
 * the focus, and the surface then drops the pane's focus with it, so the next
 * click would only focus the pane again: the pane asks for the keyboard back.
 */
export async function setView(host: Host, view: View): Promise<void> {
  await host.state.view.set(() => view)
  host.refocus()
}

export async function select(host: Host, id: string | null): Promise<void> {
  await host.state.selected.set(() => id)
}

/**
 * Moves a card to a lane, at `index` or its end. Into the start column from
 * elsewhere it first hands the card to an agent, and stays put if that fails.
 */
export async function moveCard(
  host: Host,
  id: string,
  to: string,
  index?: number,
  mode?: StartMode,
): Promise<boolean> {
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  const column = board.config.columns.find(one => one.id === to)
  const isLane = column !== undefined || (to === SUGGESTED && card?.status === SUGGESTED)
  if (!card || !isLane) return false
  if (column?.role === 'start' && card.status !== to) {
    const launched = await launch(host, board, card, mode ?? board.config.startMode)
    host.toast(launched.isStarted ? launched.message : `Could not start "${card.title}": ${launched.message}.`)
    if (!launched.isStarted) return false
  }
  const changed = planMove(board.cards, id, to, index)
  if (changed.length > 0) {
    await writeCards(host, changed)
    onChange(host)
  }

  return true
}

/** Puts a card in a column as a plain move: nothing is launched, whatever the column. */
export async function placeCard(host: Host, id: string, to: string): Promise<void> {
  const board = await getBoard(host)
  const changed = planMove(board.cards, id, to)
  if (changed.length === 0) return
  await writeCards(host, changed)
  onChange(host)
}

/** Hands a card to an agent now, moving it to the start column if it is elsewhere. */
export async function startCard(host: Host, id: string, mode?: StartMode): Promise<void> {
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  const start = board.config.columns.find(column => column.role === 'start')
  if (!card) return
  // An epic is handed over to be broken down; it stays where it is.
  if (start && card.status !== start.id && card.kind !== EPIC) {
    await moveCard(host, id, start.id, undefined, mode)

    return
  }
  const launched = await launch(host, board, card, mode ?? board.config.startMode)
  host.toast(launched.isStarted ? launched.message : `Could not start "${card.title}": ${launched.message}.`)
}

/** Moves a card one lane left or right of the one it is in. */
export async function shiftCard(host: Host, id: string, by: -1 | 1): Promise<void> {
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  if (!card || (card.status === SUGGESTED && by < 0)) return
  const ids = board.config.columns.map(column => column.id)
  const at = card.status === SUGGESTED ? -1 : ids.indexOf(card.status)
  const to = ids[Math.max(0, at + by)]
  if (to !== undefined && to !== card.status) await moveCard(host, id, to)
}

/** Moves a card one place up or down its own lane. */
export async function nudgeCard(host: Host, id: string, by: -1 | 1): Promise<void> {
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  if (!card) return
  const lane = board.cards.filter(one => one.status === card.status).sort((a, b) => a.order - b.order)
  const at = lane.findIndex(one => one.id === id)
  await moveCard(host, id, card.status, Math.max(0, at + by))
}

/** Accepts a suggested card into the first column, and into the sprint or epic the board is scoped to. */
export async function acceptCard(host: Host, id: string): Promise<void> {
  const board = await getBoard(host)
  const first = board.config.columns[0]
  const card = board.cards.find(one => one.id === id)
  if (!first || card?.status !== SUGGESTED) return
  const planned = plannedFor(board, await currentScope(host))
  const patch = {
    sprint: card.sprint === '' ? planned.sprint : card.sprint,
    epic: card.epic === '' ? planned.epic : card.epic,
  }
  if (patch.sprint !== card.sprint || patch.epic !== card.epic) await patchCard(host, id, patch)
  await moveCard(host, id, first.id)
}

/** The scope the lanes show: the person's choice, else the board's default. */
export async function currentScope(host: Host): Promise<Scope> {
  return (await host.state.scope.get()) ?? defaultScope((await getBoard(host)).config)
}

export async function setScope(host: Host, scope: Scope): Promise<void> {
  await host.state.scope.set(() => scope)
  await select(host, null)
}

/** The next scope of the toolbar's button: sprint (while one is active), backlog, all, and round. */
export async function cycleScope(host: Host): Promise<void> {
  const board = await getBoard(host)
  const order: Scope['kind'][] = activeSprint(board.config) ? ['sprint', 'backlog', 'all'] : ['backlog', 'all']
  const at = order.indexOf((await currentScope(host)).kind)
  const kind = order[(at + 1) % order.length] ?? 'all'
  await setScope(host, kind === 'sprint' ? { kind } : kind === 'backlog' ? { kind } : { kind: 'all' })
}

/** The sprint and epic a card made while the board shows `scope` belongs to. */
export function plannedFor(board: Board, scope: Scope): { sprint: string; epic: string } {
  const active = activeSprint(board.config)

  return {
    sprint: scope.kind === 'sprint' && active ? active.id : '',
    epic: scope.kind === 'epic' ? scope.id : '',
  }
}

/** A new epic card, in the first column. */
export async function addEpic(host: Host, title: string, body = ''): Promise<Card> {
  const board = await getBoard(host)
  const card = await addCard(host, { title, status: board.config.columns[0]?.id ?? 'backlog', kind: EPIC, body })
  onChange(host)

  return card
}

async function today(host: Host): Promise<string> {
  return (await nowIso(host)).slice(0, 10)
}

/** A new sprint, planned: it starts when the person starts it. */
export async function addSprint(host: Host, title: string, goal = '', end = ''): Promise<Sprint> {
  const board = await getBoard(host)
  const sprint: Sprint = {
    id: nextSprintId(board.config),
    title,
    goal,
    start: '',
    end,
    state: 'planned',
    closed: null,
  }
  await writeConfig(host, { ...board.config, sprints: [...board.config.sprints, sprint] })

  return sprint
}

export async function patchSprint(host: Host, id: string, patch: Partial<Omit<Sprint, 'id'>>): Promise<void> {
  const board = await getBoard(host)
  if (!board.config.sprints.some(one => one.id === id)) return
  await writeConfig(host, {
    ...board.config,
    sprints: board.config.sprints.map(one => (one.id === id ? { ...one, ...patch } : one)),
  })
}

/** Starts a planned sprint, when none is active, and narrows the board to it. Answers what happened. */
export async function startSprint(host: Host, id: string): Promise<string> {
  const board = await getBoard(host)
  const sprint = board.config.sprints.find(one => one.id === id)
  const active = activeSprint(board.config)
  if (!sprint) return `No sprint "${id}".`
  if (sprint.state !== 'planned') return `Sprint ${id} is ${sprint.state}; only a planned sprint starts.`
  if (active) return `Sprint ${active.id} is still active: close it first.`
  await patchSprint(host, id, { state: 'active', start: sprint.start === '' ? await today(host) : sprint.start })
  await setScope(host, { kind: 'sprint' })

  return `Sprint ${id} "${sprint.title}" is active.`
}

/** What closing a sprint will do, in a sentence; undefined when it cannot close. */
export function closePreview(board: Board, id: string): string | undefined {
  const plan = planSprintClose(board, id, '')
  if (!plan) return undefined
  const done = plan.cards.filter(card => card.status === ARCHIVED).length
  const rolled = plan.cards.length - done

  return `${done} done card(s) archived, ${rolled} unfinished card(s) to ${plan.next ? `sprint ${plan.next.id}` : 'the backlog'}.`
}

/** Closes a sprint: its done cards are archived and the rest roll on, in one pass. Answers what happened. */
export async function closeSprint(host: Host, id: string): Promise<string> {
  const board = await getBoard(host)
  const plan = planSprintClose(board, id, await nowIso(host))
  if (!plan) return `No open sprint "${id}".`
  const said = closePreview(board, id) ?? ''
  if (plan.cards.length > 0) await writeCards(host, plan.cards)
  await writeConfig(host, plan.config)
  if ((await host.state.scope.get())?.kind === 'sprint') await host.state.scope.set(() => null)
  onChange(host)

  return `Sprint ${id} closed: ${said}`
}

export async function archiveCard(host: Host, id: string): Promise<void> {
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  if (!card) return
  await writeCards(host, [{ ...card, status: ARCHIVED }])
  await select(host, null)
  onChange(host)
}

/**
 * Settles a gate: its evidence is appended to the card's body and the card goes
 * to the end of the done column, in one write. Nothing is launched.
 */
export async function settleCard(host: Host, id: string, note: string): Promise<void> {
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  const done = doneColumnOf(board.config)
  if (!card || !done) return
  const body = `${card.body.trim()}\n\n${note}`.trim()
  const moved = planMove(board.cards, id, done.id)
  const changed = moved.some(one => one.id === id) ? moved : [...moved, card]
  await writeCards(
    host,
    changed.map(one => (one.id === id ? { ...one, body } : one)),
  )
  onChange(host)
}

/** Turns the board's gate filter on or off. */
export async function toggleGatesOnly(host: Host): Promise<void> {
  await host.state.isGatesOnly.set(isOn => !isOn)
}

export async function patchCard(host: Host, id: string, patch: Partial<Card>): Promise<void> {
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  if (!card) return
  await writeCards(host, [{ ...card, ...patch, id: card.id, file: card.file }])
  onChange(host)
}

export async function patchConfig(host: Host, patch: Partial<BoardConfig>): Promise<void> {
  const board = await getBoard(host)
  await writeConfig(host, { ...board.config, ...patch })
}
