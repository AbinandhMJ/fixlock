# Changelog

## 0.9.1

- Ready for IntelliJ IDEA 2026.3 and later: no longer uses platform APIs that JetBrains has deprecated or scheduled for removal.

## 0.9.0

- First release for JetBrains IDEs (IntelliJ IDEA, PyCharm, WebStorm, PhpStorm, GoLand, Rider, Android Studio and the rest).
- Locked lines get a gutter lock and a light background; hover for the reason, the issue and who approves.
- An edit that undoes a locked fix turns the lock amber, shows a banner above the file and alerts once. Structural matching, the same as CI.
- One-click setup: Set up fixlock runs `fixlock quickstart` in a git repository that doesn't use fixlock yet.
- Lock Selected Lines, Why Is This Locked?, Check Branch, Check Staged Changes, Find Past Fixes and Tell Junie About the Locks, in the Tools menu and the editor's right-click menu.
