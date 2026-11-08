<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://abinandhmj.github.io/fixlock/fixlock-logo-dark.svg">
    <img alt="fixlock" src="https://abinandhmj.github.io/fixlock/fixlock-logo.svg" height="72">
  </picture>
</p>
<p align="center"><b>fixed stays fixed.</b></p>

   [![npm](https://img.shields.io/npm/v/@abinandhmj/fixlock)](https://www.npmjs.com/package/@abinandhmj/fixlock) [![docs](https://img.shields.io/badge/docs-fixlock-B8F23A)](https://abinandhmj.github.io/fixlock/)

**Stop fixed bugs and finished features from coming back.**

You fix a bug. Weeks later a teammate's AI ports a feature from an old codebase, rewrites the file, and your fix disappears. Git merges it with **no conflict**, because to git it's just a normal edit.

fixlock lets a team **lock** the lines that hold a bug fix or a feature, with an owner. Then:

- **Before an AI edits them**, the teammate is told what they're about to break (Claude Code hook):
  ```
  🔒 fixlock: heads up Ravi — this change affects a locked bug fix, which may bring back old behaviour:
  • FIX-001 "SAP date format" (bug fix by @abinandhmj) — src/date.ts lines 2-3
    Why it exists: SAP B1 rejects ISO timestamps for DocDate
    This edit removes/rewrites: return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
    Policy: confirm with the developer; the PR will need approval from @abinandhmj.
  Leave these lines unchanged, or build around them, unless the owner has agreed.
  ```
- **Before a commit**, the same warning shows in the terminal (it never blocks).
- **On the PR**, CI fails until the lock's owner (or a lead, per policy) approves the PR.
- **Your tracker updates itself**: locking a fix moves the Linear / ClickUp / Notion issue to *Done*; a PR that reverts it moves the issue back to *Reopened* with a comment.

Zero dependencies. Node ≥ 18. Windows, macOS, Linux.

📖 **Docs: [abinandhmj.github.io/fixlock](https://abinandhmj.github.io/fixlock/)** ·  [Getting started](docs/getting-started.md) · [Team lead](docs/team-lead-guide.md) · [Developer](docs/developer-guide.md) · [AI tools](docs/ai-tools.md) · [CI](docs/ci-setup.md) · [Trackers](docs/trackers.md) · [Config](docs/configuration.md) · [Commands](docs/cli-reference.md) · [Troubleshooting](docs/troubleshooting.md)

## Setup (team lead, once)

```bash
npm i -D @abinandhmj/fixlock
npx fixlock init
```

`init` asks for:
1. **Team members**: name, GitHub username, git email, role (`lead` / `developer` / `reviewer`)
2. **Policies** for bug fixes and features:
   - on edit: `warn` (show warning), `ask` (AI must ask the developer), `block` (AI must not touch the lines)
   - PR approval from: `owner`, `lead`, `owner-or-lead`, `none`
3. **Tracker**: Linear, ClickUp, Notion, or a webhook (Bugasura, Jira, … via Zapier/Make/n8n), plus the status names to use
4. **AI tools** the team uses (detected automatically; see below)
5. **Hooks**: Claude Code hook, git pre-commit warning, `.github/CODEOWNERS`

Commit `.fixlock/` and every generated file (rules files, `CHANGELOG.md`, `.claude/settings.json`, `.github/`). Every developer then runs `npm install` (and `npx fixlock install-hook` for the commit warning).

Add people later: `npx fixlock team add --name Ravi --github ravi --email ravi@co.com --role developer`

## No AI rewrites working code without telling you

Two layers protect code, so nobody has to remember to lock everything:

**1. Auto-lock.** Every `fix:` / `feat:` commit (and commits saying "fixed … bug", "hotfix", …) locks its own lines through a post-commit hook. The locks go in a follow-up `chore(fixlock)` commit. Issue keys in the message (`fix(ENG-15): …`, `CU-86abc`) are linked automatically. For fixes that are already in your history:

```bash
npx fixlock autolock --all --dry-run   # see what would be locked
npx fixlock autolock --all             # lock past fixes that are still in the code
```

**2. Working-code guard.** Code that isn't locked is still protected. If an AI edit would delete or rewrite committed lines written by someone else, or by you more than 7 days ago, the developer is asked first:

```
🔒 fixlock: heads up Ravi — this change affects code that already works and may change how it behaves:
• 4 existing line(s) in src/totals.ts would be deleted or rewritten — code that already works.
  Written by @abinandhmj; last changed today ("chore: totals").
AI: do not rewrite working code silently. Tell the developer exactly which lines you want to change and why…
```

Your own uncommitted or fresh work is never interrupted. The same check runs at commit time and on the PR (as a warning in the PR comment). Every AI tool's rules file starts with: *never rewrite, delete or replace code that already works without telling the developer first.* The Claude Code settings also stop the AI from editing the hook config or git hooks to switch this off.

Config (`.fixlock/config.json`): `"stableCode": { "onEdit": "ask", "olderThanDays": 7, "minLines": 3 }`, `"autoLock": { "lockFeatures": true, "maxLines": 40 }`.

## Daily use

```bash
# Lock a fix right after fixing it
npx fixlock mark src/app/core/utils/date.util.ts 3-4 \
  -m "SAP B1 rejects ISO timestamps for DocDate" --title "SAP date format" \
  --issue linear:ENG-12

# Lock a finished feature
npx fixlock mark src/app/orders/approval.service.ts 40-58 --type feature \
  --title "Two-step order approval" --issue clickup:86abc12

# Can I change this line?
npx fixlock why src/app/core/utils/date.util.ts:3
```

Issue refs: `linear:ENG-12`, `clickup:<task id>`, `notion:<page id>`, `bugasura:<id>` / `webhook:<id>` (sent to your webhook).

## CI

- GitHub Actions: `examples/github-action.yml` (reads PR approvals with `GITHUB_TOKEN`, posts a PR comment, re-runs on approval)
- Jenkins multibranch: `examples/Jenkinsfile.stage` (uses `CHANGE_ID`, `CHANGE_AUTHOR`)

Make the check required on `main`. A PR passes when every reverted lock has an approval from the right person, or when the PR author is that person.

## Environment variables

| Var | Used for |
|---|---|
| `GITHUB_TOKEN` | Read PR approvals in CI |
| `LINEAR_API_KEY` / `CLICKUP_TOKEN` / `NOTION_TOKEN` | Tracker sync |
| `FIXLOCK_WEBHOOK_URL`, `FIXLOCK_WEBHOOK_SECRET` | Webhook tracker |
| `FIXLOCK_USER` | Override who you are (GitHub username or email) |

Tokens are never written to the repo.

## Works with whatever AI your team uses

Each developer may use a different AI. `fixlock tools` detects them from the repo, installed CLIs, and VS Code / Cursor / Windsurf extensions:

```
● on     claude-code  Claude Code (CLI / VS Code / JetBrains)    CLAUDE.md
                       detected: repo: .claude; command: claude
● on     codex        OpenAI Codex (CLI / IDE extension)         AGENTS.md
                       detected: extension: openai.chatgpt
○ found  cursor       Cursor                                     .cursor/rules/fixlock.mdc
Found on this machine/repo but not enabled: cursor
→ npx fixlock tools add cursor
```

For every enabled tool, fixlock writes that tool's own rules file with the team rules and the current locks, and keeps it updated on every `mark` / `remove`:

| Tool | File |
|---|---|
| Claude Code | `CLAUDE.md` + pre-edit hook in `.claude/settings.json` |
| OpenAI Codex (CLI / extension) | `AGENTS.md` |
| Cursor | `.cursor/rules/fixlock.mdc` (always applied) |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/fixlock.md` |
| Gemini CLI / Code Assist | `GEMINI.md` |
| Cline | `.clinerules/fixlock.md` |
| Roo Code | `.roo/rules/fixlock.md` |
| Continue | `.continue/rules/fixlock.md` |
| Aider | `CONVENTIONS.md` (+ `read:` in `.aider.conf.yml`) |
| Amazon Q Developer | `.amazonq/rules/fixlock.md` |
| JetBrains Junie | `.junie/guidelines.md` |

In shared files (CLAUDE.md, AGENTS.md…) fixlock only touches its own marked section; your own content is kept. Only Claude Code has a pre-edit hook. The other tools follow the written rules, and the commit warning and CI gate apply to everyone.

## CHANGELOG.md

fixlock keeps `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com) format) up to date from locks and Conventional Commits (`feat:`, `fix:`, `perf:`…). The generated AI rules tell every assistant to write commits that way.

```
## [Unreleased]

### Added
- **orders:** two-step approval (11d691c)

### Fixed
- SAP date format (FIX-001, @abinandhmj, linear:ENG-12)
- **sap:** send DocDate as yyyy-MM-dd (078076a)
```

`npx fixlock release 1.4.0` freezes that section as `## [1.4.0] - <date>`. A PR template with a fixlock checklist is also added.

## Limitations (v0.2)

- Matching is text-based: renaming a variable inside a locked line counts as a change. Re-`mark` after intentional edits.
- Tracker sync runs on every CI run with `--notify`, so repeated pushes add repeated comments.
- Approvals are read from GitHub. GitLab/Bitbucket approvals are on the roadmap.

## Roadmap

VS Code extension (inline lock markers while typing), MCP server, GitLab approvals, AST-aware matching.

MIT licensed.
