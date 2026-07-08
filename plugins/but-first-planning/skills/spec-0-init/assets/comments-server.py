#!/usr/bin/env python3
"""Serve the spec site *with* inline commenting from a single port.

The spec site is a static MkDocs build served read-only by `mkdocs serve`, so the
browser can't write files. This server is the write-back path AND the front door:
it serves the comments API on the same origin as the pages and reverse-proxies
everything else to MkDocs behind it. One origin, one port — which matters the
moment the site is viewed through a forwarded port (VS Code / code-server, SSH
tunnels, Codespaces): whatever forwarding exposes the page exposes the API too,
with no second port to forward and no cross-origin URL to configure.

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
import shutil
import subprocess
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# spec-comments.json lives at the .plan root. This script is at
# .plan/spec/scripts/comments-server.py, so parents[2] == .plan/.
PLAN_DIR = Path(__file__).resolve().parents[2]
COMMENTS_FILE = PLAN_DIR / "spec-comments.json"
MKDOCS_YML = PLAN_DIR / "mkdocs.yml"

HOST = "127.0.0.1"
API_PATH = "/__spec_comments__"  # same-origin endpoint the client talks to

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
        if self._is_api():
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._proxy()

    def do_GET(self) -> None:  # noqa: N802
        if self._is_api():
            self._api_get()
        else:
            self._proxy()

    def do_HEAD(self) -> None:  # noqa: N802
        self._proxy()

    def do_POST(self) -> None:  # noqa: N802
        if self._is_api():
            self._api_post()
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
