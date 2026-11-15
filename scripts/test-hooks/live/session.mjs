// The live lane's side effects: fixture repos, headless Claude Code sessions,
// and the lens run over their transcripts. Everything here spends model quota
// or touches the disk; the pure reading of the result is measure.mjs.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { AREA_PLUGIN } from "../../lib.mjs";
import { KINDS, REPO, makeFixture } from "../fixtures.mjs";
import { parseTranscript } from "./reach.mjs";

export { REPO, makeFixture };
// The one plugin, loaded from the checkout. A stub beside it is never loaded:
// it ships nothing a session would see, and its dependency is the plugin itself.
export const PLUGIN = AREA_PLUGIN;
const PLUGIN_DIR = path.join(REPO, "plugins", PLUGIN);
// The lens is the one the context-doctor area ships, so the lane reads
// transcripts exactly as a person asking for the route does.
const LENS = path.join(PLUGIN_DIR, "skills", "context-doctor", "scripts", "context-lens.mjs");
export const MARKETPLACE = "agentic-engineering";

export const MODEL = "haiku";
export const BUDGET_USD = "0.50"; // per claude -p call; three calls per fixture
// A plugin's agent is named by the plugin, whichever area dispatches it.
export const SUBAGENTS = ["general-purpose", "Explore", `${PLUGIN}:vision-critic`];
export const FIXTURES = KINDS;

