---
title: OpenAI Codex
---

# OpenAI Codex

Works with the Codex CLI and the Codex IDE extension.

## Setup

In the project (once, by the team lead):

```bash
npm i -D @abinandhmj/fixlock
npx fixlock tools add codex      # writes the AGENTS.md section
```

On each developer's machine:

```bash
npx fixlock setup codex
```

This adds the MCP server to **your user config**, `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`):

```toml
[mcp_servers.fixlock]
command = "npx"
args = ["--no-install", "fixlock", "mcp"]
```

It's a user-level setting, so it applies to every repo. In repos without fixlock the tools just say "not set up".

## Using it

Codex reads `AGENTS.md`, which tells it to call `fixlock_check_edit` before changing existing lines. You can also ask:

- *"Use fixlock_list, then plan the refactor around the locked fixes."*

Codex has no pre-edit hook for fixlock; the commit warning and the [CI check](../ci-setup.md) are the safety net.
