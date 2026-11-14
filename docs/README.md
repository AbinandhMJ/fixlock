---
title: fixlock — fixed stays fixed
layout: home

hero:
  name: fixlock
  text: Fixed stays fixed.
  tagline: Stop AI coding assistants (and teammates) from silently undoing bug fixes. Works with Claude Code, Cursor, GitHub Copilot and Codex. A product of Algotricz.
  image:
    light: /fixlock-mark.svg
    dark: /fixlock-mark-dark.svg
    alt: fixlock
  actions:
    - theme: brand
      text: See it in 60 seconds
      link: /demo
    - theme: alt
      text: Get started
      link: /getting-started
    - theme: alt
      text: How it works
      link: /how-it-works

features:
  - icon: 🔒
    title: Lock what's fixed
    details: Every fix and feature commit locks its own lines, with an owner and the reason it exists. Past fixes in your history can be locked in one command.
  - icon: 🤖
    title: AI checks before it edits
    details: Claude Code, Cursor, Copilot, Codex and any MCP client ask fixlock before changing existing code, and get "ok", "ask" or "block" with the reason.
  - icon: 🛡️
    title: Working code is protected too
    details: Even code nobody locked is guarded. An AI rewrite of committed, working code asks the developer first.
  - icon: ✅
    title: The owner decides
    details: A PR that changes a locked line is blocked until its owner or a lead approves. Git can't see this; fixlock can.
  - icon: 🔁
    title: Your tracker follows
    details: Locking a fix closes its Linear, ClickUp or Notion issue. A PR that reverts it reopens the issue.
  - icon: 🪶
    title: Zero dependencies
    details: Plain Node.js you can read, no telemetry, a read-only MCP server, and local hooks that warn but never block.
---

<div style="margin: 48px auto 0; max-width: 960px">

## The problem

You fix a bug. Weeks later an AI assistant ports a feature from an old codebase, rewrites the file, and your fix is gone. **Git merges it with no conflict**, because to git it's a normal edit. Tests only catch it if someone wrote a test for that exact bug; code review only catches it if the reviewer remembers.

fixlock remembers for the whole team, and tells the AI before it makes the change.

<div class="wide-figure"><img src="/demo.svg" alt="Terminal recording of the fixlock demo"></div>

```bash
npx @abinandhmj/fixlock demo      # run that yourself, in a throwaway repo
```

## Start here

| | |
|---|---|
| [See it in action](demo.md) | The 60-second demo, step by step |
| [How it works](how-it-works.md) | The five checkpoints, and what each one catches |
| [Getting started](getting-started.md) | fixlock running on your repo in 10 minutes |
| [AI assistants](integrations/index.md) | Connect Claude Code, Cursor, Copilot or Codex |
| [Recipes](recipes.md) | Common situations and what to do |
| [FAQ](faq.md) | "Why not just tests?" and other questions |

## Guides

| Guide | Read it if you… |
|---|---|
| [Team lead guide](team-lead-guide.md) | set up the project, the team and the rules |
| [Developer guide](developer-guide.md) | write code day to day and want to know what the warnings mean |
| [AI tools](ai-tools.md) | want the rules file for any of 12 assistants |
| [CI setup](ci-setup.md) | wire the PR check into GitHub Actions, Jenkins or GitLab |
| [Examples](examples.md) | want ready-to-copy configs |
| [Issue trackers](trackers.md) | want Linear, ClickUp, Notion or Bugasura to update themselves |
| [Configuration](configuration.md) · [Commands](cli-reference.md) · [Troubleshooting](troubleshooting.md) · [Security](security.md) | need a reference |

</div>
