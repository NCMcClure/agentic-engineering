import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseCard } from './cards'

const DIR = '/repo/.agents/kanban'
const OLD_DIR = '/repo/.agents/board'

/** A path as the tests name it, whatever the platform's spelling of it. */
const plain = (path: string) => path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

/** `/kanban <args>`, as typed: the engine stamps the rest of a run's input. */
const slash = (args: string) => ({ command: 'kanban', args }) as Parameters<Engine['command']['run']>[0]

/** The world beneath the mod, in memory: a repository's files, its CLI, and what the mod showed and sent. */
function world(on: On, seed: Readonly<Record<string, string>> = {}) {
  const files = new Map(Object.entries(seed))
  const stamps = new Map<string, number>()
  const toasts: string[] = []
  const prompts: string[] = []
  const runs: (readonly string[])[] = []
  const spawned: Record<string, unknown>[] = []
  const opened: unknown[] = []
  const state = { tick: 0, isSpawnRefused: false, cli: (_argv: readonly string[], _stdin?: string) => '' }
  const clock = mock.clock(on, { now: Date.parse('2026-03-01T00:00:00Z') })

  on('fs.exists', (_$, e) => ({
    value: [...files.keys()].some(path => path === plain(e.path) || path.startsWith(`${plain(e.path)}/`)),
  }))
  on('fs.list', (_$, e) => ({
    value: [...files.entries()]
      .filter(([path]) => path.startsWith(`${plain(e.path)}/`) && !path.slice(plain(e.path).length + 1).includes('/'))
      .map(([path, text]) => ({
        name: path.slice(plain(e.path).length + 1),
        kind: 'file' as const,
        size: text.length,
        mtimeMs: stamps.get(path) ?? 0,
        isLink: false,
      })),
  }))
  on('fs.read', (_$, e) => {
    const text = files.get(plain(e.path))
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(plain(e.path), e.text)
    stamps.set(plain(e.path), ++state.tick)

    return { value: undefined }
  })
  on('session.repo', () => ({ value: { root: '/repo', remote: 'git@github.com:o/r.git', internal: false, name: null } }))
  on('session.root', () => ({ value: '/repo' }))
  on('command.list', () => ({ value: [] }))
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    opened.push(e)

    return { value: { isPlaced: true } }
  })
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('mcp.call', (_$, e) => {
    spawned.push(e.args)

    return { value: { content: [], isError: state.isSpawnRefused } }
  })
  on('process.run', (_$, e) => {
    runs.push(e.argv)

    const value = {
      exitCode: 0,
      stdout: state.cli(e.argv, e.init?.stdin),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    }

    return { value }
  })

  const cards = () =>
    [...files.entries()]
      .filter(([path]) => path.endsWith('.md'))
      .flatMap(([path, text]) => parseCard(path.slice(path.lastIndexOf('/') + 1), text) ?? [])
      .sort((a, b) => a.id.localeCompare(b.id))

  return { files, toasts, prompts, runs, spawned, opened, state, clock, cards }
}

test('a task Claude surfaces lands in Suggested, once', async ($, on) => {
  const w = world(on)
  const first = await $.tool.call({
    tool: 'mcp__agent-works__surface_task',
    title: 'Fix race in session cache',
    details: 'Two writers, no lock.',
    kind: 'bug',
    files: ['src/cache.ts'],
  })
  expect(String(first.result)).toContain('Suggested as card 0001')
  const [card] = w.cards()
  expect(card?.status).toBe('suggested')
  expect(card?.source).toBe('claude')
  expect(card?.labels).toEqual(['bug'])
  expect(card?.body).toContain('- src/cache.ts')
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('/kanban to review it')
  expect([...w.files.keys()]).toEqual([`${DIR}/0001-fix-race-in-session-cache.md`])

  const again = await $.tool.call({
    tool: 'mcp__agent-works__surface_task',
    title: 'fix race in session cache',
    details: 'Same thing.',
  })
  expect(String(again.result)).toContain('Already on the kanban board')
  expect(w.cards().length).toBe(1)
})

