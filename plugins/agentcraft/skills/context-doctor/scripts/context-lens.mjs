#!/usr/bin/env node
// Context Lens: what entered an agent's context window, when, and from which
// plugin, read from the Claude Code session transcripts on this machine.
//
// Usage:
//   node context-lens.mjs serve  [--port 4646] [--claude-dir <dir>] [--focus agentic-engineering]
//   node context-lens.mjs report [<transcript.jsonl | session id>] [--all] [--json] [--claude-dir <dir>] [--focus <marketplace>]
//   node context-lens.mjs list   [--limit 20] [--claude-dir <dir>]
//
// `report` with no session reads the newest transcript for the working
// directory, which is the running session when an agent calls it.
//
// The server binds 127.0.0.1, answers only to a loopback Host header, and
// serves no file outside <claude-dir>/projects: a transcript holds everything
// its session saw.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { defaultClaudeDir, loadSources } from "./sources.mjs";
import { renderReport } from "./report.mjs";
import { buildSession, parseJsonl, preview } from "./transcript.mjs";

const ASSETS = path.join(import.meta.dirname, "..", "assets");
const VALUED = new Set(["--port", "--claude-dir", "--focus", "--limit"]);
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1]; };
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !VALUED.has(all[i - 1]));
const claudeDir = path.resolve(flag("--claude-dir") ?? defaultClaudeDir());
const projectsDir = path.join(claudeDir, "projects");
const focus = flag("--focus", "agentic-engineering");

const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
const jsonl = (dir) => { try { return fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { return []; } };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

function slice(file, start, length) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fd, buffer, 0, length, start);
      return buffer.subarray(0, read).toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch { return ""; }
}

/** The session's starting directory from the head, its title from the tail, without parsing the whole file. */
function glance(file, size) {
  const rows = (text) => text.split("\n").flatMap((line) => { try { return line.startsWith("{") ? [JSON.parse(line)] : []; } catch { return []; } });
  const cwd = rows(slice(file, 0, Math.min(size, 64 * 1024))).find((e) => e.cwd)?.cwd ?? null;
  const tail = rows(slice(file, Math.max(0, size - 128 * 1024), Math.min(size, 128 * 1024))).reverse();
  const title = tail.find((e) => e.type === "custom-title")?.customTitle ?? tail.find((e) => e.type === "agent-name")?.agentName ?? null;
  const prompt = tail.find((e) => e.type === "last-prompt")?.lastPrompt;
  return { cwd, title: title ?? (prompt ? preview(prompt, 80) : null) };
}

