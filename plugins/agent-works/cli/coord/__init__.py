"""The machine-wide coordination layer of agent-works: one store per machine, written only through ``aw``.

Modules: ``store`` (the store itself: paths, atomic writes, short lock files, processes), ``locks`` (exclusive locks
with a queue), ``leases`` (declared shared use), ``sysinfo`` (live readings), ``notes``, ``claims``, ``learnings``,
``agents``. Each command module exposes ``register(subparsers)``. The contract agents read is
``core/references/coordination.md``.

``common`` is the CLI's shared module; it is re-exported here so the modules of this package write
``from . import common`` whichever way the package was imported (``coord`` with the ``cli`` folder on the path, or
``cli.coord``).
"""
import os
import sys

sys.dont_write_bytecode = True

try:
    import common  # the cli folder is on sys.path (aw.py, the hooks and cli/__init__ put it there)
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import common  # noqa: F401
