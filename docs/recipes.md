---
title: Recipes
---

# Recipes

Common situations, and what to do in each.

## Protect the fixes you already have

You're adding fixlock to a project with months of history.

```bash
npx fixlock autolock --all --dry-run   # review the list (last 300 commits)
npx fixlock autolock --all             # lock them
npx fixlock list                       # check
git add .fixlock && git commit -m "chore: lock existing fixes"
```

Backfill finds `fix:` commits and messages like "fixed … bug" or "hotfix" whose lines are still in the code. It skips blocks over 40 lines and files that fixlock or AI tools generate. For important fixes with unusual commit messages, lock the key lines by hand:

```bash
npx fixlock mark src/billing/tax.ts 41-44 -m "GST must round per line item, not per invoice" --issue linear:FIN-7
```

## Port features from another codebase with AI

This is the case fixlock was built for: an assistant copies code from a legacy app and silently overwrites fixes.

1. Before starting, ask the assistant: *"Use fixlock_list and plan the port around the locked fixes."*
2. Phrase the task as *"implement this feature in our existing code"*, not *"copy this file"*.
3. When the assistant hits a lock, it stops with `ask` or `block`. Keep the locked lines and adapt the ported code to them.
4. The commit warning and the CI check catch anything that slipped through.

## Let an AI refactor a module safely

```text
Refactor src/app/orders. Before changing existing lines, call fixlock_check_edit.
Keep every locked line; if a lock blocks the refactor, stop and tell me which one.
```

Use `npx fixlock why src/app/orders/order.service.ts` yourself first to see what's locked there. For a large refactor that intentionally replaces locked code, agree it with the lock owners up front; they approve the PR and re-lock the new lines.

## A lock is wrong or no longer needed

The fix was replaced on purpose, or the feature was removed.

```bash
npx fixlock remove FIX-004     # only the owner (or a lead, per policy) can do this
```

If the code moved or changed shape but still matters, re-lock it:

```bash
npx fixlock remove FIX-004
npx fixlock mark src/sap/date.ts 10-12 -m "SAP B1 rejects ISO timestamps" --title "SAP date format"
```

## Too many warnings

- **Lock smaller.** A lock should be the 2–5 lines that actually fix the bug, not the whole function.
- **Turn off feature locking** if `feat:` commits lock too much: `"autoLock": { "lockFeatures": false }`.
- **Loosen the working-code guard**: `"stableCode": { "onEdit": "warn", "minLines": 5 }`.
- **Warn instead of ask for features**: `"policies": { "feature": { "onEdit": "warn" } }`.

See [Configuration](configuration.md) for all settings.

## Someone keeps reverting the same fix

Make it impossible to miss:

```json
"policies": { "bug": { "onEdit": "block", "approval": "owner" } }
```

With `block`, Claude Code refuses the edit outright and MCP assistants are told not to make it. Add a test that fails without the fix and record it on the lock (`mark … --test date.util.spec.ts`) so the reason is obvious to whoever hits it next.

## Different assistants on one team

Each developer uses what they like. The team lead enables them all once:

```bash
npx fixlock setup claude-code cursor copilot   # project files, committed
```

Codex and Windsurf users each run `npx fixlock setup codex` (or `windsurf`) on their own machine. See [AI assistants](integrations/index.md).

## Monorepo

fixlock works per git repository, so one `.fixlock/` covers the whole monorepo. Use `protectedPaths` for packages that need extra attention, and policies apply to every lock regardless of package.

## Running without GitHub

The CI check works anywhere with Node and git ([GitLab](https://github.com/AbinandhMJ/fixlock/tree/main/examples/gitlab), Jenkins, others). Approvals are read from GitHub only, so elsewhere a locked change passes when the lock's owner opens the PR, or once the lines are restored.
