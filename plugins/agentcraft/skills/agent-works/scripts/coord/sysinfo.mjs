#!/usr/bin/env node
// aw sys: what the machine is doing right now, beside what agents said they
// would use. Every probe is optional and time-limited: a missing tool, an
// unsupported platform or a slow answer yields "no reading", never an error.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { AwError, emit, ioOf, parseArgs, posix, readText, realPath, runMain, splitLines } from "../../lib/common.mjs";
import * as locks from "../locks.mjs";
import * as agents from "./agents.mjs";
import * as leases from "./leases.mjs";
import * as store from "./store.mjs";

const USAGE = `usage: aw sys [--json]
       aw sys --quiet-for timing [--gpu-under 10] [--cpu-under N] [--strict] [--wait S] [--interval S] [--as AGENT] [--json]

What the machine is doing right now, beside what agents said they would use.

  aw sys [--json]
        live readings (each GPU's utilisation and memory, and its processes, through nvidia-smi when present; CPU;
        memory; disk of the project's drive and of the home drive), then the leases, the locks held and the agents
        running, by project, then warnings: leases that add up to more than there is, a busy GPU nobody declared
  aw sys --quiet-for timing [--gpu-under 10] [--cpu-under N] [--strict] [--wait S] [--interval S]
        is the machine quiet enough to measure? Exit 0 when no other agent holds a GPU lease or a machine-wide lock
        and every GPU reads under the threshold (percent utilisation); else exit 1 with the reasons. --wait polls
        for up to S seconds. --strict counts every lease and lock of another agent.

Every probe is optional and time-limited: a missing tool, an unsupported platform or a probe slower than 3 s yields
"no reading", never an error. The last line of the text ("record:") is the one to keep beside a measurement.

Options:
  --quiet-for timing   answer whether the machine is quiet enough: exit 0 yes, 1 no
  --gpu-under P        GPU utilisation, in percent, that still counts as quiet (default 10)
  --cpu-under P        also require the CPU under this percentage
  --strict             count every lease and every lock of another agent, not only the GPU's and the machine's
  --wait S             poll for up to this many seconds until the machine is quiet
  --interval S         seconds between polls (default 5)
  --as AGENT           the agent's name: its own leases and locks do not count against quiet
  --json               print one JSON document with the same data`;

const PROBE_MS = 3000;
const GPU_BUSY = 50; // a GPU above this that nobody declared earns a warning
const MIB = 1024 * 1024;
const present = (v) => v !== null && v !== undefined;
const pct = (value) => (present(value) ? `${store.g(value)} %` : "?");

// --------------------------------------------------------------------------------------------------------- probes

/** A program's output, or null when it is missing, fails, or takes longer than `timeoutMs`. `[text, missing]`. */
export function probe(argv, { timeoutMs = PROBE_MS, env = process.env } = {}) {
  try {
    const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env });
    if (r.error) return [null, r.error.code === "ENOENT"];
    return [r.status === 0 ? r.stdout : null, false];
  } catch {
    return [null, false];
  }
}

const num = (cell) => {
  const text = String(cell).trim();
  const n = text ? Number(text) : NaN;
  return Number.isFinite(n) ? n : null; // "[N/A]", "[Insufficient Permissions]"
};

/** Rows of `nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu` (csv, no units). */
export function parseGpus(text) {
  const rows = [];
  for (const line of splitLines(text)) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length < 7 || num(cells[0]) === null) continue;
    const [used, total] = [num(cells[4]), num(cells[5])];
    rows.push({
      index: Math.trunc(num(cells[0])), uuid: cells[1], name: cells[2], util: num(cells[3]),
      memUsed: used === null ? null : Math.trunc(used * MIB), memTotal: total === null ? null : Math.trunc(total * MIB),
      temp: num(cells[6]), processes: [],
    });
  }
  return rows;
}

/** Rows of `nvidia-smi --query-compute-apps=pid,process_name,used_memory,gpu_uuid` (csv, no units). */
export function parseGpuProcesses(text) {
  const rows = [];
  for (const line of splitLines(text)) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length < 4 || num(cells[0]) === null) continue;
    const mem = num(cells.at(-2));
    const name = cells.slice(1, -2).join(",").trim();
    rows.push({ pid: Math.trunc(num(cells[0])), name: path.posix.basename(name.replaceAll("\\", "/")) || name, mem: mem === null ? null : Math.trunc(mem * MIB), uuid: cells.at(-1) });
  }
  return rows;
}

