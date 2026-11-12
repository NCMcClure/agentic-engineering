// A project's diagrams: its miro.config.mjs, the miro/ directory beside it, and its
// generators run in-process. Every CLI here finds the project the same way.
//
// miro.config.mjs default-exports:
//   board   the board's URL (https://miro.com/app/board/<id>=/)
//   views   [{ key, title, gen, args?, grid?, offBoard?, strict? }]: one per frame. key is
//           a word (letters, digits, _), gen a generator path relative to the config, grid
//           true for frames that take the next grid slot until the board places them,
//           strict true for a frame the generator lays out alone: every lint finding on
//           it blocks the build (see build.mjs)
//   grid    { x, y, cols, gap }: where grid frames go (default 0, 0, 3, 200)
//   check   optional path to a module whose default export takes { <key>: elements }
//           and returns a list of problems; the build refuses to write while any remain
// A generator default-exports generate(kit, ...args) and returns a scene (kit.createScene())
// or its element list. The kit is scene-kit.mjs's, plus systemMap(mapFile): the scene of a
// committed system map (scripts/system-map.mjs at the plugin root draws it).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generate as systemMap } from "../../../scripts/system-map.mjs";
import { kit as sceneKit } from "./scene-kit.mjs";

const kit = { ...sceneKit, systemMap: (mapFile) => systemMap(sceneKit, mapFile) };

const CANDIDATES = ["miro.config.mjs", "diagrams/miro.config.mjs"];

export function findConfig(argv = process.argv) {
  const i = argv.indexOf("--config");
  if (i >= 0) return path.resolve(argv[i + 1]);
  const hit = CANDIDATES.map((c) => path.resolve(c)).find(existsSync);
  if (!hit) throw new Error(`no miro.config.mjs in ${process.cwd()} or diagrams/; pass --config <path> or run init.mjs`);
  return hit;
}

export async function loadProject(argv = process.argv) {
  const file = findConfig(argv);
  const dir = path.dirname(file);
  const config = (await import(pathToFileURL(file).href)).default;
  if (!config?.views?.length) throw new Error(`${file}: export default { board, views: [...] }`);
  for (const v of config.views) {
    if (!/^\w+$/.test(v.key ?? "")) throw new Error(`${file}: view key "${v.key}" must be letters, digits, or _ (it prefixes every item key)`);
    if (!v.title || !v.gen) throw new Error(`${file}: view ${v.key} needs a title and a gen`);
  }
  const out = path.join(dir, "miro");
  mkdirSync(out, { recursive: true });
  const read = (f, fallback) => (existsSync(path.join(out, f)) ? JSON.parse(readFileSync(path.join(out, f), "utf8")) : fallback);
  const write = (f, s) => writeFileSync(path.join(out, f), s);
  const scene = async (v) => {
    const gen = (await import(pathToFileURL(path.resolve(dir, v.gen)).href)).default;
    if (typeof gen !== "function") throw new Error(`${v.gen}: default-export generate(kit, ...args)`);
    const s = await gen(kit, ...(v.args ?? []));
    const els = Array.isArray(s) ? s : s?.elements?.();
    if (!Array.isArray(els)) throw new Error(`${v.gen}: return a scene or its element list`);
    return els.filter((e) => !e.isDeleted);
  };
  const check = config.check ? (await import(pathToFileURL(path.resolve(dir, config.check)).href)).default : null;
  return {
    file, dir, out, read, write, scene, check, views: config.views,
    grid: { x: 0, y: 0, cols: 3, gap: 200, ...config.grid },
    board: read("board.json", { url: config.board ?? null, frames: {}, ids: {} }),
  };
}

export const flag = (argv, name) => argv.includes(name);
export const list = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1].split(",") : []);
