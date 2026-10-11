"""What the coordination tests share: temp projects on one temp store, and `aw` as separate processes.

Nothing here touches the real store: every child gets AGENT_WORKS_HOME pointing into the test's temp folder, and the
in-process helpers patch the same variable for the length of a test. No test methods live in this file.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

PLUGIN = Path(__file__).resolve().parent.parent
CLI = PLUGIN / "cli"
AW = str(CLI / "aw.py")
if str(CLI) not in sys.path:
    sys.path.insert(0, str(CLI))

_STRAY = ("AW_AGENT", "PL_AGENT", "CLAUDE_AGENT_NAME", "AW_RUN", "AW_LEASE", "CLAUDE_PID")


def dead_pid():
    """The id of a process that has exited."""
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


def remove_tree(path):
    """Delete a temp tree, also git's read-only object files and a folder a dying child still stands in."""
    import stat
    import time

    def writable(func, target, _exc):
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except OSError:
            pass

    for _ in range(25):
        shutil.rmtree(path, onerror=writable)
        if not os.path.exists(path):
            return
        time.sleep(0.2)


class CoordCase(unittest.TestCase):
    CONFIG = None  # the config of self.proj; None: no config file

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="aw-coord-")).resolve()
        self.home = self.tmp / "store"
        self.procs = []
        self._saved = {k: os.environ.get(k) for k in (*_STRAY, "AGENT_WORKS_HOME", "AW_SESSION_PID")}
        for k in _STRAY:
            os.environ.pop(k, None)
        os.environ["AGENT_WORKS_HOME"] = str(self.home)  # for the helpers imported into this process
        os.environ["AW_SESSION_PID"] = str(os.getpid())
        self.proj = self.project("proj", self.CONFIG)

    def tearDown(self):
        for p in self.procs:
            if p.poll() is None:
                p.kill()
            p.communicate()
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        remove_tree(self.tmp)

    def project(self, name, config=None):
        """A folder that looks like a repository (a .git folder with a HEAD: no git process needed)."""
        root = self.tmp / name
        (root / ".git").mkdir(parents=True)
        (root / ".git" / "HEAD").write_text("ref: refs/heads/feat/x\n", encoding="utf-8")
        if config is not None:
            self.write_config(root, config)
        return root

    def write_config(self, root, config):
        (root / ".agents").mkdir(parents=True, exist_ok=True)
        (root / ".agents" / "agent-works.json").write_text(json.dumps(config), encoding="utf-8")

    def env(self, **extra):
        env = dict(os.environ)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env.update(extra)
        return env

    def aw(self, *args, cwd=None, timeout=90, stdin=None, **extra):
        return subprocess.run([sys.executable, "-B", AW, *[str(a) for a in args]], cwd=str(cwd or self.proj),
                              env=self.env(**extra), capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=timeout, input=stdin, **({} if stdin is not None else {"stdin": subprocess.DEVNULL}))

    def spawn(self, *args, cwd=None, **extra):
        p = subprocess.Popen([sys.executable, "-B", AW, *[str(a) for a in args]], cwd=str(cwd or self.proj),
                             env=self.env(**extra), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
        self.procs.append(p)
        return p

    def python(self, code, *args, cwd=None):
        """A child Python with the CLI folder on its path (for races on the store's own functions)."""
        p = subprocess.Popen([sys.executable, "-B", "-c", f"import sys; sys.path.insert(0, {str(CLI)!r})\n{code}",
                              *[str(a) for a in args]], cwd=str(cwd or self.proj), env=self.env(),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(p)
        return p

    def doc(self, *args, **kw):
        r = self.aw(*args, **kw)
        try:
            return json.loads(r.stdout)
        except ValueError:
            self.fail(f"aw {' '.join(map(str, args))}: not JSON (exit {r.returncode})\n{r.stdout}\n{r.stderr}")
