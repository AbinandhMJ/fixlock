# Configuration reference

All settings live in `.fixlock/config.json`. `init` writes it; you can edit it by hand. Locks live in `.fixlock/registry.json`. Don't edit that by hand; use the commands.

```json
{
  "project": "Fluxo ERP",
  "team": [
    { "name": "Abi", "github": "abinandhmj", "emails": ["abi@fluxo.dev"], "role": "lead" },
    { "name": "Ravi", "github": "ravik", "emails": ["ravi@fluxo.dev"], "role": "developer" }
  ],
  "policies": {
    "bug":     { "onEdit": "ask",  "approval": "owner" },
    "feature": { "onEdit": "warn", "approval": "owner-or-lead" }
  },
  "aiTools": ["claude-code", "codex", "cursor"],
  "stableCode": { "enabled": true, "onEdit": "ask", "olderThanDays": 7, "minLines": 3 },
  "autoLock": { "enabled": true, "lockFeatures": true, "maxLines": 40 },
  "tracker": { "type": "linear", "onFix": "Done", "onRegression": "In Progress" },
  "protectedPaths": [],
  "changelog": true,
  "ignoreTrivialLines": true
}
```

## `team`

| Field | Meaning |
|---|---|
| `name` | Display name |
| `github` | GitHub username, used for PR approvals and CODEOWNERS |
| `emails` | Git commit emails, used to recognise who is editing or committing |
| `role` | `lead`, `developer` or `reviewer` |

## `policies.bug` / `policies.feature`

| Field | Values |
|---|---|
| `onEdit` | `warn`, `ask`, `block` (what happens before an AI edit) |
| `approval` | `owner`, `lead`, `owner-or-lead`, `none` (who must approve the PR) |

## `aiTools`

Tool ids to write rules files for: `claude-code`, `codex`, `cursor`, `copilot`, `windsurf`, `gemini`, `cline`, `roo`, `continue`, `aider`, `amazonq`, `junie`. Manage with `npx fixlock tools add|remove`.

## `stableCode` (working-code guard)

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Turn the guard on or off |
| `onEdit` | `ask` | `warn`, `ask` or `block` for AI edits that rewrite working code |
| `olderThanDays` | `7` | Your own committed code counts as "working" after this many days |
| `minLines` | `3` | Ignore edits that rewrite fewer lines than this |

## `autoLock`

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Lock lines from fix/feature commits |
| `lockFeatures` | `true` | Also lock `feat:` commits |
| `maxLines` | `40` | Skip blocks bigger than this |
| `bugPattern` | conventional `fix:`/`bugfix:`/`hotfix:` + words fix/fixed/bug/hotfix/issue | Regex for bug-fix commit messages |
| `featurePattern` | `^feat(\(.+\))?!?:` | Regex for feature commit messages |
| `ignore` | lock files, `.md`, `.json`, images, `.fixlock/` | Files never auto-locked |

## `tracker`

See [Issue trackers](trackers.md). Tokens are never stored here.

## Other

| Field | Meaning |
|---|---|
| `protectedPaths` | Path prefixes, e.g. `["src/app/core/"]`; any change there is reported (warning only) |
| `changelog` | `false` to stop updating `CHANGELOG.md` |
| `ignoreTrivialLines` | Ignore blank and brace-only lines |

## Environment variables

| Variable | Used for |
|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | Reading PR approvals in CI |
| `LINEAR_API_KEY`, `CLICKUP_TOKEN`, `NOTION_TOKEN` | Tracker sync |
| `FIXLOCK_WEBHOOK_URL`, `FIXLOCK_WEBHOOK_SECRET` | Webhook tracker |
| `FIXLOCK_BASE` | Default `--base` for `check` |
| `FIXLOCK_USER` | Override who you are (email or GitHub username) |
| `NO_COLOR` | Plain output |
