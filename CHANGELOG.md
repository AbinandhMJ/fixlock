# Changelog

All notable changes to fixlock. Format: [Keep a Changelog](https://keepachangelog.com), versions follow [SemVer](https://semver.org).

## [Unreleased]

_No changes yet._

## [0.7.0] - 2026-11-15

### Added
- **On PyPI**: `pipx install fixlock` (or `uv tool install fixlock`, `pip install fixlock`) installs a standalone `fixlock` binary for Linux glibc/musl, macOS and Windows on x64 and ARM, with no Node.js needed. `python -m fixlock` works too; other platforms get a fallback that runs it through `npx`.
  - `init` from the native command records `"launcher": "fixlock"`, so hooks, MCP configs and rules call `fixlock …`. `FIXLOCK_LAUNCHER` overrides it on one machine.
  - The release workflow builds the binaries with Bun and publishes the wheels with PyPI trusted publishing; CI tests the wheel on a machine with no Node.js on PATH.
- **63 languages and formats** for structural matching ([list](https://abinandhmj.github.io/fixlock/languages)), from one table in `src/languages.js`: Java, Kotlin, Scala, Groovy/Gradle, C#, F#, Go, Rust, Swift, Dart, C/C++/Objective-C, PHP, Ruby, Elixir, Python, Lua, Haskell, Clojure/Lisp, Erlang, R, Julia, Perl, SQL, Terraform, YAML, TOML, Dockerfile, Makefile, shell, PowerShell, CSS/SCSS/Less, GraphQL, Protobuf and more.
  - **Templates**: HTML, Angular, Vue, Svelte, Astro, Django/Jinja, Twig, Liquid, Handlebars, EJS, ERB, Razor, Blade, JSP, Thymeleaf and Go templates are read as tags, attributes and `{{ }}` expressions, with `<script>` and `<style>` in their own language.
  - **Indentation is logic** in Python, YAML, Nim, CoffeeScript and Sass: moving a line in or out of a block is caught.
  - **Case-insensitive** languages (SQL, Fortran, Pascal, Ada, VB, PowerShell, CMake, Dockerfile) ignore keyword case.
  - Language rules for raw/verbatim strings (Rust, C++, C#, Python, Lua), Rust lifetimes, nested block comments, template comments, shell `${#x}`, `url(http://…)` in CSS.
- **Works in any project**, not just JavaScript:
  - Hooks, MCP configs and AI rules run fixlock with the scoped package (`npx -y @abinandhmj/fixlock@<minor>`) when the repo doesn't install it, and never with the bare name `fixlock`.
  - **GitHub Action**: `uses: AbinandhMJ/fixlock@v0.7.0`, with no install step and a PR comment.
  - **pre-commit** hooks: `fixlock` (warns) and `fixlock-strict` (blocks).
  - `fixlock languages [file]` shows the supported languages and how a file is read.
  - Docs: [Python, Go, Java, .NET and other projects](https://abinandhmj.github.io/fixlock/any-language).
- `fixlock discover` recognizes fixes and tests across ecosystems: Go, Rust, Swift, Kotlin, Java, C#, PHP, Ruby and SQL guards, template conditions, access checks; test files from `src/test/`, `*Tests.cs`, `_spec.rb`, `*_test.dart`… It skips lockfiles, vendored, generated and build files.
- Accuracy benchmark extended to **11 repositories in 11 languages** (adds Java, Kotlin, Rust, Ruby, PHP, C#, Swift): 764 locks, 5,271 edits. 0.0% of harmless edits flagged (text matching: 55.7%), 99.9% of harmful edits caught (text: 92.3%).

### Fixed
- Breaking a lock is no longer excused as a "rename" when a look-alike block (the same code with other names) exists elsewhere in the file: locks record `siblings`; older locks count them in the base version.
- Ruby, Perl and Crystal regex literals: a `#` inside `/…/` was read as a comment.
- `CONSTANT_CASE` names (constants, enum values) are fixed: `ADMIN` → `USER` is a change, not a rename.
- Hooks silently did nothing in repos without fixlock in `node_modules` (`npx --no-install`). Re-running `install-hook` / `install-claude-hook` / `init` replaces old entries.
- `check --staged --strict` said "the commit is allowed".

## [0.6.0] - 2026-11-14

### Fixed (found by the accuracy benchmark)
- Line numbers after an unterminated quote (e.g. a `'` inside a regex) were off by one, which misplaced lock positions in `why`, hooks and the editor.
- `locate()` could match a common line (`try:`, `return true`) hundreds of lines away; it now finds the lock as one block, preferring a match on whole lines.
- Regex literals (`/"([^"]+)"/`) were read as strings; closing generics (`Promise<Array<T>>`) split by a formatter no longer differ from `>>`; JS private fields (`#cache`) are member names, not renameable variables.
- A rename is only accepted when it's believable: the snippet has at least 4 code tokens and the old names are gone from the surrounding code (the whole file for short snippets). This stops a deleted or swapped line from being excused as a "rename" of similar code elsewhere.
- Removing the locked copy of code that appears more than once in a file is now caught: locks record `copies`.
- `fixlock discover` no longer suggests comment-only, docstring-only or trivially small blocks.

### Added
- **Structural matching**: locks now compare code structure instead of text, with zero new dependencies. Reformatting, added comments, quote style, semicolons, trailing commas and line wrapping no longer count as changes to a lock. A consistent variable rename is reported as a rename (a warning by default) instead of a revert. Field and object-key renames, flipped conditions, changed values and removed checks are still caught. Supports JS/TS, Python, Java, Go, C#, Kotlin, Rust, C/C++, Swift, PHP, Ruby and similar; other files are matched as text.
- **`fixlock discover`**: finds past bug fixes worth locking in git history, whatever the commit style, and ranks them with the reasons shown: fixes that were reverted and re-applied, fix/regression wording, linked issues, tests in the same commit, guard code and small focused changes. Pick which to lock, or `--apply`. Linked tests are recorded on the lock. `fixlock init` now points to it.
- **Accuracy benchmark** (`bench/`, [docs](https://abinandhmj.github.io/fixlock/benchmark)): 229 real fixes from Express, ky, Requests and Cobra, 1,812 edits. Structural matching flags 0.0% of harmless edits (text matching: 58.8%) and catches 99.5% of harmful ones (text: 93.2%).
- `matching` config: `mode` (`structural` | `text`) and `renames` (`allow` | `warn` | `ask` | `block`).
- `fixlock why` and the MCP `fixlock_why` tool find locks that were reformatted.
- **VS Code extension** (`extensions/vscode`, also for Cursor, Windsurf and VSCodium via Open VSX): locked lines in the gutter with hover and CodeLens, live Problems warnings when an edit changes locked code, "Lock selected lines", and fixlock's MCP tools registered for Copilot agent mode. Bundles fixlock; no Node.js install needed.

## [0.5.0] - 2026-11-11

_Not published to npm on its own; everything below ships in 0.6.0._

### Added
- **`fixlock demo`**: a 60-second walkthrough in a throwaway repo, using the real commands. Also recorded as an animated SVG, MP4 and GIF (`scripts/record-demo.js`).
- Docs: landing page, How it works (with diagram), See it in action, Recipes, FAQ with a comparison to tests / CODEOWNERS / review, Examples.
- Examples: GitLab CI, Husky, Lefthook, and per-assistant MCP configs generated by `fixlock setup`.
- **MCP server** (`fixlock mcp`): any MCP-capable assistant (Claude Code, Cursor, GitHub Copilot in VS Code, Codex, Gemini CLI, Windsurf) can check an edit before making it. Tools: `fixlock_check_edit`, `fixlock_why`, `fixlock_list`, `fixlock_check_staged`.
- **`fixlock setup <assistant>`**: one command to connect Claude Code, Cursor, Copilot, Codex, Gemini CLI or Windsurf. `init` offers it too.
- AI rules files now tell assistants to call `fixlock_check_edit` before changing existing lines.
- `fixlock --version`.
- CI on Linux, Windows and macOS (Node 18/20/22); releases published with npm provenance.
- Docs: integration guides per assistant, security & privacy page, `llms.txt` for AI assistants.

### Fixed
- An edit whose text started with a line break was counted as touching the line above it.
- The npm package no longer ships the docs folder.
- The commit-time check (`check --staged`) no longer treats a PR author as an approval; there is no PR yet at commit time.
- Repos reached through a symlink (macOS `/var` → `/private/var`) or a Windows short path (`RUNNER~1`) are now matched correctly; previously locks there were missed.
- `autolock` never locks files that fixlock or AI tools generate (CODEOWNERS, `.cursor/`, `.claude/`, `.aider.conf.yml`, …).
- Auto-locked fixes use the commit message body as "why it exists", when there is one.
- GitHub Actions example: re-runs after an approval now compare against the right base branch (`github.base_ref` is empty on review events).

## [0.4.0] - 2026-11-08

### Added
- Auto-lock lines from `fix:` / `feat:` commits (post-commit hook) and `autolock --all` to lock fixes already in history.
- Working-code guard: AI edits that rewrite committed, working code ask the developer first.
- Rules files for 12 AI tools, AI tool detection (`fixlock tools`), generated `CHANGELOG.md`, `release` command.
- Team roles, owner/lead approval policies, Claude Code pre-edit hook, Linear / ClickUp / Notion / webhook sync, CODEOWNERS.
- User guides and docs site.

## [0.1.0] - 2026-11-05

### Added
- First release: fix registry (`mark`), CI revert check (`check`), protected authors, CLAUDE.md / AGENTS.md sync.

[0.5.0]: https://github.com/AbinandhMJ/fixlock/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/AbinandhMJ/fixlock/compare/v0.1.0...v0.4.0
[0.1.0]: https://github.com/AbinandhMJ/fixlock/releases/tag/v0.1.0
