#!/usr/bin/env python3
"""Serve the spec site *with* inline commenting from a single port.

The spec site is a static MkDocs build served read-only by `mkdocs serve`, so the
browser can't write files. This server is the write-back path AND the front door:
it serves two same-origin endpoints — the comments API (`/__spec_comments__`,
GET/POST) and a read-only plan-tree status feed (`/__plan_status__`, GET only,
consumed by the site's Plan page) — and reverse-proxies everything else to MkDocs
behind it. One origin, one port — which matters the moment the site is viewed
through a forwarded port (VS Code / code-server, SSH tunnels, Codespaces):
whatever forwarding exposes the page exposes the API too, with no second port to
forward and no cross-origin URL to configure.

Run it from the repo root, in place of `mkdocs serve`:

    python .plan/spec/scripts/comments-server.py            # site + comments on :8000

It spawns `mkdocs serve` on an internal port and fronts it. Comments persist to
`.plan/spec-comments.json` (at the .plan root, NOT under docs_dir, so MkDocs
doesn't live-reload on every save). The spec-4-edit skill reads that file and
flips each comment's `resolved` flag once addressed.

Options:
    --port N            public port to serve on (default 8000)
    --mkdocs-port N     internal port for the spawned MkDocs (default 8001)
    --upstream HOST:PORT  proxy to an already-running MkDocs instead of spawning one

Stdlib only. Binds 127.0.0.1 — never expose beyond localhost (front it with your
editor's port forwarding, which is itself localhost on the server).

The canonical `_instructions` / `_schema` preamble below is the single source of
truth for the on-disk contract: it is re-injected on every write, so whatever an
agent reads from spec-comments.json always carries current guidance.
"""
from __future__ import annotations

import argparse
import atexit
import http.client
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# spec-comments.json lives at the .plan root. This script is at
# .plan/spec/scripts/comments-server.py, so parents[2] == .plan/.
PLAN_DIR = Path(__file__).resolve().parents[2]
COMMENTS_FILE = PLAN_DIR / "spec-comments.json"
MKDOCS_YML = PLAN_DIR / "mkdocs.yml"
PLAN_TREE_DIR = PLAN_DIR / "plan"
TRACKER_MD_FILE = PLAN_DIR / "tracker.md"

HOST = "127.0.0.1"
API_PATH = "/__spec_comments__"  # same-origin endpoint the comments client talks to
PLAN_API_PATH = "/__plan_status__"  # read-only plan-tree JSON for the Plan page

# hop-by-hop headers must not be forwarded by a proxy
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}

# --- the on-disk contract, re-injected on every write ------------------------

INSTRUCTIONS = (
    "These are inline review comments left on the spec site. Each entry with "
    '"resolved": false is a requested change to the spec page named by its '
    '"specFile". To act on them, run the spec-4-edit skill: for each unresolved '
    'comment, treat "specFile" as the changed spec file, route and propagate the '
    "edit per spec-4-edit, then set that comment's \"resolved\" field to true (do "
    "NOT delete the entry, keeping it preserves the review trail). Do not edit "
    'the "quote", "prefix", or "suffix" fields; they anchor the highlight on the '
    "page. specFile is derived from the page URL; if it doesn't exist on disk, "
    "try the section-index form (replace <name>.md with <name>/index.md). This "
    "file is written by the comments sidecar server; edits you make to the "
    "resolved flags are picked up by the site on its next refresh."
)

SCHEMA = {
    "id": "stable unique id for the comment",
    "specFile": "spec-relative path this comment annotates, e.g. spec/02-runtime/event-loop.md",
    "url": "the page URL the comment was made on",
    "quote": "the exact highlighted text (anchor, do not edit)",
    "prefix": "text immediately before the quote (anchor, do not edit)",
    "suffix": "text immediately after the quote (anchor, do not edit)",
    "body": "the reviewer's comment",
    "resolved": "boolean, set true after the comment is addressed",
    "created": "ISO 8601 timestamp",
    "updated": "ISO 8601 timestamp",
}


def _empty_doc() -> dict:
    return {"_instructions": INSTRUCTIONS, "_schema": SCHEMA, "comments": []}


