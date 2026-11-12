// tracker.mjs: where a plan issue lives outside the plan tree, on GitHub or GitLab.
//
// Lands in `.agents/plan/plan/` beside `plan-status.mjs` and
// `publish-issues.mjs`, which are its two callers, and `provider.mjs`, the
// layer over `gh` and `glab` it is written on. Node 22 stdlib only.
//
// `.agents/plan/tracker.md` says which forge and how. This module reads that
// file and turns the plan's vocabulary into the forge's:
//
//   GitHub   an issue per plan issue, labelled by type with the triage label
//            tracker.md names (ready-for-agent, ready-for-human,
//            ready-for-review); done closes it, anything else reopens it; when
//            tracker.md names a Project board, the item's Status follows.
//   GitLab   an issue per plan issue, labelled `epic::EE-<slug>` and
//            `type::<TYPE>` (a decision issue also `decision`), in a milestone
//            per sprint titled `EE-SS <slug>`; `status::in-progress` and
//            `status::blocked` follow the plan, done closes it.
//
// On both, a blocked reason is posted as a comment and a cancelled issue is
// closed as not planned (GitHub's close reason, a comment on GitLab).
//
// Every function takes the provider's `{ run, env }` as its last argument, so
// a test hands in a runner and nothing here starts a process on its own.
// Nothing throws for a failed call: a create answers the provider's result,
// and a status sync answers the list of things it could not do, as warnings.
import { api, commentOnIssue, createIssue, detect, ensureLabel, graphql, updateIssue, viewIssue } from "./provider.mjs";

/** Plan status to the GitLab label that carries it; open and closed carry the rest. */
export const STATUS_LABEL = { "in-progress": "status::in-progress", blocked: "status::blocked" };
/** Plan status to the option of a GitHub Project's built-in Status field. */
export const BOARD_STATUS = { "not-started": "Todo", "in-progress": "In Progress", blocked: "Todo", done: "Done" };
/** One hue per epic label, cycled. */
export const EPIC_COLORS = ["#6699cc", "#b16286", "#689d6a", "#d79921", "#d65d0e", "#458588", "#cc241d", "#8ec07c"];

const filled = (v) => Boolean(v) && !v.includes("{{") && v !== "<unset>" && v !== "-";
const field = (text, name, shape = "[^`\\s]+") => {
  const value = new RegExp(`\\*\\*${name}\\*\\*:\\s*\`?(${shape})\`?`).exec(text)?.[1];
  return filled(value) ? value : null;
};
const labelFor = (text, role, fallback) => new RegExp(`\\|\\s*${role}\\s*\\|\\s*\`([^\`]+)\``).exec(text)?.[1] ?? fallback;

/**
 * What tracker.md declares: `mode` ("local", "github" or "gitlab") and the
 * values that mode needs. A file that names no forge, or no file, is local.
 */
