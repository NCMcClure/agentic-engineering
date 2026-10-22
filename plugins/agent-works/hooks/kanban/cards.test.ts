import { describe, expect, test } from 'claude-code/testing'

import type { Board, Card, Sprint } from '../../types'
import {
  cardHash,
  cardLine,
  defaultConfig,
  defaultScope,
  doneColumnOf,
  epicProgress,
  fileName,
  findDuplicate,
  listing,
  nextId,
  nextSprintId,
  parseCard,
  parseConfig,
  parseScope,
  planMove,
  planSprintClose,
  remoteHash,
  serializeCard,
  serializeConfig,
  toClientBoard,
} from './cards'
import { GOLDEN } from './cards.golden'
import { buildPrompt } from './launch'

function card(id: string, status: string, order: number, more: Partial<Card> = {}): Card {
  return {
    id,
    file: fileName(id, `card ${id}`),
    title: `Card ${id}`,
    status,
    order,
    priority: 'normal',
    labels: [],
    skills: [],
    source: 'user',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    kind: 'task',
    owner: '',
    needs: '',
    ref: '',
    epic: '',
    sprint: '',
    body: '',
    remote: null,
    extra: [],
    ...more,
  }
}

function board(cards: Card[]): Board {
  return { dir: '/repo/.agents/kanban', isOldFolder: false, config: defaultConfig('new-session'), cards, stamp: '' }
}

/**
 * The golden cards: the files under tests/fixtures/cards, which the Python
 * twin (cli/kanban.py) reads from disk and is held to in tests/test_kanban.py.
 * `cards.golden.ts` is generated from them; both sides must give these values.
 */
describe('the golden cards', () => {
  test('there are the canonical dozen and the hand-written ones', () => {
    expect(GOLDEN.filter(one => one.canon === one.text).length).toBeGreaterThanOrEqual(12)
    expect(GOLDEN.some(one => one.card === null)).toBe(true)
    expect(GOLDEN.some(one => one.canon !== null && one.canon !== one.text)).toBe(true)
  })

  for (const golden of GOLDEN) {
    test(`${golden.file} parses to the values the Python twin gives`, () => {
      const read = parseCard(golden.file, golden.text)
      if (golden.card === null) expect(read).toBeUndefined()
      else expect(read).toEqual(golden.card)
    })

    const { card: expected, canon } = golden
    if (expected === null || canon === null) continue

    test(`${golden.file} is written as the Python twin writes it, and stays so`, () => {
      const read = parseCard(golden.file, golden.text)
      if (!read) throw new Error('no card')
      expect(serializeCard(read)).toBe(canon)
      expect(serializeCard(expected)).toBe(canon)
      const again = parseCard(golden.file, canon)
      if (!again) throw new Error('no card')
      expect(serializeCard(again)).toBe(canon)
    })

    test(`${golden.file} reads the same with CRLF line endings`, () => {
      const read = parseCard(golden.file, golden.text.replaceAll('\n', '\r\n'))
      if (!read) throw new Error('no card')
      expect({ ...read, body: read.body.replaceAll('\r\n', '\n') }).toEqual(expected)
    })
  }
})