def read_doc() -> dict:
    if not COMMENTS_FILE.exists():
        return _empty_doc()
    try:
        data = json.loads(COMMENTS_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return _empty_doc()
    comments = data.get("comments") if isinstance(data, dict) else data
    if not isinstance(comments, list):
        comments = []
    return {"_instructions": INSTRUCTIONS, "_schema": SCHEMA, "comments": comments}


def write_comments(comments: list) -> dict:
    doc = {"_instructions": INSTRUCTIONS, "_schema": SCHEMA, "comments": comments}
    tmp = COMMENTS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(COMMENTS_FILE)  # atomic swap so a reader never sees a half-written file
    return doc


# --- plan-tree status (read-only) --------------------------------------------
# Serves the site's Plan page. Parses .plan/plan/ fresh on every GET (the tree
# is tens of files; a re-parse per 15s poll is negligible and needs no cache).
# Deliberately self-contained rather than importing plan-status.py: that script
# sys.exit(2)s on structural oddities (fatal in a threaded server) and the two
# files are backfilled independently, so a cross-file import can break on a
# partially-updated workspace. Here every anomaly becomes a `warnings` entry.
# Regexes and _rollup() mirror .plan/plan/plan-status.py — keep in sync.

PLAN_STATUSES = ("not-started", "in-progress", "blocked", "done")
ISSUE_TYPES = ("AFK", "HITL", "REVIEW")
ISSUE_FILE_RE = re.compile(r"^([0-9]{2})_issue_[A-Z][A-Z0-9-]+\.md$")
STATUS_FIELD_RE = re.compile(r"\*\*Status\*\*:[ \t]*(\S+)")
TYPE_FIELD_RE = re.compile(r"\*\*Type\*\*:[ \t]*(\S+)")
TRACKER_FIELD_RE = re.compile(r"\*\*GitHub\*\*:[ \t]*(\S+)")  # field name is GitHub in every tracker mode
H1_RE = re.compile(r"^#\s+(.*?)\s*$", re.MULTILINE)
ACCEPTANCE_SECTION_RE = re.compile(
    r"(^## Acceptance criteria\s*$)(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL
)
BLOCKED_SECTION_RE = re.compile(
    r"(^## Blocked by\s*$)(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL
)
MD_LINK_RE = re.compile(r"\]\(([^)]+)\)")
NN_DIR_RE = re.compile(r"^\d{2}-")


def _rollup(children: list) -> str:
    """Derive a parent's status from its children's statuses (deterministic).

    `in-progress` is evaluated BEFORE `blocked`, so a node with any active work
    reads in-progress rather than being mislabeled blocked; `blocked` is reserved
    for "something is blocked and nothing is moving."
    """
    if not children:
        return "not-started"
    if all(c == "done" for c in children):
        return "done"
    if all(c == "not-started" for c in children):
        return "not-started"
    if any(c == "in-progress" for c in children):
        return "in-progress"
    if any(c == "done" for c in children) and all(
        c in ("done", "not-started") for c in children
    ):
        return "in-progress"
    if any(c == "blocked" for c in children):
        return "blocked"
    return "in-progress"


def _tracker_mode_name() -> str:
    """`local` | `github` | `github+board` | `gitlab` — from .plan/tracker.md."""
    if not TRACKER_MD_FILE.exists():
        return "local"
    try:
        text = TRACKER_MD_FILE.read_text(encoding="utf-8")
    except OSError:
        return "local"
    if re.search(r"#\s*Issue tracker:\s*local", text, re.IGNORECASE):
        return "local"
    if re.search(r"#\s*Issue tracker:\s*GitLab", text, re.IGNORECASE):
        return "gitlab"
    if not re.search(r"#\s*Issue tracker:\s*GitHub", text, re.IGNORECASE):
        return "local"
    owner_m = re.search(r"\*\*Owner\*\*:\s*`?([^`\s]+)`?", text)
    number_m = re.search(r"\*\*Number\*\*:\s*`?([^`\s]+)`?", text)
    owner = owner_m.group(1) if owner_m else None
    number = number_m.group(1) if number_m else None

    def filled(v) -> bool:
        return bool(v) and "{{" not in v and v not in ("<unset>", "-")

    if filled(owner) and filled(number) and re.fullmatch(r"\d+", number or ""):
        return "github+board"
    return "github"


def _read_text(path: Path, rel: str, warnings: list) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        warnings.append(f"{rel}: unreadable ({type(exc).__name__})")
        return None


def _h1_title(text: str, fallback: str) -> str:
    m = H1_RE.search(text)
    return m.group(1).strip() if m else fallback


def _section_body(regex: re.Pattern, text: str) -> str:
    m = regex.search(text)
    return m.group(2) if m else ""


def _blocked_issue_ids(text: str, sprint_id: str) -> list:
    """Sibling-issue ids from an issue's `## Blocked by` links, e.g.
    `(./02_issue_FOO.md)` under sprint 01-01 -> '01-01-02'."""
    ids = []
    for link in MD_LINK_RE.findall(_section_body(BLOCKED_SECTION_RE, text)):
        m = re.search(r"(\d{2})_issue_", link)
        if m:
            ids.append(f"{sprint_id}-{m.group(1)}")
    return ids


def _blocked_dir_ids(text: str, kind: str, prefix: str = "") -> list:
    """Sibling epic/sprint ids from a Blocked-by section, e.g.
    `(../02-persistence/epic.md)` -> '02' (prefixed for sprints)."""
    ids = []
    for link in MD_LINK_RE.findall(_section_body(BLOCKED_SECTION_RE, text)):
        m = re.search(rf"(?:^|/)(\d{{2}})-[^/]*/{kind}\.md$", link)
        if m:
            ids.append(prefix + m.group(1))
    return ids


def _parse_issue(f: Path, sprint_id: str, rel: str, warnings: list) -> dict | None:
    text = _read_text(f, rel, warnings)
    if text is None:
        return None
    m = STATUS_FIELD_RE.search(text)
    status = m.group(1) if m else None
    if status not in PLAN_STATUSES:
        warnings.append(
            f"{rel}: missing or invalid **Status** field"
            + (f" ('{status}')" if status else "")
        )
        status = "not-started"
    m = TYPE_FIELD_RE.search(text)
    itype = m.group(1) if m else None
    if itype not in ISSUE_TYPES:
        warnings.append(
            f"{rel}: missing or invalid **Type** field"
            + (f" ('{itype}')" if itype else "")
        )
        itype = None
    m = TRACKER_FIELD_RE.search(text)
    tracker_ref = m.group(1) if m else None
    if tracker_ref == "<unassigned>":
        tracker_ref = None
    ac_body = _section_body(ACCEPTANCE_SECTION_RE, text)
    return {
        "id": f"{sprint_id}-{f.name[:2]}",
        "file": f.name,
        "path": rel,
        "title": _h1_title(text, f.stem),
        "type": itype,
        "status": status,
        "tracker": tracker_ref,
        "blockedBy": _blocked_issue_ids(text, sprint_id),
        "acceptance": {
            "done": len(re.findall(r"-\s\[[xX]\]", ac_body)),
            "total": len(re.findall(r"-\s\[[ xX]\]", ac_body)),
        },
        "actionable": False,  # derived after the whole tree is parsed
    }


def build_plan_status() -> dict:
    """Assemble the /__plan_status__ document. Never raises for content problems —
    malformed files become `warnings` entries; only a genuine bug escapes (and the
    handler turns that into a 500)."""
    warnings: list = []
    counts = {
        "epics": 0,
        "sprints": 0,
        "issues": 0,
        "byStatus": {s: 0 for s in PLAN_STATUSES},
        "byType": {t: 0 for t in ISSUE_TYPES},
    }
    doc = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "planExists": PLAN_TREE_DIR.is_dir(),
        "tracker": _tracker_mode_name(),
        "status": "not-started",
        "counts": counts,
        "next": [],
        "epics": [],
        "warnings": warnings,
    }
    if not doc["planExists"]:
        warnings.append("no plan tree yet — run plan-0-decompose")
        return doc

    for ed in sorted(
        d for d in PLAN_TREE_DIR.iterdir() if d.is_dir() and NN_DIR_RE.match(d.name)
    ):
        epic_id = ed.name[:2]
        epic_md = ed / "epic.md"
        e_text = (
            _read_text(epic_md, f"plan/{ed.name}/epic.md", warnings)
            if epic_md.exists()
            else None
        )
        if e_text is None and not epic_md.exists():
            warnings.append(f"plan/{ed.name}: missing epic.md")

        sprints = []
        for sd in sorted(
            d for d in ed.iterdir() if d.is_dir() and NN_DIR_RE.match(d.name)
        ):
            sprint_id = f"{epic_id}-{sd.name[:2]}"
            sprint_md = sd / "sprint.md"
            s_rel = f"plan/{ed.name}/{sd.name}/sprint.md"
            s_text = (
                _read_text(sprint_md, s_rel, warnings) if sprint_md.exists() else None
            )
            if s_text is None and not sprint_md.exists():
                warnings.append(f"plan/{ed.name}/{sd.name}: missing sprint.md")

            issues = []
            issues_dir = sd / "issues"
            if issues_dir.is_dir():
                for f in sorted(issues_dir.iterdir()):
                    if not (f.is_file() and ISSUE_FILE_RE.match(f.name)):
                        continue
                    rel = f"plan/{ed.name}/{sd.name}/issues/{f.name}"
                    issue = _parse_issue(f, sprint_id, rel, warnings)
                    if issue is None:
                        continue
                    issues.append(issue)
                    counts["issues"] += 1
                    counts["byStatus"][issue["status"]] += 1
                    if issue["type"]:
                        counts["byType"][issue["type"]] += 1

            s_rollup = _rollup([i["status"] for i in issues])
            m = STATUS_FIELD_RE.search(s_text) if s_text else None
            sprints.append({
                "id": sprint_id,
                "dir": sd.name,
                "title": _h1_title(s_text, sd.name) if s_text else sd.name,
                "status": m.group(1) if m else s_rollup,
                "rollup": s_rollup,
                "blockedBy": _blocked_dir_ids(s_text or "", "sprint", f"{epic_id}-"),
                "issues": issues,
            })
            counts["sprints"] += 1

        e_rollup = _rollup([s["rollup"] for s in sprints])
        m = STATUS_FIELD_RE.search(e_text) if e_text else None
        doc["epics"].append({
            "id": epic_id,
            "dir": ed.name,
            "title": _h1_title(e_text, ed.name) if e_text else ed.name,
            "status": m.group(1) if m else e_rollup,
            "rollup": e_rollup,
            "blockedBy": _blocked_dir_ids(e_text or "", "epic"),
            "sprints": sprints,
        })
        counts["epics"] += 1

    doc["status"] = _rollup([e["status"] for e in doc["epics"]])

    # Actionable = not-started with every blocker (issue, sprint, epic) done.
    epic_done = {e["id"]: e["status"] == "done" for e in doc["epics"]}
    sprint_done = {
        s["id"]: s["status"] == "done" for e in doc["epics"] for s in e["sprints"]
    }
    issue_done = {
        i["id"]: i["status"] == "done"
        for e in doc["epics"]
        for s in e["sprints"]
        for i in s["issues"]
    }
    for e in doc["epics"]:
        epic_clear = all(epic_done.get(b, False) for b in e["blockedBy"])
        for s in e["sprints"]:
            sprint_clear = epic_clear and all(
                sprint_done.get(b, False) for b in s["blockedBy"]
            )
            for i in s["issues"]:
                i["actionable"] = (
                    sprint_clear
                    and i["status"] == "not-started"
                    and all(issue_done.get(b, False) for b in i["blockedBy"])
                )
                if i["actionable"] and len(doc["next"]) < 5:
                    doc["next"].append({
                        "id": i["id"],
                        "title": i["title"],
                        "type": i["type"],
                        "path": i["path"],
                    })
    return doc


