// What each thing the pane does asks of the board CLI: the arguments after
// `aw board`, and nothing else. The pane never writes a card or board.json
// itself: the CLI takes the board's lock for every write, so the pane, an
// agent's tool call and a person's shell never mint the same card id or
// overwrite each other's change. Pure: host.mjs runs what these return.
//
// A flag's value rides in the same word as its name (`--details=...`), so a
// value that begins with a dash is still a value.

const opt = (name, value) => (value === undefined || value === null ? [] : [`--${name}=${value}`]);
const csv = (name, value) => (value === undefined ? [] : [`--${name}=${value.join(",")}`]);

/** Every board action the pane and its tools run, by the name actions.mjs and tools.mjs call it. */
export const BOARD = {
  // ---- reads ----
  read: () => ["list", "--all", "--json"],
  config: () => ["config", "--json"],
  list: ({ scope, kind } = {}) => ["list", ...opt("scope", scope), ...opt("kind", kind)],
  remoteStatus: () => ["remote", "status", "--json"],

  // ---- cards ----
  add: ({ title, status, suggest, details, kind, priority, labels, skills, files, epic, sprint, source = "user" }) => [
    "add", title, ...(suggest ? ["--suggest"] : opt("status", status)), ...opt("details", details), ...opt("kind", kind), ...opt("priority", priority),
    ...csv("labels", labels), ...csv("skills", skills), ...csv("files", files), ...opt("epic", epic), ...opt("sprint", sprint), ...opt("source", source),
  ],
  epic: ({ title, details, source = "user" }) => ["epic", title, ...opt("details", details), ...opt("source", source)],
  edit: ({ id, title, details, kind, priority, labels, skills, owner, ref, needs, epic, sprint }) => [
    "edit", id, ...opt("title", title), ...opt("details", details), ...opt("kind", kind), ...opt("priority", priority), ...csv("labels", labels),
    ...csv("skills", skills), ...opt("owner", owner), ...opt("ref", ref), ...opt("needs", needs), ...opt("epic", epic), ...opt("sprint", sprint),
  ],
  note: ({ id, text }) => ["note", id, text],
  move: ({ id, to, index, mr }) => ["move", id, to, ...opt("index", index), ...opt("mr", mr)],
  reorder: ({ id, index }) => ["reorder", id, String(index)],
  plan: ({ id, epic, sprint }) => ["plan", id, ...opt("epic", epic), ...opt("sprint", sprint)],

  // ---- gates ----
  owe: ({ title, ref, needs, owner, details, source = "user" }) => [
    "owe", title, ...opt("ref", ref), ...opt("needs", needs), ...opt("owner", owner), ...opt("details", details), ...opt("source", source),
  ],
  settle: ({ id, evidence }) => ["settle", id, ...opt("evidence", evidence)],

  // ---- sprints ----
  sprintNew: ({ title, goal, end }) => ["sprint", "new", title, ...opt("goal", goal), ...opt("end", end)],
  sprintStart: ({ id } = {}) => ["sprint", "start", ...(id ? [id] : [])],
  sprintClose: ({ id } = {}) => ["sprint", "close", ...(id ? [id] : [])],
  sprintEdit: ({ id, title, goal, start, end }) => ["sprint", "edit", id, ...opt("title", title), ...opt("goal", goal), ...opt("start", start), ...opt("end", end)],

  // ---- the board's own settings ----
  startMode: ({ mode }) => ["config", ...opt("start-mode", mode)],
  remoteOn: () => ["remote", "on"],
  remoteOff: () => ["remote", "off"],
  remoteSync: () => ["remote", "sync"],
};
