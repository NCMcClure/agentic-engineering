#!/usr/bin/env node
// Builds a project's Miro frames from its generators (miro.config.mjs, see project.mjs).
//
// Usage: node build.mjs [--config <miro.config.mjs>] [--published] [--relayout <frame,...>]
//
// For each view it writes, in the miro/ directory beside the config:
//   <frame>.svg         the whole frame, for a frame the board does not have yet
//                       (canvas_create_from_svg, then pull.mjs on the result)
//   <frame>.update.svg  only the items that changed since the last publish, with their
//                       board ids (canvas_update_from_svg); absent when nothing changed
//   <frame>.resize.svg  after the update, when the frame shrinks
// Off-board views get <frame>.svg only.
//
// The layout comes from the board (pull.mjs), so positions and routing set in Miro win
// over the generators' own. --relayout drops a frame's board layout (not its place) so
// the generator's geometry goes out instead: use it after improving a generator. After
// sending the update files, run with --published to record what the board now holds.
//
// Nothing is written while the project's check reports a problem, or while the
// legibility lint (lint.mjs) finds one in what is about to be published: an item that
// changed, or any item of a new, relaid, or off-board frame. Findings that rest on a
// route the predictor is known to miss (est), and ones on untouched items, are warnings;
// live.mjs settles those. On a view marked strict in the config, every finding blocks,
// estimated or not, touched or not, and the lint's direction check runs.
// Exit 1 when nothing was written.

import { rmSync } from "node:fs";
import path from "node:path";
import { applyLayout, fingerprint, frameSvg, sceneFrame, sceneItems } from "./miro.mjs";
import { lint, predictedModel, report } from "./lint.mjs";
import { flag, list, loadProject } from "./project.mjs";

