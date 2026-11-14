---
title: See it in action
---

# See it in action

The demo plays a real story in a throwaway git repo, using fixlock's real commands. It takes about a minute and doesn't touch your projects.

```bash
npx @abinandhmj/fixlock demo
```

<div class="wide-figure"><img src="/demo.svg" alt="Terminal recording of the fixlock demo"></div>

Add `--keep` to keep the demo repo afterwards and poke around (`npx fixlock list`, `npx fixlock why src/sap/date.ts:3`).

## What happens, step by step

### 1. Abi fixes a bug

SAP's API rejects ISO timestamps, so Abi changes `toSapDate()` to send `yyyy-MM-dd` and commits:

```
git commit -m "fix(ENG-12): send SAP DocDate as yyyy-MM-dd" -m "SAP B1 Service Layer rejects ISO timestamps for DocDate."
```

The post-commit hook locks the two lines that fixed it, owned by Abi, with the commit body as the reason and ENG-12 as the linked issue. Abi doesn't run any fixlock command.

### 2. Ravi's AI tries to undo it

Weeks later, Ravi asks his assistant to port the order screen from the old portal. The old portal still has the buggy `toSapDate()`, and the AI wants to bring it back. Before editing, it checks with fixlock:

```
verdict: ASK THE DEVELOPER FIRST
• FIX-001 "send SAP DocDate as yyyy-MM-dd" (bug fix by @abinandhmj) — src/sap/date.ts lines 2-3
  Why it exists: SAP B1 Service Layer rejects ISO timestamps for DocDate.
  This edit removes/rewrites: return `${d.getFullYear()}-…`;
  Policy: confirm with the developer; the PR will need approval from @abinandhmj.
```

**This is where most regressions stop.** The AI explains the conflict, Ravi sees a fix he didn't know about, and the AI builds around it instead.

### 3. Ravi commits anyway

Suppose Ravi says "go ahead". The commit goes through, with a warning: fixlock never blocks local work.

### 4. CI blocks the pull request

```
LOCKED  FIX-001 "send SAP DocDate as yyyy-MM-dd" (bug, owner @abinandhmj)
    → needs approval from @abinandhmj on the PR, or restore these lines.
✖ 1 locked change(s) without approval.
```

Git saw no conflict at all. Without fixlock, this merges and the SAP bug is back in production.

### 5. The owner decides

Abi is asked to review. If the change is intended, Abi approves and the check passes, with the owner on record. If not, Ravi restores the two lines.

## Try it on your repo

```bash
npm i -D @abinandhmj/fixlock
npx fixlock init
npx fixlock autolock --all --dry-run   # which of your past fixes would be locked
```

Then [connect your AI assistant](integrations/index.md) and [add the CI check](ci-setup.md).

## Share the demo

A video version (MP4, GIF) of the recording is in the repo under [`assets/demo/`](https://github.com/AbinandhMJ/fixlock/tree/main/assets/demo), for slides, posts and team chats.
