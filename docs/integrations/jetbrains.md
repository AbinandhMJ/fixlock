---
title: JetBrains IDEs
---

# JetBrains IDEs

The fixlock plugin shows locks in the editor and warns you the moment an edit undoes one. One plugin works in every JetBrains IDE: IntelliJ IDEA, PyCharm, WebStorm, PhpStorm, GoLand, Rider, CLion, RubyMine, RustRover, DataGrip and Android Studio, version 2024.3 or newer, for any language.

## Install

In the IDE, open **Settings**, **Plugins**, **Marketplace**, search for **fixlock** (vendor: Algotricz) and click **Install**.

The plugin runs the fixlock command-line tool, so you need one of:

- `pipx install fixlock` (or `pip install fixlock`): a standalone binary, **no Node.js needed**. Best for Java, Kotlin, Python, PHP, Go, Rust and .NET projects.
- `@abinandhmj/fixlock` in the project's `node_modules` (`npm i -D @abinandhmj/fixlock`): the IDE then uses the same version as your CI.
- Node.js on PATH: the plugin falls back to `npx`.

It looks for them in that order: the path in **Settings**, **Tools**, **fixlock**, then `node_modules`, then `fixlock` on PATH, then `npx`.

## Set up a repository

Open a git repository that doesn't use fixlock and click **Set up fixlock** in the notification (or **Tools**, **fixlock**, **Set Up fixlock**). It runs [`fixlock quickstart`](../cli-reference.md): no questions; it sets up the team, locks the past fixes it's surest about, installs commit hooks and adds the GitHub PR check. The output appears in the **fixlock** tool window. Then commit and push.

## What you get

- **Locked lines are visible**: a lock in the gutter and a light background. Hover the lock for why the code exists, the linked issue and who must approve a change.
- **Live warnings**: a moment after you (or an AI assistant in the IDE, such as Junie or AI Assistant) change locked code, fixlock checks the unsaved text with the same [structural matching](../how-it-works.md) as CI. If the edit undoes the fix, the lock turns amber, a banner appears above the file, and you get one alert. Reformatting and comments don't count.
- **Lock in two clicks**: select lines, right-click, **Lock Selected Lines**, say why.
- **Why is this locked?**: right-click any line.
- **Run CI locally**: **Tools**, **fixlock**, **Check Branch Against Main** or **Check Staged Changes**.
- **Find past fixes**: **Find Past Fixes Worth Locking** ranks fixes from your commit history.
- **Junie**: **Tell Junie About the Locks** writes the lock rules to `.junie/guidelines.md`, so JetBrains' coding agent leaves locked code alone.

## Settings

**Settings**, **Tools**, **fixlock**:

| Setting | Default | |
|---|---|---|
| Highlight locked lines | on | Gutter lock and background |
| Warn when an edit changes a locked fix | on | The banner and the one-time alert |
| Offer "Set up fixlock" | on | In git repositories that don't use fixlock |
| fixlock command | empty | A specific `fixlock` binary or `bin/fixlock.js` |

## Trust and privacy

The plugin runs fixlock on your machine and sends nothing anywhere. It reads the files you open and the `.fixlock/` folder.