function subagents(dir) {
  return jsonl(dir).map((name) => {
    const file = path.join(dir, name);
    const meta = readJson(file.replace(/\.jsonl$/, ".meta.json")) ?? {};
    let stat = null;
    try { stat = fs.statSync(file); } catch { return null; }
    return { file, id: name.slice(0, -6), agentType: meta.agentType ?? null, description: meta.description ?? null, mtimeMs: stat.mtimeMs, size: stat.size };
  }).filter(Boolean).sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export function listSessions(limit = 200) {
  const found = [];
  for (const project of dirs(projectsDir)) {
    for (const name of jsonl(path.join(projectsDir, project))) {
      const file = path.join(projectsDir, project, name);
      try { const stat = fs.statSync(file); found.push({ file, project, id: name.slice(0, -6), mtimeMs: stat.mtimeMs, size: stat.size }); } catch { /* raced a delete */ }
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, limit).map((s) => ({ ...s, ...glance(s.file, s.size), subagents: subagents(path.join(projectsDir, s.project, s.id, "subagents")) }));
}

let sources = null;
let sourcesAt = 0;
const currentSources = () => {
  // Plugins update during a session; a stale index misattributes their hooks.
  if (!sources || Date.now() - sourcesAt > 30_000) { sources = loadSources({ claudeDir, focus }); sourcesAt = Date.now(); }
  return sources;
};

const cache = new Map();
function readSession(file) {
  const stat = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.session;
  const { entries, bad } = parseJsonl(fs.readFileSync(file, "utf8"));
  const session = { ...buildSession(entries, { sources: currentSources() }), file, mtimeMs: stat.mtimeMs, badLines: bad };
  cache.set(file, { mtimeMs: stat.mtimeMs, session });
  return session;
}

/** A transcript path from a request, or null when it is anything but a .jsonl under the projects folder. */
function allowed(raw) {
  if (!raw || !String(raw).endsWith(".jsonl")) return null;
  try {
    const real = fs.realpathSync(raw);
    return real.startsWith(fs.realpathSync(projectsDir) + path.sep) ? real : null;
  } catch { return null; }
}

function serve(port) {
  const send = (res, status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    // A page on another origin could otherwise reach this server by DNS rebinding.
    const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) return send(res, 403, { error: "loopback only" });
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (url.pathname === "/") return send(res, 200, fs.readFileSync(path.join(ASSETS, "index.html"), "utf8"), "text/html; charset=utf-8");
      if (url.pathname === "/app.js") return send(res, 200, fs.readFileSync(path.join(ASSETS, "app.js"), "utf8"), "text/javascript; charset=utf-8");
      if (url.pathname === "/api/sessions") return send(res, 200, { focus, sessions: listSessions(Number(url.searchParams.get("limit")) || 200) });
      if (url.pathname === "/api/session" || url.pathname === "/api/stat") {
        const file = allowed(url.searchParams.get("file"));
        if (!file) return send(res, 403, { error: "not a transcript under the projects folder" });
        if (url.pathname === "/api/stat") return send(res, 200, { mtimeMs: fs.statSync(file).mtimeMs });
        return send(res, 200, readSession(file));
      }
      return send(res, 404, { error: "not found" });
    } catch (error) {
      return send(res, 500, { error: String(error?.message ?? error) });
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`Context Lens: http://127.0.0.1:${server.address().port}`));
}

/** The transcript to report on: a path, a session id, or the newest one for this directory or the nearest parent that has any. */
function resolveTarget(arg) {
  if (arg && fs.existsSync(arg)) return path.resolve(arg);
  if (arg) {
    for (const project of dirs(projectsDir)) {
      const file = path.join(projectsDir, project, `${arg}.jsonl`);
      if (fs.existsSync(file)) return file;
    }
    return null;
  }
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const folder = path.join(projectsDir, dir.replace(/[^A-Za-z0-9]/g, "-"));
    const newest = jsonl(folder).map((n) => path.join(folder, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (newest) return newest;
    if (path.dirname(dir) === dir) return null;
  }
}

function main() {
  const command = argv[0] ?? "serve";
  if (command === "serve") return serve(Number(flag("--port", "4646")));
  if (command === "list") {
    for (const s of listSessions(Number(flag("--limit", "20")))) {
      console.log(`${new Date(s.mtimeMs).toISOString().slice(0, 16)}  ${String(Math.round(s.size / 1024)).padStart(6)} KB  ${s.id}  ${s.title ?? ""}  (${s.cwd ?? s.project})`);
    }
    return;
  }
  if (command === "report") {
    const file = resolveTarget(positional[0]);
    if (!file) {
      console.error(`context-lens: no transcript found${positional[0] ? ` for ${positional[0]}` : ` for ${process.cwd()}`} under ${projectsDir}`);
      process.exitCode = 1;
      return;
    }
    const session = readSession(file);
    if (argv.includes("--json")) console.log(JSON.stringify(session));
    else process.stdout.write(`${renderReport(session, { all: argv.includes("--all") })}\n${file}\n`);
    return;
  }
  console.error("usage: context-lens.mjs serve [--port n] | report [session] [--all] [--json] | list [--limit n]");
  process.exitCode = 2;
}

main();
