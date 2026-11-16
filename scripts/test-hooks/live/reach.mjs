// The reached-detector: what a session transcript shows about one skill. A
// skill is reached when the session invoked it through the Skill tool, or
// read its instructions by path, and the call succeeded: a call the host
// refused, a read that failed, and a call that never got its result are
// calls, not reaches.
//
// A skill is `{ plugin, skill }`, both matched, so a skill of the same name
// elsewhere is not this one. The plugins are becoming areas of one plugin
// (MERGED), and a skill a route of its area, under the same two names, so a
// row reads the same against a recording from either side of that:
//
//   plugins   Skill <plugin>:<skill>, or plugins/<plugin>/skills/<skill>/SKILL.md
//   areas     a route: plugins/<MERGED>/skills/<plugin>/routes/<skill>/ROUTE.md,
//             read by path, the only way a route is opened;
//             an area or the entry skill (skill and plugin the same name):
//             Skill <MERGED>:<plugin>, or its own SKILL.md
//
// Calling an area is not reaching one of its routes: the session has to open
// the route's document.
//
// The context lens reports what entered the context, not which tool calls the
// model made, so this reads the transcript's own entries. Pure: the caller
// reads the file.

/** The one plugin every plugin becomes an area of. */
export const MERGED = "agentcraft";

export function parseTranscript(text) {
  const entries = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  return entries;
}

const isBoundary = (e) => e.type === "system" && e.subtype === "compact_boundary";
const blocks = (e, type) => (Array.isArray(e.message?.content) ? e.message.content.filter((b) => b?.type === type) : []);
const attached = (e, type) => (e.type === "attachment" && e.attachment?.type === type ? e.attachment : null);

/** The skill a Skill address names: `<plugin>:<skill>`, an area or the entry skill as `<MERGED>:<name>`, or a bare name in no plugin. */
function ofAddress(address) {
  const [plugin, skill] = String(address ?? "").split(":");
  if (skill === undefined) return plugin ? { plugin: null, skill: plugin } : null;
  return plugin === MERGED ? { plugin: skill, skill } : { plugin, skill };
}

const ROUTE = new RegExp(`/plugins/${MERGED}/skills/([^/]+)/routes/([^/]+)/ROUTE\\.md$`);
const DOOR = new RegExp(`/plugins/${MERGED}/skills/([^/]+)/SKILL\\.md$`);
const IN_PLUGIN = /\/plugins\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/;
const ELSEWHERE = /\/skills\/([^/]+)\/SKILL\.md$/;

/** The skill a file path is the instructions of, or null for any other file. */
function ofPath(file) {
  const path = String(file ?? "");
  let hit = ROUTE.exec(path);
  if (hit) return { plugin: hit[1], skill: hit[2] };
  hit = DOOR.exec(path);
  if (hit) return { plugin: hit[1], skill: hit[1] };
  hit = IN_PLUGIN.exec(path);
  if (hit) return { plugin: hit[1], skill: hit[2] };
  hit = ELSEWHERE.exec(path);
  return hit ? { plugin: null, skill: hit[1] } : null;
}

const same = (a, b) => Boolean(a) && a.plugin === b.plugin && a.skill === b.skill;

/**
 * Every tool call the session made, in order, with whether it succeeded:
 * { name, input, ok, segment }. A segment ends at a compaction.
 */
export function calls(entries) {
  const failed = new Map();
  for (const e of entries) for (const r of e.type === "user" ? blocks(e, "tool_result") : []) failed.set(r.tool_use_id, Boolean(r.is_error));
  const out = [];
  let segment = 0;
  for (const e of entries) {
    if (isBoundary(e)) segment += 1;
    for (const b of e.type === "assistant" ? blocks(e, "tool_use") : []) out.push({ name: b.name, input: b.input ?? {}, ok: failed.get(b.id) === false, segment });
  }
  return out;
}

