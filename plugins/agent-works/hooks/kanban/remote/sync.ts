import type { Timer } from 'claude-code'

import type { BoardConfig, Card, SyncState } from '../../../types'
import { ARCHIVED, EPIC, SUGGESTED, TASK, fileName, isEpic, nextId, remoteHash } from '../cards'
import { getBoard, reload, writeCardsAsIs, writeConfig } from '../store'
import type { Host } from '../host'
import { connectGithub } from './github'
import { connectGitlab } from './gitlab'
import { isEpicUrl, milestoneTitle, remoteKey } from './provider'
import type { Plan, Provider, RemoteIssue } from './provider'

const DEBOUNCE_MS = 5000

let isRunning = false
let pending: Timer | undefined
let saidNotice: string | null = null
const saidMilestones = new Set<string>()

async function setSync(host: Host, status: SyncState['status'], message: string): Promise<void> {
  const at = await host.now()
  await host.state.sync.set(() => ({ status, message, at }))
}

async function connect(host: Host): Promise<Provider> {
  const repo = await host.repo()
  if (!repo) throw new Error('this folder is not a git repository')
  if (repo.remote === null) throw new Error('the repository has no origin remote')
  const board = await getBoard(host)
  const isGithub = /github\.com[:/]/i.test(repo.remote)

  return (isGithub ? connectGithub : connectGitlab)(host, repo.root, board.config)
}

function keyOfCard(card: Card): string | null {
  return card.remote ? remoteKey(card.remote.number, isEpicUrl(card.remote.url)) : null
}

function linked(card: Card, provider: Provider, issue: RemoteIssue): Card {
  const remote = { provider: provider.name, number: issue.number, url: issue.url, updatedAt: issue.updatedAt }

  return { ...card, remote: { ...remote, syncedHash: remoteHash(card) } }
}

/**
 * A milestone as a sprint id, matched by title. A milestone the board has no
 * sprint for stays the tracker's: said once, never made a sprint, and the
 * card keeps the sprint it had.
 */
function sprintOf(host: Host, config: BoardConfig, issue: RemoteIssue, fallback: string): string {
  if (issue.milestone === null) return ''
  const sprint = config.sprints.find(one => milestoneTitle(one) === issue.milestone)
  if (sprint) return sprint.id
  if (!saidMilestones.has(issue.milestone)) {
    saidMilestones.add(issue.milestone)
    host.toast(`Kanban sync: milestone "${issue.milestone}" matches no sprint on this board; left as it is.`)
  }

  return fallback
}

/** A parent issue (or an `epic:<id>` label) as the id of the epic card it is; the card's own when none is. */
function epicOf(cards: readonly Card[], issue: RemoteIssue, fallback: string): string {
  const parent = issue.parent
  if (parent === null) return ''
  const epic =
    'label' in parent
      ? cards.find(card => card.id === parent.label && isEpic(card))
      : cards.find(card => isEpic(card) && keyOfCard(card) === remoteKey(parent.number, parent.isEpic))

  return epic?.id ?? fallback
}

/** The card as the remote has it: its title, body, labels, column, sprint and epic. */
function pulled(card: Card, provider: Provider, issue: RemoteIssue, theirs: { sprint: string; epic: string }): Card {
  const next = {
    ...card,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    status: issue.status ?? card.status,
    ...theirs,
  }

  return linked(remoteHash(next) === remoteHash(card) ? next : { ...next, updated: issue.updatedAt }, provider, issue)
}

function isSame(a: Card, b: Card): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** What a card is planned into, with its epic's remote as the cards so far have it. */
function planOf(card: Card, config: BoardConfig, cards: ReadonlyMap<string, Card>): Plan {
  const sprint = card.sprint === '' ? null : (config.sprints.find(one => one.id === card.sprint) ?? null)
  if (card.epic === '' || isEpic(card)) return { sprint, epic: null }
  const epic = cards.get(card.epic)
  const remote = epic?.remote ? { number: epic.remote.number, isEpic: isEpicUrl(epic.remote.url) } : null

  return { sprint, epic: { id: card.epic, remote } }
}

/**
 * One two-way pass. A card with no issue gets one; a linked card is pushed
 * when only it changed, pulled when only the issue did, and the newer side
 * wins when both did; an open issue with no card becomes one. Suggested and
 * archived cards are never pushed. Epics go first, so a card can name its
 * epic's issue as its parent in the same pass; an issue other issues hang
 * from comes in as an epic.
 */
