"""Claims on a project's shared counters: a number taken once, by one agent, until its merge lands.

Two branches that each bump "the next version" to the same number collide at merge time. A claim settles who gets
which number before anybody writes it down.

  aw claim COUNTER [--after N] [--for "what"]     claim the next value: one above the highest known
  aw claim COUNTER --value V [--for "what"]       claim this very value
  aw claim COUNTER --release [--landed]           give it back; --landed: the value is in the main branch now
  aw claims [--all] [--json]

The store knows a counter's floor (the highest value known to have landed) and the claims in force. The next value is
one above the highest of both. The first time a counter is used, say what the code holds now: --after N. A claim
lasts until released or for coordination.claimHours (72), whichever comes first; asking again while you hold one
returns the same value and renews it. Released without --landed, a value is free again.

Claim at merge time, not when the work starts: a number held for days blocks nobody, but it leaves a gap when the
work is dropped. Counters are declared under "counters" in the config; an undeclared one works, with a warning.
Exit codes: 0 claimed or released, 1 not now (the value is taken, or nothing to release), 2 usage.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import common, store

sys.dont_write_bytecode = True


def path(project: str) -> Path:
    return store.project_dir(project) / "claims.json"


def _counter(doc: Dict[str, Any], name: str) -> Dict[str, Any]:
    counters = doc.setdefault("counters", {})
    c = counters.get(name)
    if not isinstance(c, dict):
        c = counters[name] = {"floor": None, "claims": []}
    c["claims"] = [x for x in c.get("claims") or [] if isinstance(x, dict) and not _expired(x)]
    return c


def _expired(claim: Dict[str, Any]) -> bool:
    until = store.parse_iso(claim.get("until"))
    return until is not None and time.time() > until


def read(project: str) -> Dict[str, Dict[str, Any]]:
    """{counter: {"floor", "claims"}} with expired claims left out (they are dropped at the next write)."""
    doc = common.read_json(path(project), {})
    counters = doc.get("counters") if isinstance(doc, dict) else None
    out: Dict[str, Dict[str, Any]] = {}
    for name, c in (counters or {}).items():
        if isinstance(c, dict):
            out[name] = {"floor": c.get("floor"), "claims": [x for x in c.get("claims") or [] if isinstance(x, dict) and not _expired(x)]}
    return out


def claim(project: str, counter: str, agent: str, why: str, value: Optional[int], after: Optional[int],
          hours: float) -> Dict[str, Any]:
    """{"ok": True, "claim": {...}} or {"ok": False, "why": "...", "usage": bool}."""
    until = store.iso_at(time.time() + hours * 3600)

    def change(doc: Dict[str, Any]) -> Dict[str, Any]:
        c = _counter(doc, counter)
        if after is not None:
            c["floor"] = max(int(after), int(c["floor"])) if c.get("floor") is not None else int(after)
        mine = [x for x in c["claims"] if x.get("agent") == agent]
        if value is None and mine:
            mine[-1]["until"] = until
            if why:
                mine[-1]["for"] = why
            return {"ok": True, "claim": mine[-1], "renewed": True}
        taken = [int(x["value"]) for x in c["claims"]]
        if value is None:
            known = taken + ([int(c["floor"])] if c.get("floor") is not None else [])
            if not known:
                return {"ok": False, "usage": True,
                        "why": f"nothing is known about '{counter}' yet: say what the code holds now (--after N) or the value you take (--value V)"}
            v = max(known) + 1
        else:
            v = int(value)
            other = next((x for x in c["claims"] if int(x["value"]) == v and x.get("agent") != agent), None)
            if other:
                return {"ok": False, "why": f"{counter} {v} is claimed by {other.get('agent')} (for: {other.get('for') or '?'}; until {other.get('until')})"}
            if c.get("floor") is not None and v <= int(c["floor"]):
                return {"ok": False, "why": f"{counter} {v} has landed already (the highest landed value is {c['floor']})"}
            same = next((x for x in c["claims"] if int(x["value"]) == v), None)
            if same:
                same["until"] = until
                return {"ok": True, "claim": same, "renewed": True}
        entry = {"value": v, "agent": agent, "for": why, "since": store.now(), "until": until}
        c["claims"].append(entry)
        return {"ok": True, "claim": entry, "renewed": False}

    return store.update_json(path(project), {"counters": {}}, change)


def release(project: str, counter: str, agent: str, value: Optional[int], landed: bool) -> List[Dict[str, Any]]:
    def change(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
        c = _counter(doc, counter)
        gone = [x for x in c["claims"] if x.get("agent") == agent and (value is None or int(x["value"]) == int(value))]
        c["claims"] = [x for x in c["claims"] if x not in gone]
        if landed and gone:
            top = max(int(x["value"]) for x in gone)
            c["floor"] = max(top, int(c["floor"])) if c.get("floor") is not None else top
        return gone

    return store.update_json(path(project), {"counters": {}}, change)


# ------------------------------------------------------------------------------------------------------- commands

def cmd_claim(a: Any) -> int:
    ctx = store.Context(a.agent)
    counter = store.check_name(a.counter, "counter name")
    warnings = []
    if counter not in (ctx.cfg.get("counters") or {}):
        warnings.append(f"'{counter}' is not declared under \"counters\" in {common.CONFIG_REL}: claimed all the same")
        print(f"aw claim: {warnings[0]}", file=sys.stderr)
    if a.release:
        gone = release(ctx.project, counter, ctx.agent, a.value, a.landed)
        if not gone:
            store.emit({"counter": counter, "released": []}, a.json)
            print(f"{counter}: {ctx.agent} holds no claim" + (f" on {a.value}" if a.value is not None else ""), file=sys.stderr)
            return 1
        values = ", ".join(str(x["value"]) for x in gone)
        store.emit({"counter": counter, "released": gone, "landed": a.landed, "warnings": warnings}, a.json,
                   f"{counter}: {ctx.agent} released {values}" + (" (landed)" if a.landed else " (free again)"))
        return 0
    ctx.stamp()
    hours = float(a.hours if a.hours is not None else store.setting(ctx.cfg, "claimHours"))
    result = claim(ctx.project, counter, ctx.agent, a.why or "", a.value, a.after, hours)
    if not result["ok"]:
        if result.get("usage"):
            raise store.CoordError(f"claim: {result['why']}")
        store.emit({"counter": counter, "claimed": False, "why": result["why"]}, a.json)
        print(f"{result['why']}. Take the next one: aw claim {counter}", file=sys.stderr)
        return 1
    c = result["claim"]
    store.emit({"counter": counter, "claimed": True, "value": c["value"], "agent": ctx.agent, "until": c["until"],
                "renewed": result.get("renewed", False), "warnings": warnings}, a.json,
               f"{counter}: {c['value']} is {ctx.agent}'s until {c['until']}" + (" (renewed)" if result.get("renewed") else "")
               + f"\nwhen the merge has landed: aw claim {counter} --release --landed")
    return 0


def cmd_claims(a: Any) -> int:
    ctx = store.Context()
    known = store.projects()
    ids = [ctx.project]
    if a.all:
        try:
            ids = sorted({p.name for p in (store.home() / "projects").iterdir() if p.is_dir()} | {ctx.project})
        except OSError:
            pass
    doc: Dict[str, Any] = {}
    lines: List[str] = []
    declared = ctx.cfg.get("counters") or {}
    for pid in ids:
        counters = read(pid)
        if pid == ctx.project:
            for name in declared:
                counters.setdefault(name, {"floor": None, "claims": []})
        doc[pid] = counters
        if a.all and counters:
            lines.append(f"{store.project_name(pid, known)}")
        for name, c in sorted(counters.items()):
            note = (declared.get(name) or {}).get("note") if pid == ctx.project and isinstance(declared.get(name), dict) else None
            floor = f"landed up to {c['floor']}" if c.get("floor") is not None else "nothing landed known"
            lines.append(f"{'  ' if a.all else ''}{name}: {floor}" + (f"  ({note})" if note else ""))
            for x in sorted(c["claims"], key=lambda x: int(x["value"])):
                lines.append(f"{'  ' if a.all else ''}    {x['value']}  {x.get('agent')}  until {x.get('until')}: \"{x.get('for') or '?'}\"")
    store.emit({"project": ctx.project, "counters": doc[ctx.project]} if not a.all else {"projects": doc}, a.json,
               "\n".join(lines) if lines else "(no counters)")
    return 0


def register(subparsers: Any) -> None:
    import argparse

    p = subparsers.add_parser("claim", help="claim the next value of a shared counter until its merge lands",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("counter")
    p.add_argument("--value", type=int, help="claim (or, with --release, give back) this very value")
    p.add_argument("--after", type=int, metavar="N", help="the value the code holds now: the next claim is above it")
    p.add_argument("--for", dest="why", help="what the number is for (the branch, the card)")
    p.add_argument("--release", action="store_true", help="give your claim back")
    p.add_argument("--landed", action="store_true", help="with --release: the value has landed, never hand it out again")
    p.add_argument("--hours", type=float, help="how long the claim lasts (default 72)")
    p.add_argument("--as", dest="agent", help="the agent's name (default: the agent variable, else session-<pid>)")
    p.add_argument("--json", action="store_true", help="print one JSON document")
    p.set_defaults(func=cmd_claim)

    p = subparsers.add_parser("claims", help="the counters of this project: what has landed, who claims what")
    p.add_argument("--all", action="store_true", help="every project's counters")
    p.add_argument("--json", action="store_true", help="print one JSON document")
    p.set_defaults(func=cmd_claims)
