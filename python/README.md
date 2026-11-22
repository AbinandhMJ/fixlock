# fixlock

**Stop AI coding assistants (and teammates) from silently undoing your bug fixes.** A product of [Algotricz](https://www.linkedin.com/company/algotricz).

fixlock locks the lines that hold a bug fix or a finished feature, each with an owner and a reason. When an AI assistant or a teammate changes what that code does, fixlock asks first in the editor, warns at commit time, and fails the pull request until the owner approves. Reformatting, comments and renames don't count; flipped conditions, changed values and deleted checks do.

It works with **any language**: Python, Go, Java, Kotlin, Rust, C#, TypeScript, PHP, Ruby, SQL, Terraform, YAML, Django/Jinja templates and [63 languages and formats in all](https://abinandhmj.github.io/fixlock/languages).

## Install

```bash
pipx install fixlock        # or: uv tool install fixlock   ·   pip install fixlock
```

This installs a native `fixlock` command. Node.js isn't needed: wheels include a standalone binary for Linux (x86-64, ARM64, glibc and musl), macOS 13+ (Intel and Apple Silicon) and Windows (x64, ARM64).

## Use

```bash
cd your-repo
fixlock init                 # team, policies, git + AI-assistant hooks
fixlock discover             # find the bug fixes already in your git history and lock them
fixlock mark app/billing.py 42-48 -m "never charge twice on retry"
fixlock check --base origin/main   # what CI will say
```

`fixlock init` connects Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI and Windsurf, so they check a lock before editing.

In CI, use the [GitHub Action](https://abinandhmj.github.io/fixlock/any-language#github-actions) (`uses: AbinandhMJ/fixlock@v0.10.0`) or run `fixlock check` after `pip install fixlock`.

With [pre-commit](https://pre-commit.com):

```yaml
repos:
  - repo: local
    hooks:
      - id: fixlock
        name: fixlock
        language: python
        additional_dependencies: [fixlock]
        entry: fixlock check --staged
        pass_filenames: false
        always_run: true
```

## How accurate is it?

On 764 real fixes from 11 open-source projects in 11 languages, harmless edits (Black, Prettier, gofmt, comments, line wrapping) were flagged 0% of the time, and 99.9% of harmful edits were caught. [See the benchmark](https://abinandhmj.github.io/fixlock/benchmark).

Docs: https://abinandhmj.github.io/fixlock/ · Source: https://github.com/AbinandhMJ/fixlock · MIT licensed. Also on npm as `@abinandhmj/fixlock`.
