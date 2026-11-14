---
title: Developer guide
---

# Developer guide

What fixlock does while you work, and what to do when it speaks up.

## One-time setup on your machine

```bash
npm install
npx fixlock install-hook
```

The hooks:
- **before each commit**: warn you if you are changing locked lines or rewriting working code. They never block a commit.
- **after each `fix:` / `feat:` commit**: lock the lines you just wrote, in a small follow-up commit.

Check that fixlock knows who you are:

```bash
npx fixlock team
git config user.email
```

Your git email must be in the team list. If it isn't, ask your lead to add it.

## When your AI wants to change something

If you use Claude Code, you will sometimes see a prompt like this before an edit:

```
🔒 fixlock: heads up Ravi — this change affects a locked bug fix, which may bring back old behaviour:
• FIX-001 "SAP date format" (bug fix by @abinandhmj) — src/app/core/utils/date.util.ts lines 3-4
  Why it exists: SAP B1 rejects ISO timestamps for DocDate
  This edit removes/rewrites: return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  Policy: confirm with the developer; the PR will need approval from @abinandhmj.
```

What to do:
- **Didn't mean to touch it?** Say no. Tell the AI to leave those lines and build around them.
- **Need to change it?** Say yes, but talk to the owner first. Your PR will need their approval.
- **Blocked?** The AI isn't allowed to change these lines. Change them yourself if you agreed this with the owner.

A similar prompt appears when the AI would rewrite **working code** that someone else wrote, or that you wrote more than a week ago. Read which lines it lists. Large silent rewrites are where old bugs come back.

With other AI tools (Codex, Cursor, Copilot…), the tool reads the same rules from its rules file, and you see the warning at commit time instead. See [AI tools](ai-tools.md).

## Before you commit

```
LOCKED  FIX-001 "SAP date format" (bug, owner @abinandhmj) — src/app/core/utils/date.util.ts
    - const p = (n: number) => String(n).padStart(2, '0');
    → needs approval from @abinandhmj when you open the PR, or restore these lines.
REWRITE  src/app/customer.ts — 9 existing working line(s) rewritten (by @abinandhmj)

! Heads up: 1 locked change(s). The commit is allowed, but CI will ask for approval.
```

`LOCKED` means your PR will be blocked until the owner approves. `REWRITE` is information for you and the reviewer. Check it was intended.

## Is this line locked?

```bash
npx fixlock why src/app/core/utils/date.util.ts:3
```

```
🔒 FIX-001 SAP date format  (bug, owner @abinandhmj)
   lines 3-4 · why: SAP B1 rejects ISO timestamps for DocDate
   policy: ask; approval: @abinandhmj
```

## Locking your own fix

Most of the time this is automatic: commit with `fix: …` and the lines are locked. To lock by hand, or to lock only the key lines of a big change:

```bash
npx fixlock mark src/app/core/utils/date.util.ts 3-4 \
  -m "SAP B1 rejects ISO timestamps for DocDate" \
  --title "SAP date format" --issue linear:ENG-12
```

| Flag | Meaning |
|---|---|
| `-m` | Why the fix exists. Write it for a teammate who wasn't there. |
| `--title` | Short name shown in warnings and the changelog. |
| `--type feature` | Lock a feature instead of a bug fix. |
| `--issue` | Link a tracker issue (`linear:`, `clickup:`, `notion:`, `bugasura:`). |
| `--owner` | Make someone else the owner (GitHub username). |
| `--test` | Note the test that guards this fix. |

Lock the **few lines that actually fix the bug**, not the whole function. Small locks mean fewer false alarms.

## Your PR is blocked

The PR comment tells you which lock is affected and who must approve:

> ❌ **FIX-001** SAP date format (bug) — `src/app/core/utils/date.util.ts`
> **Approve this PR as @abinandhmj** to accept the change, or restore the lines.

Either restore the lines, or ask the owner to review. Once they approve on GitHub, re-run the check and it turns green.

## False alarms

Reformatting or commenting a locked line is fine: fixlock compares code structure, not text. Renaming a variable shows a warning but doesn't block. If you changed a locked line's logic on purpose and the owner agreed:

1. Get the PR approved.
2. The owner re-locks the new lines: `npx fixlock remove FIX-001` then `npx fixlock mark …`.

## Good habits

- Commit messages: `fix(ENG-15): what you fixed`, `feat(orders): what you added`.
- Lock the fix in the same PR as the fix.
- When asking an AI to port something from another codebase, say: "implement this feature in our existing code; don't replace existing files."
