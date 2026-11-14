<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://abinandhmj.github.io/fixlock/fixlock-logo-dark.svg">
    <img alt="fixlock" src="https://abinandhmj.github.io/fixlock/fixlock-logo.svg" height="72">
  </picture>
</p>
<p align="center"><b>fixed stays fixed.</b><br>Stop AI coding assistants (and teammates) from silently undoing bug fixes.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@abinandhmj/fixlock"><img alt="npm" src="https://img.shields.io/npm/v/@abinandhmj/fixlock?color=B8F23A&labelColor=0E1116"></a>
  <a href="https://github.com/AbinandhMJ/fixlock/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AbinandhMJ/fixlock/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-B8F23A?labelColor=0E1116">
  <img alt="node" src="https://img.shields.io/node/v/@abinandhmj/fixlock?labelColor=0E1116">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-B8F23A?labelColor=0E1116"></a>
  <a href="https://abinandhmj.github.io/fixlock/"><img alt="docs" src="https://img.shields.io/badge/docs-abinandhmj.github.io%2Ffixlock-B8F23A?labelColor=0E1116"></a>
</p>

<p align="center"><b>Works with</b> Claude Code · Cursor · GitHub Copilot · OpenAI Codex · Gemini CLI · Windsurf · Cline · Aider · any MCP client</p>

---

<p align="center"><img src="https://abinandhmj.github.io/fixlock/demo.svg" alt="fixlock demo: a bug fix is locked, an AI edit that would undo it is stopped, and the pull request is blocked until the owner approves" width="860"></p>

<p align="center"><b>See it yourself in 60 seconds</b> (throwaway repo, nothing to set up):<br><code>npx @abinandhmj/fixlock demo</code></p>

You fix a bug. Weeks later an AI assistant ports a feature from an old codebase, rewrites the file, and your fix is gone. Git merges it with **no conflict**, because to git it's just a normal edit.

**fixlock** lets a team **lock** the lines that hold a bug fix or a finished feature, each with an owner. Then:

| When | What happens |
|---|---|
| **Before the AI edits** | The assistant checks with fixlock (MCP server, rules file, or Claude Code hook) and is told what it would break, why the code exists and who owns it. Depending on your policy it warns, asks the developer, or doesn't touch the lines. |
| **Before a commit** | The same warning shows in the terminal (it never blocks). |
| **On the pull request** | CI fails until the lock's owner (or a lead) approves. |
| **In your tracker** | Locking a fix moves the Linear / ClickUp / Notion issue to *Done*; a PR that reverts it reopens it. |

Locks are created automatically from `fix:` / `feat:` commits, and a **working-code guard** also covers code nobody locked: an AI rewrite of committed, working code asks the developer first.

## Quick start

```bash
npm i -D @abinandhmj/fixlock
npx fixlock init                         # team, rules, AI assistants, hooks
npx fixlock autolock --all --dry-run     # see which past fixes it would lock
```

Then connect your assistant:

```bash
npx fixlock setup claude-code   # or: cursor · copilot · codex · gemini · windsurf · all
```

