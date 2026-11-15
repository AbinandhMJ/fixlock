"""`python -m fixlock …` and the launcher used by the universal (fallback) wheel."""
import os
import subprocess
import sys

from . import binary_path, npx_command


def main():
    exe = binary_path()
    if exe:
        cmd = [exe]
    else:
        cmd = npx_command()
        if not cmd:
            sys.stderr.write(
                "fixlock: there is no prebuilt binary for this platform and Node.js (npx) wasn't found.\n"
                "Install Node.js 18+ (https://nodejs.org) or download a binary from "
                "https://github.com/AbinandhMJ/fixlock/releases\n"
            )
            return 1
    args = sys.argv[1:]
    if os.name == "nt":
        return subprocess.call(cmd + args)
    try:
        os.execv(cmd[0], cmd + args)
    except OSError as e:
        sys.stderr.write("fixlock: could not start %s: %s\n" % (cmd[0], e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