describe('card files', () => {
  test('a card survives a round trip through its file', () => {
    const one = card('0007', 'review', 3, {
      title: 'Fix: the "sync" race',
      labels: ['bug', 'needs triage'],
      skills: ['perceptual-loop:perceptual-loop'],
      source: 'claude',
      priority: 'high',
      kind: 'gate',
      owner: 'the integrator',
      needs: 'the main checkout',
      ref: '#213',
      body: 'Line one.\n\n- a\n- b',
      remote: {
        provider: 'github',
        number: 12,
        url: 'https://github.com/o/r/issues/12',
        updatedAt: '2026-01-02T03:04:05Z',
        syncedHash: 'abc123',
      },
      extra: ['estimate: 3', 'review:', '  by: sam'],
    })
    expect(parseCard(one.file, serializeCard(one))).toEqual(one)
  })

  test('a key the board does not know survives a change of the card', () => {
    const text = '---\nid: "0001"\ntitle: "T"\nstatus: backlog\ncustom: 1\nnested:\n  a: b\n---\n\nBody\n'
    const read = parseCard('0001-t.md', text)
    if (!read) throw new Error('no card')
    expect(read.extra).toEqual(['custom: 1', 'nested:', '  a: b'])
    const written = serializeCard({ ...read, status: 'done', owner: 'pat' })
    expect(written).toContain('custom: 1\nnested:\n  a: b\n---\n')
    expect(written).toContain('owner: "pat"\n')
  })

  test('a plain task writes no kind, owner, needs or ref', () => {
    expect(serializeCard(card('0001', 'backlog', 0))).not.toMatch(/kind|owner|needs|ref/)
    expect(serializeCard(card('0001', 'backlog', 0, { kind: 'gate' }))).toContain('\nkind: gate\n')
  })

  test('a hand-written card reads with defaults', () => {
    const read = parseCard('0003-by-hand.md', '---\ntitle: By hand\nlabels: [a, b]\n---\nBody')
    expect(read?.id).toBe('0003')
    expect(read?.status).toBe('backlog')
    expect(read?.kind).toBe('task')
    expect(read?.labels).toEqual(['a', 'b'])
    expect(read?.body).toBe('Body')
  })

  test('a file with no frontmatter is no card', () => {
    expect(parseCard('README.md', '# Notes')).toBeUndefined()
  })

  test('ids count up from the highest and name the file', () => {
    expect(nextId([card('0002', 'backlog', 0), card('0009', 'done', 0)])).toBe('0010')
    expect(fileName('0010', 'Fix the Flaky  Sync!')).toBe('0010-fix-the-flaky-sync.md')
  })

  test('a broken board.json falls back, a partial one is filled in', () => {
    const fallback = defaultConfig('queue')
    expect(parseConfig('{', fallback)).toEqual(fallback)
    const partial = parseConfig('{"remote":{"enabled":true}}', fallback)
    expect(partial.remote.enabled).toBe(true)
    expect(partial.startMode).toBe('queue')
    expect(partial.columns.length).toBe(4)
  })
})

describe('moves', () => {
  const cards = [card('0001', 'backlog', 0), card('0002', 'backlog', 1), card('0003', 'review', 0)]

  test('a card dropped at a slot of another lane takes it and the lane renumbers', () => {
    const changed = planMove(cards, '0003', 'backlog', 1)
    expect(changed.map(one => [one.id, one.status, one.order])).toEqual([
      ['0003', 'backlog', 1],
      ['0002', 'backlog', 2],
    ])
  })

  test('a move to where the card already is changes nothing', () => {
    expect(planMove(cards, '0002', 'backlog', 1)).toEqual([])
  })

  test('the hash follows what the remote holds, not the order', () => {
    const [first] = cards
    if (!first) throw new Error('no card')
    expect(cardHash({ ...first, order: 9, priority: 'high', owner: 'pat', extra: ['x: 1'] })).toBe(cardHash(first))
    expect(cardHash({ ...first, status: 'done' })).not.toBe(cardHash(first))
  })

  test('the remote hash adds the epic and sprint only once either is set', () => {
    const [first] = cards
    if (!first) throw new Error('no card')
    const plain = { ...first, epic: '', sprint: '' }
    expect(remoteHash(plain)).toBe(cardHash(plain))
    expect(remoteHash({ ...plain, sprint: 's1' })).not.toBe(cardHash(plain))
    expect(remoteHash({ ...plain, epic: '0042' })).not.toBe(remoteHash({ ...plain, sprint: '0042' }))
  })

  test('a finished card goes to the done column, else the last', () => {
    const config = defaultConfig('queue')
    expect(doneColumnOf(config)?.id).toBe('done')
    expect(doneColumnOf({ ...config, columns: config.columns.map(column => ({ ...column, role: null })) })?.id).toBe('done')
    expect(doneColumnOf({ ...config, columns: [] })).toBeUndefined()
  })
})