class Handler(BaseHTTPRequestHandler):
    server_version = "spec-comments/2.0"
    protocol_version = "HTTP/1.1"
    upstream = f"{HOST}:8001"  # overwritten in main()

    # --- comments API --------------------------------------------------------

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, obj: dict, status: int = 200) -> None:
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def _is_api(self) -> bool:
        return self.path.split("?", 1)[0].rstrip("/") == API_PATH

    def _is_plan_api(self) -> bool:
        return self.path.split("?", 1)[0].rstrip("/") == PLAN_API_PATH

    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        return self.rfile.read(length) if length else b""

    def _api_get(self) -> None:
        self._send_json(read_doc())

    def _api_post(self) -> None:
        try:
            body = json.loads(self._read_body().decode("utf-8") or "[]")
        except (ValueError, UnicodeDecodeError):
            self._send_json({"error": "invalid JSON"}, status=400)
            return
        comments = body.get("comments") if isinstance(body, dict) else body
        if not isinstance(comments, list):
            self._send_json({"error": "expected a comments array"}, status=400)
            return
        self._send_json(write_comments(comments))

    def _plan_api_get(self) -> None:
        try:
            self._send_json(build_plan_status())
        except Exception as exc:  # noqa: BLE001 — a parser bug must not kill the thread
            self._send_json({"error": f"{type(exc).__name__}: {exc}"}, status=500)

    # --- reverse proxy to MkDocs --------------------------------------------

    def _proxy(self) -> None:
        body = self._read_body()
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        headers["Host"] = self.upstream
        try:
            conn = http.client.HTTPConnection(self.upstream, timeout=None)
            conn.request(self.command, self.path, body=body or None, headers=headers)
            resp = conn.getresponse()
            payload = resp.read()  # long-poll /livereload/ blocks here; fine, we're threaded
        except OSError:
            self.send_error(502, "upstream MkDocs unreachable")
            return
        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() in HOP_BY_HOP or k.lower() in ("content-length", "cache-control"):
                continue
            self.send_header(k, v)
        # Never let a browser cache the live spec while it's being reviewed —
        # otherwise edits to the assets (or the spec) can be masked by a stale copy.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
        conn.close()

    # --- verbs ---------------------------------------------------------------

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self._is_api() or self._is_plan_api():
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._proxy()

    def do_GET(self) -> None:  # noqa: N802
        if self._is_api():
            self._api_get()
        elif self._is_plan_api():
            self._plan_api_get()
        else:
            self._proxy()

    def do_HEAD(self) -> None:  # noqa: N802
        self._proxy()

    def do_POST(self) -> None:  # noqa: N802
        if self._is_api():
            self._api_post()
        elif self._is_plan_api():
            self._send_json({"error": "plan status is read-only"}, status=405)
        else:
            self._proxy()

    def log_message(self, fmt: str, *args) -> None:
        pass  # quiet; the API and MkDocs both have their own signal