Using VS Code, Cursor or Windsurf? Install the **fixlock** extension ([guide](https://abinandhmj.github.io/fixlock/integrations/vscode)) to see locks in the editor, get warned as you type, and connect Copilot agent mode automatically.

📖 **[Full docs](https://abinandhmj.github.io/fixlock/)**: [How it works](https://abinandhmj.github.io/fixlock/how-it-works) · [Getting started](https://abinandhmj.github.io/fixlock/getting-started) · [Team lead](https://abinandhmj.github.io/fixlock/team-lead-guide) · [Developer](https://abinandhmj.github.io/fixlock/developer-guide) · [AI assistants](https://abinandhmj.github.io/fixlock/integrations/) · [CI](https://abinandhmj.github.io/fixlock/ci-setup) · [Recipes](https://abinandhmj.github.io/fixlock/recipes) · [FAQ](https://abinandhmj.github.io/fixlock/faq) · [Commands](https://abinandhmj.github.io/fixlock/cli-reference)

## AI assistants

| Assistant | MCP check before edit | Rules file | Pre-edit hook | Guide |
|---|:-:|---|:-:|---|
| Claude Code | ✅ `.mcp.json` | `CLAUDE.md` | ✅ | [→](https://abinandhmj.github.io/fixlock/integrations/claude-code) |
| Cursor | ✅ `.cursor/mcp.json` | `.cursor/rules/fixlock.mdc` | | [→](https://abinandhmj.github.io/fixlock/integrations/cursor) |
| GitHub Copilot | ✅ `.vscode/mcp.json` | `.github/copilot-instructions.md` | | [→](https://abinandhmj.github.io/fixlock/integrations/copilot) |
| OpenAI Codex | ✅ `~/.codex/config.toml` | `AGENTS.md` | | [→](https://abinandhmj.github.io/fixlock/integrations/codex) |
| Gemini CLI | ✅ `.gemini/settings.json` | `GEMINI.md` | | |
| Windsurf | ✅ user config | `.windsurf/rules/fixlock.md` | | |
| Cline, Roo, Continue, Aider, Amazon Q, Junie | any MCP client | their native rules file | | [→](https://abinandhmj.github.io/fixlock/ai-tools) |

The **MCP server** (`npx fixlock mcp`) gives every assistant four read-only tools:

| Tool | Use |
|---|---|
| `fixlock_check_edit` | Before changing existing lines: returns `ok` / `warn` / `ask` / `block`, with the lock, its reason and owner |
| `fixlock_why` | What's locked in a file or on given lines, and whether you may change it |
| `fixlock_list` | All locks in the repo, e.g. before a big refactor |
| `fixlock_check_staged` | Check staged changes before committing |

```json
{ "mcpServers": { "fixlock": { "command": "npx", "args": ["--no-install", "fixlock", "mcp"] } } }
```

What the developer sees when an assistant tries to undo a fix:

```
🔒 fixlock: heads up Ravi — this change affects a locked bug fix, which may bring back old behaviour:
• FIX-001 "SAP date format" (bug fix by @abinandhmj) — src/date.ts lines 2-3
  Why it exists: SAP B1 rejects ISO timestamps for DocDate
  This edit removes/rewrites: return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  Policy: confirm with the developer; the PR will need approval from @abinandhmj.
```

## Locking fixes

```bash
# automatic: commit with fix: / feat: and the lines are locked (post-commit hook)
git commit -m "fix(ENG-15): handle null customer in invoice total"

# by hand
npx fixlock mark src/app/core/utils/date.util.ts 3-4 \
  -m "SAP B1 rejects ISO timestamps for DocDate" --title "SAP date format" --issue linear:ENG-12

# can I change this line?
npx fixlock why src/app/core/utils/date.util.ts:3
```

## CI

Add the check to your pipeline and make it required on `main`. A PR that changes a locked line passes only once the right person approves it.
Examples: [GitHub Actions](examples/ci/github-actions.yml) · [Jenkins](examples/ci/Jenkinsfile) · [GitLab](examples/ci/gitlab-ci.yml) · [CI guide](https://abinandhmj.github.io/fixlock/ci-setup) · [all examples](examples/)

## Why trust it

- **Zero runtime dependencies.** The whole tool is readable in [`src/`](src/).
- **No telemetry.** The network is used only for GitHub approvals and your tracker, when you configure them.
- **Read-only MCP server.** stdio only; it never edits files.
- **Never blocks local work.** Hooks warn; only CI enforces.
- **Tested on Linux, Windows and macOS** with Node 18, 20 and 22; releases are published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

See [SECURITY.md](SECURITY.md) for exactly what fixlock reads and writes.

## Also included

Team roles and owner/lead approval policies · generated `CODEOWNERS` · `CHANGELOG.md` from locks and Conventional Commits · Linear, ClickUp, Notion and webhook (Bugasura, Jira…) sync · AI tool detection (`npx fixlock tools`).

## Limitations

- Structural matching covers JS/TS, Python, Java, Go, C#, Kotlin, Rust, C/C++, Swift, PHP and similar languages. Other files (Markdown, JSON, …) are matched as text. A consistent rename of variables inside a lock is reported as a warning, not ignored; field and key renames count as changes.
- Only Claude Code can intercept an edit before it happens. Other assistants check through MCP or their rules file, so a model that ignores both is caught at commit time and in CI.
- Approvals are read from GitHub; GitLab and Bitbucket are on the roadmap.

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately ([SECURITY.md](SECURITY.md)).

MIT licensed.