/** `[the GPUs with their processes, ""]`, or `[null, why there is no reading]`. */
export function gpus(env = process.env) {
  const [out, missing] = probe(["nvidia-smi", "--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], { env });
  if (missing) return [null, "no GPU reading (nvidia-smi is not on the path)"];
  if (out === null) return [null, "no GPU reading (nvidia-smi did not answer in time)"];
  const rows = parseGpus(out);
  if (!rows.length) return [null, "no GPU reading (nvidia-smi listed no GPU)"];
  const [apps] = probe(["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory,gpu_uuid", "--format=csv,noheader,nounits"], { env });
  for (const proc of parseGpuProcesses(apps ?? "")) {
    for (const gpu of rows) if (gpu.uuid === proc.uuid) gpu.processes.push({ pid: proc.pid, name: proc.name, mem: proc.mem });
  }
  return [rows, ""];
}

// [idle, total] processor time so far, over every processor.
function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return total > 0 ? [idle, total] : null;
}

/** `{ count, percent, load1 }`: processors, how busy they were over `sampleSeconds`, the one-minute load (null on Windows). */
export async function cpu(sampleSeconds = 0.25) {
  const out = { count: os.cpus().length || os.availableParallelism(), percent: null, load1: null };
  const a = cpuTimes();
  if (a) {
    await sleep(sampleSeconds * 1000);
    const b = cpuTimes();
    if (b && b[1] > a[1]) out.percent = Math.round(Math.max(0, Math.min(100, 100 * (1 - (b[0] - a[0]) / (b[1] - a[1])))) * 10) / 10;
  }
  if (process.platform !== "win32") out.load1 = Math.round(os.loadavg()[0] * 100) / 100;
  return out;
}

/** `{ total, available }` in bytes, or null. Available counts what the system would give up: Linux MemAvailable, macOS free and inactive pages. */
export function memory() {
  const total = os.totalmem();
  if (!(total > 0)) return null;
  const meminfo = process.platform === "linux" ? readText("/proc/meminfo") : null;
  const m = /^MemAvailable:\s+(\d+)/m.exec(meminfo ?? "");
  if (m) return { total, available: Number(m[1]) * 1024 };
  if (process.platform === "darwin") {
    const [stat] = probe(["vm_stat"]);
    const page = /page size of (\d+)/.exec(stat ?? "");
    if (page) {
      const pages = Object.fromEntries([...stat.matchAll(/Pages ([a-z ]+):\s+(\d+)/g)].map((x) => [x[1], Number(x[2])]));
      return { total, available: Math.min(total, ((pages.free ?? 0) + (pages.inactive ?? 0)) * Number(page[1])) };
    }
  }
  return { total, available: Math.min(total, os.freemem()) };
}

/** Free space where each `[label, path]` lives, as `{ mount, of, total, free }`; places on one drive are one row. */
export function disks(places) {
  const rows = [];
  for (const [label, place] of places) {
    try {
      let p = realPath(place);
      while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
      const usage = fs.statfsSync(p);
      const drive = process.platform === "win32" ? path.parse(p).root.replace(/[\\/]+$/, "").toUpperCase() : "";
      const key = drive || String(fs.statSync(p).dev);
      const same = rows.find((r) => r.key === key);
      if (same) same.of.push(label);
      else rows.push({ key, mount: drive || posix(p), of: [label], total: usage.blocks * usage.bsize, free: usage.bavail * usage.bsize });
    } catch { /* no reading for this place */ }
  }
  return rows.map(({ key: _key, ...row }) => row);
}

// ---------------------------------------------------------------------------------------------------- the picture

/** Everything `aw sys` shows as one document: the readings, the leases, the locks held, the agents, and the warnings. */
export async function collect(ctx, sampleSeconds = 0.25) {
  const [gpuRows, gpuNote] = gpus(ctx.env);
  const doc = {
    at: store.now(), project: ctx.project, gpus: gpuRows, gpuNote,
    cpu: await cpu(sampleSeconds), memory: memory(),
    disks: disks([["project", ctx.root], ["home", os.homedir()], ["store", ctx.home]]),
    leases: leases.live(ctx.home), locks: locks.allLocks(ctx.home).filter((r) => r.held), agents: agents.live(ctx.home, ctx.cfg),
  };
  const known = store.projects(ctx.home);
  const ids = new Set([ctx.project]);
  for (const key of ["leases", "locks", "agents"]) for (const r of doc[key]) if (r.project) ids.add(String(r.project));
  doc.projects = Object.fromEntries([...ids].sort().map((p) => [p, store.projectLabel(p, known)]));
  doc.totals = leases.totals(doc.leases);
  doc.warnings = warningsOf(doc);
  return doc;
}

const isGpu = (resource) => String(resource).toLowerCase().startsWith("gpu");

/** Over-subscription, and readings that contradict the declarations. Reported, never refused. */
export function warningsOf(doc) {
  const out = [];
  const names = doc.projects ?? {};
  const who = (rows) => rows.map((r) => `${r.agent} (${names[String(r.project)] ?? "?"})`).join(", ");
  const sum = (rows, key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0);
  const byResource = {};
  for (const r of doc.leases) (byResource[String(r.resource)] ??= []).push(r);
  for (const name of Object.keys(byResource).sort()) {
    const share = sum(byResource[name], "share");
    if (share > 1 + 1e-9) out.push(`${name} is over-subscribed: the leases add up to a share of ${store.g(share)} (${who(byResource[name])})`);
  }
  const gpuTotal = (doc.gpus ?? []).reduce((n, gpu) => n + (gpu.memTotal || 0), 0);
  const gpuLeases = doc.leases.filter((r) => isGpu(r.resource) && r.mem);
  if (gpuTotal && sum(gpuLeases, "mem") > gpuTotal) {
    out.push(`GPU memory is over-subscribed: leases for ${leases.fmtBytes(sum(gpuLeases, "mem"))} on ${leases.fmtBytes(gpuTotal)} (${who(gpuLeases)})`);
  }
  const ramLeases = doc.leases.filter((r) => !isGpu(r.resource) && r.mem);
  const total = doc.memory?.total;
  if (total && sum(ramLeases, "mem") > total) {
    out.push(`memory is over-subscribed: leases for ${leases.fmtBytes(sum(ramLeases, "mem"))} on ${leases.fmtBytes(total)} (${who(ramLeases)})`);
  }
  const cpuLeases = doc.leases.filter((r) => r.cpu);
  const count = doc.cpu?.count;
  if (count && sum(cpuLeases, "cpu") > count) out.push(`processors are over-subscribed: leases for ${store.g(sum(cpuLeases, "cpu"))} of ${count} (${who(cpuLeases)})`);
  const declared = [...doc.leases, ...doc.locks].some((r) => isGpu(r.resource));
  for (const gpu of doc.gpus ?? []) {
    if (present(gpu.util) && gpu.util >= GPU_BUSY && !declared) {
      out.push(`GPU ${gpu.index} reads ${store.g(gpu.util)} % and nobody has declared it: an undeclared run, or the owner's own work`);
    }
  }
  return out;
}

/** One line to keep beside a measurement. */
export function recordLine(doc) {
  const parts = [doc.at];
  if (doc.gpus?.length) {
    for (const gpu of doc.gpus) {
      parts.push(`gpu${gpu.index} ${pct(gpu.util)}${gpu.memTotal ? ` ${leases.fmtBytes(gpu.memUsed)}/${leases.fmtBytes(gpu.memTotal)}` : ""}`);
    }
  } else {
    parts.push("gpu: no reading");
  }
  const c = doc.cpu ?? {};
  const m = doc.memory;
  parts.push(present(c.percent) ? `cpu ${pct(c.percent)}` : present(c.load1) ? `load ${store.g(c.load1)}` : "cpu: no reading");
  if (m?.total) parts.push(`mem ${(100 * (1 - m.available / m.total)).toFixed(0)} %`);
  parts.push(`leases ${doc.leases.length}`, `locks ${doc.locks.length}`, `agents ${doc.agents.length}`);
  return parts.join("; ");
}

function textOf(doc, ctx) {
  const names = doc.projects;
  const lines = [`machine at ${doc.at}`];
  if (doc.gpus?.length) {
    for (const gpu of doc.gpus) {
      const mem = gpu.memTotal ? `${leases.fmtBytes(gpu.memUsed)} of ${leases.fmtBytes(gpu.memTotal)}` : "memory ?";
      lines.push(`  gpu ${gpu.index}   ${pct(gpu.util)} busy, ${mem}${present(gpu.temp) ? `, ${store.g(gpu.temp)} C` : ""}  (${gpu.name})`);
      const sized = gpu.processes.filter((p) => present(p.mem)).sort((a, b) => b.mem - a.mem).slice(0, 8);
      for (const p of sized) lines.push(`           pid ${p.pid}  ${leases.fmtBytes(p.mem)}  ${p.name}`);
      const rest = gpu.processes.length - sized.length;
      if (rest) {
        lines.push(`           ${rest} ${sized.length ? "more " : ""}process${rest === 1 ? "" : "es"} on it${sized.length ? "" : " (this platform does not report memory per process)"}`);
      }
    }
  } else {
    lines.push(`  gpu     ${doc.gpuNote || "no GPU reading"}`);
  }
  const c = doc.cpu ?? {};
  if (present(c.percent)) lines.push(`  cpu     ${store.g(c.percent)} % busy of ${c.count || "?"} processors${present(c.load1) ? `, load ${store.g(c.load1)}` : ""}`);
  else if (present(c.load1)) lines.push(`  cpu     load ${store.g(c.load1)} on ${c.count || "?"} processors`);
  else lines.push("  cpu     no reading");
  const m = doc.memory;
  if (m?.total) {
    const used = m.total - m.available;
    lines.push(`  memory  ${leases.fmtBytes(used)} of ${leases.fmtBytes(m.total)} in use (${(100 * used / m.total).toFixed(0)} %)`);
  } else {
    lines.push("  memory  no reading");
  }
  for (const d of doc.disks ?? []) lines.push(`  disk    ${d.mount}  ${leases.fmtBytes(d.free)} free of ${leases.fmtBytes(d.total)}  (${d.of.join(", ")})`);
  if (!doc.disks?.length) lines.push("  disk    no reading");

  lines.push(`leases${doc.leases.length ? "" : ": none"}`);
  const known = Object.fromEntries(Object.entries(names).map(([p, name]) => [p, { name }]));
  const key = (r) => `${r.resource}\n${r.since}`;
  for (const r of [...doc.leases].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) lines.push(`  ${leases.describe(r, known)}`);
  for (const [name, t] of Object.entries(doc.totals)) if (t.count > 1) lines.push(`  = ${leases.totalLine(name, t)}`);
  lines.push(`locks${doc.locks.length ? "" : ": none"}`);
  for (const r of doc.locks) {
    const where = r.scope === store.MACHINE ? "machine" : names[String(r.scope)] ?? String(r.scope);
    const holder = `${r.agent}${r.scope === store.MACHINE ? ` (${names[String(r.project)] ?? "?"})` : ""}`;
    lines.push(`  ${r.resource} [${where}]  ${holder}  for ${store.g(r.heldMinutes ?? 0)} min: "${r.for || "?"}"`);
  }
  lines.push(`agents${doc.agents.length ? "" : ": none registered"}`);
  const low = (p) => (names[p] ?? p).toLowerCase();
  for (const project of [...new Set(doc.agents.map((r) => String(r.project)))].sort((a, b) => (low(a) < low(b) ? -1 : low(a) > low(b) ? 1 : 0))) {
    const mine = doc.agents.filter((r) => String(r.project) === project).map((r) => String(r.name)).sort();
    lines.push(`  ${names[project] ?? project}${project === ctx.project ? " (this project)" : ""}: ${mine.join(", ")}`);
  }
  if (doc.warnings.length) lines.push("warnings", ...doc.warnings.map((w) => `  ! ${w}`));
  lines.push(`record: ${recordLine(doc)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------- quiet enough to measure

/**
 * Why the machine is not quiet enough for a timing measurement; empty when it is. Another agent's GPU lease or
 * machine-wide lock counts (`strict`: every lease and lock of another agent), and a GPU at or above `gpuUnder`
 * percent, and with `cpuUnder` the CPU at or above it. No reading is not a reason.
 */
export function quietReasons(doc, agent, project, gpuUnder, { cpuUnder = null, strict = false } = {}) {
  const names = doc.projects ?? {};
  const other = (r) => r.agent !== agent || r.project !== project;
  const who = (r) => `${r.agent} (${names[String(r.project)] ?? "?"})`;
  const out = [];
  for (const r of doc.leases) if (other(r) && (strict || isGpu(r.resource))) out.push(`${who(r)} holds a lease on ${r.resource}: "${r.for || "?"}"`);
  for (const r of doc.locks) if (other(r) && (strict || r.scope === store.MACHINE)) out.push(`${who(r)} holds the lock on ${r.resource}: "${r.for || "?"}"`);
  for (const gpu of doc.gpus ?? []) {
    if (present(gpu.util) && gpu.util >= gpuUnder) out.push(`GPU ${gpu.index} reads ${store.g(gpu.util)} % (threshold ${store.g(gpuUnder)} %)`);
  }
  const percent = doc.cpu?.percent;
  if (cpuUnder !== null && present(percent) && percent >= cpuUnder) out.push(`CPU reads ${store.g(percent)} % (threshold ${store.g(cpuUnder)} %)`);
  return out;
}

/** `aw sys ...`; resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  const { values, positionals, help } = parseArgs(argv, {
    json: { type: "boolean" }, "quiet-for": { type: "string" }, "gpu-under": { type: "string" }, "cpu-under": { type: "string" },
    strict: { type: "boolean" }, wait: { type: "string" }, interval: { type: "string" }, as: { type: "string" },
  });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  if (positionals.length) throw new AwError(`sys: unexpected '${positionals[0]}'`);
  const quietFor = values["quiet-for"] ?? null;
  if (quietFor !== null && quietFor !== "timing") throw new AwError(`sys: --quiet-for takes 'timing', not '${quietFor}'`);
  const gpuUnder = store.numArg(values["gpu-under"], "--gpu-under", 10);
  const cpuUnder = store.numArg(values["cpu-under"], "--cpu-under");
  const wait = store.numArg(values.wait, "--wait", 0);
  const interval = store.numArg(values.interval, "--interval", 5);
  const strict = values.strict === true;
  const ctx = store.context(io, values.as ?? null);
  if (quietFor === null) {
    const doc = await collect(ctx);
    store.say(io, doc, values.json, textOf(doc, ctx));
    return 0;
  }
  const started = Date.now();
  const deadline = started + Math.max(0, wait) * 1000;
  let said = null;
  let doc;
  let reasons;
  for (;;) {
    doc = await collect(ctx);
    reasons = quietReasons(doc, ctx.agent, ctx.project, gpuUnder, { cpuUnder, strict });
    const left = deadline - Date.now();
    if (!reasons.length || left <= 0) break;
    if (reasons.join("\n") !== said && !values.json) io.stderr.write(`not quiet yet: ${reasons.join("; ")}\n`);
    said = reasons.join("\n");
    await sleep(Math.min(Math.max(interval, 0.2) * 1000, left));
  }
  const waited = Math.round((Date.now() - started) / 100) / 10;
  const notes = doc.gpus ? [] : [`${doc.gpuNote}: judged by the declarations alone`];
  doc.quiet = { for: quietFor, ok: !reasons.length, reasons, notes, waitedSeconds: waited, gpuUnder, cpuUnder, strict };
  const lines = [`quiet for ${quietFor}: ${reasons.length ? "NO" : "yes"}${wait ? ` (after ${store.g(waited)} s)` : ""}`];
  lines.push(...reasons.map((r) => `  - ${r}`), ...notes.map((n) => `  (${n})`), `record: ${recordLine(doc)}`);
  store.say(io, doc, values.json, lines.join("\n"));
  return reasons.length ? 1 : 0;
}

runMain(import.meta.url, main, "aw sys");
