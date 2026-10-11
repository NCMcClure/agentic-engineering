import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card, CardPriority, SyncState, View } from '../../types'
import {
  acceptCard,
  archiveCard,
  moveCard,
  nudgeCard,
  placeCard,
  select,
  setChangeListener,
  settleCard,
  setView,
  shiftCard,
  startCard,
  toggleGatesOnly,
} from './actions'
import {
  ARCHIVED,
  GATE,
  SUGGESTED,
  cardLine,
  doneColumnOf,
  findDuplicate,
  isGate,
  isKnownStatus,
  toClientBoard,
} from './cards'
import { drain } from './launch'
import { scheduleSync, setRemoteEnabled, syncIfEnabled } from './remote/sync'
import { addCard, configure, getBoard, locate, nowIso, reload, syncIntervalMs } from './store'
import type { Host } from './host'
import { cardView, listBoard, newView, settingsView, toolbar } from './views'

const PANE = 'kanban'
const TITLE = 'Kanban'
const COMMAND = 'kanban'
const POLL_MS = 3000
/** How long a view change's redraw takes to land on the surface, generously. */
const REFOCUS_MS = 150
const SURFACE_TOOL = 'mcp__agent-works__surface_task'
const MOVE_TOOL = 'mcp__agent-works__move_task'
const LIST_TOOL = 'mcp__agent-works__list_tasks'
const OWE_TOOL = 'mcp__agent-works__owe_gate'
const SETTLE_TOOL = 'mcp__agent-works__settle_gate'

const SURFACE_DESCRIPTION = `Put a task on the project's kanban board for the user to consider, without interrupting your current work.

Call this when you notice something worth doing that is outside the change you are making: a bug spotted in passing, a pattern repeated often enough to deserve a fix, stale docs, missing test coverage, a confirmed TODO, a security issue, or a follow-up your own change makes necessary. Do not call it for vague code-smell observations, low-confidence hunches, or anything you can simply fix inline as part of the current task.

The task lands in the kanban board's Suggested lane; the user accepts or dismisses it. Write it to stand alone: a specific title, and details with the file paths, what you saw, and why it matters, so that an agent with none of this conversation could act on it. Then carry on with what you were doing.`

type Engine = EngineInterface

const BOARD_VIEW: View = { kind: 'board' }
const SYNC_OFF: SyncState = { status: 'off', message: '', at: 0 }

const boardAtom = atom({ plugin: 'agent-works', key: 'board' } as const, null)
const viewAtom = atom({ plugin: 'agent-works', key: 'view' } as const, BOARD_VIEW)
const selectedAtom = atom({ plugin: 'agent-works', key: 'selected' } as const, null)
const queueAtom = atom({ plugin: 'agent-works', key: 'queue' } as const, [])
const syncAtom = atom({ plugin: 'agent-works', key: 'sync' } as const, SYNC_OFF)
const turnAtom = atom({ plugin: 'agent-works', key: 'isTurnRunning' } as const, false)
const brokenAtom = atom({ plugin: 'agent-works', key: 'isClientBroken' } as const, false)
const gatesAtom = atom({ plugin: 'agent-works', key: 'isGatesOnly' } as const, false)

