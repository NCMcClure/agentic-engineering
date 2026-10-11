"""What the machine is doing right now, beside what agents said they would use.

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
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import common, store

sys.dont_write_bytecode = True

PROBE_S = 3.0
GPU_BUSY = 50.0  # a GPU above this that nobody declared earns a warning
MIB = 1024 * 1024


# ---------------------------------------------------------------------------------------------------------- probes

def _run(argv: List[str], timeout: float = PROBE_S) -> Optional[str]:
    import subprocess

    try:
        r = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                           stdin=subprocess.DEVNULL, **({"creationflags": store.NO_WINDOW} if os.name == "nt" else {}))
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return r.stdout if r.returncode == 0 else None


def _num(cell: str) -> Optional[float]:
    try:
        return float(cell.strip())
    except ValueError:
        return None  # "[N/A]", "[Insufficient Permissions]"


def parse_gpus(text: str) -> List[Dict[str, Any]]:
    """nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu (csv, no units)."""
    rows = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 7 or _num(cells[0]) is None:
            continue
        used, total = _num(cells[4]), _num(cells[5])
        rows.append({"index": int(float(cells[0])), "uuid": cells[1], "name": cells[2], "util": _num(cells[3]),
                     "memUsed": int(used * MIB) if used is not None else None,
                     "memTotal": int(total * MIB) if total is not None else None,
                     "temp": _num(cells[6]), "processes": []})
    return rows


def parse_gpu_processes(text: str) -> List[Dict[str, Any]]:
    """nvidia-smi --query-compute-apps=pid,process_name,used_memory,gpu_uuid (csv, no units)."""
    rows = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 4 or _num(cells[0]) is None:
            continue
        mem = _num(cells[-2])
        name = ",".join(cells[1:-2]).strip()
        rows.append({"pid": int(float(cells[0])), "name": os.path.basename(name.replace("\\", "/")) or name,
                     "mem": int(mem * MIB) if mem is not None else None, "uuid": cells[-1]})
    return rows


def gpus() -> Tuple[Optional[List[Dict[str, Any]]], str]:
    """(the GPUs with their processes, "") or (None, why there is no reading)."""
    import shutil

    exe = shutil.which("nvidia-smi")
    if not exe:
        return None, "no GPU reading (nvidia-smi is not on the path)"
    out = _run([exe, "--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits"])
    if out is None:
        return None, "no GPU reading (nvidia-smi did not answer in time)"
    rows = parse_gpus(out)
    if not rows:
        return None, "no GPU reading (nvidia-smi listed no GPU)"
    apps = _run([exe, "--query-compute-apps=pid,process_name,used_memory,gpu_uuid", "--format=csv,noheader,nounits"])
    for proc in parse_gpu_processes(apps or ""):
        for g in rows:
            if g["uuid"] == proc["uuid"]:
                g["processes"].append({k: proc[k] for k in ("pid", "name", "mem")})
    return rows, ""


def _cpu_times() -> Optional[Tuple[float, float]]:
    """(idle, total) processor time so far, in any one unit."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
            if not ctypes.WinDLL("kernel32").GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                return None

            def value(ft: Any) -> float:
                return float((ft.dwHighDateTime << 32) | ft.dwLowDateTime)

            return value(idle), value(kernel) + value(user)  # kernel time includes idle time
        except Exception:
            return None
    try:
        cells = Path("/proc/stat").read_text(encoding="ascii").splitlines()[0].split()[1:]
        nums = [float(c) for c in cells]
        return nums[3] + (nums[4] if len(nums) > 4 else 0.0), sum(nums[:8])
    except (OSError, ValueError, IndexError):
        return None


def cpu(sample: float = 0.25) -> Dict[str, Any]:
    out: Dict[str, Any] = {"count": os.cpu_count(), "percent": None, "load1": None}
    a = _cpu_times()
    if a is not None:
        time.sleep(sample)
        b = _cpu_times()
        if b is not None and b[1] > a[1]:
            out["percent"] = round(max(0.0, min(100.0, 100.0 * (1 - (b[0] - a[0]) / (b[1] - a[1])))), 1)
    try:
        out["load1"] = round(os.getloadavg()[0], 2)  # not on Windows
    except (OSError, AttributeError):
        pass
    return out


