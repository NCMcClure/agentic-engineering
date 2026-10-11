import type { Timer } from 'claude-code'

import type { Card, SyncState } from '../../../types'
import { ARCHIVED, SUGGESTED, TASK, cardHash, fileName, nextId } from '../cards'
import { getBoard, reload, writeCardsAsIs, writeConfig } from '../store'
import type { Host } from '../host'
import { connectGithub } from './github'
import { connectGitlab } from './gitlab'
import type { Provider, RemoteIssue } from './provider'

const DEBOUNCE_MS = 5000

let isRunning = false
let pending: Timer | undefined
let saidNotice: string | null = null

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

function linked(card: Card, provider: Provider, issue: RemoteIssue): Card {
  const remote = { provider: provider.name, number: issue.number, url: issue.url, updatedAt: issue.updatedAt }

  return { ...card, remote: { ...remote, syncedHash: cardHash(card) } }
}

/** The card as the remote has it: its title, body, labels and column. */
function pulled(card: Card, provider: Provider, issue: RemoteIssue): Card {
  const next = {
    ...card,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    status: issue.status ?? card.status,
  }

  return linked(cardHash(next) === cardHash(card) ? next : { ...next, updated: issue.updatedAt }, provider, issue)
}

function isSame(a: Card, b: Card): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * One two-way pass. A card with no issue gets one; a linked card is pushed
 * when only it changed, pulled when only the issue did, and the newer side
 * wins when both did; an open issue with no card becomes one. Suggested and
 * archived cards are never pushed.
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
    const issues = new Map((await provider.list()).map(issue => [issue.number, issue]))
    const writes: Card[] = []
    let pushedCount = 0
    let pulledCount = 0

    for (const card of board.cards) {
      const isLocalOnly = card.status === SUGGESTED || card.status === ARCHIVED
      if (!card.remote) {
        if (isLocalOnly) continue
        writes.push(linked(card, provider, await provider.create(card)))
        pushedCount++
        continue
      }
      const issue = issues.get(card.remote.number)
      if (!issue || isLocalOnly) continue
      const theirs = pulled(card, provider, issue)
      const isLocalChanged = cardHash(card) !== card.remote.syncedHash
      const isRemoteNewer = issue.updatedAt !== card.remote.updatedAt && issue.updatedAt > card.updated
      if (cardHash(theirs) === cardHash(card)) {
        if (!isSame(theirs, card)) writes.push(theirs)
      } else if (isLocalChanged && !isRemoteNewer) {
        writes.push(linked(card, provider, await provider.push(card, issue)))
        pushedCount++
      } else {
        writes.push(theirs)
        pulledCount++
      }
    }

    const known = new Set(board.cards.flatMap(card => (card.remote ? [card.remote.number] : [])))
    const all = [...board.cards]
    for (const issue of issues.values()) {
      if (known.has(issue.number) || !issue.isOpen) continue
      const id = nextId(all)
      const status = issue.status ?? board.config.columns[0]?.id ?? 'backlog'
      const fresh: Card = {
        id,
        file: fileName(id, issue.title),
        title: issue.title,
        status,
        order: all.filter(card => card.status === status).length,
        priority: 'normal',
        labels: issue.labels,
        skills: [],
        source: 'user',
        created: issue.updatedAt,
        updated: issue.updatedAt,
        kind: TASK,
        owner: '',
        needs: '',
        ref: '',
        body: issue.body,
        remote: null,
        extra: [],
      }
      const card = linked(fresh, provider, issue)
      all.push(card)
      writes.push(card)
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