// The skill listing gets 1% of the model's context window, so a trigger
// prompt is sent at two: the login's default for MODEL (where nearly every
// description fits when that is 1M) and 200k (where a plugin's skills are
// listed by name, with no description). A window is the environment added to
// the child's; the size the session really had is read from its result.
export const WINDOWS = { default: {}, "200k": { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" } };

// A skill session may open any skill, and the prompts ask for work with side
// effects (ship it, merge it, scaffold a repo, draw on the Miro board), so it
// is given the two tools a skill is reached through and two that only read,
// and nothing else exists for it to call:
//   --tools              the built-in tools, by name; every other one is gone
//   --strict-mcp-config  with no --mcp-config: no MCP server loads, neither the
//                        login's connectors nor a plugin's own
//   --disallowedTools    the plugin's mod (the agent-works area's board) registers
//                        its tools without an MCP config, so they are denied
//                        by name (NO_MCP)
// checks/triggers.mjs fails a session whose transcript shows it was offered
// any other tool.
export const SKILL_TOOLS = ["Skill", "Read", "Glob", "Grep"];
// The host names a mod's tools by the plugin that loads it.
export const NO_MCP = ["--strict-mcp-config", "--disallowedTools", `mcp__${PLUGIN}`];
// Eight turns hold a look around the repo, a skill, and a step past it; a
// session costs about a cent, so five is a runaway.
export const SKILL_SESSION_ARGS = ["--tools", SKILL_TOOLS.join(","), ...NO_MCP,
  "--allowedTools", "Skill Read", "--max-turns", "8", "--max-budget-usd", "0.05"];

/**
 * The environment a child session gets: the login's, never the host's. A
 * session started from inside Claude Code (the desktop app, another agent)
 * carries CLAUDE_CODE_* and ANTHROPIC_BASE_URL meant for that host, which
 * change the child's tools and endpoint. The keychain login needs only HOME.
 */
export function childEnv(env = process.env) {
  const keep = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM"];
  return Object.fromEntries(keep.filter((k) => env[k]).map((k) => [k, env[k]]));
}

/**
 * One headless call, the prompt on stdin: a positional prompt after --resume
 * is not read as one. `--plugin-dir` loads the one plugin for that session
 * only, from the checkout, with no install; `--setting-sources project`
 * keeps the person's own plugins and CLAUDE.md out. Every area is in that
 * plugin, so no hook asks which of its siblings are enabled, and a fixture
 * declares nothing in its settings.
 */
const BASE = ["-p", "--model", MODEL, "--setting-sources", "project", "--plugin-dir", PLUGIN_DIR];

function claude(cwd, prompt, args = []) {
  const r = spawnSync("claude", [...BASE, "--output-format", "json", "--max-budget-usd", BUDGET_USD, ...args],
    { cwd, env: childEnv(), input: prompt, encoding: "utf8", timeout: 300_000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* fall through */ }
  if (!out) throw new Error(`claude -p failed in ${cwd}: ${r.stderr || r.stdout || r.error}`);
  // Running out of turns is not a failed session: a hook's note can send the
  // model off to do what it says, and the transcript the lane reads is complete
  // either way.
  if (out.is_error && out.subtype !== "error_max_turns") throw new Error(`claude -p returned an error in ${cwd}: ${out.result ?? out.subtype ?? JSON.stringify(out).slice(0, 400)}`);
  return out;
}

/** The scripted session: one prompt, a forced compaction, then one prompt that starts each subagent type. */
export function runSession(cwd) {
  const first = claude(cwd, "Reply with one short line: what does README.md say this repo is?", ["--max-turns", "3"]);
  const id = first.session_id;
  const compact = claude(cwd, "/compact", ["--resume", id]);
  const agents = SUBAGENTS.map((t) => `one of subagent_type "${t}"`).join(", ");
  const third = claude(cwd, `Start ${SUBAGENTS.length} subagents in parallel with the Agent tool: ${agents}. Tell each to reply with only the word done and to use no tools. Then reply done.`,
    ["--resume", id, "--max-turns", "5", "--allowedTools", "Agent"]);
  const cost = [first, compact, third].reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0);
  return { id, cost };
}

/**
 * One process, several prompts, each sent when the one before it has its
 * result. Sent all at once, a later prompt is folded into the running turn.
 * Resolves with every result the process gave, however it ended: fewer than
 * the prompts when it failed, and the last one says why a session stopped.
 */
function converse(cwd, prompts, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn("claude", [...BASE, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", ...args],
      { cwd, env: { ...childEnv(), ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const queue = [...prompts];
    const results = [];
    let stderr = "";
    const send = () => child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: queue.shift() } })}\n`);
    const timer = setTimeout(() => child.kill(), 300_000);
    const done = () => { clearTimeout(timer); resolve({ results, stderr }); };
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let event = null;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type !== "result") return;
      results.push(event);
      if (queue.length && !event.is_error) send(); else child.stdin.end();
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => { /* the child went away first; close reports it */ });
    child.on("error", (error) => { stderr += error.message; done(); });
    child.on("close", done);
    send();
  });
}

/** Run async jobs at most `limit` at a time; the results come back in the jobs' order. */
export async function pool(limit, jobs) {
  const out = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next;
      next += 1;
      out[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

/**
 * One trigger prompt as its own session at one context window. Never throws:
 * `result` is the session's result payload, null when the process gave none,
 * and measure.mjs stopOf reads why it stopped.
 */
export async function runTrigger(cwd, prompt, window) {
  const { results } = await converse(cwd, [prompt], SKILL_SESSION_ARGS, WINDOWS[window]);
  const result = results.at(-1) ?? null;
  return { id: result?.session_id ?? null, cost: result?.total_cost_usd ?? 0, result };
}

/**
 * The skill-compaction check's session: work inside a skill, compact, carry
 * on, in one process. The host re-attaches an invoked skill, and restores a
 * file the session read, only in the process that did it; a --resume starts
 * without either, so three calls the way runSession makes them would report
 * every skill lost. Throws unless every prompt had a clean result.
 */
export async function runSkillSession(cwd, { before, after }) {
  const prompts = [before, "/compact", after];
  const { results, stderr } = await converse(cwd, prompts, SKILL_SESSION_ARGS);
  const failed = results.find((r) => r.is_error);
  if (failed || results.length < prompts.length) {
    throw new Error(`the skill session stopped after ${results.length} of ${prompts.length} prompts: ${failed?.result ?? failed?.subtype ?? (stderr.trim() || "no result")}`);
  }
  return { id: results.at(-1).session_id, cost: results.at(-1).total_cost_usd ?? 0 }; // the process's running total
}

/** A session's transcript entries, read where Claude Code wrote them, before collect() moves them out. Null when there is none. */
export function sessionEntries(cwd, id) {
  try {
    return parseTranscript(fs.readFileSync(path.join(projectFolder(path.join(os.homedir(), ".claude"), cwd), `${id}.jsonl`), "utf8"));
  } catch { return null; }
}

/** Claude Code files a session's transcript under its cwd with every non-alphanumeric character dashed. */
export const projectFolder = (claudeDir, cwd) => path.join(claudeDir, "projects", fs.realpathSync(cwd).replace(/[^A-Za-z0-9]/g, "-"));

/** Move a session's transcripts out of the person's ~/.claude into the lane's own lens directory. */
export function collect(cwd, lensDir) {
  const from = projectFolder(path.join(os.homedir(), ".claude"), cwd);
  const to = path.join(lensDir, "projects", path.basename(from));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
  return to;
}

/**
 * A lens directory that attributes hooks to this checkout's plugins: the lens
 * indexes each known marketplace's catalog at its install location, and a
 * --plugin-dir load leaves no cache copy to index.
 */
export function makeLensDir(root) {
  const dir = path.join(root, "lens");
  fs.mkdirSync(path.join(dir, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugins", "known_marketplaces.json"), `${JSON.stringify({ [MARKETPLACE]: { installLocation: REPO } })}\n`);
  return dir;
}

/** The lens's JSON report for one transcript. */
export function lens(file, lensDir) {
  const out = execFileSync(process.execPath, [LENS, "report", file, "--json", "--claude-dir", lensDir, "--focus", MARKETPLACE], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out);
}

/** The main transcript's report and each subagent's, keyed by agent type. */
export function readTranscripts(folder, id, lensDir) {
  const main = lens(path.join(folder, `${id}.jsonl`), lensDir);
  const subDir = path.join(folder, id, "subagents");
  const subagents = [];
  for (const name of fs.existsSync(subDir) ? fs.readdirSync(subDir).filter((n) => n.endsWith(".jsonl")) : []) {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(subDir, name.replace(/\.jsonl$/, ".meta.json")), "utf8")); } catch { /* no meta */ }
    subagents.push({ agentType: meta.agentType ?? null, report: lens(path.join(subDir, name), lensDir) });
  }
  return { main, subagents };
}

export function claudeVersion() {
  return execFileSync("claude", ["--version"], { env: childEnv(), encoding: "utf8" }).trim().split(" ")[0];
}

export const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "live-lane-"));
