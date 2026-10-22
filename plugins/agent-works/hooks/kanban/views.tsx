import type { Elements, RenderElement } from 'claude-code'

import type { Board, Card, CardPriority, ClientBoard, Scope, SyncState } from '../../types'
import {
  acceptCard,
  addEpic,
  addSprint,
  archiveCard,
  closePreview,
  closeSprint,
  cycleScope,
  moveCard,
  patchCard,
  patchConfig,
  patchSprint,
  plannedFor,
  setScope,
  setView,
  shiftCard,
  startCard,
  startSprint,
  toggleGatesOnly,
} from './actions'
import {
  ARCHIVED,
  EPIC,
  GATE,
  SUGGESTED,
  TASK,
  activeSprint,
  doneIds,
  epicProgress,
  inScope,
  isEpic,
  isGate,
  openEpics,
  progressBar,
} from './cards'
import { setRemoteEnabled, syncNow } from './remote/sync'
import { addCard } from './store'
import type { Host } from './host'

/** What every surface's table has, and the fields the mobile app does not draw yet. */
export type Table = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button' | 'Link' | 'Markdown'> &
  Partial<Pick<Elements['vscode'], 'Input' | 'Select'>>

const PRIORITIES: readonly CardPriority[] = ['low', 'normal', 'high']
const BOARD = { kind: 'board' } as const

function splitList(text: string): string[] {
  return text
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')
}

function syncLine(board: Board, sync: SyncState): string {
  if (!board.config.remote.enabled) return 'sync off'
  if (sync.status === 'running') return 'syncing…'
  if (sync.status === 'error') return `sync failed: ${sync.message}`

  return sync.message === '' ? 'sync on' : `synced: ${sync.message}`
}

/** What the lanes are narrowed to, in a line: the sprint and its progress, the backlog, an epic, or all. */
export function scopeLine(board: Board, scope: Scope): string {
  const lanes = board.cards.filter(card => card.status !== ARCHIVED && inScope(board.config, card, scope))
  const done = doneIds(board.config)
  const finished = lanes.filter(card => done.has(card.status)).length
  if (scope.kind === 'sprint') {
    const active = activeSprint(board.config)
    if (active) {
      return [
        `Sprint ${active.id}`,
        active.title,
        active.end === '' ? '' : `ends ${active.end}`,
        `${finished}/${lanes.length} done`,
      ]
        .filter(part => part !== '')
        .join(' · ')
    }
  }
  if (scope.kind === 'backlog') return `Backlog: ${lanes.length} card(s) in no sprint`
  if (scope.kind === 'epic') {
    const epic = board.cards.find(one => one.id === scope.id)

    return `Epic ${scope.id} · ${epic?.title ?? '(gone)'} · ${progressBar(epicProgress(board, scope.id))}`
  }

  return `All cards: ${lanes.length}`
}

/** The row of controls above the board: what the keys and the drag do, as buttons. */
export function toolbar(
  ui: Table,
  host: Host,
  board: Board,
  selected: string | null,
  sync: SyncState,
  isGatesOnly: boolean,
  scope: Scope,
): RenderElement {
  const { Box, Text, Button } = ui
  const card = board.cards.find(one => one.id === selected)
  const isQueue = board.config.startMode === 'queue'
  const first = board.config.columns[0]?.id ?? 'backlog'
  const gates = board.cards.filter(one => isGate(one) && one.status !== ARCHIVED).length
  const epics = openEpics(board).length

  return (
    <Box flexDirection="column">
      <Text bold color="claude" wrap="truncate-end">
        {scopeLine(board, scope)}
      </Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="new" hotkey="n" onPress={() => void setView(host, { kind: 'new', status: first })}>
          + New
        </Button>
        <Button key="scope" hotkey="v" onPress={() => void cycleScope(host)}>
          {`Scope: ${scope.kind}`}
        </Button>
        <Button key="epics" hotkey="e" onPress={() => void setView(host, { kind: 'epics' })}>
          {`Epics ${epics}`}
        </Button>
        <Button key="sprints" hotkey="p" onPress={() => void setView(host, { kind: 'sprints' })}>
          Sprints
        </Button>
        {card && (
          <Button key="open" hotkey="o" onPress={() => void setView(host, { kind: 'card', id: card.id })}>
            Open
          </Button>
        )}
        {card && (
          <Button key="left" onPress={() => void shiftCard(host, card.id, -1)}>
            ‹
          </Button>
        )}
        {card && (
          <Button key="right" onPress={() => void shiftCard(host, card.id, 1)}>
            ›
          </Button>
        )}
        {card && (
          <Button key="start" hotkey="s" variant="primary" onPress={() => void startCard(host, card.id)}>
            Start
          </Button>
        )}
        <Button
          key="mode"
          hotkey="m"
          onPress={() => void patchConfig(host, { startMode: isQueue ? 'new-session' : 'queue' })}
        >
          {isQueue ? 'Starts: queue here' : 'Starts: new session'}
        </Button>
        <Button key="gates" hotkey="g" onPress={() => void toggleGatesOnly(host)}>
          {isGatesOnly ? `Showing: gates (${gates})` : `Showing: all · gates ${gates}`}
        </Button>
        <Button key="settings" onPress={() => void setView(host, { kind: 'settings' })}>
          Settings
        </Button>
      </Box>
      <Text dimColor wrap="truncate-end">
        {card ? `${card.title} · ` : ''}
        {syncLine(board, sync)}
      </Text>
    </Box>
  )
}

