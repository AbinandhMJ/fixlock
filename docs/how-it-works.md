---
title: How it works
---

# How it works

fixlock adds a memory to your repo: which lines fix a bug or hold a finished feature, who owns them, and why they exist. Then it checks that memory at five points, from the AI's first edit to the merge button.

<div class="wide-figure"><img src="/how-it-works.svg" alt="The five checkpoints: lock, AI check, commit warning, CI, owner decision"></div>

## 1. A fix is locked

A **lock** is a few lines of code plus an owner, a reason and, optionally, an issue:

```json
{ "id": "FIX-001", "type": "bug", "title": "SAP date format",
  "file": "src/sap/date.ts", "snippet": ["const p = (n) => …", "return `${d.getFullYear()}-…`;"],
  "owner": "abinandhmj", "reason": "SAP B1 rejects ISO timestamps for DocDate", "issue": "linear:ENG-12" }
```

Locks live in `.fixlock/registry.json`, committed with your code, so the whole team (and CI) shares them. They're created:

- **automatically**: a `fix:` or `feat:` commit locks the lines it added (post-commit hook). The commit body becomes "why it exists".
- **for history**: `npx fixlock autolock --all` locks past fixes that are still in the code.
- **by hand**: `npx fixlock mark <file> <lines> -m "why"` for the few lines that matter most.

A lock matches the *text* of its lines, not their line numbers, so code can move around freely. Only deleting or rewriting the locked lines counts as a change.

## 2. The AI checks before editing

Before an assistant changes existing lines, it asks fixlock, which answers with a **verdict**:

| Verdict | When | What the assistant does |
|---|---|---|
| `ok` | Nothing locked or protected is affected, or you own the lock | Goes ahead |
| `warn` | Locked lines are touched but kept, or your policy is `warn` | Goes ahead and mentions it |
| `ask` | The edit removes or rewrites locked lines (default for bug fixes) | Explains and waits for your yes |
| `block` | Policy is `block` | Leaves the lines alone and builds around them |

How the assistant asks depends on the tool:

- **MCP server** (Claude Code, Cursor, Copilot, Codex, Gemini, Windsurf): the assistant calls `fixlock_check_edit`.
- **Rules file** (12 assistants): `AGENTS.md`, `.cursor/rules/fixlock.mdc` and the rest tell the assistant to check first, and list the locks.
- **Pre-edit hook** (Claude Code): every edit is checked before it happens, even if the model forgets.

### Working code that isn't locked

Nobody locks everything, so a second guard covers the rest. If an edit would delete or rewrite lines that are **already committed**, written by someone else or by you more than 7 days ago, the verdict is `ask`. Your own fresh and uncommitted work is never interrupted.

## 3. The commit warns

The pre-commit hook (`npx fixlock install-hook`) prints the same findings in the terminal. It **never blocks a commit**: people can always save their work.

## 4. CI enforces

`npx fixlock check` in CI compares the PR with `main`. If a locked line is gone, the check fails with the lock, the reason, and who must approve. It passes when:

- the lock's owner (or a lead, depending on [policy](team-lead-guide.md#choosing-the-rules)) approves the PR on GitHub, or
- the owner opened the PR themselves, or
- the lines are restored.

This is the one hard stop, and it's what makes the earlier warnings trustworthy: whatever tool wrote the code, a reverted fix can't merge unnoticed.

## 5. The owner decides

Sometimes the change is right: the fix is no longer needed, or the code was replaced on purpose. The owner approves, then re-locks the new lines or removes the lock (`npx fixlock remove FIX-001`). The point isn't to freeze code. It's that undoing a fix becomes a **decision**, not an accident.

## What fixlock is not

- **Not a replacement for tests.** A test proves behaviour; a lock remembers that a specific change mattered and who to ask. They work best together: `mark --test spec.ts` records the test that guards a fix.
- **Not a code freeze.** Everything stays editable. Only removing locked lines needs a second person.
- **Not tied to one AI.** The rules, the MCP server and the CI check work the same whatever assistant (or human) wrote the code.
