# Team lead guide

For the team lead or project manager who sets fixlock up and decides the rules.

## Roles

| Role | What it means |
|---|---|
| `lead` | Can approve changes to any lock when the policy allows leads. Owner of locks whose owner has left the team. |
| `developer` | Normal team member. Owns the locks they create. |
| `reviewer` | Same as developer; useful for QA or reviewers who mark fixes. |

People are recognised by their **git email** (who is editing or committing) and their **GitHub username** (who approved a PR). Make sure both are right. Many people commit with a personal and a work email, so list both, comma separated.

```bash
npx fixlock team                       # list
npx fixlock team add --name "Ravi K" --github ravik --email ravi@fluxo.dev,ravi.k@gmail.com --role developer
npx fixlock team remove ravik
```

## Choosing the rules

There are separate rules for **bug fixes** and **features**:

**On edit**: what happens when someone else's AI tries to change locked lines:

| Value | Effect |
|---|---|
| `warn` | The developer sees a warning; the edit goes ahead. |
| `ask` | The AI must ask the developer before editing (Claude Code). Recommended for bug fixes. |
| `block` | The AI may not change those lines at all. A human can still change them, but the PR needs approval. |

**Approval**: who must approve the PR when a lock is changed:

| Value | Who can approve |
|---|---|
| `owner` | Only the person who owns the lock (falls back to leads if the owner has left the team). |
| `lead` | Any lead. |
| `owner-or-lead` | The owner or any lead. |
| `none` | Nobody; CI only warns. |

Recommended starting point:

```json
"policies": {
  "bug":     { "onEdit": "ask",  "approval": "owner" },
  "feature": { "onEdit": "warn", "approval": "owner-or-lead" }
}
```

If a PR is opened by the owner themselves, it passes without waiting for a separate approval.

## The working-code guard

Locks protect what someone remembered to lock. The working-code guard protects everything else: when an AI edit would delete or rewrite lines that are already committed and working, the developer is asked first.

It counts:
- lines committed by **someone else**, of any age
- lines committed by **the same developer** more than `olderThanDays` ago (default 7)

It ignores uncommitted work and edits smaller than `minLines` (default 3). It never blocks CI; it shows as a warning in the PR comment so reviewers know a rewrite happened.

```json
"stableCode": { "enabled": true, "onEdit": "ask", "olderThanDays": 7, "minLines": 3 }
```

## Auto-lock

With the git hooks installed, every commit whose message starts with `fix:` or `feat:` (or says "fixed … bug", "hotfix", "bug", "issue") locks its own lines. Locks are saved in a follow-up `chore(fixlock): lock FIX-00x` commit.

- `chore:`, `docs:`, `test:`, `ci:`, `build:` and `style:` commits are never auto-locked.
- Blocks larger than `maxLines` (default 40) are skipped with a note. Lock the key lines by hand.
- Lock files, Markdown, JSON and images are ignored.

Ask the team to write [Conventional Commits](https://www.conventionalcommits.org). The AI rules files already tell every assistant to do so. Put the issue key in the message to link it: `fix(ENG-15): handle null customer`.

Turn feature locking off if it is too noisy: `"autoLock": { "lockFeatures": false }`.

## Rolling out to an existing project

1. `npx fixlock init` and commit the result.
2. `npx fixlock autolock --all --dry-run`. Review the list; it covers the last 300 commits.
3. `npx fixlock autolock --all`, then commit.
4. Lock the important fixes it missed (non-standard commit messages) with `npx fixlock mark`.
5. Add the CI check with `--notify` off for the first week, then turn it on.
6. Make the check required on `main` once the team is used to it.

## Removing a lock

Only an approver of the lock can remove it:

```bash
npx fixlock remove FIX-004
```

Use this when a fix is genuinely no longer needed (the feature was removed, the code was replaced on purpose).

## Releases and the changelog

`CHANGELOG.md` is kept up to date from locks and commit messages. At release time:

```bash
npx fixlock release 1.4.0
git add CHANGELOG.md .fixlock && git commit -m "chore: release 1.4.0" && git tag v1.4.0
```

## What to commit

| Path | Why |
|---|---|
| `.fixlock/` | team, rules and locks |
| `CLAUDE.md`, `AGENTS.md`, other AI rules files | what each AI assistant reads |
| `.claude/settings.json` | Claude Code hook and permissions |
| `.github/CODEOWNERS`, `.github/pull_request_template.md` | owner review requests and PR checklist |
| `CHANGELOG.md` | release notes |

Never commit tokens. Tracker and GitHub tokens are environment variables or CI secrets.
