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
npx fixlock autolock --all --dry-run   # preview
npx fixlock autolock --all             # lock them
```

This finds past `fix:` commits, and messages like "fixed … bug" or "hotfix", whose lines are still in the code.

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

## 5. Turn on the PR check

Add the CI step from [CI setup](ci-setup.md) and make it a required check on `main`.

## Try it

```bash
npx fixlock list                          # what is locked
npx fixlock why src/app/core/date.ts:12   # is this line locked? who owns it?
npx fixlock check --base origin/main      # what CI will say about your branch
```

Next: [Team lead guide](team-lead-guide.md) or [Developer guide](developer-guide.md).
