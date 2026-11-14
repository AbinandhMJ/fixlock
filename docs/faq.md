---
title: FAQ
---

# FAQ

## Why not just write tests?

You should. But a test only catches a regression if someone wrote a test for that exact bug, and many real fixes (an API date format, a rounding rule, a null check for one customer) never get one. fixlock covers the fix from the moment it's committed, tells the AI *before* it edits, and names the person to ask. When a fix does have a test, record it with `mark --test`, and you get both.

## Why not CODEOWNERS and branch protection?

CODEOWNERS works on whole files or folders: every change to `date.util.ts` needs Abi, even a comment. fixlock works on the few lines that matter, explains *why* they matter, and tells the AI before the edit, not after the PR is open. fixlock also generates CODEOWNERS from your locks if you want GitHub to request the review automatically.

## How is this different from code review?

Review relies on the reviewer remembering that a line fixed a bug months ago. With AI-sized diffs, that line is one of hundreds. fixlock remembers for them and puts the lock, the reason and the owner at the top of the PR.

| | Tests | CODEOWNERS | Code review | fixlock |
|---|:-:|:-:|:-:|:-:|
| Catches a reverted fix with no test | | | if remembered | ✅ |
| Warns the AI before it edits | | | | ✅ |
| Line-level, with the reason | | | | ✅ |
| Names who must approve | | ✅ | | ✅ |
| Proves behaviour | ✅ | | | |

## Does it slow developers down?

Locally, fixlock only warns: commits are never blocked, and your own fresh work never triggers a prompt. The only hard stop is the CI check, and it fires only when a locked line is removed. Day to day, most developers never see it.

## Does the AI have to cooperate?

There are three layers:

1. **Claude Code**: the pre-edit hook checks every edit, whether or not the model remembers to, and Claude is denied permission to edit the hook settings.
2. **Other assistants**: they're instructed (rules file) and equipped (MCP) to check. Good models follow this reliably, but it isn't enforced.
3. **Everyone**: the commit warning and the CI check don't depend on the AI at all.

So the worst case is that a reverted fix is caught at the PR instead of before the edit.

## What if I rename a variable inside a locked line?

fixlock compares code structure, not text. Reformatting, comments, quote style and line wrapping don't count as changes. A consistent rename of a variable (`user` → `account` everywhere in the lock) is reported as a **rename warning**: the PR isn't blocked, but reviewers see it. Renaming a field or object key (`user.role` → `user.type`) reads different data, so it counts as a real change.

You can make renames stricter or quieter with [`matching.renames`](configuration.md#matching).

## Does fixlock send my code anywhere?

No. There's no telemetry. The network is used only to read PR approvals from GitHub in CI and to update your tracker, and only when you configure them. The MCP server runs locally over stdio. See [Security & privacy](security.md).

## Which languages does it support?

All of them. Locks are lines of text, so fixlock works for TypeScript, Java, Python, SQL, YAML, anything in git.

## Do teammates need to install anything?

`npm install` (fixlock is a dev dependency) and, optionally, `npx fixlock install-hook` for the commit warning. Everything else (locks, rules files, assistant configs) is committed to the repo.

## Is it free?

Yes, MIT licensed.