def memory() -> Optional[Dict[str, Any]]:
    """{"total", "available"} in bytes, or None."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class Status(ctypes.Structure):
                _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

            st = Status()
            st.dwLength = ctypes.sizeof(Status)
            if ctypes.WinDLL("kernel32").GlobalMemoryStatusEx(ctypes.byref(st)):
                return {"total": int(st.ullTotalPhys), "available": int(st.ullAvailPhys)}
        except Exception:
            pass
        return None
    try:
        fields = {}
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            k, _, v = line.partition(":")
            fields[k] = float(v.split()[0]) * 1024
        return {"total": int(fields["MemTotal"]), "available": int(fields.get("MemAvailable", fields.get("MemFree", 0)))}
    except (OSError, ValueError, KeyError, IndexError):
        pass
    total, stat = _run(["sysctl", "-n", "hw.memsize"]), _run(["vm_stat"])  # macOS
    try:
        import re

        page = int(re.search(r"page size of (\d+)", stat or "").group(1))  # type: ignore[union-attr]
        pages = {m.group(1): int(m.group(2)) for m in re.finditer(r"Pages ([a-z ]+):\s+(\d+)", stat or "")}
        return {"total": int((total or "").strip()), "available": (pages.get("free", 0) + pages.get("inactive", 0)) * page}
    except (AttributeError, ValueError):
        return None


def disks(places: List[Tuple[str, Any]]) -> List[Dict[str, Any]]:
    """Free space where each (label, path) lives; places on one drive are one row."""
    import shutil

    rows: List[Dict[str, Any]] = []
    for label, place in places:
        try:
            p = Path(place).resolve()
            while not p.exists() and p != p.parent:
                p = p.parent
            usage = shutil.disk_usage(p)
            key = p.drive.upper() if p.drive else str(os.stat(p).st_dev)
            mount = p.drive.upper() if p.drive else common.posix(p)
        except (OSError, ValueError):
            continue
        same = next((r for r in rows if r["key"] == key), None)
        if same:
            same["of"].append(label)
        else:
            rows.append({"key": key, "mount": mount, "of": [label], "total": usage.total, "free": usage.free})
    return [{k: v for k, v in r.items() if k != "key"} for r in rows]


# ----------------------------------------------------------------------------------------------------- the picture

def collect(ctx: store.Context, sample: float = 0.25) -> Dict[str, Any]:
    from . import agents, leases, locks

    gpu_rows, gpu_note = gpus()
    doc: Dict[str, Any] = {
        "at": store.now(), "project": ctx.project,
        "gpus": gpu_rows, "gpuNote": gpu_note,
        "cpu": cpu(sample), "memory": memory(),
        "disks": disks([("project", ctx.root), ("home", Path.home()), ("store", store.home())]),
        "leases": leases.live(), "locks": [r for r in locks.all_locks() if r.get("held")],
        "agents": agents.live(ctx.cfg),
    }
    known = store.projects()
    ids = {str(r.get("project")) for key in ("leases", "locks", "agents") for r in doc[key] if r.get("project")}
    doc["projects"] = {p: store.project_name(p, known) for p in sorted(ids | {ctx.project})}
    doc["totals"] = leases.totals(doc["leases"])
    doc["warnings"] = warnings_of(doc)
    return doc


def _is_gpu(resource: Any) -> bool:
    return str(resource).lower().startswith("gpu")


def warnings_of(doc: Dict[str, Any]) -> List[str]:
    """Over-subscription, and readings that contradict the declarations. Reported, never refused."""
    from . import leases

    out = []
    names = doc.get("projects") or {}

    def who(rows: List[Dict[str, Any]]) -> str:
        return ", ".join(f"{r.get('agent')} ({names.get(str(r.get('project')), '?')})" for r in rows)

    by_resource: Dict[str, List[Dict[str, Any]]] = {}
    for r in doc["leases"]:
        by_resource.setdefault(str(r.get("resource")), []).append(r)
    for name, rows in sorted(by_resource.items()):
        share = sum(float(r.get("share") or 0) for r in rows)
        if share > 1.0 + 1e-9:
            out.append(f"{name} is over-subscribed: the leases add up to a share of {share:g} ({who(rows)})")
    gpu_total = sum(g["memTotal"] or 0 for g in doc.get("gpus") or [])
    gpu_leases = [r for r in doc["leases"] if _is_gpu(r.get("resource")) and r.get("mem")]
    gpu_mem = sum(int(r["mem"]) for r in gpu_leases)
    if gpu_total and gpu_mem > gpu_total:
        out.append(f"GPU memory is over-subscribed: leases for {leases.fmt_bytes(gpu_mem)} on {leases.fmt_bytes(gpu_total)} ({who(gpu_leases)})")
    ram_leases = [r for r in doc["leases"] if not _is_gpu(r.get("resource")) and r.get("mem")]
    ram = sum(int(r["mem"]) for r in ram_leases)
    total = (doc.get("memory") or {}).get("total")
    if total and ram > total:
        out.append(f"memory is over-subscribed: leases for {leases.fmt_bytes(ram)} on {leases.fmt_bytes(total)} ({who(ram_leases)})")
    cpu_leases = [r for r in doc["leases"] if r.get("cpu")]
    cpus = sum(float(r["cpu"]) for r in cpu_leases)
    count = (doc.get("cpu") or {}).get("count")
    if count and cpus > count:
        out.append(f"processors are over-subscribed: leases for {cpus:g} of {count} ({who(cpu_leases)})")
    declared = [r for r in doc["leases"] if _is_gpu(r.get("resource"))] + [r for r in doc["locks"] if _is_gpu(r.get("resource"))]
    for g in doc.get("gpus") or []:
        if g.get("util") is not None and g["util"] >= GPU_BUSY and not declared:
            out.append(f"GPU {g['index']} reads {g['util']:g} % and nobody has declared it: an undeclared run, or the "
                       f"owner's own work")
    return out


def record_line(doc: Dict[str, Any]) -> str:
    """One line to keep beside a measurement."""
    from . import leases

    parts = [doc["at"]]
    if doc.get("gpus"):
        for g in doc["gpus"]:
            mem = f" {leases.fmt_bytes(g['memUsed'])}/{leases.fmt_bytes(g['memTotal'])}" if g.get("memTotal") else ""
            parts.append(f"gpu{g['index']} {_pct(g.get('util'))}{mem}")
    else:
        parts.append("gpu: no reading")
    c, m = doc.get("cpu") or {}, doc.get("memory")
    parts.append(f"cpu {_pct(c.get('percent'))}" if c.get("percent") is not None else
                 (f"load {c['load1']:g}" if c.get("load1") is not None else "cpu: no reading"))
    if m and m.get("total"):
        parts.append(f"mem {100 * (1 - m['available'] / m['total']):.0f} %")
    parts.append(f"leases {len(doc['leases'])}")
    parts.append(f"locks {len(doc['locks'])}")
    parts.append(f"agents {len(doc['agents'])}")
    return "; ".join(parts)


def _pct(value: Any) -> str:
    return f"{value:g} %" if value is not None else "?"


def text_of(doc: Dict[str, Any], ctx: store.Context) -> str:
    from . import leases

    names = doc["projects"]
    lines = [f"machine at {doc['at']}"]
    if doc.get("gpus"):
        for g in doc["gpus"]:
            mem = f"{leases.fmt_bytes(g['memUsed'])} of {leases.fmt_bytes(g['memTotal'])}" if g.get("memTotal") else "memory ?"
            temp = f", {g['temp']:g} C" if g.get("temp") is not None else ""
            lines.append(f"  gpu {g['index']}   {_pct(g.get('util'))} busy, {mem}{temp}  ({g['name']})")
            procs = g["processes"]
            sized = sorted((p for p in procs if p.get("mem") is not None), key=lambda p: -p["mem"])
            for p in sized[:8]:
                lines.append(f"           pid {p['pid']}  {leases.fmt_bytes(p['mem'])}  {p['name']}")
            rest = len(procs) - len(sized[:8])
            if rest:
                why = " (this platform does not report memory per process)" if not sized else ""
                lines.append(f"           {rest} {'more ' if sized else ''}process{'es' if rest != 1 else ''} on it{why}")
    else:
        lines.append(f"  gpu     {doc.get('gpuNote') or 'no GPU reading'}")
    c = doc.get("cpu") or {}
    if c.get("percent") is not None:
        load = f", load {c['load1']:g}" if c.get("load1") is not None else ""
        lines.append(f"  cpu     {c['percent']:g} % busy of {c.get('count') or '?'} processors{load}")
    elif c.get("load1") is not None:
        lines.append(f"  cpu     load {c['load1']:g} on {c.get('count') or '?'} processors")
    else:
        lines.append("  cpu     no reading")
    m = doc.get("memory")
    if m and m.get("total"):
        used = m["total"] - m["available"]
        lines.append(f"  memory  {leases.fmt_bytes(used)} of {leases.fmt_bytes(m['total'])} in use ({100 * used / m['total']:.0f} %)")
    else:
        lines.append("  memory  no reading")
    for d in doc.get("disks") or []:
        lines.append(f"  disk    {d['mount']}  {leases.fmt_bytes(d['free'])} free of {leases.fmt_bytes(d['total'])}  ({', '.join(d['of'])})")
    if not doc.get("disks"):
        lines.append("  disk    no reading")

    lines.append("leases" + ("" if doc["leases"] else ": none"))
    for r in sorted(doc["leases"], key=lambda r: (str(r.get("resource")), str(r.get("since")))):
        lines.append(f"  {leases.describe(r, {p: {'name': n} for p, n in names.items()})}")
    for name, t in doc["totals"].items():
        if t["count"] > 1:
            extra = (f" share {t['share']:g}" if t["share"] else "") + (f" {leases.fmt_bytes(t['mem'])}" if t["mem"] else "") + (
                f" {t['cpu']:g} cpu" if t["cpu"] else "")
            lines.append(f"  = {name}: {t['count']} leases add up to{extra or ' nothing stated'}")
    lines.append("locks" + ("" if doc["locks"] else ": none"))
    for r in doc["locks"]:
        where = "machine" if r.get("scope") == store.MACHINE else names.get(str(r.get("scope")), str(r.get("scope")))
        holder = f"{r.get('agent')}" + (f" ({names.get(str(r.get('project')), '?')})" if r.get("scope") == store.MACHINE else "")
        lines.append(f"  {r['resource']} [{where}]  {holder}  for {r.get('heldMinutes', 0):g} min: \"{r.get('for') or '?'}\"")
    lines.append("agents" + ("" if doc["agents"] else ": none registered"))
    for project in sorted({str(r.get("project")) for r in doc["agents"]}, key=lambda p: names.get(p, p).lower()):
        mine = sorted(str(r.get("name")) for r in doc["agents"] if str(r.get("project")) == project)
        here = " (this project)" if project == ctx.project else ""
        lines.append(f"  {names.get(project, project)}{here}: {', '.join(mine)}")
    if doc["warnings"]:
        lines.append("warnings")
        lines += [f"  ! {w}" for w in doc["warnings"]]
    lines.append(f"record: {record_line(doc)}")
    return "\n".join(lines)


# ----------------------------------------------------------------------------------------------- quiet enough to measure

def quiet_reasons(doc: Dict[str, Any], agent: str, project: str, gpu_under: float, cpu_under: Optional[float] = None,
                  strict: bool = False) -> List[str]:
    """Why the machine is not quiet enough for a timing measurement; empty when it is."""
    names = doc.get("projects") or {}

    def other(r: Dict[str, Any]) -> bool:
        return (r.get("agent"), r.get("project")) != (agent, project)

    def who(r: Dict[str, Any]) -> str:
        return f"{r.get('agent')} ({names.get(str(r.get('project')), '?')})"

    out = []
    for r in doc["leases"]:
        if other(r) and (strict or _is_gpu(r.get("resource"))):
            out.append(f"{who(r)} holds a lease on {r.get('resource')}: \"{r.get('for') or '?'}\"")
    for r in doc["locks"]:
        if other(r) and (strict or r.get("scope") == store.MACHINE):
            out.append(f"{who(r)} holds the lock on {r.get('resource')}: \"{r.get('for') or '?'}\"")
    for g in doc.get("gpus") or []:
        if g.get("util") is not None and g["util"] >= gpu_under:
            out.append(f"GPU {g['index']} reads {g['util']:g} % (threshold {gpu_under:g} %)")
    percent = (doc.get("cpu") or {}).get("percent")
    if cpu_under is not None and percent is not None and percent >= cpu_under:
        out.append(f"CPU reads {percent:g} % (threshold {cpu_under:g} %)")
    return out


def cmd_sys(a: Any) -> int:
    ctx = store.Context(a.agent)
    if not a.quiet_for:
        doc = collect(ctx)
        store.emit(doc, a.json, text_of(doc, ctx))
        return 0
    started = time.monotonic()
    deadline = started + max(0.0, a.wait)
    said = None
    while True:
        doc = collect(ctx)
        reasons = quiet_reasons(doc, ctx.agent, ctx.project, a.gpu_under, a.cpu_under, a.strict)
        left = deadline - time.monotonic()
        if not reasons or left <= 0:
            break
        if reasons != said and not a.json:
            print("not quiet yet: " + "; ".join(reasons), file=sys.stderr, flush=True)
            said = reasons
        time.sleep(min(max(a.interval, 0.2), left))
    waited = round(time.monotonic() - started, 1)
    notes = [doc["gpuNote"] + ": judged by the declarations alone"] if not doc.get("gpus") else []
    doc["quiet"] = {"for": a.quiet_for, "ok": not reasons, "reasons": reasons, "notes": notes, "waitedSeconds": waited,
                    "gpuUnder": a.gpu_under, "cpuUnder": a.cpu_under, "strict": a.strict}
    lines = [f"quiet for {a.quiet_for}: " + ("yes" if not reasons else "NO") + (f" (after {waited:g} s)" if a.wait else "")]
    lines += [f"  - {r}" for r in reasons] + [f"  ({n})" for n in notes]
    lines.append(f"record: {record_line(doc)}")
    store.emit(doc, a.json, "\n".join(lines))
    return 0 if not reasons else 1


def register(subparsers: Any) -> None:
    import argparse

    p = subparsers.add_parser("sys", help="live machine readings beside the leases and locks held; quiet enough to measure?",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", action="store_true", help="print one JSON document with the same data")
    p.add_argument("--quiet-for", choices=["timing"], help="answer whether the machine is quiet enough: exit 0 yes, 1 no")
    p.add_argument("--gpu-under", type=float, default=10.0, help="GPU utilisation, in percent, that still counts as quiet (default 10)")
    p.add_argument("--cpu-under", type=float, help="also require the CPU under this percentage")
    p.add_argument("--strict", action="store_true", help="count every lease and every lock of another agent, not only the GPU's and the machine's")
    p.add_argument("--wait", type=float, default=0.0, help="poll for up to this many seconds until the machine is quiet")
    p.add_argument("--interval", type=float, default=5.0, help="seconds between polls (default 5)")
    p.add_argument("--as", dest="agent", help="the agent's name: its own leases and locks do not count against quiet")
    p.set_defaults(func=cmd_sys)
