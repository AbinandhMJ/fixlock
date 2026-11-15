---
title: Regression Bench
---

# Regression Bench

Does a tool notice when a pull request quietly undoes a real bug fix? That's the failure fixlock exists for: an AI assistant ports code from an older version, or "simplifies" a function, and a fix someone shipped months ago is gone. Git merges it without a conflict.

The Regression Bench is 33 real bug fixes from 11 open-source repositories in 11 languages. Each one is undone by applying the fix's own diff in reverse, so the code goes back to exactly what it was before the fix. Each also has a **control**: a harmless edit of the same lines, which a tool shouldn't flag.

## Results

| | Regressions caught | False alarms on controls |
|---|---|---|
| **fixlock** (structural matching, the default) | **32 of 33 (97%)** | **0 of 33 (0%)** |
| fixlock, text matching | 32 of 33 (97%) | 33 of 33 (100%) |
| git merge | 0 (no conflict) | 0 |
| Cubic (AI code review, on GitHub) | 21 of 33 (63.6%) | 0 of 33 (plus 24 comments about the added code comments) |
| CodeRabbit | Didn't review: see [AI reviewers](#ai-reviewers) | |

A regression counts as caught when fixlock reports a locked fix as changed, which fails the PR check until the fix's owner approves. Locks are the ones `fixlock discover` and auto-lock would make for the fix; nobody chose them by hand.

## Cases

