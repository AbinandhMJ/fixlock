#!/usr/bin/env python3
"""Build the fixlock wheels for PyPI from the standalone binaries.

    python3 python/build_wheels.py --version 0.8.0 --bins dist/bin --out dist/wheels

`--bins` holds the binaries `bun build --compile` produced, named after their Bun target
(fixlock-bun-linux-x64-baseline, fixlock-bun-darwin-arm64, fixlock-bun-windows-x64-baseline.exe, …).
Each platform wheel puts the binary in the wheel's scripts, so pip installs a native `fixlock` command
(no Node.js needed). A universal py3-none-any wheel is built too: on other platforms it runs fixlock
through npx when Node.js is there. Standard library only; wheels follow PEP 427 / PEP 491.
"""
import argparse
import base64
import hashlib
import io
import os
import re
import stat
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

# Bun target → wheel platform tag. Linux binaries need glibc 2.17 (manylinux2014); macOS ones 13.0.
TARGETS = {
    "bun-linux-x64-baseline": "manylinux_2_17_x86_64.manylinux2014_x86_64",
    "bun-linux-arm64": "manylinux_2_17_aarch64.manylinux2014_aarch64",
    "bun-linux-x64-musl": "musllinux_1_2_x86_64",
    "bun-linux-arm64-musl": "musllinux_1_2_aarch64",
    "bun-darwin-x64": "macosx_13_0_x86_64",
    "bun-darwin-arm64": "macosx_13_0_arm64",
    "bun-windows-x64-baseline": "win_amd64",
    "bun-windows-arm64": "win_arm64",
}

SUMMARY = "Stop AI coding assistants (and teammates) from silently undoing bug fixes. Works with any language."
CLASSIFIERS = [
    "Development Status :: 4 - Beta",
    "Environment :: Console",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Operating System :: OS Independent",
    "Programming Language :: Python :: 3",
    "Topic :: Software Development :: Quality Assurance",
    "Topic :: Software Development :: Version Control :: Git",
]
KEYWORDS = "ai,code-review,regression,bug-fix,git,ci,mcp,claude,cursor,copilot,pre-commit"


def metadata(version):
    readme = open(os.path.join(HERE, "README.md"), encoding="utf-8").read()
    lines = [
        "Metadata-Version: 2.1",
        "Name: fixlock",
        "Version: " + version,
        "Summary: " + SUMMARY,
        "Home-page: https://abinandhmj.github.io/fixlock/",
        "Author: Algotricz",
        "License: MIT",
        "Keywords: " + KEYWORDS,
        "Project-URL: Documentation, https://abinandhmj.github.io/fixlock/",
        "Project-URL: Source, https://github.com/AbinandhMJ/fixlock",
        "Project-URL: Issues, https://github.com/AbinandhMJ/fixlock/issues",
        "Project-URL: Changelog, https://github.com/AbinandhMJ/fixlock/blob/main/CHANGELOG.md",
        "Requires-Python: >=3.8",
    ] + ["Classifier: " + c for c in CLASSIFIERS] + [
        "Description-Content-Type: text/markdown",
        "",
        readme,
    ]
    return "\n".join(lines)


def package_files(version):
    out = {}
    for name in ("__init__.py", "__main__.py"):
        src = open(os.path.join(HERE, "fixlock", name), encoding="utf-8").read()
        if name == "__init__.py":
            src = re.sub(r'__version__ = "[^"]*"', '__version__ = "%s"' % version, src)
        out["fixlock/" + name] = src.encode("utf-8")
    out["fixlock/LICENSE"] = open(os.path.join(HERE, "..", "LICENSE"), "rb").read()
    return out


def record_line(path, data):
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return "%s,sha256=%s,%d" % (path, digest, len(data))


def write_wheel(out_dir, version, tag, files, executables=()):
    """files: {archive path: bytes}. executables: archive paths that get mode 0755."""
    dist_info = "fixlock-%s.dist-info" % version
    files = dict(files)
    files[dist_info + "/METADATA"] = metadata(version).encode("utf-8")
    files[dist_info + "/WHEEL"] = (
        "Wheel-Version: 1.0\nGenerator: fixlock build_wheels.py\nRoot-Is-Purelib: %s\nTag: %s\n"
        % ("true" if tag == "py3-none-any" else "false", tag)
    ).encode()
    files[dist_info + "/licenses/LICENSE"] = files["fixlock/LICENSE"]
    record = [record_line(p, d) for p, d in sorted(files.items())] + [dist_info + "/RECORD,,"]
    files[dist_info + "/RECORD"] = ("\n".join(record) + "\n").encode()

    name = "fixlock-%s-%s.whl" % (version, tag)
    path = os.path.join(out_dir, name)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        # dist-info last, RECORD last of all (PEP 427 recommends it)
        order = sorted(files, key=lambda p: (p.startswith(dist_info), p.endswith("/RECORD"), p))
        for p in order:
            info = zipfile.ZipInfo(p, date_time=(2020, 1, 1, 0, 0, 0))
            mode = 0o755 if p in executables else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, files[p])
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--bins", required=True, help="folder with fixlock-<bun-target>[.exe] binaries")
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="", help="comma-separated Bun targets (default: every binary found)")
    args = ap.parse_args()
    if not re.match(r"^\d+\.\d+\.\d+([.-]?(a|b|rc|dev|post)\d*)?$", args.version):
        sys.exit("version %r is not a PEP 440 release version" % args.version)
    os.makedirs(args.out, exist_ok=True)
    base = package_files(args.version)
    only = set(filter(None, args.only.split(",")))
    built = []
    for target, plat in TARGETS.items():
        if only and target not in only:
            continue
        exe = target.startswith("bun-windows")
        src = os.path.join(args.bins, "fixlock-%s%s" % (target, ".exe" if exe else ""))
        if not os.path.exists(src):
            if only:
                sys.exit("missing binary: " + src)
            print("skip %s (no binary)" % target)
            continue
        script = "fixlock-%s.data/scripts/%s" % (args.version, "fixlock.exe" if exe else "fixlock")
        files = dict(base)
        files[script] = open(src, "rb").read()
        built.append(write_wheel(args.out, args.version, "py3-none-" + plat, files, executables={script}))
    # universal fallback: a console script that runs fixlock through npx
    files = dict(base)
    dist_info = "fixlock-%s.dist-info" % args.version
    files[dist_info + "/entry_points.txt"] = b"[console_scripts]\nfixlock = fixlock.__main__:main\n"
    built.append(write_wheel(args.out, args.version, "py3-none-any", files))
    for p in built:
        print("%6.1f MB  %s" % (os.path.getsize(p) / 1048576, os.path.basename(p)))


if __name__ == "__main__":
    main()
