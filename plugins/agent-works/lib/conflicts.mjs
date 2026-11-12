// Which ready cards can start now, beside each other and beside the cards
// already in flight, and why the rest wait. The person sees this before any
// child starts, so every hold carries its reason.
//
// Two cards conflict when their predicted files overlap by path prefix
// (`src/` meets `src/index.mjs`, not `src-old/`). A repo's
// .agents/agent-works.json refines that, under `kanban.conflicts`:
//   rederived  generated files and the command that remakes them: ignored,
//              since the second branch to land regenerates rather than merges
//   merge      list-like files (catalogs, hubs, a README table): overlap only
//              warns, since both sides' entries are kept
//   shared     paths that always conflict, even where `merge` would warn. A `*`
//              segment stands for any directory a card works in: with
//              `plugins/*/CHANGELOG.md` shared, every card under `plugins/x/`
//              touches `plugins/x/CHANGELOG.md`, because every change to a
//              plugin bumps its version and adds a changelog line
// and at its top level, beside what the locks already read there:
//   resources  `{ "<name>": { paths, scope, long } }`: a card whose files touch
//              `paths` needs that lock; two cards needing one `long` lock do
//              not run together
//   lockOrder  the order locks are taken in, which orders a card's locks
// A card in review still holds its files and its slot: findings can send it
// back to work. A card that names no files cannot be checked, so it runs alone.
//
// Pure: the board and the config in, the proposal out.
import { ARCHIVED, BoardError, byPlace, findCard, ready, roleIds } from "./board.mjs";

const norm = (p) => String(p).trim().replace(/^(\.\/)+/, "").replace(/\/+$/, "");
const segs = (p) => norm(p).split("/").filter(Boolean);

/**
 * What the conflict check reads of the repo's config (`loadConfig`'s result, or the file's own JSON):
 * `{ shared, merge, rederived, resources, lockOrder }` with defaults filled; a bare `rederived` path has no command.
 */
export function conflictConfig(cfg = {}) {
  const rules = cfg?.kanban?.conflicts && typeof cfg.kanban.conflicts === "object" ? cfg.kanban.conflicts : {};
  const json = { ...rules, resources: cfg?.resources, lockOrder: cfg?.lockOrder };
  const paths = (list) => (Array.isArray(list) ? list.filter((p) => typeof p === "string" && norm(p)).map(norm) : []);
  const rederived = (Array.isArray(json.rederived) ? json.rederived : [])
    .map((r) => (typeof r === "string" ? { path: r, command: null } : { path: r?.path, command: r?.command ?? null }))
    .filter((r) => typeof r.path === "string" && norm(r.path))
    .map((r) => ({ path: norm(r.path), command: r.command }));
  const resources = {};
  for (const [name, r] of Object.entries(json.resources && typeof json.resources === "object" ? json.resources : {})) {
    resources[name] = { paths: paths(r?.paths), scope: r?.scope === "machine" ? "machine" : "project", long: r?.long === true };
  }
  return { shared: paths(json.shared), merge: paths(json.merge), rederived, resources, lockOrder: paths(json.lockOrder) };
}

/** True when `path` is `pattern` or lies under it; a `*` in the pattern matches one segment. */
function covers(pattern, path) {
  const p = segs(pattern);
  const q = segs(path);
  return p.length <= q.length && p.every((s, i) => s === "*" || s === q[i]);
}

/** Where two paths meet: the more specific one, or null when neither lies under the other. */
const meet = (a, b) => (covers(a, b) ? norm(b) : covers(b, a) ? norm(a) : null);

/** The concrete shared paths a `*` pattern makes a card touch, by the directory its files work in. */
function impliedShared(files, shared) {
  const out = new Set();
  for (const pattern of shared.filter((p) => p.includes("*"))) {
    const p = segs(pattern);
    const anchor = p.length - [...p].reverse().findIndex((s) => s === "*");
    for (const file of files) {
      const q = segs(file);
      // A file must lie inside the anchor directory; a directory given with its slash counts as inside itself.
      const inside = q.length > anchor || (q.length === anchor && /\/\s*$/.test(file));
      if (!inside || !p.slice(0, anchor).every((s, i) => s === "*" || s === q[i])) continue;
      out.add(p.map((s, i) => (i < anchor && s === "*" ? q[i] : s)).join("/"));
    }
  }
  return out;
}

const effective = (card, config) => (card.files ?? []).filter((f) => !config.rederived.some((r) => covers(r.path, f)));

/** What two cards' files do to each other: paths that hold (plain or shared) and merge paths that only warn. */
function clash(a, b, config) {
  const fa = effective(a, config);
  const fb = effective(b, config);
  const plain = new Set();
  const shared = new Set();
  const warn = new Set();
  for (const x of fa) {
    for (const y of fb) {
      const point = meet(x, y);
      if (!point) continue;
      if (config.shared.some((p) => covers(p, point))) shared.add(point);
      else if (config.rederived.some((r) => covers(r.path, point))) continue;
      else if (config.merge.some((p) => covers(p, point))) warn.add(point);
      else plain.add(point);
    }
  }
  const theirs = impliedShared(fb, config.shared);
  for (const s of impliedShared(fa, config.shared)) if (theirs.has(s)) shared.add(s);
  return { plain: [...plain].sort(), shared: [...shared].sort(), warn: [...warn].sort() };
}