| Case | Fix | File | fixlock: regression | fixlock: control | Cubic: regression |
|---|---|---|---|---|---|
| express-1 | [9a34acf](https://github.com/expressjs/express/commit/9a34acf03cb818ff3f8bc40e44176e277a25cbb9) preserve ETag generation with Transfer-Encoding (#7459) | `lib/response.js` | Caught | Passed | Caught |
| express-2 | [f275e87](https://github.com/expressjs/express/commit/f275e87dff1aaef86080e6931888de4968585fd8) Fix handling of undefined when "json escape" is enabled | `lib/response.js` | Caught | Passed | Caught |
| express-3 | [5855339](https://github.com/expressjs/express/commit/5855339455a7f60774bef4166829e742a5056fa8) Fix behavior of null/undefined as "maxAge" in res.cookie | `lib/response.js` | Caught | Passed | Caught |
| ky-1 | [224034d](https://github.com/sindresorhus/ky/commit/224034d10df5cd47db23adb3aa78efe26274fc1f) Fix headers set to `undefined` in `init` hooks being sent as the strin | `source/core/Ky.ts` | Caught | Passed | Caught |
| ky-2 | [d6e049a](https://github.com/sindresorhus/ky/commit/d6e049a690c7562a72e22d0b1eb57a2d4d19745e) Resolve retry replacements without parent retry options | `source/utils/merge.ts` | Caught | Passed | Missed |
| ky-3 | [06ebf18](https://github.com/sindresorhus/ky/commit/06ebf18e1927b3772726037bda5a78d4b7eb6dba) Handle unsupported streaming uploads gracefully | `source/core/constants.ts` | Caught | Passed | Missed |
| requests-1 | [5b4b64c](https://github.com/psf/requests/commit/5b4b64c3467fd7a3c03f91ee641aaa348b6bed3b) Add more tests to prevent regression of CVE 2024 47081 | `src/requests/utils.py` | Missed | Passed | Missed |
| requests-2 | [ef439eb](https://github.com/psf/requests/commit/ef439eb779c1eba7cbdeeeb302b11e1e061b4b7d) Prevent Response self-reference in redirect history (#7328) | `src/requests/sessions.py` | Caught | Passed | Caught |
| requests-3 | [bc7dd0f](https://github.com/psf/requests/commit/bc7dd0fc4d56e808bcdd85ac2d797b3107c89259) Fix cosmetic header validity parsing regex (#7308) | `src/requests/_internal_utils.py` | Caught | Passed | Caught |
| cobra-1 | [a97f9fd](https://github.com/spf13/cobra/commit/a97f9fd47b290016526c8af2dac0531fea5cd773) fix CompletionFunc implementation (#2234) | `completions.go` | Caught | Passed | Missed |
| cobra-2 | [7790bf9](https://github.com/spf13/cobra/commit/7790bf97fd40e285913066cf65387ad281cd6c2e) correct command path in see_also for YAML doc (#1771) | `doc/yaml_docs.go` | Caught | Passed | Missed |
| cobra-3 | [19e54c4](https://github.com/spf13/cobra/commit/19e54c4a2b8a78c9d54b2bed61b1a6c5e1bfcf6f) Update error message for missing required flags (#580) | `command.go` | Caught | Passed | Caught |
| gson-1 | [6bf8bf6](https://github.com/google/gson/commit/6bf8bf6cbf4d4f5f72f69262be890a5a5e28259d) Include location info in NumberFormatException from JsonReader (#3000) | `gson/src/main/java/com/google/gson/stream/JsonReader.java` | Caught | Passed | Caught |
| gson-2 | [9eb61b3](https://github.com/google/gson/commit/9eb61b30acdfd1c8497eee7de9bec3a7448ff41e) Bump Error Prone to 2.49.0 and fix new warnings (#3030) | `gson/src/main/java/com/google/gson/internal/LinkedTreeMap.java` | Caught | Passed | Missed |
| gson-3 | [004e7a4](https://github.com/google/gson/commit/004e7a4949e08b430e3c8996998ee5a17ff9423a) peekNumber rejects some numerals like 2^64 + "0" (#3034) | `gson/src/main/java/com/google/gson/stream/JsonReader.java` | Caught | Passed | Caught |
| okhttp-1 | [25e213c](https://github.com/square/okhttp/commit/25e213cac2d9edd182b0943770209408cad497c4) translate invalid hostname IllegalArgumentException to UnknownHostExce | `okhttp-dnsoverhttps/src/main/kotlin/okhttp3/dnsoverhttps/DnsOverHttps.kt` | Caught | Passed | Caught |
| okhttp-2 | [21ad1aa](https://github.com/square/okhttp/commit/21ad1aa6aa4d5de7f5f52956f0841a5c304ab849) guard null fields in Entry.writeTo() to fix NPE (#8962) (#9345) | `okhttp/src/commonJvmAndroid/kotlin/okhttp3/Cache.kt` | Caught | Passed | Caught |
| okhttp-3 | [a66e3d2](https://github.com/square/okhttp/commit/a66e3d2277932963c75b0cb7502bf181f7863178) Handle null requestedServerNames in Platform.getHandshakeServerNames ( | `okhttp/src/commonJvmAndroid/kotlin/okhttp3/internal/platform/Platform.kt` | Caught | Passed | Missed |
| ripgrep-1 | [9d738ad](https://github.com/BurntSushi/ripgrep/commit/9d738ad0c009e6632d75fa3d36051e5ae7f7cce6) fix inner literal extraction that resulted in false negatives | `crates/regex/src/literal.rs` | Caught | Passed | Missed |
| ripgrep-2 | [c8e4a84](https://github.com/BurntSushi/ripgrep/commit/c8e4a84519ede79b330f9a9e2b072110d5bd0c8c) prefix all non-fatal error messages with 'rg: ' | `crates/core/messages.rs` | Caught | Passed | Caught |
| ripgrep-3 | [4ab1862](https://github.com/BurntSushi/ripgrep/commit/4ab1862dc04783b6615807d4b4511388c6b30364) fix case where "bytes searched" could be wrong | `crates/searcher/src/searcher/glue.rs` | Caught | Passed | Caught |
| rack-1 | [ed25abc](https://github.com/rack/rack/commit/ed25abcde2a64a937efa1e59f1a0bb53d7ccecb8) Fix encoding setting for non-binary IO-like objects in MockRequest#env | `lib/rack/mock_request.rb` | Caught | Passed | Caught |
| rack-2 | [6d434bb](https://github.com/rack/rack/commit/6d434bbccdc2ffc3086dbce3930c3816945a35ec) Fix root prefix bug in Rack::Static | `lib/rack/static.rb` | Caught | Passed | Caught |
| rack-3 | [7d0fe1f](https://github.com/rack/rack/commit/7d0fe1f01a4583f46bcafadddff29080f92c92ab) Fix handling of empty cookies in `Rack::MockResponse` (#2203) | `lib/rack/mock_response.rb` | Caught | Passed | Caught |
| guzzle-1 | [ba8613b](https://github.com/guzzle/guzzle/commit/ba8613b3d1e9717eb2d87cec44ba40527295e06c) Add configurable idle cURL handle retention (#3993) | `src/Handler/CurlHandler.php` | Caught | Passed | Caught |
| guzzle-2 | [501a06c](https://github.com/guzzle/guzzle/commit/501a06cd870cbbf4721a9d4de6e913e1224d8e51) Harden cURL handler bookkeeping against native handle ID reuse (#3919) | `src/Handler/CurlFactory.php` | Caught | Passed | Missed |
| guzzle-3 | [f8aaea4](https://github.com/guzzle/guzzle/commit/f8aaea46ef23a07d9f68549e1d8c8c20e5685f5a) Reject invalid TLS proxy transport names (#3666) | `src/Handler/StreamHandler.php` | Caught | Passed | Caught |
| Newtonsoft.Json-1 | [d498352](https://github.com/JamesNK/Newtonsoft.Json/commit/d498352622048735b37169e200808c64167d198d) Fix error message displayed when a property marked as DisallowNull is  | `Src/Newtonsoft.Json/Serialization/JsonSerializerInternalReader.cs` | Caught | Passed | Caught |
| Newtonsoft.Json-2 | [55a7204](https://github.com/JamesNK/Newtonsoft.Json/commit/55a7204f9b9546aa07145591d42046d509176ad4) Fix handling of empty constructor names (#2922) | `Src/Newtonsoft.Json/JsonTextReader.cs` | Caught | Passed | Caught |
| Newtonsoft.Json-3 | [5702581](https://github.com/JamesNK/Newtonsoft.Json/commit/57025815e564d36821acf778e2c00d02225aab35) Null String being reported as String rather than JTokenType.Null (#279 | `Src/Newtonsoft.Json/Linq/JTokenWriter.cs` | Caught | Passed | Missed |
| Alamofire-1 | [9a0e640](https://github.com/Alamofire/Alamofire/commit/9a0e640817719b1d23939f1a304bb42938b85b22) Stabilize CI And Fix Bugs (#4030) | `Source/Core/DownloadRequest.swift` | Caught | Passed | Caught |
| Alamofire-2 | [b2d6f41](https://github.com/Alamofire/Alamofire/commit/b2d6f41fd37f4cd25e4996f89fc46bb6d2b2857e) Prevent Duplicate Serializer Completion Calls (#3999) | `Source/Core/DownloadRequest.swift` | Caught | Passed | Missed |
| Alamofire-3 | [9ec78de](https://github.com/Alamofire/Alamofire/commit/9ec78dee16adf642cdcb23b8e304857e2e259758) More Atomic Locking (#3984) | `Source/Core/DownloadRequest.swift` | Caught | Passed | Missed |

**Missed (1):** requests-1 (Add more tests to prevent regression of CVE 2024 47081). The requests "fix" mostly removed an old workaround (a `try`/`except` around `os.path.expanduser`); undoing it puts the workaround back, and the line fixlock locked is still there unchanged. It's counted as a miss because the case was chosen mechanically.


Every case, with its locks and verdicts, is in [`bench/regression/results.json`](https://github.com/AbinandhMJ/fixlock/blob/main/bench/regression/results.json).

## Method

1. Each repository is fetched at a pinned commit, and `fixlock discover` lists its past bug-fix commits from the git history (commit messages, reverts, tests changed with the fix).
2. For each fix, in the order `discover` ranks them, the fix's diff for one file is applied **in reverse** at the pinned commit. The case is kept only if that applies cleanly and changes at most 40 lines. Test files are skipped. Up to 3 fixes per repository.
3. The **control** adds comments and blank lines inside the fixed code and changes nothing else.
4. fixlock locks the fix's code as it is at the pinned commit (every block `discover` suggests for that fix in that file), then judges the regression and the control.

Cases are chosen without asking fixlock anything, so the selection can't favour it. Reproduce with `node bench/regression/run.js` (needs git and network for the first fetch; about 150 seconds).

### Limits

- A reversed diff is the cleanest possible regression. Real AI rewrites often undo a fix while changing much more around it; the [accuracy benchmark](benchmark.md) covers mixed and partial edits.
- fixlock only protects fixes that are locked. Here every fix is locked by `discover`; in a real repository, a fix nobody locked (and that `discover` doesn't find) isn't protected.
- Some commits that `discover` ranks as fixes are partly refactors. They're kept as found, to avoid hand-picking.

## AI reviewers

On 2026-11-15, the bench was published to [AbinandhMJ/regression-bench](https://github.com/AbinandhMJ/regression-bench) with `publish.js`: every fix in the history with its original message and author, then one regression PR and one control PR per case under neutral names. The reviewers and the [fixlock GitHub App](github-app.md) were installed on the repository and reviewed every PR on their own.

- **Cubic** reviewed all 66 PRs. It flagged 21 of 33 regressions, usually naming the exact fix it undid, and claimed no behavior change on any control. Its other 24 comments on controls were about the placeholder comments the controls add. It missed: ky-2, ky-3, requests-1, cobra-1, cobra-2, gson-2, okhttp-3, ripgrep-1, guzzle-2, Newtonsoft.Json-3, Alamofire-2, Alamofire-3.
- **CodeRabbit** didn't review. It skips automatic reviews in repositories with fewer than 10 stars, and when asked on each PR (`@coderabbitai review`) it answered with its hourly rate limit. It's left unscored rather than scored as 0.
- The **fixlock GitHub App** gave the same verdict on every PR as this page's offline run.

How the comments were graded: a regression counts as caught only if a comment says the change removes or breaks the fix; a control counts as a false alarm only if a comment claims a behavior change or a bug. The verdicts were graded by Claude (AI) from each comment and are recorded with the comments themselves in [`bench/regression/reviews.md`](https://github.com/AbinandhMJ/fixlock/blob/main/bench/regression/reviews.md), so anyone can check them.

AI reviewers don't know which lines are fixes; they judge the diff on its merits, and catching 21 undone fixes that way is impressive. fixlock knows because the fixes were locked, so it also caught 11 that Cubic let through, for example "Resolve retry replacements without parent retry options" (ky-2), "Handle unsupported streaming uploads gracefully" (ky-3), "fix CompletionFunc implementation" (cobra-1). The two work well together.

## Run it against AI reviewers

AI code reviewers can't be run offline, so the bench comes with a harness that runs them on the same cases, on GitHub:

1. `node bench/regression/publish.js --repo you/regression-bench` creates a public repository where each fix is in the history, with its original commit message, and opens one regression PR and one control PR per case. PR titles don't say which is which.
2. Install the reviewers to compare (for example CodeRabbit and Cubic, both free for public repositories) and the [fixlock GitHub App](github-app.md) on that repository, and let them review every PR.
3. `node bench/regression/score.js --repo you/regression-bench` collects every bot's comments into `bench/regression/reviews.md`, marking the ones that point at the undone lines. A person confirms each verdict, since an AI review can flag a regression in its own words.

The fix's commit is right there in the history, so a reviewer that reads history has every chance to notice it was undone.