/** The board without a surface module: every lane a list, every move a button. */
export function listBoard(ui: Table, host: Host, lanes: ClientBoard['lanes']): RenderElement {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="column" gap={1}>
      {lanes.map(lane => (
        <Box flexDirection="column">
          <Text bold>
            {lane.title} <Text dimColor>{lane.cards.length}</Text>
          </Text>
          {lane.cards.map(card => (
            <Box flexDirection="row" gap={1}>
              <Button key={`left-${card.id}`} plain onPress={() => void shiftCard(host, card.id, -1)}>
                ‹
              </Button>
              <Button key={`right-${card.id}`} plain onPress={() => void shiftCard(host, card.id, 1)}>
                ›
              </Button>
              <Button key={`card-${card.id}`} plain onPress={() => void setView(host, { kind: 'card', id: card.id })}>
                {card.isGate ? '[gate] ' : ''}
                {card.title} <Text dimColor>{card.meta}</Text>
              </Button>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export function newView(ui: Table, host: Host, board: Board, status: string, scope: Scope): RenderElement {
  const { Box, Text, Button, Input, Select } = ui
  const planned = plannedFor(board, scope)
  const create = async (title: string) => {
    if (title.trim() === '') return
    await addCard(host, { title: title.trim(), status, ...planned })
    await setView(host, BOARD)
  }
  const into = [planned.sprint === '' ? '' : `sprint ${planned.sprint}`, planned.epic === '' ? '' : `epic ${planned.epic}`]
    .filter(part => part !== '')
    .join(', ')

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold>New card</Text>
      {into !== '' && <Text dimColor>{`Goes into ${into}: the scope the board shows.`}</Text>}
      {Select && (
        <Select
          key="new-status"
          label="Column"
          value={status}
          options={board.config.columns.map(column => ({ value: column.id, label: column.title }))}
          onSelect={value => void setView(host, { kind: 'new', status: value })}
        />
      )}
      {Input ? (
        <Input key="new-title" label="Title" autoFocus submitLabel="add" onSubmit={title => void create(title)} />
      ) : (
        <Text dimColor>Add a card with /kanban add &lt;title&gt;.</Text>
      )}
      <Box flexDirection="row">
        <Button key="back" hotkey="b" onPress={() => void setView(host, BOARD)}>
          ‹ Kanban
        </Button>
      </Box>
    </Box>
  )
}

export function cardView(ui: Table, host: Host, board: Board, card: Card, skills: readonly string[]): RenderElement {
  const { Box, Text, Button, Link, Markdown, Input, Select } = ui
  const isSuggested = card.status === SUGGESTED
  const columns = board.config.columns.map(column => ({ value: column.id, label: column.title }))
  const addSkill = (skill: string) => {
    const name = skill.trim().replace(/^\//, '')
    if (name !== '' && !card.skills.includes(name)) void patchCard(host, card.id, { skills: [...card.skills, name] })
  }
  const offered = skills.filter(skill => !card.skills.includes(skill))
  const owed = [
    card.ref === '' ? '' : `for ${card.ref}`,
    card.needs === '' ? '' : `needs ${card.needs}`,
    card.owner === '' ? '' : `owner ${card.owner}`,
  ]
    .filter(part => part !== '')
    .join(' · ')
  const kinds = [TASK, GATE, EPIC, ...([TASK, GATE, EPIC].includes(card.kind) ? [] : [card.kind])]
  const epics = openEpics(board).filter(one => one.id !== card.id)
  const epicOptions = [
    { value: '', label: 'No epic' },
    ...epics.map(one => ({ value: one.id, label: `${one.id} ${one.title}` })),
    ...(card.epic !== '' && !epics.some(one => one.id === card.epic) ? [{ value: card.epic, label: card.epic }] : []),
  ]
  const sprints = board.config.sprints.filter(one => one.state !== 'closed' || one.id === card.sprint)
  const sprintOptions = [
    { value: '', label: 'No sprint (backlog)' },
    ...sprints.map(one => ({ value: one.id, label: `${one.id} ${one.title} (${one.state})` })),
    ...(card.sprint !== '' && !sprints.some(one => one.id === card.sprint) ? [{ value: card.sprint, label: card.sprint }] : []),
  ]
  const isAnEpic = isEpic(card)
  const children = isAnEpic ? board.cards.filter(one => one.epic === card.id && one.status !== ARCHIVED) : []

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="back" hotkey="b" onPress={() => void setView(host, BOARD)}>
          ‹ Kanban
        </Button>
        <Button key="start-new" variant="primary" onPress={() => void startCard(host, card.id, 'new-session')}>
          {isAnEpic ? 'Break down in new session' : 'Start in new session'}
        </Button>
        <Button key="start-queue" onPress={() => void startCard(host, card.id, 'queue')}>
          {isAnEpic ? 'Break down here' : 'Queue in this session'}
        </Button>
        {isAnEpic && (
          <Button
            key="epic-cards"
            onPress={() => void setScope(host, { kind: 'epic', id: card.id }).then(() => setView(host, BOARD))}
          >
            Show its cards
          </Button>
        )}
        {isSuggested && (
          <Button key="accept" onPress={() => void acceptCard(host, card.id)}>
            Accept
          </Button>
        )}
        <Button key="archive" onPress={() => void archiveCard(host, card.id).then(() => setView(host, BOARD))}>
          {isSuggested ? 'Dismiss' : 'Archive'}
        </Button>
      </Box>
      <Text bold>
        {isGate(card) ? <Text color="warning">gate </Text> : ''}
        {isAnEpic ? <Text color="claude">epic </Text> : ''}
        {card.title} <Text dimColor>{`${card.id}${card.source === 'claude' ? ' · by Claude' : ''}`}</Text>
      </Text>
      {owed !== '' && <Text dimColor>{owed}</Text>}
      {Input && (
        <Input
          key="title"
          label="Title"
          value={card.title}
          submitLabel="rename"
          onSubmit={title => {
            if (title.trim() !== '') void patchCard(host, card.id, { title: title.trim() })
          }}
        />
      )}
      {Select && (
        <Select
          key="status"
          label="Column"
          value={card.status}
          options={isSuggested ? [{ value: SUGGESTED, label: 'Suggested' }, ...columns] : columns}
          onSelect={value => void moveCard(host, card.id, value)}
        />
      )}
      {Select && (
        <Select
          key="kind"
          label="Kind"
          value={card.kind}
          options={kinds.map(value => ({ value }))}
          onSelect={value => void patchCard(host, card.id, { kind: value })}
        />
      )}
      {Select && !isAnEpic && (
        <Select
          key="epic"
          label="Epic"
          value={card.epic}
          options={epicOptions}
          onSelect={value => void patchCard(host, card.id, { epic: value })}
        />
      )}
      {Select && (
        <Select
          key="sprint"
          label="Sprint"
          value={card.sprint}
          options={sprintOptions}
          onSelect={value => void patchCard(host, card.id, { sprint: value })}
        />
      )}
      {isAnEpic && (
        <Box flexDirection="column">
          <Text bold>
            {'Cards '}
            <Text dimColor>{progressBar(epicProgress(board, card.id))}</Text>
          </Text>
          {children.length === 0 && <Text dimColor>None yet: Break down hands the epic to an agent to slice.</Text>}
          {children.map(one => (
            <Button key={`child-${one.id}`} plain onPress={() => void setView(host, { kind: 'card', id: one.id })}>
              {`${one.id} [${one.status}] ${one.title}`}
            </Button>
          ))}
        </Box>
      )}
      {Input && (
        <Input
          key="owner"
          label="Owner"
          value={card.owner}
          submitLabel="save"
          onSubmit={owner => void patchCard(host, card.id, { owner: owner.trim() })}
        />
      )}
      {Input && isGate(card) && (
        <Input
          key="ref"
          label="Owed for"
          value={card.ref}
          placeholder="pull request, issue or card"
          submitLabel="save"
          onSubmit={ref => void patchCard(host, card.id, { ref: ref.trim() })}
        />
      )}
      {Input && isGate(card) && (
        <Input
          key="needs"
          label="Needs"
          value={card.needs}
          placeholder="what running it needs"
          submitLabel="save"
          onSubmit={needs => void patchCard(host, card.id, { needs: needs.trim() })}
        />
      )}
      {Select && (
        <Select
          key="priority"
          label="Priority"
          value={card.priority}
          options={PRIORITIES.map(value => ({ value }))}
          onSelect={value => void patchCard(host, card.id, { priority: PRIORITIES.find(one => one === value) ?? 'normal' })}
        />
      )}
      {Input && (
        <Input
          key="labels"
          label="Labels"
          value={card.labels.join(', ')}
          placeholder="comma separated"
          submitLabel="save"
          onSubmit={text => void patchCard(host, card.id, { labels: splitList(text) })}
        />
      )}
      <Box flexDirection="column">
        <Text bold>Skill nudges</Text>
        <Text dimColor>Listed at the end of the first message, for the agent that takes this card.</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {card.skills.map(skill => (
            <Button
              key={`skill-${skill}`}
              plain
              onPress={() => void patchCard(host, card.id, { skills: card.skills.filter(one => one !== skill) })}
            >
              {`/${skill} ✕`}
            </Button>
          ))}
        </Box>
        {Select && offered.length > 0 && (
          <Select
            key="skill-pick"
            label="Add"
            value=""
            options={[{ value: '', label: 'Pick a skill…' }, ...offered.map(value => ({ value, label: `/${value}` }))]}
            onSelect={addSkill}
          />
        )}
        {Input && (
          <Input key="skill-type" label="Or type one" placeholder="plugin:skill" submitLabel="add" onSubmit={addSkill} />
        )}
      </Box>
      {card.remote && <Link href={card.remote.url} label={`Issue #${card.remote.number}`} />}
      <Markdown text={card.body.trim() === '' ? '_No details yet._' : card.body} />
      {Input && (
        <Input
          key="note"
          label="Add a note"
          submitLabel="append"
          onSubmit={note => {
            if (note.trim() !== '') void patchCard(host, card.id, { body: `${card.body.trim()}\n\n${note.trim()}`.trim() })
          }}
        />
      )}
      <Text dimColor wrap="truncate-start">{`${board.dir}/${card.file}`}</Text>
    </Box>
  )
}

/** The open epics with their progress: open one, show its cards on the board, or start a new one. */
export function epicsView(ui: Table, host: Host, board: Board): RenderElement {
  const { Box, Text, Button, Input } = ui
  const epics = openEpics(board)
  const create = async (title: string) => {
    if (title.trim() === '') return
    const card = await addEpic(host, title.trim())
    await setView(host, { kind: 'card', id: card.id })
  }

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box flexDirection="row">
        <Button key="back" hotkey="b" onPress={() => void setView(host, BOARD)}>
          ‹ Kanban
        </Button>
      </Box>
      <Text bold>Epics</Text>
      <Text dimColor>
        An epic holds a goal larger than one session. Its cards carry its goal into every agent that takes one.
      </Text>
      {epics.length === 0 && <Text dimColor>No open epics.</Text>}
      {epics.map(epic => (
        <Box key={`epic-${epic.id}`} flexDirection="row" gap={1} flexWrap="wrap">
          <Text>
            {`${progressBar(epicProgress(board, epic.id))}  `}
            <Text bold>{epic.title}</Text> <Text dimColor>{epic.id}</Text>
          </Text>
          <Button key={`open-${epic.id}`} plain onPress={() => void setView(host, { kind: 'card', id: epic.id })}>
            Open
          </Button>
          <Button
            key={`show-${epic.id}`}
            plain
            onPress={() => void setScope(host, { kind: 'epic', id: epic.id }).then(() => setView(host, BOARD))}
          >
            Show cards
          </Button>
        </Box>
      ))}
      {Input ? (
        <Input key="new-epic" label="New epic" placeholder="the goal, as a title" submitLabel="add" onSubmit={title => void create(title)} />
      ) : (
        <Text dimColor>Add one with /kanban epic &lt;title&gt;.</Text>
      )}
    </Box>
  )
}

/** The sprints: plan one, start it, close it. Closing archives its done cards and rolls the rest on. */
export function sprintsView(ui: Table, host: Host, board: Board): RenderElement {
  const { Box, Text, Button, Input } = ui
  const active = activeSprint(board.config)
  const open = board.config.sprints.filter(sprint => sprint.state !== 'closed')
  const closed = board.config.sprints.filter(sprint => sprint.state === 'closed').slice(-5).reverse()
  const counts = (id: string) => board.cards.filter(card => card.sprint === id && card.status !== ARCHIVED).length
  const close = async (id: string) => {
    const preview = closePreview(board, id)
    if (preview === undefined) return
    const answer = await host.ask(`Close sprint ${id}? ${preview}`, ['Close it', 'Keep it open'])
    if (answer === 'Close it') host.toast(await closeSprint(host, id))
  }

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box flexDirection="row">
        <Button key="back" hotkey="b" onPress={() => void setView(host, BOARD)}>
          ‹ Kanban
        </Button>
      </Box>
      <Text bold>Sprints</Text>
      <Text dimColor>
        The board shows the active sprint. Closing it archives its done cards and moves the rest to the next planned
        sprint, or to the backlog.
      </Text>
      {open.length === 0 && <Text dimColor>No sprint planned.</Text>}
      {open.map(sprint => (
        <Box key={`sprint-${sprint.id}`} flexDirection="column">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text>
              <Text bold color={sprint.state === 'active' ? 'claude' : 'text'}>
                {`${sprint.id} ${sprint.title}`}
              </Text>
              <Text dimColor>{` ${sprint.state} · ${counts(sprint.id)} card(s)${sprint.end === '' ? '' : ` · ends ${sprint.end}`}`}</Text>
            </Text>
            {sprint.state === 'planned' && !active && (
              <Button key={`start-${sprint.id}`} plain onPress={() => void startSprint(host, sprint.id).then(host.toast)}>
                Start
              </Button>
            )}
            <Button key={`close-${sprint.id}`} plain onPress={() => void close(sprint.id)}>
              Close
            </Button>
          </Box>
          {sprint.goal !== '' && <Text dimColor>{sprint.goal}</Text>}
          {Input && (
            <Input
              key={`goal-${sprint.id}`}
              label="Goal"
              value={sprint.goal}
              submitLabel="save"
              onSubmit={goal => void patchSprint(host, sprint.id, { goal: goal.trim() })}
            />
          )}
          {Input && (
            <Input
              key={`end-${sprint.id}`}
              label="Ends"
              value={sprint.end}
              placeholder="YYYY-MM-DD"
              submitLabel="save"
              onSubmit={end => void patchSprint(host, sprint.id, { end: end.trim() })}
            />
          )}
        </Box>
      ))}
      {Input ? (
        <Input
          key="new-sprint"
          label="New sprint"
          placeholder="its title"
          submitLabel="plan"
          onSubmit={title => {
            if (title.trim() !== '') void addSprint(host, title.trim())
          }}
        />
      ) : (
        <Text dimColor>Plan one with /kanban sprint new &lt;title&gt;.</Text>
      )}
      {closed.length > 0 && <Text bold>Closed</Text>}
      {closed.map(sprint => (
        <Text key={`closed-${sprint.id}`} dimColor>
          {`${sprint.id} ${sprint.title}: ${sprint.closed?.done ?? 0} done, ${sprint.closed?.rolled ?? 0} rolled on${sprint.closed?.at ? `, ${sprint.closed.at.slice(0, 10)}` : ''}`}
        </Text>
      ))}
    </Box>
  )
}

export function settingsView(ui: Table, host: Host, board: Board, sync: SyncState): RenderElement {
  const { Box, Text, Button, Select } = ui
  const isEnabled = board.config.remote.enabled

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Box flexDirection="row">
        <Button key="back" hotkey="b" onPress={() => void setView(host, BOARD)}>
          ‹ Kanban
        </Button>
      </Box>
      <Text bold>Starting a task</Text>
      {Select && (
        <Select
          key="start-mode"
          label="Dropping a card into the start column"
          value={board.config.startMode}
          options={[
            { value: 'new-session', label: 'opens a new session' },
            { value: 'queue', label: 'queues it for this session' },
          ]}
          onSelect={value => void patchConfig(host, { startMode: value === 'queue' ? 'queue' : 'new-session' })}
        />
      )}
      <Text bold>Remote sync</Text>
      <Text dimColor>
        Two-way with this repository's GitHub or GitLab issues, through your own gh or glab login. Suggested and
        archived cards stay local.
      </Text>
      <Box flexDirection="row" gap={1}>
        <Button key="sync-toggle" onPress={() => void setRemoteEnabled(host, !isEnabled)}>
          {isEnabled ? 'Turn sync off' : 'Turn sync on'}
        </Button>
        {isEnabled && (
          <Button key="sync-now" onPress={() => void syncNow(host)}>
            Sync now
          </Button>
        )}
      </Box>
      <Text dimColor>{syncLine(board, sync)}</Text>
      <Text bold>Folder</Text>
      <Text dimColor wrap="truncate-start">{board.dir}</Text>
      {board.isOldFolder && (
        <Text color="warning">
          These cards are still in .agents/board, the folder of before the rename. It keeps working; `aw setup` or `aw
          doctor` moves it to .agents/kanban.
        </Text>
      )}
    </Box>
  )
}
