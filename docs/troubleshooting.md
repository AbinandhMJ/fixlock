---
title: Troubleshooting
---

# Troubleshooting

## "I'm not recognised" / warnings say "unknown"

fixlock identifies you by `git config user.email`. Check:

```bash
git config user.email
npx fixlock team
```

Ask your lead to add the email you actually commit with (`fixlock team add … --email a@x.com,b@y.com`). For a one-off, set `FIXLOCK_USER=you@company.com`.

## Claude Code doesn't show any fixlock prompt

- `.claude/settings.json` must contain `npx --no-install fixlock hook claude`. Run `npx fixlock install-claude-hook`.
- fixlock must be installed in the project (`npm i -D @abinandhmj/fixlock`). `--no-install` won't download it.
- Restart Claude Code after changing settings.
- You won't be prompted for locks you own, your own uncommitted work, or edits under `minLines`.
- Test the hook by hand:
  ```bash
  echo '{"tool_name":"Write","cwd":".","tool_input":{"file_path":"src/x.ts","content":""}}' | npx fixlock hook claude
  ```

## Commit warning or auto-lock doesn't run

- Run `npx fixlock install-hook` on each machine. Git hooks aren't shared through the repo.
- If your project uses Husky or another hook manager, it may replace `.git/hooks`. Add these lines to its hooks instead:
  - pre-commit: `npx --no-install fixlock check --staged || true`
  - post-commit: `[ -n "$FIXLOCK_IN_HOOK" ] || FIXLOCK_IN_HOOK=1 npx --no-install fixlock autolock --commit-result --quiet || true`
- Auto-lock only reacts to fix/feature messages. `chore:`, `docs:` and similar are skipped on purpose.

## CI blocks even after the owner approved

- `GITHUB_TOKEN` must be set and able to read pull requests.
- The approver's GitHub username in `.fixlock/config.json` must match their GitHub login.
- A later "Request changes" from the same person cancels their approval.
- Re-run the check after approval (GitHub: the `pull_request_review` trigger; Jenkins: re-run the job).
- The output line `! Could not read PR approvals: …` explains API errors.

## CI says "Could not diff against origin/main"

The checkout is shallow or `main` wasn't fetched. Use `fetch-depth: 0` (GitHub Actions) or `git fetch origin main` before the check.

## Too many false alarms

- Lock fewer, more specific lines: `fixlock remove FIX-00x`, then `fixlock mark` just the key lines.
- Raise `stableCode.minLines`, or set `stableCode.onEdit` to `warn`.
- Set `autoLock.lockFeatures` to `false`, or lower `autoLock.maxLines`.

## Windows

- Use PowerShell or Command Prompt; Git for Windows runs the git hooks with its own shell.
- `'bash' is not recognized`: you have an old copy of the package. Version 0.2.0 and later run tests with Node.
- Paths in locks are stored with `/`, so locks made on Windows work on macOS/Linux and in CI.

## Publishing (maintainers)

- `403 … Package name too similar`: npm blocks names close to existing ones. The package is published under the scope `@abinandhmj/fixlock`.
- Scoped packages need `npm publish --access=public`.
- `npm test` must print `E2E PASS` and `TRACKERS PASS` before publishing.

## Tracker issue didn't move

- Check the token env var is set where the command runs (your shell for `mark`, CI secrets for `check --notify`).
- Status names must match exactly what exists in Linear / ClickUp / Notion.
- The command output shows `tracker: … sync failed: <reason>`.