class QuietServer(ThreadingHTTPServer):
    """Threaded server that swallows client-hangup noise. A browser routinely
    closes a connection mid-response (cancelled live-reload long-polls, a reload,
    navigating away), which surfaces as BrokenPipe/ConnectionReset — harmless, but
    it would otherwise dump a traceback per occurrence into the log."""

    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


def wait_for(host_port: str, timeout: float = 30.0) -> bool:
    url = f"http://{host_port}/"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except urllib.error.HTTPError:
            return True  # any HTTP response means it's up
        except OSError:
            time.sleep(0.4)
    return False


def spawn_mkdocs(port: int) -> subprocess.Popen:
    if not MKDOCS_YML.exists():
        sys.exit(f"error: {MKDOCS_YML} not found — run this from a .plan/ workspace.")
    # Prefer the mkdocs console script from THIS interpreter's env (so a venv's
    # mkdocs-shadcn is used, not a system mkdocs on PATH); then PATH; then -m.
    local = Path(sys.executable).parent / "mkdocs"
    if local.exists():
        cmd = [str(local)]
    elif shutil.which("mkdocs"):
        cmd = [shutil.which("mkdocs")]
    else:
        cmd = [sys.executable, "-m", "mkdocs"]
    cmd += ["serve", "-f", str(MKDOCS_YML), "-a", f"{HOST}:{port}"]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    atexit.register(lambda: proc.poll() is None and proc.terminate())
    return proc


def main() -> int:
    ap = argparse.ArgumentParser(description="Serve the spec site with inline commenting.")
    ap.add_argument("--port", type=int, default=8000, help="public port (default 8000)")
    ap.add_argument("--mkdocs-port", type=int, default=8001, help="internal MkDocs port")
    ap.add_argument("--upstream", default=None, help="proxy to an existing MkDocs, e.g. 127.0.0.1:8001")
    args = ap.parse_args()

    if args.upstream:
        Handler.upstream = args.upstream
        print(f"proxying to existing MkDocs at http://{args.upstream}")
    else:
        Handler.upstream = f"{HOST}:{args.mkdocs_port}"
        print(f"starting MkDocs behind the comments server (internal :{args.mkdocs_port})…")
        spawn_mkdocs(args.mkdocs_port)
        if not wait_for(Handler.upstream):
            sys.exit("error: MkDocs did not come up — is it installed? "
                     "pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin")

    httpd = QuietServer((HOST, args.port), Handler)
    print(f"spec site + comments on http://{HOST}:{args.port}  ->  {COMMENTS_FILE}")
    print("open that URL (or its forwarded address); Ctrl-C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