describe('the board drawn', () => {
  test('the Suggested lane leads only while it holds a card', () => {
    const plain = toClientBoard(board([card('0001', 'backlog', 0)]), [], null)
    expect(plain.lanes.map(lane => lane.id)).toEqual(['backlog', 'in-progress', 'review', 'done'])
    const withOne = toClientBoard(board([card('0001', 'suggested', 0), card('0002', 'archived', 0)]), ['0001'], null)
    expect(withOne.lanes[0]?.id).toBe('suggested')
    expect(withOne.lanes[0]?.cards[0]?.isQueued).toBe(true)
    expect(withOne.lanes.flatMap(lane => lane.cards).length).toBe(1)
  })

  test('a gate is marked, and the filter leaves only gates', () => {
    const held = board([
      card('0001', 'backlog', 0),
      card('0002', 'backlog', 1, { kind: 'gate', ref: '#213', owner: 'sam' }),
      card('0003', 'suggested', 0),
    ])
    const all = toClientBoard(held, [], null)
    const drawn = all.lanes.flatMap(lane => lane.cards)
    expect(drawn.map(one => [one.id, one.isGate])).toEqual([
      ['0003', false],
      ['0001', false],
      ['0002', true],
    ])
    expect(drawn[2]?.meta).toBe('for #213 · @sam')
    const gates = toClientBoard(held, [], null, true)
    expect(gates.lanes.map(lane => lane.id)).toEqual(['backlog', 'in-progress', 'review', 'done'])
    expect(gates.lanes.flatMap(lane => lane.cards).map(one => one.id)).toEqual(['0002'])
  })

  test('a card is listed with its kind and owner, a gate with what it is owed for', () => {
    expect(cardLine(card('0001', 'backlog', 0))).toBe('0001 [backlog] task: Card 0001')
    expect(
      cardLine(card('0002', 'review', 0, { kind: 'gate', owner: 'sam', ref: '#213', needs: 'the main checkout' })),
    ).toBe('0002 [review] gate @sam: Card 0002 (for #213; needs the main checkout)')
  })

  test('a duplicate is found by its title, whatever the case, unless done', () => {
    const held = board([card('0001', 'backlog', 0, { title: 'Fix the cache' }), card('0002', 'done', 0)])
    expect(findDuplicate(held, 'fix   the CACHE!')?.id).toBe('0001')
    expect(findDuplicate(held, 'Card 0002')).toBeUndefined()
  })

  test('the same gate owed for another pull request is another gate', () => {
    const held = board([card('0001', 'backlog', 0, { title: 'Run the smoke gate', kind: 'gate', ref: '#1' })])
    expect(findDuplicate(held, 'run the smoke gate', '#1')?.id).toBe('0001')
    expect(findDuplicate(held, 'run the smoke gate', '#2')).toBeUndefined()
  })
})

function sprint(id: string, state: Sprint['state'], more: Partial<Sprint> = {}): Sprint {
  return { id, title: `Sprint ${id}`, goal: '', start: '', end: '', state, closed: null, ...more }
}

function planned(cards: Card[], sprints: Sprint[]): Board {
  const held = board(cards)

  return { ...held, config: { ...held.config, sprints } }
}

/** The board.json both twins read: tests/test_kanban.py holds cli/kanban.py to the same values. */
const SPRINT_CONFIG = `{
  "columns": [
    { "id": "todo", "title": "To do" },
    { "id": "doing", "title": "Doing", "role": "start" },
    { "id": "done", "title": "Done", "role": "done" }
  ],
  "sprints": [
    { "id": "s1", "title": "First", "state": "closed", "closed": { "at": "2026-01-14T00:00:00.000Z", "done": 4, "rolled": 1 } },
    { "id": "s2", "title": "Second", "goal": "Ship it", "start": "2026-01-15", "end": "2026-01-29", "state": "active" },
    { "id": "s3", "state": "active" },
    { "title": "no id" },
    { "id": "s4", "title": "", "state": "someday", "closed": "no" }
  ]
}`

