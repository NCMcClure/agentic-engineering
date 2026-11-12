// The pane's way to the board: the board CLI, run through the host. A mod has
// no Node of its own, so register.mjs hands every file here a `host`, the few
// calls on the engine the pane needs, spelled once there:
//
//   run(argv, init)   start a process: { exitCode, stdout, stderr }
//   root              the plugin's folder
//   cwd()             the session's working directory
//   exists(path), list(path)   the disk, read only
//
// The CLI is the board's one writer and its one reader of record: it knows
// where the board lives (the main checkout, the configured folder, the folder
// it had before), reads plan issues from the base branch, and takes the lock
// for a write. The only thing read past it is the board folder's listing, so
// a poll that finds nothing changed starts no process.
import { boardConfig } from "../../lib/board.mjs";
import { BOARD } from "./commands.mjs";

const READ_MS = 30_000;
const WRITE_MS = 60_000;
/** A pass against a tracker talks to the network through gh or glab. */
export const SYNC_MS = 300_000;

/** Run the board CLI from the session's directory: `{ code, out, err }`. */
export async function runBoard(host, args, { timeoutMs = WRITE_MS } = {}) {
  const r = await host.run(["node", `${host.root}/scripts/aw.mjs`, "board", ...args], { cwd: await host.cwd(), timeoutMs });
  return { code: r.exitCode, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** A run as the pane says it: `{ ok, text }`, the CLI's own words without its name in front. */
export function answer(r) {
  if (r.code === 0) return { ok: true, text: r.out.trim() || "Done." };
  const said = (r.err.trim() || r.out.trim()).replace(/^aw (board|kanban): /, "");
  return { ok: false, text: said || `the board CLI exited ${r.code}` };
}

function parsed(r, what) {
  if (r.code !== 0) throw new Error(answer(r).text);
  try { return JSON.parse(r.out); } catch { throw new Error(`the board CLI's ${what} was not JSON`); }
}

/**
 * The board as lib/board.mjs takes it, from two reads of the CLI: every card
 * (plan issues among them) and board.json's settings. `dir` is the folder,
 * `isOldFolder` says the cards are still where they were kept before
 * `.agents/kanban`, and `exists` is false until the first card is filed.
 */
export async function readBoard(host) {
  const listed = parsed(await runBoard(host, BOARD.read(), { timeoutMs: READ_MS }), "listing");
  const config = parsed(await runBoard(host, BOARD.config(), { timeoutMs: READ_MS }), "settings");
  const cards = Array.isArray(listed.cards) ? listed.cards : [];
  return { ...boardConfig(config), cards, dir: String(listed.dir ?? ""), isOldFolder: listed.oldFolder === true, exists: await host.exists(String(listed.dir ?? "")).catch(() => cards.length > 0) };
}

/** The board folder's files by name, size and time: equal twice running, nothing in it changed. "" while there is no folder. */
export async function signatureOf(host, dir) {
  if (!dir || !(await host.exists(dir))) return "";
  const files = (await host.list(dir)).filter((f) => f.kind === "file" && /\.(md|json)$/.test(f.name));
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return files.map((f) => `${f.name}:${f.size}:${f.mtimeMs}`).join("|") || "empty";
}
