"""fixlock: stop AI coding assistants (and teammates) from silently undoing bug fixes.

This package installs the standalone `fixlock` command-line tool. Use it from your shell:

    fixlock init
    fixlock discover

or from Python: `python -m fixlock …`. Docs: https://abinandhmj.github.io/fixlock/
"""
import os
import shutil
import sys
import sysconfig

__version__ = "0.0.0"  # replaced when the wheel is built

_EXE = "fixlock.exe" if sys.platform == "win32" else "fixlock"


def binary_path():
    """Path of the fixlock executable installed with this package, or None (universal wheel)."""
    candidates = []
    for scheme in ("posix_user", "nt_user", "posix_prefix", "nt", None):
        try:
            d = sysconfig.get_path("scripts", scheme) if scheme else sysconfig.get_path("scripts")
        except KeyError:
            continue
        if d:
            candidates.append(os.path.join(d, _EXE))
    candidates.append(os.path.join(os.path.dirname(sys.executable), _EXE))
    for c in candidates:
        if os.path.isfile(c) and os.access(c, os.X_OK) and not _is_wrapper(c):
            return c
    return None


def _is_wrapper(path):
    # In the universal wheel `fixlock` is a small launcher pip generated (a script, or a tiny .exe on
    # Windows), not the binary. The real binary is tens of megabytes.
    try:
        return os.path.getsize(path) < 5 * 1024 * 1024
    except OSError:
        return True


def npx_command():
    """Fallback for platforms without a prebuilt binary: run fixlock through Node.js."""
    npx = shutil.which("npx")
    if not npx:
        return None
    return [npx, "-y", "@abinandhmj/fixlock@" + __version__]
