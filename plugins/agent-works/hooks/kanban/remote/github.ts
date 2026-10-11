import type { Card, Column } from '../../../types'
import {
  adoptColumns,
  asArray,
  doneColumn,
  isRecord,
  isStatusLabel,
  normalizeBody,
  parseJson,
  run,
  statusLabel,
  statusOf,
} from './provider'
import type { Connect, RemoteIssue } from './provider'

type Project = {
  id: string
  number: number
  owner: string
  fieldId: string
  /** Column id to the Status option that is it. */
  options: Map<string, string>
  columns: Column[]
}

const PROJECT_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        id number
        owner { ... on Organization { login } ... on User { login } }
        field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
      }
    }
  }
}`

const issuesQuery = (hasProject: boolean) => `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title body url updatedAt state
        labels(first: 30) { nodes { name } }
        ${
          hasProject
            ? 'projectItems(first: 10) { nodes { id project { id } fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId } } } }'
            : ''
        }
      }
    }
  }
}`

function dig(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((at, key) => (isRecord(at) ? at[key] : undefined), value)
}

function toProject(node: unknown): Project | null {
  const fieldId = dig(node, 'field', 'id')
  const id = dig(node, 'id')
  const owner = dig(node, 'owner', 'login')
  const number = dig(node, 'number')
  const named = asArray(dig(node, 'field', 'options')).flatMap(option =>
    isRecord(option) && typeof option.id === 'string' && typeof option.name === 'string'
      ? [{ id: option.id, name: option.name }]
      : [],
  )
  if (typeof id !== 'string' || typeof fieldId !== 'string' || typeof owner !== 'string') return null
  if (typeof number !== 'number' || named.length === 0) return null
  const columns = adoptColumns(named.map(option => option.name))

  return {
    id,
    number,
    owner,
    fieldId,
    columns,
    options: new Map(columns.map((column, index) => [column.id, named[index]?.id ?? ''])),
  }
}

/**
 * GitHub through the person's own `gh` login: issues, and the repository's
 * most recent Projects v2 board when it has one (columns are its Status
 * options); otherwise a `status:<column>` label per card.
 */
export const connectGithub: Connect = async (host, root, config) => {
  const gh = (args: readonly string[], stdin?: string) => run(host, root, ['gh', ...args], stdin)
  const graphql = async (query: string, owner: string, name: string) =>
    parseJson(await gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`]))

  const repo = parseJson(await gh(['repo', 'view', '--json', 'nameWithOwner']))
  const [owner = '', name = ''] = String(dig(repo, 'nameWithOwner') ?? '').split('/')
  if (owner === '' || name === '') throw new Error('gh could not name this repository')

  let project: Project | null = null
  let notice: string | null = null
  try {
    const found = await graphql(PROJECT_QUERY, owner, name)
    project = toProject(asArray(dig(found, 'data', 'repository', 'projectsV2', 'nodes'))[0])
  } catch {
    notice = 'No access to project boards, so columns sync as labels. To use a project board: gh auth refresh -s project'
  }

  const columns = project?.columns ?? config.columns
  const done = doneColumn(columns)
  const first = columns[0]?.id ?? null
  const items = new Map<number, string>()
  const ensured = new Set<string>()

  const ensureLabels = async (labels: readonly string[]) => {
    for (const label of labels) {
      if (ensured.has(label)) continue
      await gh(['label', 'create', label, '--force']).catch(() => undefined)
      ensured.add(label)
    }
  }
  const labelsOf = (card: Card) => (project ? card.labels : [...card.labels, statusLabel(card.status)])

  const toIssue = (node: unknown): RemoteIssue[] => {
    const number = dig(node, 'number')
    if (typeof number !== 'number') return []
    const all = asArray(dig(node, 'labels', 'nodes') ?? dig(node, 'labels')).flatMap(label =>
      isRecord(label) && typeof label.name === 'string' ? [label.name] : [],
    )
    const isOpen = String(dig(node, 'state')).toUpperCase() === 'OPEN'
    let status = isOpen ? (statusOf(all) ?? first) : done
    if (project) {
      const item = asArray(dig(node, 'projectItems', 'nodes')).find(one => dig(one, 'project', 'id') === project.id)
      const itemId = dig(item, 'id')
      if (typeof itemId === 'string') items.set(number, itemId)
      const optionId = dig(item, 'fieldValueByName', 'optionId')
      const column = [...project.options].find(([, option]) => option === optionId)?.[0]
      status = isOpen ? (column ?? null) : (done ?? column ?? null)
    }

    return [
      {
        number,
        title: String(dig(node, 'title') ?? ''),
        body: normalizeBody(dig(node, 'body')),
        url: String(dig(node, 'url') ?? ''),
        updatedAt: String(dig(node, 'updatedAt') ?? ''),
        isOpen,
        status,
        labels: all.filter(label => !isStatusLabel(label)),
      },
    ]
  }

  const view = async (number: number, status: string): Promise<RemoteIssue> => {
    const fields = 'number,title,body,url,updatedAt,state,labels'
    const issue = toIssue(parseJson(await gh(['issue', 'view', String(number), '--json', fields])))[0]
    if (!issue) throw new Error(`gh could not read issue #${number}`)

    return { ...issue, status }
  }

  const place = async (card: Card, number: number, url: string) => {
    if (!project) return
    let item = items.get(number)
    if (item === undefined) {
      const args = ['project', 'item-add', String(project.number), '--owner', project.owner, '--url', url]
      const added = dig(parseJson(await gh([...args, '--format', 'json'])), 'id')
      if (typeof added !== 'string') return
      item = added
      items.set(number, item)
    }
    const option = project.options.get(card.status)
    if (option === undefined || option === '') return
    const target = ['--id', item, '--project-id', project.id, '--field-id', project.fieldId]
    await gh(['project', 'item-edit', ...target, '--single-select-option-id', option])
  }

  return {
    name: 'github',
    columns: project?.columns ?? null,
    notice,
    list: async () => {
      const found = await graphql(issuesQuery(project !== null), owner, name)

      return asArray(dig(found, 'data', 'repository', 'issues', 'nodes')).flatMap(toIssue)
    },
    create: async card => {
      const labels = labelsOf(card)
      await ensureLabels(labels)
      const args = ['issue', 'create', '--title', card.title, '--body-file', '-']
      const url = (await gh([...args, ...labels.flatMap(label => ['--label', label])], card.body)).trim().split(/\s+/).pop()
      const number = Number(/\/issues\/(\d+)/.exec(url ?? '')?.[1])
      if (url === undefined || !Number.isInteger(number)) throw new Error('gh issue create answered no issue URL')
      await place(card, number, url)
      if (card.status === done) await gh(['issue', 'close', String(number)])

      return view(number, card.status)
    },
    push: async (card, was) => {
      const wanted = labelsOf(card)
      const had = project ? was.labels : [...was.labels, ...(was.status === null ? [] : [statusLabel(was.status)])]
      const added = wanted.filter(label => !had.includes(label))
      const removed = had.filter(label => !wanted.includes(label))
      await ensureLabels(added)
      await gh(
        [
          'issue',
          'edit',
          String(was.number),
          '--title',
          card.title,
          '--body-file',
          '-',
          ...added.flatMap(label => ['--add-label', label]),
          ...removed.flatMap(label => ['--remove-label', label]),
        ],
        card.body,
      )
      await place(card, was.number, was.url)
      const shouldBeOpen = card.status !== done
      if (shouldBeOpen !== was.isOpen) await gh(['issue', shouldBeOpen ? 'reopen' : 'close', String(was.number)])

      return view(was.number, card.status)
    },
  }
}
