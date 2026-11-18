# fixlock for JetBrains IDEs

The IntelliJ Platform plugin: one build for IntelliJ IDEA, PyCharm, WebStorm, PhpStorm, GoLand, Rider, CLion, RubyMine, Android Studio and the rest (2024.3+). Users' docs: [JetBrains IDEs](https://abinandhmj.github.io/fixlock/integrations/jetbrains).

It asks the fixlock CLI for every answer (`fixlock status <file> --stdin --json` for lock state, `why`, `check`, `mark`, `quickstart`), so the IDE, hooks and CI agree.

```bash
./gradlew test          # unit tests
./gradlew runIde        # try it in a sandbox IDE
./gradlew buildPlugin   # build/distributions/fixlock-jetbrains-<version>.zip
./gradlew verifyPlugin  # JetBrains Plugin Verifier against IDEA, PyCharm, WebStorm and the recommended IDEs
```

CI: `.github/workflows/jetbrains-plugin.yml`.

## Publishing on JetBrains Marketplace

1. Sign in at https://plugins.jetbrains.com with a JetBrains Account and create the vendor **Algotricz** (Profile, Organizations).
2. Upload the first version by hand: https://plugins.jetbrains.com/plugin/add, with the zip from the workflow's `fixlock-jetbrains` artifact. JetBrains reviews new plugins (usually 1 to 3 working days).
3. For later versions, create a token at https://plugins.jetbrains.com/author/me/tokens, save it as the `JETBRAINS_MARKETPLACE_TOKEN` repository secret, and run the workflow with "JetBrains Marketplace" (or push a `jetbrains-v*` tag).