export async function syncNow(host: Host): Promise<void> {
  if (isRunning) return
  let board = await reload(host, true)
  if (!board.config.remote.enabled) {
    await setSync(host, 'off', '')

    return
  }
  isRunning = true
  await setSync(host, 'running', '')
  try {
    const provider = await connect(host)
    if (provider.notice !== null && provider.notice !== saidNotice) {
      saidNotice = provider.notice
      host.toast(`Kanban sync: ${provider.notice}`)
    }
    if (provider.columns && JSON.stringify(provider.columns) !== JSON.stringify(board.config.columns)) {
      board = await writeConfig(host, { ...board.config, columns: provider.columns })
    }
    const issues = new Map((await provider.list()).map(issue => [remoteKey(issue.number, issue.isEpic), issue]))
    const config = board.config
    const writes: Card[] = []
    const byId = new Map(board.cards.map(card => [card.id, card]))
    const write = (card: Card) => {
      writes.push(card)
      byId.set(card.id, card)
    }
    let pushedCount = 0
    let pulledCount = 0

    for (const card of [...board.cards.filter(isEpic), ...board.cards.filter(card => !isEpic(card))]) {
      const isLocalOnly = card.status === SUGGESTED || card.status === ARCHIVED
      if (!card.remote) {
        if (isLocalOnly) continue
        write(linked(card, provider, await provider.create(card, planOf(card, config, byId))))
        pushedCount++
        continue
      }
      const issue = issues.get(keyOfCard(card) ?? '')
      if (!issue || isLocalOnly) continue
      const theirs = pulled(card, provider, issue, {
        sprint: sprintOf(host, config, issue, card.sprint),
        epic: isEpic(card) ? card.epic : epicOf([...byId.values()], issue, card.epic),
      })
      const isLocalChanged = remoteHash(card) !== card.remote.syncedHash
      const isRemoteNewer = issue.updatedAt !== card.remote.updatedAt && issue.updatedAt > card.updated
      if (remoteHash(theirs) === remoteHash(card)) {
        if (!isSame(theirs, card)) write(theirs)
      } else if (isLocalChanged && !isRemoteNewer) {
        write(linked(card, provider, await provider.push(card, issue, planOf(card, config, byId))))
        pushedCount++
      } else {
        write(theirs)
        pulledCount++
      }
    }

    const known = new Set(board.cards.flatMap(card => keyOfCard(card) ?? []))
    const parents = new Set(
      [...issues.values()].flatMap(({ parent }) =>
        parent !== null && 'number' in parent ? [remoteKey(parent.number, parent.isEpic)] : [],
      ),
    )
    const all = [...board.cards]
    const fresh = [...issues].filter(([key, issue]) => !known.has(key) && issue.isOpen)
    fresh.sort(([a], [b]) => Number(parents.has(b)) - Number(parents.has(a)))
    for (const [key, issue] of fresh) {
      const id = nextId(all)
      const status = issue.status ?? config.columns[0]?.id ?? 'backlog'
      const isParent = issue.isEpic || parents.has(key)
      const card = linked(
        {
          id,
          file: fileName(id, issue.title),
          title: issue.title,
          status,
          order: all.filter(one => one.status === status).length,
          priority: 'normal',
          labels: issue.labels,
          skills: [],
          source: 'user',
          created: issue.updatedAt,
          updated: issue.updatedAt,
          kind: isParent ? EPIC : TASK,
          owner: '',
          needs: '',
          ref: '',
          epic: isParent ? '' : epicOf(all, issue, ''),
          sprint: sprintOf(host, config, issue, ''),
          body: issue.body,
          remote: null,
          extra: [],
        },
        provider,
        issue,
      )
      all.push(card)
      write(card)
      pulledCount++
    }

    if (writes.length > 0) await writeCardsAsIs(host, writes)
    await setSync(host, 'idle', `${pushedCount} pushed, ${pulledCount} pulled`)
  } catch (error) {
    await setSync(host, 'error', error instanceof Error ? error.message : 'sync failed')
  } finally {
    isRunning = false
  }
}

/** Runs a pass a few seconds after the last local change, while sync is on. */
export function scheduleSync(host: Host): void {
  pending?.cancel()
  pending = host.after(DEBOUNCE_MS, () => {
    pending = undefined
    void syncNow(host)
  })
}

/** A pass on the timer: only where the board has sync on. */
export async function syncIfEnabled(host: Host): Promise<void> {
  const board = await getBoard(host)
  if (board.config.remote.enabled) await syncNow(host)
}

/**
 * Turns the board's remote sync on or off. Turning it on with cards that have
 * no issue yet asks first, since the first pass creates one issue per card.
 */
export async function setRemoteEnabled(host: Host, isEnabled: boolean): Promise<void> {
  const board = await getBoard(host)
  if (isEnabled) {
    const unlinked = board.cards.filter(
      card => !card.remote && card.status !== SUGGESTED && card.status !== ARCHIVED,
    ).length
    if (unlinked > 0) {
      const create = `Create ${unlinked} issue${unlinked === 1 ? '' : 's'}`
      const question = `Turning sync on creates a remote issue for each of the ${unlinked} card${unlinked === 1 ? '' : 's'} that has none. Go ahead?`
      const answer = await host.ask(question, [create, 'Cancel']).catch(() => 'Cancel')
      if (answer !== create) return
    }
  }
  await writeConfig(host, { ...board.config, remote: { enabled: isEnabled } })
  await syncNow(host)
}