/** Every skill the session opened, in order: { plugin, skill, via: "skill" | "read", segment }. Calls that did not succeed are left out. */
export function reaches(entries) {
  const out = [];
  for (const c of calls(entries)) {
    if (!c.ok) continue;
    const opened = c.name === "Skill" ? ofAddress(c.input.skill) : c.name === "Read" ? ofPath(c.input.file_path) : null;
    if (opened) out.push({ ...opened, via: c.name === "Skill" ? "skill" : "read", segment: c.segment });
  }
  return out;
}

/** How the session first reached this skill ("skill" or "read"), or null. `where` narrows it to some segments. */
export function reached(entries, target, where = () => true) {
  return reaches(entries).find((r) => same(r, target) && where(r.segment))?.via ?? null;
}

/**
 * What the session's first skill listing held for the way in to this skill:
 * "described", "name" (the description was dropped), or "absent". The way in
 * is the skill's own entry where it has one (the plugins as they are today),
 * else its area's, `<MERGED>:<plugin>`: a route is never listed.
 */
export function listing(entries, target) {
  const content = entries.map((e) => attached(e, "skill_listing")).find(Boolean)?.content;
  const lines = String(content ?? "").split("\n");
  for (const address of [`${target.plugin}:${target.skill}`, `${MERGED}:${target.plugin}`]) {
    if (lines.includes(`- ${address}`)) return "name";
    if (lines.some((line) => line.startsWith(`- ${address}: `))) return "described";
  }
  return "absent";
}

/**
 * Each plugin's share of the session's first skill listing: `{ <plugin>:
 * { skills, described, characters } }`, plugins in order. `skills` is the
 * plugin's entries, `described` those that kept a description, `characters`
 * what they cost: each entry from its dash to the end of its description,
 * the line break between two entries not counted. A skill in no plugin is
 * nobody's share. Null when the transcript holds no listing.
 */
export function listingSizes(entries) {
  const content = entries.map((e) => attached(e, "skill_listing")).find(Boolean)?.content;
  if (content === undefined) return null;
  const sizes = {};
  let share = null; // of the entry a line belongs to: a description may run on
  for (const line of String(content).split("\n")) {
    const entry = /^- ([^:\s]+):[^:\s]+(: )?/.exec(line);
    if (entry) {
      share = sizes[entry[1]] ??= { skills: 0, described: 0, characters: 0 };
      share.skills += 1;
      if (entry[2]) share.described += 1;
    } else if (line.startsWith("- ")) share = null;
    if (share) share.characters += line.length + (entry ? 0 : 1);
  }
  return Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * A skill in use when the session compacted: `before` is how it was reached
 * before the compaction, `after` is how its instructions came back:
 * "reattached" (the host re-attached the invoked skill), "restored" (the host
 * restored the file the session had read), "read" (the session opened it
 * again), or null. Lost when it is null.
 */
export function acrossCompaction(entries, target) {
  let segment = 0;
  let reattached = false;
  let restored = false;
  for (const e of entries) {
    if (isBoundary(e)) { segment += 1; continue; }
    if (segment === 0) continue;
    reattached ||= (attached(e, "invoked_skills")?.skills ?? []).some((s) => same(ofAddress(s.name), target));
    restored ||= same(ofPath(attached(e, "file")?.filename), target);
  }
  const again = reached(entries, target, (s) => s > 0);
  const after = reattached ? "reattached" : restored ? "restored" : again ? "read" : null;
  return { compacted: segment > 0, before: reached(entries, target, (s) => s === 0), after, kept: after !== null };
}

/** Every tool the session was given, inline or deferred, by name. Empty when the transcript recorded no tool list. */
export function offered(entries) {
  const names = new Set();
  for (const e of entries) {
    for (const tool of attached(e, "prompt_snapshot")?.tools ?? []) if (tool?.name) names.add(tool.name);
    for (const name of attached(e, "deferred_tools_delta")?.addedNames ?? []) names.add(name);
  }
  return [...names].sort();
}
