import type { Card, Column, Sprint } from '../../../types'
import {
  adoptColumns,
  asArray,
  doneColumn,
  epicLabel,
  epicOfLabels,
  isBoardLabel,
  isRecord,
  milestoneTitle,
  normalizeBody,
  parseJson,
  run,
  statusLabel,
  statusOf,
} from './provider'
import type { Connect, ParentRef, Plan, RemoteIssue } from './provider'

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

const issuesQuery = (hasProject: boolean, hasSubIssues: boolean) => `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        id number title body url updatedAt state
        labels(first: 30) { nodes { name } }
        milestone { title }
        ${hasSubIssues ? 'parent { number }' : ''}
        ${
          hasProject
            ? 'projectItems(first: 10) { nodes { id project { id } fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId } } } }'
            : ''
        }
      }
    }
  }
}`

const SUB_ISSUE_ADD = `mutation($issueId: ID!, $subIssueId: ID!) {
  addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: true }) { issue { id } }
}`

const SUB_ISSUE_REMOVE = `mutation($issueId: ID!, $subIssueId: ID!) {
  removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) { issue { id } }
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
 * options); otherwise a `status:<column>` label per card. A sprint is a
 * milestone of its title (made when missing, due on the sprint's end); an
 * epic's cards are its sub-issues, or carry an `epic:<id>` label where the
 * remote has no sub-issues.
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
  const nodes = new Map<number, string>()
  let hasSubIssues = true
  let milestones: Map<string, { number: number; due: string }> | null = null

  const ensureLabels = async (labels: readonly string[]) => {
    for (const label of labels) {
      if (ensured.has(label)) continue
      await gh(['label', 'create', label, '--force']).catch(() => undefined)
      ensured.add(label)
    }
  }
  /** The epic's issue to hang the card from, when sub-issues can say it; null leaves it to a label. */
  const parentOf = (plan: Plan): number | null =>
    hasSubIssues && plan.epic?.remote && !plan.epic.remote.isEpic ? plan.epic.remote.number : null
  const labelsOf = (card: Card, plan: Plan) => [
    ...card.labels,
    ...(project ? [] : [statusLabel(card.status)]),
    ...(plan.epic !== null && parentOf(plan) === null ? [epicLabel(plan.epic.id)] : []),
  ]

  /**
   * The sprint's milestone, made when the repository has none of its title,
   * its due date kept to the sprint's end (noon UTC, so no time zone moves the day).
   */
  const ensureMilestone = async (sprint: Sprint): Promise<string> => {
    const title = milestoneTitle(sprint)
    const path = `repos/${owner}/${name}/milestones`
    const dueOn = `due_on=${sprint.end}T12:00:00Z`
    if (milestones === null) {
      milestones = new Map()
      for (const one of asArray(parseJson(await gh(['api', `${path}?state=all&per_page=100`])))) {
        if (!isRecord(one) || typeof one.title !== 'string' || typeof one.number !== 'number') continue
        milestones.set(one.title, { number: one.number, due: String(one.due_on ?? '').slice(0, 10) })
      }
    }
    const had = milestones.get(title)
    if (had === undefined) {
      const fields = [
        ...(sprint.end === '' ? [] : ['-f', dueOn]),
        ...(sprint.goal === '' ? [] : ['-f', `description=${sprint.goal}`]),
      ]
      const made = dig(parseJson(await gh(['api', path, '-X', 'POST', '-f', `title=${title}`, ...fields])), 'number')
      milestones.set(title, { number: typeof made === 'number' ? made : 0, due: sprint.end })
    } else if (sprint.end !== '' && had.due !== sprint.end) {
      await gh(['api', `${path}/${had.number}`, '-X', 'PATCH', '-f', dueOn])
      milestones.set(title, { ...had, due: sprint.end })
    }

    return title
  }

  const nodeOf = async (number: number): Promise<string> => {
    const known = nodes.get(number)
    if (known !== undefined) return known
    const id = dig(parseJson(await gh(['issue', 'view', String(number), '--json', 'id'])), 'id')
    if (typeof id !== 'string') throw new Error(`gh could not name issue #${number}`)
    nodes.set(number, id)

    return id
  }

  /** Hangs the issue from its epic's issue, or takes it down; answers the parent it now has. */
  const hang = async (number: number, plan: Plan, had: ParentRef | null): Promise<ParentRef | null> => {
    const wanted = parentOf(plan)
    const was = had !== null && 'number' in had ? had.number : null
    if (wanted !== was && hasSubIssues) {
      const child = await nodeOf(number)
      if (wanted !== null) {
        await gh(['api', 'graphql', '-f', `query=${SUB_ISSUE_ADD}`, '-f', `issueId=${await nodeOf(wanted)}`, '-f', `subIssueId=${child}`])
      } else if (was !== null) {
        await gh(['api', 'graphql', '-f', `query=${SUB_ISSUE_REMOVE}`, '-f', `issueId=${await nodeOf(was)}`, '-f', `subIssueId=${child}`])
      }
    }

    return wanted === null ? (plan.epic === null ? null : { label: plan.epic.id }) : { number: wanted, isEpic: false }
  }

  const toIssue = (node: unknown): RemoteIssue[] => {
    const number = dig(node, 'number')
    if (typeof number !== 'number') return []
    const all = asArray(dig(node, 'labels', 'nodes') ?? dig(node, 'labels')).flatMap(label =>
      isRecord(label) && typeof label.name === 'string' ? [label.name] : [],
    )
    const isOpen = String(dig(node, 'state')).toUpperCase() === 'OPEN'
    const id = dig(node, 'id')
    if (typeof id === 'string') nodes.set(number, id)
    const parent = dig(node, 'parent', 'number')
    const milestone = dig(node, 'milestone', 'title')
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
        labels: all.filter(label => !isBoardLabel(label)),
        milestone: typeof milestone === 'string' ? milestone : null,
        parent: typeof parent === 'number' ? { number: parent, isEpic: false } : epicOfLabels(all),
        isEpic: false,
      },
    ]
  }

  /** The issue as it now stands; `gh issue view` names no parent, so the one just set is said. */
  const view = async (number: number, status: string, parent: ParentRef | null): Promise<RemoteIssue> => {
    const fields = 'id,number,title,body,url,updatedAt,state,labels,milestone'
    const issue = toIssue(parseJson(await gh(['issue', 'view', String(number), '--json', fields])))[0]
    if (!issue) throw new Error(`gh could not read issue #${number}`)

    return { ...issue, status, parent }
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
      // A server without sub-issues refuses the `parent` field: ask once without it, and say epics as labels.
      const found = await graphql(issuesQuery(project !== null, hasSubIssues), owner, name).catch(async error => {
        if (!hasSubIssues) throw error
        hasSubIssues = false

        return graphql(issuesQuery(project !== null, false), owner, name)
      })

      return asArray(dig(found, 'data', 'repository', 'issues', 'nodes')).flatMap(toIssue)
    },
    create: async (card, plan) => {
      const labels = labelsOf(card, plan)
      await ensureLabels(labels)
      const milestone = plan.sprint === null ? [] : ['--milestone', await ensureMilestone(plan.sprint)]
      const args = ['issue', 'create', '--title', card.title, '--body-file', '-', ...milestone]
      const url = (await gh([...args, ...labels.flatMap(label => ['--label', label])], card.body)).trim().split(/\s+/).pop()
      const number = Number(/\/issues\/(\d+)/.exec(url ?? '')?.[1])
      if (url === undefined || !Number.isInteger(number)) throw new Error('gh issue create answered no issue URL')
      await place(card, number, url)
      if (card.status === done) await gh(['issue', 'close', String(number)])
      const parent = await hang(number, plan, null)

      return view(number, card.status, parent)
    },
    push: async (card, was, plan) => {
      const wanted = labelsOf(card, plan)
      const had = [
        ...was.labels,
        ...(project || was.status === null ? [] : [statusLabel(was.status)]),
        ...(was.parent !== null && 'label' in was.parent ? [epicLabel(was.parent.label)] : []),
      ]
      const added = wanted.filter(label => !had.includes(label))
      const removed = had.filter(label => !wanted.includes(label))
      await ensureLabels(added)
      const title = plan.sprint === null ? null : await ensureMilestone(plan.sprint)
      const milestone = title === was.milestone ? [] : title === null ? ['--remove-milestone'] : ['--milestone', title]
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
          ...milestone,
        ],
        card.body,
      )
      await place(card, was.number, was.url)
      const shouldBeOpen = card.status !== done
      if (shouldBeOpen !== was.isOpen) await gh(['issue', shouldBeOpen ? 'reopen' : 'close', String(was.number)])
      const parent = await hang(was.number, plan, was.parent)

      return view(was.number, card.status, parent)
    },
  }
}
