import { describe, expect, test } from 'claude-code/testing'

import type { Board, Card } from '../../types'
import {
  cardHash,
  cardLine,
  defaultConfig,
  doneColumnOf,
  fileName,
  findDuplicate,
  nextId,
  parseCard,
  parseConfig,
  planMove,
  serializeCard,
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

describe('the launch prompt', () => {
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