/** The locks a card's files call for, in `lockOrder`, then by name. */
export function locksFor(card, config) {
  const rank = (r) => (config.lockOrder.includes(r) ? config.lockOrder.indexOf(r) : config.lockOrder.length);
  return Object.entries(config.resources)
    .filter(([, r]) => (card.files ?? []).some((f) => r.paths.some((p) => meet(f, p))))
    .map(([resource, r]) => ({ resource, scope: r.scope, long: r.long }))
    .sort((a, b) => rank(a.resource) - rank(b.resource) || a.resource.localeCompare(b.resource));
}

const isTask = (c) => c.kind !== "epic" && c.kind !== "gate";

/** Why a backlog card is not ready: its `needs`, a plan block, or an `after` card still open. */
function notReady(board, card) {
  const reasons = [];
  if (card.needs) reasons.push(`needs ${card.needs}`);
  if (card.blocked) reasons.push("blocked in the plan");
  const finished = new Set([ARCHIVED, ...roleIds(board, "done")]);
  for (const id of card.after ?? []) {
    const dep = board.cards.find((c) => c.id === id);
    if (!dep) reasons.push(`waits on ${id}, which is not on the board`);
    else if (!finished.has(dep.status)) reasons.push(`waits on ${id} (${dep.status})`);
  }
  return reasons;
}

/**
 * The proposal: `{ max, inFlight, run, held, warnings }`. `run` holds each card
 * that can start, with the locks it needs and the warnings it raised; `held`
 * each card that cannot, with every reason. `max` defaults to the board's
 * `parallel`; `ids` limits the candidates.
 */
export function propose(board, { config = conflictConfig(), max = board.parallel, ids } = {}) {
  const live = new Set([...roleIds(board, "start"), ...roleIds(board, "review")]);
  const inFlight = board.cards.filter((c) => isTask(c) && live.has(c.status)).sort(byPlace(board));
  const readyCards = ready(board);
  const backlog = board.columns[0].id;
  let candidates = [...readyCards, ...board.cards.filter((c) => c.status === backlog && isTask(c) && !readyCards.includes(c)).sort(byPlace(board))];
  const held = [];
  if (ids) {
    const picked = ids.map((id) => {
      const card = findCard(board, id);
      if (!card) throw new BoardError("usage", `no card with id "${id}" ({cli} list shows the ids)`);
      return card.id;
    });
    ids = picked;
    for (const c of board.cards.filter((x) => ids.includes(x.id) && !candidates.includes(x))) {
      held.push({ id: c.id, title: c.title, reasons: [isTask(c) ? `is ${c.status}, not in the backlog` : `is ${c.kind === "epic" ? "an epic" : "a gate"}, not a task`] });
    }
    candidates = candidates.filter((c) => ids.includes(c.id));
  }

  const run = [];
  const warnings = [];
  for (const c of candidates) {
    const reasons = readyCards.includes(c) ? [] : notReady(board, c);
    const raised = [];
    if (!reasons.length) {
      const mine = locksFor(c, config);
      for (const [other, where] of [...inFlight.map((o) => [o, "in flight"]), ...run.map((o) => [o, "proposed"])]) {
        const who = `${other.id} (${where})`;
        if (!c.files?.length) { reasons.push(`names no files, so it cannot run beside ${who}`); continue; }
        if (!other.files?.length) { reasons.push(`${who} names no files, so nothing runs beside it`); continue; }
        const { plain, shared, warn } = clash(c, other, config);
        if (plain.length) reasons.push(`overlaps ${who} on ${plain.join(", ")}`);
        if (shared.length) reasons.push(`meets ${who} on ${shared.join(", ")}, which always conflict`);
        for (const p of warn) raised.push(`${c.id} and ${other.id} both touch ${p}, a merge file: whichever lands second syncs and keeps both sides' entries.`);
        const theirs = new Set(locksFor(other, config).filter((l) => l.long).map((l) => l.resource));
        for (const l of mine.filter((x) => x.long && theirs.has(x.resource))) reasons.push(`shares the long-held lock ${l.resource} with ${who}`);
      }
      if (!reasons.length && inFlight.length + run.length >= max) reasons.push(`the parallel limit is ${max}, with ${inFlight.length} in flight`);
      if (!reasons.length) {
        run.push({ ...c, locks: mine, warnings: raised });
        warnings.push(...raised);
        continue;
      }
    }
    held.push({ id: c.id, title: c.title, reasons });
  }
  return {
    max,
    inFlight: inFlight.map((c) => ({ id: c.id, title: c.title, status: c.status, files: c.files ?? [], ...(c.session ? { session: c.session } : {}) })),
    run: run.map((c) => ({ id: c.id, title: c.title, files: c.files ?? [], locks: c.locks, warnings: c.warnings })),
    held,
    warnings,
  };
}
