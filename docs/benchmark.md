---
title: Accuracy benchmark
---

# Accuracy benchmark

How often does fixlock get it wrong? We locked real bug fixes from real projects, edited each lock in ways that do and don't change what the code does, and checked every verdict.

## Results

| | Text matching (≤ 0.5) | Structural matching (0.6+) |
|---|---|---|
| **False positives**: harmless edits flagged as a change | **55.7%** (1622 of 2914) | **0.0%** (0 of 2914) |
| **Detection**: harmful edits caught | 92.3% (1704 of 1846) | **99.9%** (1845 of 1846) |
| **Variable renames** blocked as a change | 99.8% | 2.9% (96.9% reported as a rename) |

764 locks · 5271 edits · 11 repositories · fixlock 0.6.0+bdadb1b · 2026-11-14

## Corpus

Locks are the past fixes `fixlock discover` suggests for each repository (score 4+, the default), up to 80 per repo.

| Repository | Language | Commit | Fixes discovered | Locks benchmarked |
|---|---|---|---|---|
| [express](https://github.com/expressjs/express) | JavaScript | `43fca52` | 46 | 35 |
| [ky](https://github.com/sindresorhus/ky) | TypeScript | `3541888` | 168 | 80 |
| [requests](https://github.com/psf/requests) | Python | `3c7baaa` | 61 | 31 |
| [cobra](https://github.com/spf13/cobra) | Go | `adbc881` | 135 | 80 |
| [gson](https://github.com/google/gson) | Java | `d938a10` | 167 | 80 |
| [okhttp](https://github.com/square/okhttp) | Kotlin | `b6e74e5` | 143 | 80 |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | Rust | `178cc02` | 74 | 58 |
| [rack](https://github.com/rack/rack) | Ruby | `da90464` | 128 | 80 |
| [guzzle](https://github.com/guzzle/guzzle) | PHP | `f8aca40` | 277 | 80 |
| [Newtonsoft.Json](https://github.com/JamesNK/Newtonsoft.Json) | C# | `52fa3ae` | 291 | 80 |
| [Alamofire](https://github.com/Alamofire/Alamofire) | Swift | `dea4bab` | 171 | 80 |

## Harmless edits (should not be flagged)

| Edit | Languages | Edits | Text flags | Structural flags |
|---|---|---|---|---|
| add comments | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 764 | 89.8% | 0.0% |
| reindent | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 729 | 0.0% | 0.0% |
| wrap long line | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 520 | 91.5% | 0.0% |
| blank lines | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 300 | 0.0% | 0.0% |
| drop semicolons | C#, Java, JavaScript, PHP, Rust, TypeScript | 264 | 91.3% | 0.0% |
| prettier (narrow, single quotes, no semicolons) | JavaScript, TypeScript | 111 | 92.8% | 0.0% |
| prettier (wide, double quotes) | JavaScript, TypeScript | 111 | 54.1% | 0.0% |
| swap quote style | JavaScript, TypeScript | 41 | 100.0% | 0.0% |
| black (line length 40) | Python | 28 | 53.6% | 0.0% |
| black (line length 120) | Python | 26 | 0.0% | 0.0% |
| gofmt (after re-indenting with spaces) | Go | 20 | 0.0% | 0.0% |

## Harmful edits (must be caught)

| Edit | Languages | Edits | Text catches | Structural catches |
|---|---|---|---|---|
| delete a line | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 649 | 91.7% | 99.8% |
| change field | C#, Go, Java, JavaScript, Kotlin, Python, Ruby, Rust, Swift, TypeScript | 302 | 92.4% | 100.0% |
| change string | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 245 | 93.9% | 100.0% |
| flip comparison | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 244 | 91.4% | 100.0% |
| swap and/or | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 158 | 94.9% | 100.0% |
| drop negation | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 144 | 91.7% | 100.0% |
| change number | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 104 | 91.3% | 100.0% |

## Renames

Renaming a local variable everywhere in the file keeps the logic but can hide a swap (`isAdmin` → `isGuest`). Structural matching reports it as a **rename**: a warning by default, configurable with [`matching.renames`](configuration.md#matching). Text matching blocks it as a change.

| Edit | Languages | Edits | Text: blocked | Structural: blocked | Structural: reported as rename |
|---|---|---|---|---|---|
| rename a local variable | C#, Go, Java, JavaScript, Kotlin, PHP, Python, Ruby, Rust, Swift, TypeScript | 511 | 99.8% | 2.9% | 96.9% |

## Where structural matching gets it wrong

- **Warned as a rename, not blocked: delete a line** in gson `metrics/src/main/java/com/google/gson/metrics/ParseBenchmark.java:367-367`
- **Rename blocked as a change: rename a local variable** in ky `source/utils/timeout.ts:43-44`
- **Rename blocked as a change: rename a local variable** in ky `source/core/Ky.ts:539-539`
- **Rename blocked as a change: rename a local variable** in ky `source/core/Ky.ts:895-895`
- **Rename blocked as a change: rename a local variable** in requests `pyproject.toml:58-58`
- **Rename blocked as a change: rename a local variable** in requests `src/requests/_types.py:89-89`
- **Rename blocked as a change: rename a local variable** in requests `src/requests/_types.py:158-158`
- **Rename blocked as a change: rename a local variable** in cobra `command.go:1488-1488`
- **Rename blocked as a change: rename a local variable** in gson `gson/src/main/java/com/google/gson/internal/GsonTypes.java:405-405`

A harmful edit "warned as a rename" means the remaining code had the same shape as the lock with different names, so fixlock reported a rename instead of a change: the PR still shows a warning. A rename is blocked as a change when the lock is very short (under 4 code tokens) or the old name is still used nearby; that's deliberate, because those are the cases where a "rename" is often a different variable.

Full details for every case are in [`bench/results.json`](https://github.com/AbinandhMJ/fixlock/blob/main/bench/results.json).

## Method

1. Each repository is fetched at the pinned commit and `fixlock discover` picks its past fixes. A lock is used only if both matchers agree it is intact before any edit.
2. Each lock gets every edit that applies to it. Edits only touch the lock's own lines, except renames and formatters, which change the whole file.
   - **Harmless**: add comments, add blank lines, wrap a long line inside brackets, swap `'` / `"` (JS/TS), drop semicolons (JS/TS), re-indent (not Python); Prettier with two opposite configs (JS/TS), Black at line length 40 and 120 (Python), gofmt (Go).
   - **Harmful**: flip a comparison, swap `&&`/`||` (`and`/`or`), drop a negation, change a number, change a string, read a different field, delete the main line of the fix.
3. Both matchers judge the edited file. A harmless edit judged *changed* is a false positive. A harmful edit judged anything but *changed* is a miss.

Reproduce: `node bench/run.js` (needs git, network for the first fetch, and optionally prettier, black and gofmt on PATH). Runs in about 230 seconds.

### Limits

These are mechanical edits, not a sample of real pull requests; real changes mix several edits at once. Formatter results depend on the formatter versions. A consistent rename that changes meaning (`isAdmin` → `isGuest`) is reported as a rename, not blocked, unless `matching.renames` is set to `block`.