describe('epics and sprints', () => {
  test('board.json sprints parse, a second active one waits as planned, and an empty list is not written', () => {
    const config = parseConfig(SPRINT_CONFIG, defaultConfig('new-session'))
    expect(config.sprints).toEqual([
      sprint('s1', 'closed', { title: 'First', closed: { at: '2026-01-14T00:00:00.000Z', done: 4, rolled: 1 } }),
      sprint('s2', 'active', { title: 'Second', goal: 'Ship it', start: '2026-01-15', end: '2026-01-29' }),
      sprint('s3', 'planned', { title: 's3' }),
      sprint('s4', 'planned', { title: 's4' }),
    ])
    expect(nextSprintId(config)).toBe('s5')
    expect(parseConfig(serializeConfig(config), defaultConfig('queue'))).toEqual(config)
    expect(serializeConfig(defaultConfig('queue'))).not.toContain('sprints')
  })

  test('the default scope is the active sprint, and every card while none is active', () => {
    const cards = [
      card('0001', 'todo', 0, { sprint: 's2' }),
      card('0002', 'todo', 1),
      card('0003', 'suggested', 0),
      card('0004', 'todo', 2, { kind: 'epic' }),
      card('0005', 'todo', 3, { epic: '0004' }),
    ]
    const held = planned(cards, [sprint('s2', 'active')])
    const ids = (scope: Parameters<typeof toClientBoard>[4]) =>
      toClientBoard(held, [], null, false, scope).lanes.flatMap(lane => lane.cards.map(one => one.id))
    expect(defaultScope(held.config)).toEqual({ kind: 'sprint' })
    expect(ids({ kind: 'sprint' })).toEqual(['0003', '0001'])
    expect(ids({ kind: 'backlog' })).toEqual(['0003', '0002', '0005'])
    expect(ids({ kind: 'epic', id: '0004' })).toEqual(['0003', '0005'])
    expect(ids({ kind: 'all' })).toEqual(['0003', '0001', '0002', '0005'])
    const idle = planned(cards, [sprint('s2', 'planned')])
    expect(defaultScope(idle.config)).toEqual({ kind: 'all' })
    expect(parseScope('', idle)).toEqual({ kind: 'all' })
    expect(parseScope('4', held)).toEqual({ kind: 'epic', id: '0004' })
    expect(parseScope('0001', held)).toBeUndefined()
  })

  test('a card in an epic carries the epic in its meta; the epic counts its finished cards', () => {
    const held = board([
      card('0001', 'backlog', 0, { kind: 'epic', title: 'Faster sync' }),
      card('0002', 'done', 0, { epic: '0001' }),
      card('0003', 'archived', 0, { epic: '0001' }),
      card('0004', 'backlog', 1, { epic: '0001' }),
      card('0005', 'suggested', 0, { epic: '0001' }),
    ])
    expect(epicProgress(held, '0001')).toEqual({ done: 2, total: 3 })
    const drawn = toClientBoard(held, [], null).lanes.flatMap(lane => lane.cards)
    expect(drawn.find(one => one.id === '0004')?.meta).toBe('◆ Faster sync')
    expect(cardLine(card('0004', 'backlog', 1, { epic: '0001', sprint: 's2' }))).toBe(
      '0004 [backlog] task: Card 0004 (epic 0001; sprint s2)',
    )
  })

  test('closing a sprint archives its done cards and rolls the rest to the next planned sprint', () => {
    const held = planned(
      [
        card('0001', 'done', 0, { sprint: 's1' }),
        card('0002', 'in-progress', 0, { sprint: 's1' }),
        card('0003', 'archived', 0, { sprint: 's1' }),
        card('0004', 'backlog', 0, { sprint: 's2' }),
      ],
      [sprint('s1', 'active'), sprint('s2', 'planned'), sprint('s3', 'planned')],
    )
    const plan = planSprintClose(held, 's1', '2026-02-01T00:00:00.000Z')
    expect(plan?.next?.id).toBe('s2')
    expect(plan?.cards.map(one => [one.id, one.status, one.sprint])).toEqual([
      ['0001', 'archived', 's1'],
      ['0002', 'in-progress', 's2'],
    ])
    expect(plan?.config.sprints[0]).toEqual(
      sprint('s1', 'closed', { closed: { at: '2026-02-01T00:00:00.000Z', done: 1, rolled: 1 } }),
    )
    const last = planned([card('0002', 'backlog', 0, { sprint: 's1' })], [sprint('s1', 'active')])
    expect(planSprintClose(last, 's1', '')?.cards[0]?.sprint).toBe('')
    expect(planSprintClose(last, 's9', '')).toBeUndefined()
  })

  test('the listing is the scope, with the sprint, the epics and how many cards it left out', () => {
    const held = planned(
      [
        card('0001', 'backlog', 0, { sprint: 's1' }),
        card('0002', 'backlog', 1),
        card('0003', 'backlog', 2, { kind: 'epic', title: 'Big' }),
      ],
      [sprint('s1', 'active', { goal: 'Ship', end: '2026-03-01' })],
    )
    expect(listing(held, { kind: 'sprint' })).toEqual([
      'Columns: backlog, in-progress, review, done (plus suggested)',
      'Sprint s1 "Sprint s1" (active, ends 2026-03-01): Ship',
      'Epic 0003 ▱▱▱▱▱▱▱▱ 0/0: Big',
      'Scope: sprint s1',
      '0001 [backlog] task: Card 0001 (sprint s1)',
      '1 more open card(s) outside this scope (scope "all" lists them).',
    ])
  })
})

