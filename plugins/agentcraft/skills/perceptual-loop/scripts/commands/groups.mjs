// groups: list them, show one, resolve a selection, propose a smoke group.
// groups.json maps a group to globs over shot names; '!glob' excludes.
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { allShots, findRoot, hasSelection, loadConfig, loadGroups, matchGlobs, readJson, resolveShots, selected, selectionOf, SELECTION_FLAGS, shotPath } from "../lib/project.mjs";

const HELP = `usage: pl.mjs groups <list | show GROUP [--match GLOB] | resolve SELECTION | suggest-smoke --by KEY[,KEY]... [SELECTION]> [--json]

  list            the groups and how many shots each selects
  show GROUP      the shots of one group
  resolve         the shot names a selection means (names or globs, --shots a,b, --group, --match, --all)
  suggest-smoke   the fewest shots covering every value combination of shot.json meta keys; repeat --by
                  to cover several things independently (--by car,track --by weather)`;

/**
 * Greedy set cover: the fewest shots such that every value combination of every
 * dimension is seen once. With several dimensions a shot covers one element of
 * each, which is where greedy beats one shot per combination.
 */
export function suggestSmoke(metas, dimensions) {
  const covers = new Map();
  for (const [shot, meta] of Object.entries(metas)) {
    const elems = new Set();
    for (const dim of dimensions) {
      // a shot with none of the keys says nothing about this dimension
      if (dim.some((k) => k in meta)) elems.add(JSON.stringify([dim, dim.map((k) => meta[k] ?? null)]));
    }
    covers.set(shot, elems);
  }
  const todo = new Set([...covers.values()].flatMap((s) => [...s]));
  const total = todo.size, picked = [], why = {};
  const names = [...covers.keys()].sort();
  while (todo.size) {
    // most new elements first; the name breaks ties so the proposal is stable between runs
    let best = null, gain = -1;
    for (const s of names) {
      const g = [...covers.get(s)].filter((e) => todo.has(e)).length;
      if (g > gain) { best = s; gain = g; }
    }
    const gained = [...covers.get(best)].filter((e) => todo.has(e));
    picked.push(best);
    why[best] = gained.map((e) => { const [dim, vals] = JSON.parse(e); return dim.map((k, i) => `${k}=${vals[i]}`).join(", "); }).sort();
    for (const e of gained) todo.delete(e);
  }
  return { picked, why, total };
}

export async function run(argv) {
  const opts = parseArgs(argv, { ...SELECTION_FLAGS, by: { type: "string", multi: true }, json: { type: "bool" } });
  if (opts.help) { emit(null, false, HELP); return 0; }
  const [cmd, ...args] = opts._;
  const root = findRoot();
  const config = loadConfig(root);
  const sel = selectionOf({ ...opts, _: args });
  if (cmd === "list") {
    const have = allShots(root, config), groups = loadGroups(root);
    const doc = { shots: have.length, groups: Object.fromEntries(Object.entries(groups).map(([g, globs]) => [g, matchGlobs(have, globs).length])) };
    const width = Math.max(5, ...Object.keys(groups).map((g) => g.length));
    const lines = [...Object.entries(doc.groups).map(([g, n]) => `${g.padEnd(width)}  ${String(n).padStart(4)}  ${groups[g].join(" ")}`), `${"(all)".padEnd(width)}  ${String(have.length).padStart(4)}`];
    emit(doc, opts.json, lines.join("\n"));
  } else if (cmd === "show") {
    if (args.length !== 1) throw new PlError("groups show takes one group name");
    const shots = resolveShots({ group: args[0], match: opts.match }, root, config);
    emit({ group: args[0], shots }, opts.json, shots.join("\n"));
  } else if (cmd === "resolve") {
    const shots = selected(sel, root, config);
    emit({ shots }, opts.json, shots.join("\n"));
  } else if (cmd === "suggest-smoke") {
    if (!opts.by.length) throw new PlError("suggest-smoke needs --by KEY[,KEY] (repeatable)");
    const pool = hasSelection(sel) ? selected(sel, root, config) : allShots(root, config);
    if (!pool.length) throw new PlError("no shots yet: create some with pl.mjs new-shot");
    const metas = Object.fromEntries(pool.map((s) => [s, readJson(path.join(shotPath(s, root, config), "shot.json"), {})?.meta ?? {}]));
    const dims = opts.by.map((d) => d.split(",").filter(Boolean));
    const unknown = dims.flat().filter((k) => !Object.values(metas).some((m) => k in m));
    if (unknown.length) throw new PlError(`no shot has meta key: ${unknown.join(", ")}`);
    const { picked, why, total } = suggestSmoke(metas, dims);
    const width = Math.max(0, ...picked.map((s) => s.length));
    const lines = [`${picked.length} of ${pool.length} shots cover the ${total} combinations of ${opts.by.join(" + ")}:`,
      ...picked.map((s) => `  ${s.padEnd(width)}  ${why[s].join("; ")}`), "", "paste into groups.json:", `  "smoke": ${JSON.stringify(picked)}`];
    emit({ by: opts.by, combinations: total, of: pool.length, smoke: picked, covers: why }, opts.json, lines.join("\n"));
  } else throw new PlError(`groups wants list, show, resolve or suggest-smoke${cmd ? `, got '${cmd}'` : ""} (see --help)`);
  return 0;
}
