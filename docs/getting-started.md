---
title: Getting started
---

# Getting started

About 10 minutes. You need Node.js 18 or newer, git, and a git repository.

## 1. Install

In your project folder:

```bash
npm i -D @abinandhmj/fixlock
```

Installing it as a dev dependency gives everyone the short `npx fixlock …` command. Without installing, use `npx @abinandhmj/fixlock …`.

Not a JavaScript project? Skip this step: see [Python, Go, Java, .NET and other projects](any-language.md). fixlock reads [63 languages and formats](languages.md).

## 2. Set up (team lead, once)

```bash
npx fixlock init
```

It asks, in order:

1. **Project name**
2. **Team members**: name, GitHub username, git email, role (`lead`, `developer`, `reviewer`). Press Enter on an empty name to finish.
3. **AI tools** the team uses. Tools found on your machine are pre-filled. Add the ones your teammates use too.
4. **Rules for bug fixes and features**: what happens when someone edits locked lines, and who must approve the PR.
5. **Working-code guard** and **auto-lock** (keep the defaults if unsure).
6. **Issue tracker** (optional).
7. **Hooks**: Claude Code hook, git hooks, CODEOWNERS.

Not sure about an answer? Press Enter for the default. You can change everything later in `.fixlock/config.json`.

## 3. Lock the fixes you already have

```bash
npx fixlock discover
```

`discover` reads your git history and ranks the past bug fixes whose code is still there, whatever your commit style. Each suggestion shows why it was picked:

```
Found 41 block(s) from 31 past fix(es) worth locking in 500 commit(s)

  1. high   bug  lib/response.js:765-771  Fix behavior of null/undefined as "maxAge" in res.cookie  5855339
       message says "fix" · links #3935 · came with a test (test/res.cookie.js) · adds a guard (null/empty check)
       │ if (opts.maxAge != null) {  ⏎  var maxAge = opts.maxAge - 0  … (+3)

Lock which? e.g. 1-3,5 · all · none (none):
```

Pick the ones you want (`1-5`, `all`), or run `npx fixlock discover --apply` to lock every suggestion. A fix that was **reverted and then re-applied** ranks highest: that bug has already come back once. When the fix came with a test, the test is linked to the lock.

Only using Conventional Commits? `npx fixlock autolock --all` locks every `fix:`/`feat:` commit without scoring.

## 4. Commit and share

```bash
git add .
git commit -m "chore: set up fixlock"
git push
```

Commit every file `init` generated. Each teammate then runs:

```bash
npm install
npx fixlock install-hook
```

## 5. Connect your AI assistants

`init` already connects the project-level ones. Each developer using Codex or Windsurf also runs:

```bash
npx fixlock setup codex     # or windsurf
```

See [AI assistants](integrations/) for Claude Code, Cursor, Copilot and Codex.

## 6. Turn on the PR check

Add the CI step from [CI setup](ci-setup.md) and make it a required check on `main`.

## Try it

```bash
npx fixlock list                          # what is locked
npx fixlock why src/app/core/date.ts:12   # is this line locked? who owns it?
npx fixlock check --base origin/main      # what CI will say about your branch
```

Next: [Team lead guide](team-lead-guide.md) or [Developer guide](developer-guide.md).