describe('the launch prompt', () => {
  test('a card of an epic carries the epic, its other open cards and the sprint', () => {
    const epic = card('0001', 'backlog', 0, { kind: 'epic', title: 'Faster sync', body: 'One query per page.' })
    const one = card('0002', 'backlog', 0, { epic: '0001', sprint: 's1' })
    const other = card('0003', 'backlog', 1, { epic: '0001' })
    const held = planned([epic, one, other], [sprint('s1', 'active', { goal: 'Ship' })])
    const prompt = buildPrompt(held, one)
    expect(prompt).toContain('## Part of epic 0001: Faster sync')
    expect(prompt).toContain('One query per page.')
    expect(prompt).toContain('- 0003 [backlog] task: Card 0003 (epic 0001)')
    expect(prompt).toContain('Sprint s1 "Sprint s1" (active): Ship')
  })

  test('an epic is handed over to be broken down into cards', () => {
    const epic = card('0001', 'backlog', 0, { kind: 'epic', title: 'Faster sync' })
    const prompt = buildPrompt(board([epic]), epic)
    expect(prompt).toContain('Break down this epic')
    expect(prompt).toContain('aw kanban add "<title>" --epic 0001')
    expect(prompt).not.toContain('move_task')
  })

  test('it carries the task, the hand-back, and the skill nudges last', () => {
    const one = card('0004', 'backlog', 0, {
      title: 'Tune the glow',
      body: 'The lamp glow is too hot.',
      skills: ['perceptual-loop:perceptual-loop', '/simplify'],
    })
    const prompt = buildPrompt(board([one]), one)
    expect(prompt).toContain('from the project kanban board')
    expect(prompt).toContain('# Tune the glow')
    expect(prompt).toContain('The lamp glow is too hot.')
    expect(prompt).toContain('mcp__agent-works__move_task')
    expect(prompt).toContain('status "review"')
    expect(prompt).toContain('aw kanban move 0004 review')
    expect(prompt.endsWith('Use these skills for this task: /perceptual-loop:perceptual-loop, /simplify')).toBe(true)
  })

  test('a card with no nudges ends on the hand-back', () => {
    const one = card('0005', 'backlog', 0)
    expect(buildPrompt(board([one]), one)).not.toContain('Use these skills')
  })

  test('a gate is handed over to be run and settled, not moved', () => {
    const one = card('0006', 'backlog', 0, { kind: 'gate', ref: '#213', needs: 'the main checkout' })
    const prompt = buildPrompt(board([one]), one)
    expect(prompt).toContain('Run this owed gate')
    expect(prompt).toContain('For: #213')
    expect(prompt).toContain('Needs: the main checkout')
    expect(prompt).toContain('mcp__agent-works__settle_gate')
    expect(prompt).toContain('aw kanban settle 0006')
    expect(prompt).not.toContain('move_task')
  })
})