/** The engine as the mod's other files reach it: every call on `$` is spelled here. */
function hostOf($: Engine): Host {
  return {
    exists: path => $.fs.exists(path),
    list: path => $.fs.list(path),
    readFile: path => $.fs.read(path),
    writeFile: (path, content) => $.fs.write(path, content),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    repo: () => $.session.repo(),
    root: () => $.session.root(),
    run: (argv, init) => $.process.run(argv, init),
    mcp: (server, tool, args) => $.mcp.call(server, tool, args),
    submit: async prompt => !('drop' in (await $.prompt.submit({ text: prompt, asUser: true }))),
    toast: message => $.ui.toast(message),
    refocus: () => {
      $.clock.after(REFOCUS_MS, () => void $.ui.open({ id: PANE, title: TITLE, focus: true }).catch(() => undefined))
    },
    ask: (question, options) => $.ui.ask(question, options),
    commands: () => $.command.list(),
    state: {
      board: { get: () => read($, boardAtom), set: change => update($, boardAtom, change) },
      view: { get: () => read($, viewAtom), set: change => update($, viewAtom, change) },
      selected: { get: () => read($, selectedAtom), set: change => update($, selectedAtom, change) },
      queue: { get: () => read($, queueAtom), set: change => update($, queueAtom, change) },
      sync: { get: () => read($, syncAtom), set: change => update($, syncAtom, change) },
      isTurnRunning: { get: () => read($, turnAtom), set: change => update($, turnAtom, change) },
      isClientBroken: { get: () => read($, brokenAtom), set: change => update($, brokenAtom, change) },
      isGatesOnly: { get: () => read($, gatesAtom), set: change => update($, gatesAtom, change) },
    },
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(one => one !== '') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The card an agent named by its id, with or without the leading zeros. */
function cardOf(cards: readonly Card[], id: string): Card | undefined {
  return cards.find(one => one.id === id || one.id === id.padStart(4, '0'))
}

/** One post of the board's surface module: validated here, since code sent it. */
async function onPost($: Engine, data: Record<string, unknown>): Promise<void> {
  const id = text(data.id)
  const by = data.by === -1 ? -1 : 1
  switch (data.type) {
    case 'select':
      return select(hostOf($), id === '' ? null : id)
    case 'move':
      await moveCard(hostOf($), id, text(data.to), typeof data.index === 'number' ? data.index : undefined)

      return
    case 'shift':
      return shiftCard(hostOf($), id, by)
    case 'nudge':
      return nudgeCard(hostOf($), id, by)
    case 'open':
      return setView(hostOf($), { kind: 'card', id })
    case 'new': {
      const board = await getBoard(hostOf($))
      const to = text(data.to)
      const first = board.config.columns[0]?.id ?? 'backlog'

      return setView(hostOf($), { kind: 'new', status: board.config.columns.some(column => column.id === to) ? to : first })
    }
    case 'start':
      return startCard(hostOf($), id)
    case 'accept':
      return acceptCard(hostOf($), id)
    case 'archive':
      return archiveCard(hostOf($), id)
    case 'filter':
      return toggleGatesOnly(hostOf($))
    default:
  }
}

/** A card file an agent's Edit or Write just changed is read at once, not at the next poll. */
async function onFileWritten($: Engine, file: string): Promise<void> {
  const dir = (await locate(hostOf($))).replaceAll('\\', '/').toLowerCase()
  if (!file.replaceAll('\\', '/').toLowerCase().startsWith(dir)) return
  await reload(hostOf($)).catch(() => undefined)
  scheduleSync(hostOf($))
}

export const register: Register = (on, options) => {
  configure(options)
  setChangeListener(scheduleSync)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: "Open this repository's kanban board",
      argumentHint: '[add <title> | sync on|off]',
    })
    await $.tool.register({
      name: 'surface_task',
      description: SURFACE_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short and specific, as an imperative: "Fix race in session cache".' },
          details: {
            type: 'string',
            description: 'Markdown. File paths, what you saw, why it matters, and what done looks like.',
          },
          kind: { type: 'string', enum: ['bug', 'pattern', 'debt', 'docs', 'tests', 'security', 'followup'] },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          files: { type: 'array', items: { type: 'string' }, description: 'Paths the task concerns.' },
          skills: {
            type: 'array',
            items: { type: 'string' },
            description: 'Skills the agent that takes this task should use, by name.',
          },
        },
        required: ['title', 'details'],
      },
    })
    await $.tool.register({
      name: 'move_task',
      description:
        "Move a card of the project's kanban board to another column, by the card's id: to the review column when you finish the task a card handed you. `status` is a column id, as list_tasks shows them. A gate is not moved to done: settle it with settle_gate.",
      isDeferred: true,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, status: { type: 'string' } },
        required: ['id', 'status'],
      },
    })
    await $.tool.register({
      name: 'list_tasks',
      description:
        "List the cards of the project's kanban board: each card's id, column, kind (task or gate), owner and title, what a gate is owed for, and the column ids.",
      isDeferred: true,
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: 'owe_gate',
      description:
        "Record a gate that is owed on the project's kanban board: a check that must still be run before work counts as verified and that you cannot run now (a full test pass, a render, a run that needs another checkout, machine or person). It becomes a gate card in the first column. Give what it is owed for (`ref`: the pull request, issue or card) and what running it needs (`needs`). Settle it with settle_gate once it has run.",
      isDeferred: true,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The check to run, as an imperative: "Run the smoke gate on main".' },
          details: {
            type: 'string',
            description: 'Markdown. The exact command, what passing looks like, and why it could not be run now.',
          },
          ref: { type: 'string', description: 'What the gate is owed for: a pull request, an issue or a card ("#213").' },
          needs: { type: 'string', description: 'What running it needs: "the main checkout", "a free GPU", "the owner".' },
          owner: { type: 'string', description: 'Who can run it, when that is known.' },
        },
        required: ['title', 'ref', 'needs'],
      },
    })
    await $.tool.register({
      name: 'settle_gate',
      description:
        "Settle an owed gate of the project's kanban board, by the card's id, once the check has run and passed: the evidence (the command and its result) is appended to the card and the card moves to done.",
      isDeferred: true,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          evidence: { type: 'string', description: 'The command that ran and what it showed.' },
        },
        required: ['id', 'evidence'],
      },
    })
    await locate(hostOf($), true)
    await reload(hostOf($)).catch(() => undefined)
    $.clock.every(POLL_MS, () => void reload(hostOf($)).catch(() => undefined))
    $.clock.every(syncIntervalMs(), () => void syncIfEnabled(hostOf($)).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    await locate(hostOf($), true)
    const board = await reload(hostOf($))
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const argument = rest.join(' ').trim()
    if (verb === 'add' && argument !== '') {
      const card = await addCard(hostOf($), { title: argument, status: board.config.columns[0]?.id ?? 'backlog' })
      scheduleSync(hostOf($))

      return { text: `Added card ${card.id}: ${card.title}` }
    }
    if (verb === 'sync' && (argument === 'on' || argument === 'off')) {
      await setRemoteEnabled(hostOf($), argument === 'on')
      const { status, message } = await read($, syncAtom)

      return { text: status === 'error' ? `Sync failed: ${message}` : `Remote sync is ${status === 'off' ? 'off' : 'on'}.` }
    }
    await setView(hostOf($), { kind: 'board' })
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: `Kanban opened: ${board.cards.filter(card => card.status !== ARCHIVED).length} cards in ${board.dir}` }
  })

  on('tool.call', { tool: SURFACE_TOOL }, async ($, e) => {
    const input: Record<string, unknown> = e
    const title = text(input.title)
    if (title === '') return { result: 'Not added: a task needs a title.' }
    const board = await reload(hostOf($))
    const twin = findDuplicate(board, title)
    if (twin) return { result: `Already on the kanban board as card ${twin.id} (${twin.status}); nothing added.` }
    const files = texts(input.files)
    const kind = text(input.kind)
    const priority: CardPriority = input.priority === 'low' || input.priority === 'high' ? input.priority : 'normal'
    const card = await addCard(hostOf($), {
      title,
      status: SUGGESTED,
      source: 'claude',
      priority,
      labels: kind === '' ? [] : [kind],
      skills: texts(input.skills),
      body: [text(input.details), files.length > 0 ? `Files:\n${files.map(file => `- ${file}`).join('\n')}` : '']
        .filter(part => part !== '')
        .join('\n\n'),
    })
    $.ui.toast(`Claude suggested a task on the kanban board: ${card.title}. /kanban to review it.`)

    return { result: `Suggested as card ${card.id}. The user will accept or dismiss it; carry on with your task.` }
  })

  on('tool.call', { tool: MOVE_TOOL }, async ($, e) => {
    const input: Record<string, unknown> = e
    const id = text(input.id)
    const status = text(input.status)
    const board = await reload(hostOf($))
    const card = cardOf(board.cards, id)
    if (!card) return { result: `No card with id "${id}". list_tasks shows the ids.` }
    const column = board.config.columns.find(one => one.id === status)
    if (!column) {
      return { result: `No column "${status}". The columns are: ${board.config.columns.map(one => one.id).join(', ')}.` }
    }
    // An agent moving a card reports progress; it never launches another agent by doing so.
    await placeCard(hostOf($), card.id, column.id)

    return { result: `Card ${card.id} is now in ${column.title}.` }
  })

  on('tool.call', { tool: LIST_TOOL }, async $ => {
    const board = await reload(hostOf($))
    const cards = board.cards.filter(card => card.status !== ARCHIVED)
    const columns = board.config.columns.map(column => column.id).join(', ')

    return { result: [`Columns: ${columns} (plus ${SUGGESTED})`, ...cards.map(cardLine)].join('\n') }
  })

  on('tool.call', { tool: OWE_TOOL }, async ($, e) => {
    const input: Record<string, unknown> = e
    const title = text(input.title)
    const ref = text(input.ref)
    const needs = text(input.needs)
    if (title === '' || ref === '' || needs === '') {
      return { result: 'Not added: a gate needs a title, what it is owed for (ref) and what running it needs (needs).' }
    }
    const board = await reload(hostOf($))
    const twin = findDuplicate(board, title, ref)
    if (twin) return { result: `Already owed as card ${twin.id} (${twin.status}); nothing added.` }
    const card = await addCard(hostOf($), {
      title,
      status: board.config.columns[0]?.id ?? 'backlog',
      source: 'claude',
      kind: GATE,
      ref,
      needs,
      owner: text(input.owner),
      body: text(input.details),
    })
    scheduleSync(hostOf($))
    $.ui.toast(`A gate is owed on the kanban board: ${card.title} (for ${ref}). /kanban to see it.`)

    return { result: `Owed as gate card ${card.id}. Settle it with settle_gate when it has run.` }
  })

  on('tool.call', { tool: SETTLE_TOOL }, async ($, e) => {
    const input: Record<string, unknown> = e
    const id = text(input.id)
    const evidence = text(input.evidence)
    const board = await reload(hostOf($))
    const card = cardOf(board.cards, id)
    if (!card) return { result: `No card with id "${id}". list_tasks shows the ids.` }
    if (!isGate(card)) return { result: `Card ${card.id} is a ${card.kind}, not a gate: move it with move_task.` }
    if (evidence === '') return { result: 'Not settled: a gate is settled with its evidence, the command that ran and what it showed.' }
    const done = doneColumnOf(board.config)
    if (!done) return { result: 'Not settled: this board has no column to settle into.' }
    if (card.status === done.id) return { result: `Gate ${card.id} is already settled.` }
    await settleCard(hostOf($), card.id, `Settled ${await nowIso(hostOf($))}: ${evidence}`)

    return { result: `Gate ${card.id} is settled and in ${done.title}.` }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    await onFileWritten($, e.file_path)

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    await onFileWritten($, e.file_path)

    return ran
  })

  on('turn.start', async ($, e, next) => {
    await update($, turnAtom, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await update($, turnAtom, () => false)
      await drain(hostOf($))
    }

    return done
  })

  on('ui.message', async ($, e, next) => {
    const heard = await next(e)
    if (!isRecord(e.data)) return heard
    await onPost($, e.data)
    const board = await read($, boardAtom)
    if (!board) return heard

    return {
      props: toClientBoard(board, await read($, queueAtom), await read($, selectedAtom), await read($, gatesAtom)),
    }
  })

  on('ui.fault', async ($, e, next) => {
    await update($, brokenAtom, () => true)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const board = await read($, boardAtom)
    if (!board) return <Text dimColor>Reading the kanban board…</Text>
    const view = await read($, viewAtom)
    const sync = await read($, syncAtom)

    if (view.kind === 'settings') return settingsView(ui, hostOf($), board, sync)
    if (view.kind === 'new') return newView(ui, hostOf($), board, view.status)
    const card = view.kind === 'card' ? board.cards.find(one => one.id === view.id) : undefined
    if (card) {
      const commands = await $.command.list().catch(() => [])
      const skills = commands.filter(one => one.source === 'plugin' || one.source === 'user').map(one => one.name)

      return cardView(ui, hostOf($), board, card, skills.sort())
    }

    const selected = await read($, selectedAtom)
    const isGatesOnly = await read($, gatesAtom)
    const client = toClientBoard(board, await read($, queueAtom), selected, isGatesOnly)
    const isBroken = await read($, brokenAtom)
    const unknown = board.cards.filter(one => !isKnownStatus(board.config, one.status)).length
    const warning = unknown > 0 && (
      <Text color="warning">{`${unknown} card(s) name a column this board lacks; shown in the first.`}</Text>
    )
    if ((e.surface === 'terminal' || e.surface === 'desktop') && !isBroken) {
      const { Client } = $.ui.resolve(e)

      return (
        <Box flexDirection="column" gap={1}>
          {toolbar(ui, hostOf($), board, selected, sync, isGatesOnly)}
          {warning}
          <Client key="board" module="./kanban.client.tsx" props={client} width={e.props.bodyColumns} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {toolbar(ui, hostOf($), board, selected, sync, isGatesOnly)}
        {warning}
        {listBoard(ui, hostOf($), client.lanes)}
      </Box>
    )
  })
}