test('/kanban add puts a card in the first column, and move_task moves it without starting it', async ($, on) => {
  const w = world(on)
  const added = await $.command.run(slash('add Write the README'))
  expect(added.text).toContain('Added card 0001')
  expect(w.cards()[0]?.status).toBe('backlog')

  const moved = await $.tool.call({ tool: 'mcp__agent-works__move_task', id: '1', status: 'in-progress' })
  expect(String(moved.result)).toContain('In progress')
  expect(w.cards()[0]?.status).toBe('in-progress')
  expect(w.prompts).toEqual([])
  expect(w.spawned).toEqual([])

  const wrong = await $.tool.call({ tool: 'mcp__agent-works__move_task', id: '0001', status: 'nowhere' })
  expect(String(wrong.result)).toContain('No column "nowhere"')
})

const PANE = {
  plugin: 'agent-works',
  component: 'Pane',
  requestId: 'kanban',
  props: {
    title: 'Kanban',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { columns: 120, rows: 50 },
} as const

/** Raises the two ends of a turn as a session does, the test answering beneath. */
function turns(on: On) {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

test('dragging a card to another lane rewrites its file, on each surface that drags', async ($, on) => {
  const w = world(on)
  await $.command.run(slash('add First'))
  await $.command.run(slash('add Second'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize({ columns: 80, rows: 30, in: 'board' })
    expect(await ui.find({ type: 'Text', text: /First/, in: 'board' })).toBeDefined()
    // Lanes are 20 cells wide; a card is 4 rows under a 2-row lane head.
    await ui.pointer({ type: 'down', x: 3, y: 3, button: 'left' })
    await ui.pointer({ type: 'move', x: 45, y: 4, button: 'left' })
    await ui.pointer({ type: 'up', x: 45, y: 4, button: 'left' })
    expect(w.cards().map(card => card.status)).toEqual(['review', 'backlog'])
    await ui.pointer({ type: 'down', x: 45, y: 3, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: 2, button: 'left' })
    await ui.pointer({ type: 'up', x: 3, y: 2, button: 'left' })
    expect(w.cards().map(card => [card.status, card.order])).toEqual([
      ['backlog', 0],
      ['backlog', 1],
    ])
    await ui.unmount()
  }
  expect(w.prompts).toEqual([])
})

test('keys walk the board, move a card and open it', async ($, on) => {
  const w = world(on)
  await $.command.run(slash('add First'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 80, rows: 30, in: 'board' })
  await ui.key({ key: 'down' })
  await ui.key({ key: 'L', shift: true })
  await ui.key({ key: 'L', shift: true })
  expect(w.cards()[0]?.status).toBe('review')
  await ui.key({ key: 'return' })
  expect(await ui.find({ key: 'start-new' })).toBeDefined()
  await ui.input({ key: 'skill-type', text: '/perceptual-loop:perceptual-loop' })
  expect(w.cards()[0]?.skills).toEqual(['perceptual-loop:perceptual-loop'])
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Client' })).toBeDefined()
})

test('a surface with no surface module gets the board as lists and buttons', async ($, on) => {
  const w = world(on)
  await $.command.run(slash('add First'))
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.press({ key: 'right-0001' })
    await ui.press({ key: 'left-0001' })
    await ui.unmount()
  }
  expect(w.cards()[0]?.status).toBe('backlog')
  expect(w.spawned.length).toBe(2)
})

test('a card dropped into the start column opens a new session, and stays put when that fails', async ($, on) => {
  const w = world(on)
  await $.command.run(slash('add Tune the glow'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  w.state.isSpawnRefused = true
  await ui.post({ type: 'move', id: '0001', to: 'in-progress', index: 0 })
  expect(w.cards()[0]?.status).toBe('backlog')
  expect(w.toasts.at(-1)).toContain('Could not start')

  w.state.isSpawnRefused = false
  await ui.post({ type: 'move', id: '0001', to: 'in-progress', index: 0 })
  expect(w.cards()[0]?.status).toBe('in-progress')
  expect(String(w.spawned.at(-1)?.prompt)).toContain('# Tune the glow')
  expect(w.prompts).toEqual([])
})

test('with the queue toggle on, cards start in this session one per turn', async ($, on) => {
  const w = world(on)
  turns(on)
  await $.command.run(slash('add One'))
  await $.command.run(slash('add Two'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'mode' })
  expect(JSON.parse(w.files.get(`${DIR}/board.json`) ?? '{}').startMode).toBe('queue')

  await $.turn.start({ text: 'something else', turnId: 't1' })
  await ui.post({ type: 'move', id: '0001', to: 'in-progress', index: 0 })
  await ui.post({ type: 'move', id: '0002', to: 'in-progress', index: 1 })
  expect(w.prompts).toEqual([])
  expect(w.cards().map(card => card.status)).toEqual(['in-progress', 'in-progress'])

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('# One')
  await $.turn.start({ text: w.prompts[0] ?? '', turnId: 't2' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toContain('# Two')
  expect(w.spawned).toEqual([])
})

type Issue = { number: number; title: string; body: string; state: 'OPEN' | 'CLOSED'; labels: string[]; updatedAt: string }

/** A GitHub repository with no project board, as `gh` answers for it. */
function github(w: ReturnType<typeof world>, on: On) {
  const issues: Issue[] = []
  const asks: string[] = []
  let stamp = Date.parse('2026-03-02T00:00:00Z')
  const touch = (issue: Issue) => {
    stamp += 60_000
    issue.updatedAt = new Date(stamp).toISOString()
  }
  const shown = (issue: Issue) => ({
    ...issue,
    url: `https://github.com/o/r/issues/${issue.number}`,
    labels: issue.labels.map(name => ({ name })),
  })
  const flags = (argv: readonly string[], flag: string) =>
    argv.flatMap((arg, index) => (arg === flag ? [argv[index + 1] ?? ''] : []))
  const numbered = (argv: readonly string[]) => {
    const issue = issues.find(one => one.number === Number(argv[3]))
    if (!issue) throw new Error(`no issue ${argv[3]}`)

    return issue
  }

  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]
    const create = question?.options.find(option => option.label.startsWith('Create'))?.label ?? ''
    asks.push(create)

    return { result: { questions: e.questions, answers: { [question?.question ?? '']: create } } }
  })
  w.state.cli = (argv, stdin) => {
    const verb = argv.slice(1, 3).join(' ')
    if (verb === 'repo view') return JSON.stringify({ nameWithOwner: 'o/r' })
    if (verb === 'api graphql') {
      const query = flags(argv, '-f').find(field => field.startsWith('query=')) ?? ''
      const nodes = query.includes('projectsV2') ? [] : issues.map(issue => ({ ...shown(issue), labels: { nodes: shown(issue).labels } }))
      const found = query.includes('projectsV2') ? { projectsV2: { nodes } } : { issues: { nodes } }

      return JSON.stringify({ data: { repository: found } })
    }
    if (verb === 'label create') return ''
    if (verb === 'issue create') {
      const issue: Issue = {
        number: issues.length + 1,
        title: flags(argv, '--title')[0] ?? '',
        body: stdin ?? '',
        state: 'OPEN',
        labels: flags(argv, '--label'),
        updatedAt: '',
      }
      touch(issue)
      issues.push(issue)

      return `https://github.com/o/r/issues/${issue.number}\n`
    }
    const issue = numbered(argv)
    if (verb === 'issue view') return JSON.stringify(shown(issue))
    if (verb === 'issue edit') {
      issue.title = flags(argv, '--title')[0] ?? issue.title
      issue.body = stdin ?? issue.body
      const removed = flags(argv, '--remove-label')
      issue.labels = [...issue.labels.filter(label => !removed.includes(label)), ...flags(argv, '--add-label')]
    } else if (verb === 'issue close') issue.state = 'CLOSED'
    else if (verb === 'issue reopen') issue.state = 'OPEN'
    touch(issue)

    return ''
  }

  return { issues, asks, touch }
}

test('remote sync creates issues, pulls remote edits, pushes local moves and imports new issues', async ($, on) => {
  const w = world(on)
  const hub = github(w, on)
  await $.command.run(slash('add First'))
  await $.command.run(slash('add Second'))
  await $.tool.call({ tool: 'mcp__agent-works__surface_task', title: 'Only a suggestion', details: 'Stays local.' })

  // Turning it on asks before creating issues, and never pushes a suggestion.
  const on1 = await $.command.run(slash('sync on'))
  expect(on1.text).toBe('Remote sync is on.')
  expect(hub.asks).toEqual(['Create 2 issues'])
  expect(hub.issues.map(issue => [issue.title, issue.labels])).toEqual([
    ['First', ['status:backlog']],
    ['Second', ['status:backlog']],
  ])
  expect(w.cards().map(card => card.remote?.number ?? null)).toEqual([1, 2, null])
  const settled = w.runs.length
  await $.command.run(slash('sync on'))
  expect(w.runs.slice(settled).some(argv => argv[1] === 'issue')).toBe(false)

  // A remote edit is pulled.
  const first = hub.issues[0]
  if (!first) throw new Error('no issue')
  first.title = 'First, renamed remotely'
  first.labels = ['status:review', 'bug']
  hub.touch(first)
  await $.command.run(slash('sync on'))
  const pulled = w.cards()[0]
  expect([pulled?.title, pulled?.status, pulled?.labels]).toEqual(['First, renamed remotely', 'review', ['bug']])

  // A local move is pushed after the debounce: done closes the issue.
  await $.tool.call({ tool: 'mcp__agent-works__move_task', id: '0002', status: 'done' })
  await w.clock.advance(6000)
  expect(hub.issues[1]?.state).toBe('CLOSED')
  expect(hub.issues[1]?.labels).toEqual(['status:done'])

  // An issue opened on the remote becomes a card.
  hub.issues.push({ number: 3, title: 'Opened upstream', body: 'From the tracker.', state: 'OPEN', labels: [], updatedAt: '' })
  hub.touch(hub.issues[2] as Issue)
  await $.command.run(slash('sync on'))
  const imported = w.cards().find(card => card.remote?.number === 3)
  expect([imported?.title, imported?.status, imported?.body]).toEqual(['Opened upstream', 'backlog', 'From the tracker.'])
  expect(hub.issues.length).toBe(3)
})

test('a sync that cannot reach the remote says why and changes no card', async ($, on) => {
  const w = world(on)
  github(w, on)
  await $.command.run(slash('add First'))
  w.state.cli = () => {
    throw new Error('gh: not logged in')
  }
  const answered = await $.command.run(slash('sync on'))
  expect(answered.text).toContain('Sync failed')
  expect(w.cards()[0]?.remote).toBeNull()
})

test('a change of view asks for the pane\'s focus back, so the next click presses', async ($, on) => {
  const w = world(on)
  await $.command.run(slash('add First'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const act of [
      () => ui.press({ key: 'settings' }),
      () => ui.press({ key: 'back' }),
      () => ui.post({ type: 'open', id: '0001' }),
      () => ui.press({ key: 'back' }),
    ]) {
      const before = w.opened.length
      await act()
      expect(w.opened.length).toBe(before)
      await w.clock.advance(200)
      expect(w.opened.slice(before)).toEqual([{ id: 'kanban', title: 'Kanban', focus: true }])
    }
    await ui.unmount()
  }
})

test('a gate is owed in the first column, listed with what it is owed for, and settled with its evidence', async ($, on) => {
  const w = world(on)
  await $.command.run(slash('add A plain task'))
  const refused = await $.tool.call({ tool: 'mcp__agent-works__owe_gate', title: 'Run the smoke gate', ref: '', needs: '' })
  expect(String(refused.result)).toContain('Not added')

  const owed = await $.tool.call({
    tool: 'mcp__agent-works__owe_gate',
    title: 'Run the smoke gate',
    details: '`npm run smoke`: 27 of 27.',
    ref: '#213',
    needs: 'the main checkout',
    owner: 'the integrator',
  })
  expect(String(owed.result)).toContain('Owed as gate card 0002')
  const gate = w.cards()[1]
  expect([gate?.kind, gate?.status, gate?.source, gate?.ref, gate?.needs, gate?.owner]).toEqual([
    'gate',
    'backlog',
    'claude',
    '#213',
    'the main checkout',
    'the integrator',
  ])
  expect(w.files.get(`${DIR}/0002-run-the-smoke-gate.md`)).toContain('\nkind: gate\n')
  expect(w.toasts.at(-1)).toContain('A gate is owed')

  const twice = await $.tool.call({ tool: 'mcp__agent-works__owe_gate', title: 'run the smoke gate', ref: '#213', needs: 'x' })
  expect(String(twice.result)).toContain('Already owed as card 0002')
  const other = await $.tool.call({ tool: 'mcp__agent-works__owe_gate', title: 'Run the smoke gate', ref: '#214', needs: 'x' })
  expect(String(other.result)).toContain('Owed as gate card 0003')

  const listed = await $.tool.call({ tool: 'mcp__agent-works__list_tasks' })
  expect(String(listed.result).split('\n')).toEqual([
    'Columns: backlog, in-progress, review, done (plus suggested)',
    '0001 [backlog] task: A plain task',
    '0002 [backlog] gate @the integrator: Run the smoke gate (for #213; needs the main checkout)',
    '0003 [backlog] gate: Run the smoke gate (for #214; needs x)',
  ])

  const notGate = await $.tool.call({ tool: 'mcp__agent-works__settle_gate', id: '1', evidence: 'ran' })
  expect(String(notGate.result)).toContain('not a gate')
  const bare = await $.tool.call({ tool: 'mcp__agent-works__settle_gate', id: '0002', evidence: ' ' })
  expect(String(bare.result)).toContain('Not settled')
  expect(w.cards()[1]?.status).toBe('backlog')

  const settled = await $.tool.call({ tool: 'mcp__agent-works__settle_gate', id: '2', evidence: 'npm run smoke: 27 of 27' })
  expect(String(settled.result)).toBe('Gate 0002 is settled and in Done.')
  const after = w.cards()[1]
  expect(after?.status).toBe('done')
  expect(after?.body).toBe('`npm run smoke`: 27 of 27.\n\nSettled 2026-03-01T00:00:00.000Z: npm run smoke: 27 of 27')
  const again = await $.tool.call({ tool: 'mcp__agent-works__settle_gate', id: '0002', evidence: 'once more' })
  expect(String(again.result)).toContain('already settled')
  expect(w.prompts).toEqual([])
  expect(w.spawned).toEqual([])
})

test('the gate filter leaves only gates on the board, on a surface that draws lists', async ($, on) => {
  world(on)
  await $.command.run(slash('add A plain task'))
  await $.tool.call({ tool: 'mcp__agent-works__owe_gate', title: 'Run the smoke gate', ref: '#213', needs: 'x' })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'card-0001' })).toBeDefined()
  expect((await ui.find({ key: 'card-0002' }))?.text).toContain('[gate]')
  await ui.press({ key: 'gates' })
  expect(await ui.find({ key: 'card-0001' })).toBeUndefined()
  expect(await ui.find({ key: 'card-0002' })).toBeDefined()
  await ui.press({ key: 'gates' })
  expect(await ui.find({ key: 'card-0001' })).toBeDefined()
})

