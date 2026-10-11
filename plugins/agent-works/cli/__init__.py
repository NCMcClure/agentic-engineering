"""The agent-works CLI. Modules import each other by bare name (``import common``): this puts their folder on the path
so ``import cli.<module>`` (tests) works too."""
import os
import sys

sys.dont_write_bytecode = True
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
