import type { Board, Card, StartMode } from '../../types'
import { isGate } from './cards'
import { getBoard } from './store'
import type { Host } from './host'

/** The desktop app's own server and tool for spinning a task off into a new session. */
const SPAWN_SERVER = 'ccd_session'
const SPAWN_TOOL = 'spawn_task'

export type Launched = { isStarted: true; message: string } | { isStarted: false; message: string }

/**
 * The first user message of an agent handed a card: the task, where its card
 * lives, how to hand it back, and last the skills the person nudged it toward.
 * A gate is handed over to be run and settled with its evidence, not moved.
 */
export function buildPrompt(board: Board, card: Card): string {
  const start = board.config.columns.findIndex(column => column.role === 'start')
  const after = board.config.columns[start + 1]
  const facts = [
    card.ref === '' ? '' : `For: ${card.ref}`,
    card.needs === '' ? '' : `Needs: ${card.needs}`,
    card.owner === '' ? '' : `Owner: ${card.owner}`,
    card.priority === 'normal' ? '' : `Priority: ${card.priority}`,
    card.labels.length > 0 ? `Labels: ${card.labels.join(', ')}` : '',
    `Card file: ${board.dir}/${card.file}`,
    card.remote ? `Issue: ${card.remote.url}` : '',
  ].filter(line => line !== '')
  const handBack = after
    ? `When you finish, move the card to ${after.title} with the mcp__agent-works__move_task tool (id "${card.id}", status "${after.id}"), or with \`aw kanban move ${card.id} ${after.id}\` if that tool is not available.`
    : ''
  const settle = `When the gate has run and passed, settle it with the mcp__agent-works__settle_gate tool (id "${card.id}", evidence: the command you ran and its result), or with \`aw kanban settle ${card.id} --evidence "…"\` if that tool is not available. If it fails or you cannot run it, leave the card where it is and say why.`
  const parts = [
    isGate(card) ? 'Run this owed gate from the project kanban board.' : 'Work on this task from the project kanban board.',
    `# ${card.title}`,
    card.body.trim(),
    facts.join('\n'),
    isGate(card) ? settle : handBack,
    card.skills.length > 0
      ? `Use these skills for this task: ${card.skills.map(skill => `/${skill.replace(/^\//, '')}`).join(', ')}`
      : '',
  ]

  return parts.filter(part => part !== '').join('\n\n')
}

async function spawnSession(host: Host, board: Board, card: Card): Promise<Launched> {
  try {
    const answer = await host.mcp(SPAWN_SERVER, SPAWN_TOOL, {
      title: `Kanban: ${card.title}`.slice(0, 59),
      prompt: buildPrompt(board, card),
      tldr: `Card ${card.id} was moved to in progress on the kanban board. The new session works on it.`,
    })
    if (answer.isError) return { isStarted: false, message: 'the app refused to open a new session' }

    return { isStarted: true, message: `"${card.title}" is ready as a new session: click its chip to start it.` }
  } catch {
    return { isStarted: false, message: 'new sessions can only be opened from the desktop app' }
  }
}

/**
 * Submits the next queued card as a prompt of this session when no turn runs;
 * `turn.complete` calls it again, so the queue goes one card per turn.
 */
export async function drain(host: Host): Promise<void> {
  if (await host.state.isTurnRunning.get()) return
  const id = (await host.state.queue.get())[0]
  if (id === undefined) return
  await host.state.queue.set(list => list.filter(one => one !== id))
  const board = await getBoard(host)
  const card = board.cards.find(one => one.id === id)
  if (!card) return drain(host)
  await host.state.isTurnRunning.set(() => true)
  const release = () => void host.state.isTurnRunning.set(() => false)
  host.submit(buildPrompt(board, card)).then(isEntered => {
    if (!isEntered) release()
  }, release)
}

export async function launch(host: Host, board: Board, card: Card, mode: StartMode): Promise<Launched> {
  if (mode === 'new-session') return spawnSession(host, board, card)
  await host.state.queue.set(list => (list.includes(card.id) ? list : [...list, card.id]))
  const isWaiting = await host.state.isTurnRunning.get()
  await drain(host)

  return {
    isStarted: true,
    message: isWaiting ? `"${card.title}" is queued for when this turn ends.` : `Started "${card.title}" in this session.`,
  }
}