test('a key the pane does not know, written by the CLI, survives a move in the pane', async ($, on) => {
  const text = '---\nid: "0001"\ntitle: "From the CLI"\nstatus: backlog\norder: 0\nestimate: 3\nreview:\n  by: sam\n---\n\nBody\n'
  const w = world(on, { [`${DIR}/0001-from-the-cli.md`]: text })
  await $.tool.call({ tool: 'mcp__agent-works__move_task', id: '0001', status: 'review' })
  const written = w.files.get(`${DIR}/0001-from-the-cli.md`) ?? ''
  expect(written).toContain('status: review\n')
  expect(written).toContain('estimate: 3\nreview:\n  by: sam\n---\n\nBody\n')
})

test('a board still in .agents/board keeps working there, and the settings say so', async ($, on) => {
  const w = world(on, { [`${OLD_DIR}/board.json`]: '{}' })
  const added = await $.command.run(slash('add In the old folder'))
  expect(added.text).toContain('Added card 0001')
  expect([...w.files.keys()].sort()).toEqual([`${OLD_DIR}/0001-in-the-old-folder.md`, `${OLD_DIR}/board.json`])
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /still in \.agents\/board/ })).toBeDefined()
})

test('a board in .agents/kanban is the board even beside an old folder, and the settings say nothing of it', async ($, on) => {
  const w = world(on, { [`${OLD_DIR}/board.json`]: '{}', [`${DIR}/board.json`]: '{}' })
  await $.command.run(slash('add In the new folder'))
  expect(w.files.has(`${DIR}/0001-in-the-new-folder.md`)).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /still in \.agents\/board/ })).toBeUndefined()
})

test("the project's own config names the folder, as it does for the aw CLI", async ($, on) => {
  const w = world(on, { '/repo/.agents/agent-works.json': '{"paths":{"kanban":"work/cards"}}' })
  await $.command.run(slash('add Elsewhere'))
  expect(w.files.has('/repo/work/cards/0001-elsewhere.md')).toBe(true)
})
