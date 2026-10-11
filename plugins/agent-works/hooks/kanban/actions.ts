import type { BoardConfig, Card, StartMode, View } from '../../types'
import { ARCHIVED, SUGGESTED, doneColumnOf, planMove } from './cards'
import { launch } from './launch'
import { getBoard, writeCards, writeConfig } from './store'
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
  if (start && card.status !== start.id) {
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

export async function acceptCard(host: Host, id: string): Promise<void> {
  const board = await getBoard(host)
  const first = board.config.columns[0]
  const card = board.cards.find(one => one.id === id)
  if (first && card?.status === SUGGESTED) await moveCard(host, id, first.id)
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
