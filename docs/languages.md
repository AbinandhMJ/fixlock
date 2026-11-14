---
title: Supported languages
---

# Supported languages

::: v-pre
fixlock compares the **structure** of locked code, not its text, so reformatting, comments and line wrapping never count as changes ([how it works](how-it-works.md), [accuracy](benchmark.md)). It understands 63 languages and formats. Any other file (Markdown, plain text, images…) is matched line by line as text, so a lock still works there, it just treats every text change as a change.

Check how fixlock reads a file: `npx @abinandhmj/fixlock languages path/to/file`.

| Language | Files | Notes |
|---|---|---|
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` `.es6` |  |
| TypeScript | `.ts` `.tsx` `.mts` `.cts` |  |
| JSON / JSONC / JSON5 | `.json` `.jsonc` `.json5` `.webmanifest` `.babelrc` `.eslintrc` `.prettierrc` |  |
| Java | `.java` `.jav` |  |
| Kotlin | `.kt` `.kts` |  |
| Scala | `.scala` `.sc` `.sbt` |  |
| Groovy / Gradle / Jenkinsfile | `.groovy` `.gradle` `.gvy` `Jenkinsfile` `.jenkinsfile` |  |
| C# | `.cs` `.csx` |  |
| Go | `.go` |  |
| Rust | `.rs` |  |
| Swift | `.swift` |  |
| Dart / Flutter | `.dart` |  |
| C, C++, CUDA, Objective-C | `.c` `.h` `.cc` `.cpp` `.cxx` `.c++` `.hpp` `.hh` `.hxx` `.h++` `.ino` `.cu` `.cuh` `.m` `.mm` `.ipp` `.tpp` |  |
| Zig | `.zig` `.zon` |  |
| D | `.d` |  |
| Solidity | `.sol` |  |
| GLSL, HLSL, WGSL, Metal | `.glsl` `.vert` `.frag` `.geom` `.comp` `.hlsl` `.wgsl` `.metal` `.shader` `.cginc` |  |
| Verilog / SystemVerilog | `.v` `.sv` `.svh` `.vh` |  |
| Protobuf, Thrift, Prisma, Cap'n Proto | `.proto` `.thrift` `.prisma` `.capnp` `.avdl` |  |
| Apex, Haxe, Vala, Gleam, Odin, Move, Cairo, CUE, QML, ReScript… | `.cls` `.trigger` `.hx` `.vala` `.gleam` `.odin` `.carbon` `.move` `.cairo` `.bal` `.cue` `.as` `.re` `.res` `.pde` `.qml` `.kt.kts` |  |
| PHP | `.php` `.phtml` `.php3` `.php4` `.php5` `.phps` `.inc` |  |
| Terraform / HCL | `.tf` `.tfvars` `.hcl` `.nomad` `.pkr.hcl` |  |
| Jsonnet | `.jsonnet` `.libsonnet` |  |
| Nix | `.nix` |  |
| Python, Starlark/Bazel, GDScript, Mojo | `.py` `.pyi` `.pyw` `.pyx` `.pxd` `.bzl` `.star` `.gd` `.mojo` `.sage` `BUILD` `BUILD.bazel` `WORKSPACE` `WORKSPACE.bazel` `MODULE.bazel` `SConstruct` `SConscript` `Tiltfile` | indentation is part of the logic |
| Ruby (Gemfile, Rakefile, Podfile…) | `.rb` `.rake` `.gemspec` `.ru` `.podspec` `.jbuilder` `.thor` `Gemfile` `Rakefile` `Podfile` `Fastfile` `Appfile` `Brewfile` `Vagrantfile` `Guardfile` `Capfile` `Dangerfile` `Berksfile` |  |
| Crystal | `.cr` |  |
| Elixir | `.ex` `.exs` `.heex` |  |
| Julia | `.jl` |  |
| R | `.r` `.rmd` `.rprofile` |  |
| Perl / Raku | `.pl` `.pm` `.t` `.raku` `.rakumod` `.p6` |  |
| Tcl | `.tcl` `.tk` |  |
| Nim | `.nim` `.nims` `.nimble` | indentation is part of the logic |
| CoffeeScript | `.coffee` `.litcoffee` `.cson` | indentation is part of the logic |
| PowerShell | `.ps1` `.psm1` `.psd1` | case-insensitive |
| Shell (bash, zsh, fish…) | `.sh` `.bash` `.zsh` `.ksh` `.fish` `.bats` `.envrc` `.bashrc` `.zshrc` `.bash_profile` `.profile` `.zprofile` `PKGBUILD` `APKBUILD` |  |
| Dockerfile / Containerfile | `Dockerfile` `Containerfile` `.dockerfile` `.containerfile` | case-insensitive |
| Makefile / Justfile | `Makefile` `makefile` `GNUmakefile` `.mk` `.mak` `Justfile` `justfile` `.just` |  |
| CMake | `CMakeLists.txt` `.cmake` | case-insensitive |
| YAML (GitHub Actions, Kubernetes, Compose…) | `.yml` `.yaml` `.sls` `Procfile` `.clang-format` | indentation is part of the logic |
| TOML | `.toml` `Pipfile` `Cargo.lock.toml` |  |
| INI, .env, .properties, .editorconfig, Caddyfile | `.ini` `.cfg` `.conf` `.properties` `.editorconfig` `.gitconfig` `.npmrc` `.env` `.env.example` `.env.local` `.env.development` `.env.production` `.env.test` `Caddyfile` `.htaccess` `.service` `.desktop` |  |
| GraphQL | `.graphql` `.gql` `.graphqls` |  |
| AWK | `.awk` |  |
| Puppet | `.pp` `.epp` |  |
| SQL (PostgreSQL, MySQL, T-SQL, PL/SQL, BigQuery, CQL…) | `.sql` `.psql` `.pgsql` `.mysql` `.ddl` `.dml` `.hql` `.bq` `.pls` `.pkb` `.pks` `.prc` `.fnc` `.trg` `.tsql` `.cql` | case-insensitive |
| Lua / Luau | `.lua` `.luau` `.rockspec` `.p8` |  |
| Haskell, Elm, PureScript, Idris, Agda, Dhall | `.hs` `.lhs` `.elm` `.purs` `.idr` `.agda` `.dhall` |  |
| Ada, VHDL | `.adb` `.ads` `.ada` `.vhd` `.vhdl` | case-insensitive |
| OCaml | `.ml` `.mli` `.mll` `.mly` |  |
| F# | `.fs` `.fsi` `.fsx` |  |
| Pascal / Delphi | `.pas` `.dpr` `.lpr` `.dfm` | case-insensitive |
| Lisp, Clojure, Scheme, Racket, Emacs Lisp, Fennel | `.lisp` `.lsp` `.cl` `.el` `.scm` `.ss` `.rkt` `.clj` `.cljs` `.cljc` `.edn` `.fnl` `.hy` `.janet` |  |
| Erlang | `.erl` `.hrl` `.app.src` `.escript` |  |
| MATLAB / Octave | `.matlab` `.octave` |  |
| LaTeX / BibTeX | `.tex` `.sty` `.cls.tex` `.bib` |  |
| Fortran | `.f` `.f90` `.f95` `.f03` `.f08` `.for` `.ftn` | case-insensitive |
| Visual Basic / VBA | `.vb` `.bas` `.vbs` `.vba` `.frm` | case-insensitive |
| CSS | `.css` `.pcss` `.postcss` `.wxss` |  |
| SCSS, Less, Stylus | `.scss` `.less` `.styl` `.stylus` |  |
| Sass (indented) | `.sass` | indentation is part of the logic |
| HTML and templates: Angular, Vue, Svelte, Astro, Django/Jinja, Twig, Liquid, Handlebars, EJS, ERB, Razor, Blade, JSP, Thymeleaf, FreeMarker, Go templates | `.html` `.htm` `.xhtml` `.shtml` `.vue` `.svelte` `.astro` `.hbs` `.handlebars` `.mustache` `.j2` `.jinja` `.jinja2` `.njk` `.nunjucks` `.twig` `.liquid` `.ejs` `.erb` `.html.erb` `.cshtml` `.razor` `.vbhtml` `.blade.php` `.jsp` `.jspx` `.tag` `.ftl` `.ftlh` `.gohtml` `.tmpl` `.tpl` `.mjml` `.html.heex` `.leex` `.eex` `.jte` `.cfm` `.marko` `.riot` | templates: tags, attributes, `{{ }}` expressions, `<script>` and `<style>`; case-insensitive |
| XML (Maven, .csproj, Android, XAML, plist, SVG…) | `.xml` `.xsd` `.xsl` `.xslt` `.plist` `.csproj` `.vbproj` `.fsproj` `.vcxproj` `.props` `.targets` `.resx` `.xaml` `.axaml` `.storyboard` `.xib` `.wsdl` `.nuspec` `.config` `.manifest` `.rss` `.atom` `.kml` `.gpx` `.svg` `.xlf` `.xliff` `.iml` `.jelly` `.tld` `.fxml` `.launch` | templates: tags, attributes, `{{ }}` expressions, `<script>` and `<style>` |

## What "understands" means

- **Comments** in the language's own syntax are ignored, including nested block comments (Rust, Kotlin, Swift, Haskell, OCaml, Julia, Nim, D) and template comments (`<!-- -->`, `{# #}`, `{{!-- --}}`, `<%# %>`, `@* *@`, `<%-- --%>`).
- **Strings** follow the language: quote style is normalized; raw and verbatim strings (Rust `r#"…"#`, C++ `R"(…)"`, C# `@"…"`, Python `r"""…"""`, Lua `[[…]]`, Go backticks) keep their content; JS regex literals aren't strings; Rust lifetimes aren't quotes.
- **Indentation** is logic in Python, YAML, Nim, CoffeeScript and Sass: moving a line in or out of a block is a change. Elsewhere it's formatting.
- **Case** doesn't matter in SQL, Fortran, Pascal, Ada, VHDL, Visual Basic, PowerShell, CMake and Dockerfiles (`select` = `SELECT`).
- **Names**: a consistent rename of a local variable is reported as a rename. Member names (`user.role`), object keys, named arguments, HTML attributes, CSS properties and `CONSTANT_CASE` names are fixed: changing them is a change.
- **Templates**: in HTML, Vue, Svelte and the like, a lock can be markup or code from `<script>`, `<style>` or a `{{ }}` expression; attribute values (`[disabled]="form.invalid"`, `v-if="…"`) are read as code, so reformatting them is fine and changing them isn't.

Missing a language? It's usually one line in [`src/languages.js`](https://github.com/AbinandhMJ/fixlock/blob/main/src/languages.js): [open an issue](https://github.com/AbinandhMJ/fixlock/issues) or a PR.
:::