// process.exitCode rather than process.exit: exiting while stdout or stderr is still
// draining into a pipe crashes Node 24 on macOS, and a refusal then reads as a crash.
async function main() {
  const argv = process.argv;
  const P = await loadProject(argv);
  const scenes = {};
  for (const v of P.views) scenes[v.key] = await P.scene(v);

  if (P.check) {
    const problems = await P.check(scenes);
    if (problems?.length) {
      for (const p of problems) console.error(p);
      console.error(`${problems.length} problem(s) from ${path.basename(P.file)}'s check; nothing written`);
      return 1;
    }
  }

  const { board } = P;
  const published = P.read("published.json", {});
  const marking = flag(argv, "--published");
  const relayout = new Set(list(argv, "--relayout"));
  const nextPublished = {};
  const layoutOf = (key) => P.read(`${key}.layout.json`, null);

  // A grid frame the board has not placed yet takes the next grid slot: columns as wide as
  // the widest grid frame, rows below the grid frames already there, wherever they are.
  const slots = {};
  {
    const grid = P.views.filter((v) => v.grid).map((v) => ({ key: v.key, placed: layoutOf(v.key)?.frame, f: sceneFrame(sceneItems(scenes[v.key], v.key)) }));
    const G = P.grid;
    const colW = Math.max(0, ...grid.map((m) => (m.placed ?? m.f).width)) + G.gap;
    let y = G.y;
    for (let i = 0; i < grid.length; i += G.cols) {
      const row = grid.slice(i, i + G.cols);
      row.forEach((m, j) => (slots[m.key] = m.placed ?? { ...m.f, x: G.x + j * colW, y }));
      y = Math.max(...row.map((m) => slots[m.key].y + slots[m.key].height)) + G.gap;
    }
  }

  // Each view's items and frame as they would go out, and what changed since the board.
  const plans = P.views.map((v) => {
    const layout = layoutOf(v.key);
    const fresh = relayout.has(v.key);
    const items = applyLayout(sceneItems(scenes[v.key], v.key), fresh ? {} : layout?.items);
    const own = sceneFrame(items);
    const frame = layout?.frame ? (fresh ? { ...layout.frame, width: own.width, height: own.height } : layout.frame) : (slots[v.key] ?? own);
    const frameKey = `${v.key}-frame`;
    const isNew = !board.frames[v.key];
    const prints = Object.fromEntries(items.map((it) => [it.key, fingerprint(it)]));
    prints[frameKey] = fingerprint({ tag: "frame", attrs: frame });
    const changed = new Set(Object.keys(prints).filter((k) => published[k] !== prints[k] && k !== frameKey));
    // Miro resolves a connector's ends only among the items in the same document, so
    // both ends of a changed connector go along (unchanged, they update nothing).
    const sent = new Set(changed);
    for (const it of items) if (it.refs && changed.has(it.key)) { sent.add(it.refs.start); sent.add(it.refs.end); }
    return { v, items, frame, frameKey, isNew, fresh, prints, changed, sent };
  });

  // The legibility lint over everything on the board, as it would be after this publish,
  // and over each off-board view on its own: it is not on the board, so it has no place
  // among the board's frames, but its svg is written whole every build.
  const onBoard = plans.filter((p) => !p.v.offBoard);
  const keys = plans.map((p) => p.v.key);
  const strict = plans.filter((p) => p.v.strict).map((p) => p.v.key);
  const model = (ps) => predictedModel(ps.map((p) => ({ key: p.v.key, frame: p.frame, items: p.items })));
  const findings = [onBoard, ...plans.filter((p) => p.v.offBoard).map((p) => [p])].flatMap((ps) => lint(model(ps), { strict }));
  const planOf = (f) => plans.find((x) => x.v.key === f.frame);
  const touched = (f) => { const p = planOf(f); return p && (p.v.offBoard || p.isNew || p.fresh || f.ids.some((id) => p.changed.has(id))); };
  const errors = findings.filter((f) => f.blocking && (strict.includes(f.frame) || touched(f)));
  const warnings = findings.filter((f) => !errors.includes(f));
  // Warnings on frames this build publishes are listed; the rest are counted, since an
  // untouched frame's predicted routes were already settled on the live board.
  const live = (f) => { const p = planOf(f); return p && (p.v.offBoard || p.changed.size || p.isNew || p.fresh); };
  const shown = warnings.filter(live);
  if (shown.length) console.log(`legibility warnings (predicted routes, or items this build does not touch):\n${report(shown, keys, { verbose: true })}`);
  if (warnings.length > shown.length) console.log(`${warnings.length - shown.length} legibility warning(s) on frames this build leaves alone (live.mjs check settles them on the board)`);
  if (errors.length && !marking) {
    console.error(report(errors, keys, { verbose: true }));
    console.error(`${errors.length} legibility problem(s) in what would be published; nothing written`);
    return 1;
  }

  for (const { v, items, frame, frameKey, isNew, prints, changed, sent } of plans) {
    P.write(`${v.key}.svg`, frameSvg({ key: frameKey, title: v.title, frame, items }).svg);
    if (v.offBoard) { console.log(`${v.key}: ${items.length} items, kept off the board (${v.key}.svg)`); continue; }
    if (isNew) { console.log(`${v.key}: ${items.length} items, a new frame: publish ${v.key}.svg with canvas_create_from_svg, then pull the result`); continue; }
    const ids = { ...board.ids, [frameKey]: board.frames[v.key].id };
    const unplaced = items.filter((it) => !board.ids[it.key]).map((it) => it.key);
    const updateFile = `${v.key}.update.svg`;
    // Miro sizes the frame before it moves the children, and refuses a frame smaller than
    // where they still are: a shrinking frame goes out at its old size, then on its own.
    const was = layoutOf(v.key)?.frame;
    const shrinks = was && (frame.width < was.width || frame.height < was.height);
    const resizeFile = `${v.key}.resize.svg`;
    rmSync(path.join(P.out, resizeFile), { force: true });
    if (changed.size || published[frameKey] !== prints[frameKey]) {
      const outer = shrinks ? { ...frame, width: Math.max(frame.width, was.width), height: Math.max(frame.height, was.height) } : frame;
      P.write(updateFile, frameSvg({ key: frameKey, title: v.title, frame: outer, items, ids, only: sent }).svg);
      if (shrinks) P.write(resizeFile, frameSvg({ key: frameKey, title: v.title, frame, items, ids, only: new Set() }).svg);
      console.log(`${v.key}: ${changed.size} of ${items.length} items to publish (${updateFile}${shrinks ? `, then ${resizeFile}` : ""})${unplaced.length ? `; new on the board: ${unplaced.join(", ")}` : ""}`);
    } else {
      rmSync(path.join(P.out, updateFile), { force: true });
      console.log(`${v.key}: ${items.length} items, board up to date`);
    }
    Object.assign(nextPublished, prints);
  }

  if (marking) {
    P.write("published.json", JSON.stringify(nextPublished, null, 2) + "\n");
    console.log("recorded the board as published; feed the update result to pull.mjs so new items get their board ids");
  }
  return 0;
}

process.exitCode = await main();
