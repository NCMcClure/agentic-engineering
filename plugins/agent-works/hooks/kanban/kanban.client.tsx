import type { ClientModule } from 'claude-code'

import type { ClientBoard, ClientCard, ClientLane } from '../../types'

type Local = {
  selected: string | null
  /** The card the button went down on, where, and whether it was selected already. */
  down: { id: string; x: number; y: number; wasSelected: boolean } | null
  /** The card being dragged, the pointer, and where a drop now would put it. */
  drag: { id: string; x: number; y: number; lane: number; slot: number } | null
}

/** Rows a lane's title and rule take above its first card. */
const LANE_HEAD = 2
/** Rows one card takes: its border and two lines. */
const CARD_ROWS = 4
const MIN_LANE = 18

const Kanban: ClientModule<ClientBoard, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const lanes = props.lanes
  const columns = surface.columns > 0 ? surface.columns : 80
  const laneWidth = Math.max(MIN_LANE, Math.floor(columns / Math.max(1, lanes.length)))
  let local: Local = surface.state ?? { selected: props.selected, down: null, drag: null }

  const set = (next: Partial<Local>) => {
    local = { ...local, ...next }
    surface.setState(local)
  }
  const laneAt = (x: number) => Math.max(0, Math.min(lanes.length - 1, Math.floor(x / laneWidth)))
  const cardAt = (x: number, y: number): ClientCard | undefined => {
    const slot = Math.floor((y - LANE_HEAD) / CARD_ROWS)

    return x < 0 || slot < 0 ? undefined : lanes[laneAt(x)]?.cards[slot]
  }
  const find = (id: string | null): { lane: number; slot: number; card: ClientCard } | undefined => {
    for (const [lane, one] of lanes.entries()) {
      const slot = one.cards.findIndex(card => card.id === id)
      const card = one.cards[slot]
      if (card) return { lane, slot, card }
    }

    return undefined
  }
  const choose = (id: string | null) => {
    if (id === local.selected) return
    set({ selected: id })
    surface.post({ type: 'select', id })
  }

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      const card = cardAt(event.x, event.y)
      const wasSelected = card !== undefined && card.id === local.selected
      set({ down: card ? { id: card.id, x: event.x, y: event.y, wasSelected } : null, drag: null })
      choose(card?.id ?? null)
    } else if (event.type === 'move' && local.down) {
      const { down } = local
      if (!local.drag && event.x === down.x && event.y === down.y) return
      const lane = laneAt(event.x)
      const others = (lanes[lane]?.cards ?? []).filter(card => card.id !== down.id)
      const slot = Math.max(0, Math.min(others.length, Math.round((event.y - LANE_HEAD) / CARD_ROWS)))
      set({ drag: { id: down.id, x: event.x, y: event.y, lane, slot } })
    } else if (event.type === 'up') {
      const { down, drag } = local
      set({ down: null, drag: null })
      const target = drag ? lanes[drag.lane] : undefined
      if (drag && target) surface.post({ type: 'move', id: drag.id, to: target.id, index: drag.slot })
      else if (down?.wasSelected) surface.post({ type: 'open', id: down.id })
    }
  })

  surface.onKey(event => {
    const at = find(local.selected)
    const key = event.key
    const isLeft = key === 'left' || key === 'h' || key === 'H'
    const isRight = key === 'right' || key === 'l' || key === 'L'
    const isUp = key === 'up' || key === 'k' || key === 'K'
    const isDown = key === 'down' || key === 'j' || key === 'J'
    const isShifted = event.shift === true || (key.length === 1 && key !== key.toLowerCase())
    if (key === 'n') {
      surface.post({ type: 'new', to: at ? (lanes[at.lane]?.id ?? null) : null })
    } else if (key === 'v' || key === 'e' || key === 'p') {
      surface.post({ type: key === 'v' ? 'scope' : key === 'e' ? 'epics' : 'sprints' })
    } else if (!at) {
      if (isLeft || isRight || isUp || isDown) choose(lanes.find(lane => lane.cards.length > 0)?.cards[0]?.id ?? null)
    } else if (isShifted && (isLeft || isRight)) {
      surface.post({ type: 'shift', id: at.card.id, by: isLeft ? -1 : 1 })
    } else if (isShifted && (isUp || isDown)) {
      surface.post({ type: 'nudge', id: at.card.id, by: isUp ? -1 : 1 })
    } else if (isLeft || isRight) {
      const step = isLeft ? -1 : 1
      for (let lane = at.lane + step; lane >= 0 && lane < lanes.length; lane += step) {
        const cards = lanes[lane]?.cards ?? []
        const card = cards[Math.min(at.slot, cards.length - 1)]
        if (card) {
          choose(card.id)
          break
        }
      }
    } else if (isUp || isDown) {
      const card = lanes[at.lane]?.cards[at.slot + (isUp ? -1 : 1)]
      if (card) choose(card.id)
    } else if (key === 'return') {
      surface.post({ type: 'open', id: at.card.id })
    } else if (key === 's') {
      surface.post({ type: 'start', id: at.card.id })
    } else if (lanes[at.lane]?.role === 'suggested' && (key === 'a' || key === 'x')) {
      surface.post({ type: key === 'a' ? 'accept' : 'archive', id: at.card.id })
    }
  })

  const { drag } = local
  const dragged = drag ? find(drag.id)?.card : undefined
  const total = lanes.reduce((sum, lane) => sum + lane.cards.length, 0)
  const titleColor = (lane: ClientLane) =>
    lane.role === 'suggested' ? 'suggestion' : lane.role === 'start' ? 'claude' : lane.role === 'done' ? 'success' : 'text'

  return (
    <Box flexDirection="column" position="relative">
      <Box flexDirection="row">
        {lanes.map((lane, index) => (
          <Box flexDirection="column" width={laneWidth}>
            <Text bold color={titleColor(lane)} inverse={drag?.lane === index} wrap="truncate-end">
              {lane.title} <Text dimColor>{lane.cards.length}</Text>
            </Text>
            <Text dimColor>{'─'.repeat(laneWidth - 1)}</Text>
            {lane.cards.map(card => (
              <Box
                borderStyle="round"
                borderColor={card.id === local.selected ? 'claude' : 'subtle'}
                borderDimColor={card.id !== local.selected}
                flexDirection="column"
                width={laneWidth - 1}
                height={CARD_ROWS}
                paddingX={1}
              >
                <Text bold={card.id === local.selected} dimColor={card.id === drag?.id} wrap="truncate-end">
                  {card.title}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {card.isGate ? <Text color="warning">gate </Text> : ''}
                  {card.isQueued ? 'queued · ' : ''}
                  {card.meta}
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
      {total === 0 && <Text dimColor>{props.empty}</Text>}
      {drag && (
        <Box position="absolute" top={LANE_HEAD + drag.slot * CARD_ROWS} left={drag.lane * laneWidth}>
          <Text color="claude">{`▶${'━'.repeat(Math.max(1, laneWidth - 3))}`}</Text>
        </Box>
      )}
      {drag && dragged && (
        <Box position="absolute" top={drag.y + 1} left={Math.max(0, Math.min(drag.x + 2, columns - 12))}>
          <Text inverse wrap="truncate-end">{` ${dragged.title.slice(0, 28)} `}</Text>
        </Box>
      )}
    </Box>
  )
}

export default Kanban
