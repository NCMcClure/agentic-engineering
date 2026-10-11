"""Helpers of the CLI tests: the plugin's folders on the path, a throwaway project, `aw` as a child process."""
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True

PLUGIN = Path(__file__).resolve().parent.parent
CLI = PLUGIN / "cli"
HOOKS = PLUGIN / "hooks"
if str(CLI) not in sys.path:
    sys.path.insert(0, str(CLI))


def load_hook(name):
    """A hook script as a module (hooks are not a package)."""
    key = f"aw_hook_{name}"
    if key in sys.modules:
        return sys.modules[key]
    spec = importlib.util.spec_from_file_location(key, HOOKS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[key] = mod
    spec.loader.exec_module(mod)
    return mod


class Project:
    """A temp folder that looks like a repository (a `.git` folder with a HEAD; no git process is needed)."""

    def __init__(self, config=None, branch="feat/x", git=True):
        self.tmp = Path(tempfile.mkdtemp(prefix="aw-test-")).resolve()
        self.root = self.tmp / "acme"
        self.home = self.tmp / "aw-home"
        self.root.mkdir()
        if git:
            (self.root / ".git").mkdir()
            (self.root / ".git" / "HEAD").write_text(f"ref: refs/heads/{branch}\n", encoding="utf-8")
        if config is not None:
            self.write(".agents/agent-works.json", json.dumps(config, indent=2))

    def write(self, rel, text=""):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        return p

    def read(self, rel):
        return (self.root / rel).read_text(encoding="utf-8")

    def env(self, **extra):
        env = dict(os.environ)
        for k in ("AW_AGENT", "PL_AGENT", "CLAUDE_AGENT_NAME", "AW_RUN"):
            env.pop(k, None)
        env["AGENT_WORKS_HOME"] = str(self.home)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env.update(extra)
        return env

    def aw(self, *args, cwd=None, stdin=None, **extra_env):
        """Run `aw <args>` in the project. Returns (exit code, stdout, stderr)."""
        r = subprocess.run([sys.executable, "-B", str(CLI / "aw.py"), *args], cwd=str(cwd or self.root),
                           capture_output=True, text=True, encoding="utf-8", errors="replace", input=stdin,
                           env=self.env(**extra_env), timeout=120)
        return r.returncode, r.stdout, r.stderr

    def hook(self, name, payload, **extra_env):
        """Run a hook script with a JSON payload on stdin. Returns (exit code, stdout, stderr)."""
        r = subprocess.run([sys.executable, "-B", str(HOOKS / f"{name}.py")], cwd=str(self.root), capture_output=True,
                           text=True, encoding="utf-8", errors="replace", input=json.dumps(payload),
                           env=self.env(**extra_env), timeout=60)
        return r.returncode, r.stdout, r.stderr

    def close(self):
        """Delete the temp folder, and only it. Git writes its object files read-only, which Windows will not delete
        until the flag is cleared: without that a test that ran git left its folder behind on every run."""
        def writable(func, target, _exc):
            try:
                os.chmod(target, stat.S_IWRITE)
                func(target)
            except OSError:
                pass

        for _ in range(10):
            shutil.rmtree(self.tmp, onerror=writable)
            if not os.path.exists(self.tmp):
                return
            time.sleep(0.1)
