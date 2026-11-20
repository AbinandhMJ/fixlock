---
title: AI review of changed locks
---

# AI review of changed locks

When a change touches a locked fix, fixlock can ask an AI model one question: **does the code still do what the locked lines did?** The model sees the lock (what it fixes, why, the locked lines) and the file as it is now, and answers *preserved*, *broken* or *unsure* with a sentence or two naming the lines. The answer appears next to the lock in the check and the PR comment:

> **Needs approval: FIX-001** never charge zero (bug) — `src/pay.py`
> - AI review: the fix looks preserved (claude-haiku-5-5). The guard moved into `check_positive` (lines 5-7), called on line 2. This is advice; the lock still needs its owner's approval.

It's **advice only**. The deterministic check decides: a changed lock still needs its owner's approval (or a [passing linked test](tests-and-lifecycle.md)) whatever the model says. The answer helps the owner approve a safe refactor quickly, or spot a broken fix in a diff that looks harmless.

Only locks that still need a person are sent: not approved ones, not ones satisfied by their test, and nothing at all when no lock changed.

## Turn it on

It's off by default, and code goes only where you choose, with your own key.

**Anthropic** (default model `claude-haiku-5-5`):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
fixlock check --judge
```

**Any OpenAI-compatible API** (OpenAI, Azure OpenAI, OpenRouter, a local server):

```json
"judge": { "enabled": true, "provider": "openai", "model": "<model name>", "url": "https://api.openai.com/v1" }
```

with `OPENAI_API_KEY` set.

**A local command**, so nothing leaves the machine. The prompt arrives on standard input and the command prints the answer:

```json
"judge": { "enabled": true, "provider": "command", "command": "ollama run llama3.1" }
```

`"enabled": true` in `.fixlock/config.json` runs it on every check; `--judge` runs it once.

## In CI

GitHub Action:

```yaml
      - uses: AbinandhMJ/fixlock@v0.10.0
        with:
          judge: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

GitLab: add `ANTHROPIC_API_KEY` as a masked variable and set `FIXLOCK_ARGS: "--judge"`.

## Settings

| `judge.` | Default | |
|---|---|---|
| `enabled` | `false` | Ask on every check |
| `provider` | `anthropic` | `anthropic`, `openai` or `command` |
| `model` | `claude-haiku-5-5` (Anthropic) | Required for `openai` |
| `url` | | API base URL (OpenAI-compatible servers, proxies) |
| `command` | | For `provider: command` |
| `timeout` | `60` | Seconds per lock |
| `maxLines` | `400` | Longer files are sent as this many lines around the lock |

If the model can't be reached, the comment says so and the check result is unchanged.
