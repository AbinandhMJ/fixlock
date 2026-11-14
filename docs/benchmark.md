---
title: Accuracy benchmark
---

# Accuracy benchmark

How often does fixlock get it wrong? We locked real bug fixes from real projects, edited each lock in ways that do and don't change what the code does, and checked every verdict.

## Results

| | Text matching (≤ 0.5) | Structural matching (0.6+) |
|---|---|---|
| **False positives**: harmless edits flagged as a change | **58.8%** (637 of 1084) | **0.0%** (0 of 1084) |
| **Detection**: harmful edits caught | 93.2% (517 of 555) | **99.5%** (552 of 555) |
| **Variable renames** blocked as a change | 100.0% | 4.6% (95.4% reported as a rename) |

229 locks · 1812 edits · 4 repositories · fixlock 0.5.0+2df0144 · 2026-11-14

## Corpus

Locks are the past fixes `fixlock discover` suggests for each repository (score 4+, the default), up to 80 per repo.

| Repository | Language | Commit | Fixes discovered | Locks benchmarked |
|---|---|---|---|---|
| [express](https://github.com/expressjs/express) | JavaScript | `43fca52` | 46 | 33 |
| [ky](https://github.com/sindresorhus/ky) | TypeScript | `3541888` | 154 | 80 |
| [requests](https://github.com/psf/requests) | Python | `3c7baaa` | 54 | 36 |
| [cobra](https://github.com/spf13/cobra) | Go | `adbc881` | 132 | 80 |

## Harmless edits (should not be flagged)

| Edit | Languages | Edits | Text flags | Structural flags |
|---|---|---|---|---|
| add comments | Go, JavaScript, Python, TypeScript | 229 | 91.3% | 0.0% |
| reindent | Go, JavaScript, TypeScript | 190 | 0.0% | 0.0% |
| wrap long line | Go, JavaScript, Python, TypeScript | 147 | 92.5% | 0.0% |
| prettier (narrow, single quotes, no semicolons) | JavaScript, TypeScript | 111 | 91.9% | 0.0% |
| prettier (wide, double quotes) | JavaScript, TypeScript | 111 | 52.3% | 0.0% |
| blank lines | Go, JavaScript, Python, TypeScript | 99 | 0.0% | 0.0% |
| drop semicolons | JavaScript, TypeScript | 73 | 97.3% | 0.0% |
| swap quote style | JavaScript, TypeScript | 38 | 100.0% | 0.0% |
| black (line length 40) | Python | 33 | 57.6% | 0.0% |
| black (line length 120) | Python | 31 | 12.9% | 0.0% |
| gofmt (after re-indenting with spaces) | Go | 22 | 0.0% | 0.0% |

## Harmful edits (must be caught)

| Edit | Languages | Edits | Text catches | Structural catches |
|---|---|---|---|---|
| delete a line | Go, JavaScript, Python, TypeScript | 189 | 93.1% | 98.4% |
| change field | Go, JavaScript, Python, TypeScript | 87 | 90.8% | 100.0% |
| flip comparison | Go, JavaScript, Python, TypeScript | 79 | 91.1% | 100.0% |
| change string | Go, JavaScript, Python, TypeScript | 75 | 97.3% | 100.0% |
| swap and/or | Go, JavaScript, Python, TypeScript | 47 | 95.7% | 100.0% |
| change number | Go, JavaScript, Python, TypeScript | 40 | 90.0% | 100.0% |
| drop negation | Go, JavaScript, Python, TypeScript | 38 | 94.7% | 100.0% |

## Renames

Renaming a local variable everywhere in the file keeps the logic but can hide a swap (`isAdmin` → `isGuest`). Structural matching reports it as a **rename**: a warning by default, configurable with [`matching.renames`](configuration.md#matching). Text matching blocks it as a change.

| Edit | Languages | Edits | Text: blocked | Structural: blocked | Structural: reported as rename |
|---|---|---|---|---|---|
| rename a local variable | Go, JavaScript, Python, TypeScript | 173 | 100.0% | 4.6% | 95.4% |

## Where structural matching gets it wrong

- **Warned as a rename, not blocked: delete a line** in ky `source/core/Ky.ts:1055-1055`
- **Warned as a rename, not blocked: delete a line** in ky `source/core/Ky.ts:1222-1222`
- **Warned as a rename, not blocked: delete a line** in requests `src/requests/models.py:946-947`
- **Rename blocked as a change: rename a local variable** in ky `source/utils/timeout.ts:43-44`
- **Rename blocked as a change: rename a local variable** in ky `source/core/Ky.ts:539-539`
- **Rename blocked as a change: rename a local variable** in ky `source/core/Ky.ts:101-110`
- **Rename blocked as a change: rename a local variable** in ky `source/core/Ky.ts:895-895`
- **Rename blocked as a change: rename a local variable** in requests `pyproject.toml:58-58`
- **Rename blocked as a change: rename a local variable** in requests `src/requests/_types.py:89-89`
- **Rename blocked as a change: rename a local variable** in requests `src/requests/_types.py:158-158`
- **Rename blocked as a change: rename a local variable** in cobra `command.go:1488-1488`

A harmful edit "warned as a rename" means the remaining code had the same shape as the lock with different names, so fixlock reported a rename instead of a change: the PR still shows a warning. A rename is blocked as a change when the lock is very short (under 4 code tokens) or the old name is still used nearby; that's deliberate, because those are the cases where a "rename" is often a different variable.

Full details for every case are in [`bench/results.json`](https://github.com/AbinandhMJ/fixlock/blob/main/bench/results.json).

## Method

1. Each repository is fetched at the pinned commit and `fixlock discover` picks its past fixes. A lock is used only if both matchers agree it is intact before any edit.
2. Each lock gets every edit that applies to it. Edits only touch the lock's own lines, except renames and formatters, which change the whole file.
   - **Harmless**: add comments, add blank lines, wrap a long line inside brackets, swap `'` / `"` (JS/TS), drop semicolons (JS/TS), re-indent (not Python); Prettier with two opposite configs (JS/TS), Black at line length 40 and 120 (Python), gofmt (Go).
   - **Harmful**: flip a comparison, swap `&&`/`||` (`and`/`or`), drop a negation, change a number, change a string, read a different field, delete the main line of the fix.
3. Both matchers judge the edited file. A harmless edit judged *changed* is a false positive. A harmful edit judged anything but *changed* is a miss.

Reproduce: `node bench/run.js` (needs git, network for the first fetch, and optionally prettier, black and gofmt on PATH). Runs in about 50 seconds.

### Limits

These are mechanical edits, not a sample of real pull requests; real changes mix several edits at once. Formatter results depend on the formatter versions. A consistent rename that changes meaning (`isAdmin` → `isGuest`) is reported as a rename, not blocked, unless `matching.renames` is set to `block`.
