---
title: Python, Go, Java, .NET and other projects
---

# Using fixlock in any project

fixlock isn't only for JavaScript. It locks code in [63 languages and formats](languages.md), and every other file still works with text matching. Your project doesn't need to be a Node project. Install fixlock as a standalone command from PyPI (no Node.js at all), or run it through npm if Node.js 18+ is already on the machine.

## Install with pip, pipx or uv

The `fixlock` package on PyPI is a self-contained binary for Linux (glibc and musl), macOS and Windows, on x64 and ARM. Nothing else is needed: no Node.js, no runtime.

```bash
pipx install fixlock        # or: uv tool install fixlock · pip install fixlock
fixlock init
fixlock discover
```

When you run `init` from the pip-installed command, fixlock records `"launcher": "fixlock"` in `.fixlock/config.json`. The hooks, MCP configs and rules files then call `fixlock …` directly, so every developer on the team installs it once with `pipx install fixlock`. See [`launcher`](configuration.md#launcher) to switch a repo between the two.

`python -m fixlock` works too. On a platform without a prebuilt binary, pip installs a small fallback that runs fixlock through `npx`.

## Set up with npx

In your repository (any language), with Node.js 18+ on the machine:

```bash
npx @abinandhmj/fixlock init
```

There's nothing to add to your project's dependencies. fixlock notices there's no `package.json` that installs it, and writes every hook and assistant config to run it with `npx -y @abinandhmj/fixlock@<version>`:

- the Claude Code hook and the git hooks,
- the MCP config for Claude Code, Cursor, Copilot, Gemini and others,
- the rules files (`CLAUDE.md`, `AGENTS.md`, Cursor rules…).

The version is pinned to the minor version you set up with, so a breaking release never sneaks in. Re-run `npx @abinandhmj/fixlock sync` after upgrading.

Then find the fixes already in your history:

```bash
npx @abinandhmj/fixlock discover
```

`discover` recognizes fixes and test files in each ecosystem: `if err != nil` and `_test.go`, `if let Some` and `tests/`, `guard let` and `*Tests.swift`, `IS NULL` in SQL migrations, `*ngIf` in Angular templates, `*Test.java` under `src/test/`, `_spec.rb`, `*Tests.cs` and so on.

> Always use the scoped name `@abinandhmj/fixlock`. The bare `npx fixlock` only works in projects that install it.

## CI

### GitHub Actions

The fixlock action ([on GitHub Marketplace](https://github.com/marketplace/actions/fixlock-by-algotricz)) needs no `package.json` and no install step. It runs fixlock from the action itself:

```yaml
# .github/workflows/fixlock.yml
name: fixlock
on:
  pull_request:
  pull_request_review:        # re-run when the owner approves
    types: [submitted, dismissed]
permissions: { contents: read, pull-requests: write }
jobs:
  fixlock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: AbinandhMJ/fixlock@v0.10.0
```

It compares the PR with its base branch, posts a comment listing the affected locks and who must approve, and fails until they do. Inputs: `base`, `comment` (default `true`), `notify` (update your issue tracker), `args` (extra `fixlock check` flags), `github-token`. Then require the **fixlock** check on `main` in **Settings → Branches**.

### GitLab CI, Jenkins, Bitbucket, Azure Pipelines…

Any image with Node.js 18+ works:

```yaml
# .gitlab-ci.yml
fixlock:
  image: node:22
  rules: [{ if: $CI_PIPELINE_SOURCE == "merge_request_event" }]
  variables: { GIT_DEPTH: 0 }
  script:
    - npx -y @abinandhmj/fixlock@0.7 check --base origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME
```

More in [CI setup](ci-setup.md).

## Commit hooks with pre-commit

If your team uses [pre-commit](https://pre-commit.com) (common in Python, Go and Rust projects):

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/AbinandhMJ/fixlock
    rev: v0.7.0
    hooks:
      - id: fixlock          # warns about changed locked fixes, never blocks
      # - id: fixlock-strict # blocks the commit instead
```

pre-commit installs fixlock in its own environment. If Node.js is already on the machine, add `default_language_version: { node: system }` to skip downloading it.

No Node.js at all? Use the PyPI package instead:

```yaml
repos:
  - repo: local
    hooks:
      - id: fixlock
        name: fixlock
        entry: fixlock check --staged
        language: python
        additional_dependencies: [fixlock]
        pass_filenames: false
```

Not using pre-commit? `npx @abinandhmj/fixlock install-hook` installs plain git hooks that do the same.

## Monorepos and mixed stacks

One `.fixlock/` folder at the repository root covers everything in it: a Spring Boot API, an Angular front end, Terraform, SQL migrations and a Python data job can all have locks in the same repo, each read in its own language.