export function readTracker(text) {
  const t = String(text ?? "");
  const notify = field(t, "Notify");
  if (/#\s*Issue tracker:\s*local/i.test(t)) return { mode: "local", notify: null };
  if (/#\s*Issue tracker:\s*GitLab/i.test(t)) {
    return { mode: "gitlab", project: field(t, "Project"), projectId: field(t, "Project ID", "\\d+"), host: field(t, "Host"), notify };
  }
  if (/#\s*Issue tracker:\s*GitHub/i.test(t)) {
    const human = labelFor(t, "ready-for-human", "ready-for-human");
    const owner = field(t, "Owner");
    const number = field(t, "Number", "\\d+");
    return {
      mode: "github",
      // A tracker.md with no ready-for-review row sends REVIEW issues to the human label.
      labels: { agent: labelFor(t, "ready-for-agent", "ready-for-agent"), human, review: labelFor(t, "ready-for-review", human) },
      board: owner && number ? { owner, number: Number(number) } : null,
      notify,
    };
  }
  return { mode: "local", notify: null };
}

/** The provider for this tracker: the forge tracker.md names, the repository of `root`'s origin unless tracker.md names a project. */
export function providerFor(config, root, opts = {}) {
  if (config.mode !== "github" && config.mode !== "gitlab") return null;
  const provider = detect(root, { ...opts, kind: config.mode, ...(config.project ? { slug: config.project } : {}), ...(config.host ? { host: config.host } : {}) });
  return config.projectId ? { ...provider, projectId: config.projectId } : provider;
}

/** The number in a `**Tracker**:` value: `#42` gives "42", `<unassigned>` gives null. */
export const refNumber = (ref) => /^#(\d+)\b/.exec(String(ref ?? "").trim())?.[1] ?? null;

export const epicLabel = (sprint) => `epic::${sprint.enum}-${sprint.eslug}`;
export const milestoneTitle = (sprint) => `${sprint.enum}-${sprint.snum} ${sprint.sslug}`;

/** The labels a new ticket is created with. */
export function ticketLabels(config, sprint, issue) {
  if (config.mode === "gitlab") return [epicLabel(sprint), `type::${issue.type}`, ...(issue.decision ? ["decision"] : [])];
  return [issue.type === "REVIEW" ? config.labels.review : issue.type === "HITL" ? config.labels.human : config.labels.agent];
}

/**
 * Makes what a ticket hangs from, once per run (`state` remembers): on GitLab
 * the epic's label and the sprint's milestone, on GitHub the triage label.
 * Answers the first failure, or `{ ok: true, value: [what was made] }`.
 */
export function ensureSprintObjects(provider, config, sprint, issue, state, opts = {}) {
  state.labels ??= new Set();
  state.milestones ??= new Set();
  const made = [];
  const label = (name, extra) => {
    if (state.labels.has(name)) return null;
    const r = ensureLabel(provider, name, extra, opts);
    if (!r.ok) return r;
    state.labels.add(name);
    if (r.value.created) made.push(`label ${name}`);
    return null;
  };
  if (config.mode === "gitlab") {
    const failed = label(epicLabel(sprint), { color: EPIC_COLORS[(Number(sprint.enum) - 1 + EPIC_COLORS.length) % EPIC_COLORS.length], description: `Epic ${sprint.enum}` });
    if (failed) return failed;
    const title = milestoneTitle(sprint);
    if (!state.milestones.has(title)) {
      const r = api(provider, "POST", "{project}/milestones", { ...opts, body: { title } });
      if (!r.ok && r.error !== "exists") return r;
      state.milestones.add(title);
      if (r.ok) made.push(`milestone ${title}`);
    }
  } else {
    const failed = label(ticketLabels(config, sprint, issue)[0], {});
    if (failed) return failed;
  }
  return { ok: true, value: made };
}

/** Opens the ticket for one plan issue. Answers the provider's result: `value.number` is the ref. */
export function createTicket(provider, config, sprint, issue, body, state, opts = {}) {
  const ready = ensureSprintObjects(provider, config, sprint, issue, state, opts);
  if (!ready.ok) return ready;
  const made = createIssue(provider, {
    title: issue.title, body, labels: ticketLabels(config, sprint, issue),
    ...(config.mode === "gitlab" ? { milestone: milestoneTitle(sprint) } : {}),
  }, opts);
  return made.ok ? { ...made, made: ready.value } : made;
}

/** Rebuilds a published ticket's title and body from its plan file. Labels, milestone and state are left alone. */
export const rebuildTicket = (provider, num, { title, body }, opts = {}) => updateIssue(provider, num, { title, body }, opts);

const BOARD_QUERY = "query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){issue(number:$num){projectItems(first:20){nodes{id project{id number field(name:\"Status\"){... on ProjectV2SingleSelectField{id options{id name}}}}}}}}}";
const BOARD_MUTATION = "mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}";

/**
 * Sets the Status of the issue's item on the configured Project board. One
 * query from the issue to its own items, never a listing of the board: a
 * board's listing costs by its size, and this runs once per status change.
 */
function boardStatus(provider, config, num, status, opts) {
  const want = BOARD_STATUS[status];
  const [owner, repo] = String(provider.slug ?? "").split("/");
  if (!owner || !repo) return ["the repository behind origin is not known; skipping board Status"];
  const seen = graphql(provider, BOARD_QUERY, { owner, repo, num: Number(num) }, opts);
  if (!seen.ok) return [`board Status not read: ${seen.hint}`];
  const item = (seen.value?.repository?.issue?.projectItems?.nodes ?? []).find((n) => Number(n?.project?.number) === config.board.number);
  if (!item) return [`issue #${num} is not on project ${config.board.number}; skipping board Status`];
  const option = (item.project.field?.options ?? []).find((o) => o.name === want);
  if (!item.project.field?.id || !option) return [`no Status option '${want}' on the board; skipping`];
  const set = graphql(provider, BOARD_MUTATION, { project: item.project.id, item: item.id, field: item.project.field.id, option: option.id }, opts);
  return set.ok ? [] : [`board Status not set: ${set.hint}`];
}

/**
 * Moves the ticket to match one plan status. Reads the ticket first and
 * changes only what differs, so a repeat is harmless. Answers the warnings:
 * an empty list means the tracker agrees with the plan.
 */
export function syncStatus(provider, config, num, status, { reason = null, cancelled = false } = {}, opts = {}) {
  const warnings = [];
  const seen = viewIssue(provider, num, opts);
  if (!seen.ok) return [`#${num} not read (${seen.error}): ${seen.hint}`];
  const wantClosed = status === "done";
  const flip = wantClosed !== (seen.value.state === "closed");
  const note = (r, what) => { if (!r.ok) warnings.push(`#${num} ${what} failed (${r.error}): ${r.hint}`); return r.ok; };

  if (config.mode === "gitlab") {
    const add = STATUS_LABEL[status];
    const drop = Object.values(STATUS_LABEL).filter((l) => l !== add && seen.value.labels.includes(l));
    const relabel = (add && !seen.value.labels.includes(add)) || drop.length > 0;
    if (relabel || flip) {
      note(updateIssue(provider, num, {
        addLabels: add ? [add] : [], removeLabels: drop,
        ...(flip ? { state: wantClosed ? "closed" : "open" } : {}),
      }, opts), flip ? (wantClosed ? "close" : "reopen") : "label update");
    }
    if (cancelled && flip) note(commentOnIssue(provider, num, "Cancelled: dropped from the plan, not built.", opts), "cancel comment");
  } else {
    if (flip && cancelled) note(api(provider, "PATCH", `{project}/issues/${num}`, { ...opts, body: { state: "closed", state_reason: "not_planned" } }), "close");
    else if (flip) note(updateIssue(provider, num, { state: wantClosed ? "closed" : "open" }, opts), wantClosed ? "close" : "reopen");
    if (config.board) warnings.push(...boardStatus(provider, config, num, status, opts));
  }
  if (status === "blocked" && reason) note(commentOnIssue(provider, num, `Blocked: ${reason}`, opts), "blocked comment");
  return warnings;
}

/**
 * What the tracker says about one ticket, in the plan's words where it can:
 * `done` (closed), `blocked` or `in-progress` (an open GitLab issue carrying
 * that label), else `open`. Answers `{ ok, value: { state, labels, url } }`.
 */
export function trackerState(provider, num, opts = {}) {
  const seen = viewIssue(provider, num, opts);
  if (!seen.ok) return seen;
  const { state, labels, url } = seen.value;
  const word = state === "closed" ? "done" : Object.entries(STATUS_LABEL).find(([, l]) => labels.includes(l))?.[0] ?? "open";
  return { ok: true, value: { state: word, labels, url } };
}

/** Whether a tracker state and a plan status tell the same story. An open ticket agrees with any status but done. */
export const agrees = (trackerWord, planStatus) => (trackerWord === "done") === (planStatus === "done")
  && (trackerWord === "open" || trackerWord === "done" || trackerWord === planStatus);
