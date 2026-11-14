#!/usr/bin/env node
// Structural matching in every supported language family: for each, harmless edits (comments in that
// language's syntax, reformatting, the language's own quirks) must keep a lock intact, and edits that
// change behaviour must be caught. Each case also checks the file is detected as the right language.
'use strict';
const S = require('../src/structural');
const LANG = require('../src/languages');

let failures = 0; let checks = 0;
const ok = (cond, msg, extra = '') => {
  checks++;
  if (cond) return;
  failures++; console.log(`FAIL ${msg}\n${extra}`);
};
const status = (snippet, content, file) => S.verify(snippet, content, file).status;

// { file, lang, lock: [lines], base, same: [harmless versions], changed: [harmful versions] }
const CASES = [
  { file: 'src/guard.ts', lang: 'ts', lock: ['if (!user || user.role !== "admin") {', 'return res.status(403).json({ error: "forbidden" });'],
    base: 'export function guard(user, res) {\n  if (!user || user.role !== "admin") {\n    return res.status(403).json({ error: "forbidden" });\n  }\n}',
    same: ["export function guard(user, res) {\n  // only admins\n  if (!user || user.role !== 'admin') { return res.status(403).json({ error: 'forbidden', }) }\n}"],
    changed: ['export function guard(user, res) {\n  if (!user || user.role === "admin") {\n    return res.status(403).json({ error: "forbidden" });\n  }\n}'] },
  { file: 'App.jsx', lang: 'js', lock: ['{items.length === 0 && <p>Nothing here</p>}'],
    base: 'const App = () => (\n  <div>\n    {items.length === 0 && <p>Nothing here</p>}\n  </div>\n);',
    same: ['const App = () => (\n  <div>\n    {/* empty state */}\n    {items.length === 0 &&\n      <p>Nothing here</p>}\n  </div>\n)'],
    changed: ['const App = () => (\n  <div>\n    {items.length > 0 && <p>Nothing here</p>}\n  </div>\n);'] },
  { file: 'tsconfig.json', lang: 'json', lock: ['"strict": true,'],
    base: '{\n  "compilerOptions": {\n    "strict": true,\n    "target": "es2022"\n  }\n}',
    same: ['{\n  // keep strict on\n  "compilerOptions": { "strict": true, "target": "es2022" }\n}'],
    changed: ['{\n  "compilerOptions": {\n    "strict": false,\n    "target": "es2022"\n  }\n}'] },
  { file: 'Order.java', lang: 'java', lock: ['if (order.getTotal() > LIMIT) {', 'throw new LimitException(order);'],
    base: 'class A {\n  void f(Order order) {\n    if (order.getTotal() > LIMIT) {\n      throw new LimitException(order);\n    }\n  }\n}',
    same: ['class A {\n  void f(Order order) {\n    /* limit check */\n    if (order.getTotal() > LIMIT)\n    { throw new LimitException(order); }\n  }\n}'],
    changed: ['class A {\n  void f(Order order) {\n    if (order.getTotal() >= LIMIT) {\n      throw new LimitException(order);\n    }\n  }\n}'] },
  { file: 'Repo.kt', lang: 'kotlin', lock: ['val user = repo.find(id) ?: return null'],
    base: 'fun load(id: Int): User? {\n    val user = repo.find(id) ?: return null\n    return user\n}',
    same: ['fun load(id: Int): User? {\n    /* outer /* nested */ comment */\n    val user = repo.find(id)\n        ?: return null\n    return user\n}'],
    changed: ['fun load(id: Int): User? {\n    val user = repo.find(id)!!\n    return user\n}'] },
  { file: 'build.gradle', lang: 'groovy', lock: ["minSdkVersion 24"],
    base: "android {\n    defaultConfig {\n        minSdkVersion 24\n    }\n}",
    same: ["android {\n    defaultConfig {\n        // Android 7+\n        minSdkVersion   24\n    }\n}"],
    changed: ["android {\n    defaultConfig {\n        minSdkVersion 21\n    }\n}"] },
  { file: 'Pay.cs', lang: 'csharp', lock: ['if (amount <= 0) throw new ArgumentException(@"amount ""must"" be > 0");'],
    base: 'class P {\n  void Pay(decimal amount) {\n    if (amount <= 0) throw new ArgumentException(@"amount ""must"" be > 0");\n  }\n}',
    same: ['class P {\n  void Pay(decimal amount) {\n    // validate\n    if (amount <= 0)\n      throw new ArgumentException(@"amount ""must"" be > 0");\n  }\n}'],
    changed: ['class P {\n  void Pay(decimal amount) {\n    if (amount < 0) throw new ArgumentException(@"amount ""must"" be > 0");\n  }\n}'] },
  { file: 'load.go', lang: 'go', lock: ['if err != nil {', 'return fmt.Errorf(`load %s: %w`, path, err)'],
    base: 'func load(path string) error {\n\tif err != nil {\n\t\treturn fmt.Errorf(`load %s: %w`, path, err)\n\t}\n\treturn nil\n}',
    same: ['func load(path string) error {\n  // wrap the error\n  if err != nil {\n    return fmt.Errorf(`load %s: %w`,\n      path, err)\n  }\n  return nil\n}'],
    changed: ['func load(path string) error {\n\tif err == nil {\n\t\treturn fmt.Errorf(`load %s: %w`, path, err)\n\t}\n\treturn nil\n}'] },
  { file: 'lib.rs', lang: 'rust', lock: ["fn first<'a>(s: &'a str) -> Option<char> {", "if s.is_empty() { return None; }", "s.chars().next().filter(|c| *c != '#')"],
    base: "fn first<'a>(s: &'a str) -> Option<char> {\n    if s.is_empty() { return None; }\n    s.chars().next().filter(|c| *c != '#')\n}",
    same: ["/* doc /* nested */ */\nfn first<'a>(s: &'a str) -> Option<char> {\n    // guard\n    if s.is_empty() {\n        return None;\n    }\n    s.chars()\n        .next()\n        .filter(|c| *c != '#')\n}"],
    changed: ["fn first<'a>(s: &'a str) -> Option<char> {\n    if s.is_empty() { return None; }\n    s.chars().next().filter(|c| *c == '#')\n}"] },
  { file: 'View.swift', lang: 'swift', lock: ['guard let user = session.user else { return }'],
    base: 'func show() {\n    guard let user = session.user else { return }\n    render(user)\n}',
    same: ['func show() {\n    /// must be logged in\n    guard let user = session.user else {\n        return\n    }\n    render(user)\n}'],
    changed: ['func show() {\n    let user = session.user!\n    render(user)\n}'] },
  { file: 'auth.dart', lang: 'dart', lock: ["if (token == null || token.isEmpty) return '/login';"],
    base: "String route(String? token) {\n  if (token == null || token.isEmpty) return '/login';\n  return '/home';\n}",
    same: ['String route(String? token) {\n  // not signed in\n  if (token == null || token.isEmpty) {\n    return "/login";\n  }\n  return "/home";\n}'],
    changed: ["String route(String? token) {\n  if (token == null && token.isEmpty) return '/login';\n  return '/home';\n}"] },
  { file: 'parse.cpp', lang: 'c', lock: ['if (len > MAX_LEN) return -1;', 'std::regex re(R"(\\d+"x)");'],
    base: 'int parse(size_t len) {\n  if (len > MAX_LEN) return -1;\n  std::regex re(R"(\\d+"x)");\n  return 0;\n}',
    same: ['int parse(size_t len) {\n  /* bound */ if (len > MAX_LEN)\n    return -1;\n  std::regex re(R"(\\d+"x)");\n  return 0;\n}'],
    changed: ['int parse(size_t len) {\n  if (len > MAX_LEN) return 0;\n  std::regex re(R"(\\d+"x)");\n  return 0;\n}'] },
  { file: 'Cart.php', lang: 'php', lock: ['if (empty($items)) {', 'return 0;'],
    base: '<?php\nfunction total($items) {\n    if (empty($items)) {\n        return 0;\n    }\n    return array_sum($items);\n}',
    same: ['<?php\n#[Pure]\nfunction total($items) {\n    # nothing to add\n    if (empty($items)) { return 0; }\n    return array_sum($items);\n}'],
    changed: ['<?php\nfunction total($items) {\n    if (!empty($items)) {\n        return 0;\n    }\n    return array_sum($items);\n}'] },
  { file: 'pay.py', lang: 'python', lock: ['    if amount <= 0:', '        raise ValueError(f"bad amount {amount}")', '    return charge(amount)'],
    base: 'def pay(amount):\n    if amount <= 0:\n        raise ValueError(f"bad amount {amount}")\n    return charge(amount)\n',
    same: ["def pay(amount):\n    # validate\n    if amount <= 0:  # never charge zero\n        raise ValueError(\n            f'bad amount {amount}'\n        )\n    return charge(amount)\n"],
    // dedenting the raise out of the if: same tokens, different logic
    changed: ['def pay(amount):\n    if amount <= 0:\n        pass\n    raise ValueError(f"bad amount {amount}")\n    return charge(amount)\n',
      'def pay(amount):\n    if amount <= 0:\n        raise ValueError(f"bad amount {amount}")\n        return charge(amount)\n'] },
  { file: 'user.rb', lang: 'ruby', lock: ['return nil unless user&.active?'],
    base: 'def load(id)\n  user = User.find(id)\n  return nil unless user&.active?\n  user\nend',
    same: ['def load(id)\n  user = User.find(id)\n=begin\nonly active users\n=end\n  return nil unless user&.active? # guard\n  user\nend'],
    changed: ['def load(id)\n  user = User.find(id)\n  return nil if user&.active?\n  user\nend'] },
  { file: 'lib/acct.ex', lang: 'elixir', lock: ['def withdraw(acct, amt) when amt > 0 and amt <= acct.balance do'],
    base: 'defmodule Acct do\n  def withdraw(acct, amt) when amt > 0 and amt <= acct.balance do\n    :ok\n  end\nend',
    same: ['defmodule Acct do\n  # no overdraft\n  def withdraw(acct, amt)\n      when amt > 0 and amt <= acct.balance do\n    :ok\n  end\nend'],
    changed: ['defmodule Acct do\n  def withdraw(acct, amt) when amt > 0 do\n    :ok\n  end\nend'] },
  { file: 'deploy.sh', lang: 'shell', lock: ['if [ ${#ARGS[@]} -eq 0 ]; then', 'exit 1'],
    base: '#!/bin/bash\nset -euo pipefail\nif [ ${#ARGS[@]} -eq 0 ]; then\n  exit 1\nfi',
    same: ['#!/bin/bash\nset -euo pipefail\n# need args\nif [ ${#ARGS[@]} -eq 0 ]; then\n    exit 1\nfi'],
    changed: ['#!/bin/bash\nset -euo pipefail\nif [ ${#ARGS[@]} -eq 0 ]; then\n  exit 0\nfi'] },
  { file: 'Dockerfile', lang: 'dockerfile', lock: ['USER node'],
    base: 'FROM node:22-alpine\nRUN npm ci\nUSER node\nCMD ["node", "server.js"]',
    same: ['FROM node:22-alpine\nRUN npm ci\n# never run as root\nuser node\nCMD ["node", "server.js"]'],
    changed: ['FROM node:22-alpine\nRUN npm ci\nUSER root\nCMD ["node", "server.js"]'] },
  { file: '.github/workflows/ci.yml', lang: 'yaml', lock: ['    if: github.event_name == \'push\'', '    steps:', '      - run: npm publish'],
    base: "jobs:\n  release:\n    if: github.event_name == 'push'\n    steps:\n      - run: npm publish\n",
    same: ["jobs:\n  release:\n    # only on push\n    if: github.event_name == \"push\"\n    steps:\n      - run: npm publish # release\n"],
    changed: ["jobs:\n  release:\n    if: github.event_name == 'pull_request'\n    steps:\n      - run: npm publish\n",
      // re-indenting the step out of the job changes the document
      "jobs:\n  release:\n    if: github.event_name == 'push'\n    steps:\n- run: npm publish\n"] },
  { file: 'pyproject.toml', lang: 'toml', lock: ['requires-python = ">=3.10"'],
    base: '[project]\nname = "app"\nrequires-python = ">=3.10"\n',
    same: ["[project]\nname = 'app'\n# 3.9 breaks typing\nrequires-python = '>=3.10'\n"],
    changed: ['[project]\nname = "app"\nrequires-python = ">=3.8"\n'] },
  { file: '.env.example', lang: 'ini', lock: ['SESSION_SECURE=true'],
    base: 'PORT=3000\nSESSION_SECURE=true\n',
    same: ['PORT=3000\n# keep secure cookies\nSESSION_SECURE=true\n'],
    changed: ['PORT=3000\nSESSION_SECURE=false\n'] },
  { file: 'main.tf', lang: 'hcl', lock: ['deletion_protection = true'],
    base: 'resource "aws_db_instance" "db" {\n  deletion_protection = true\n}',
    same: ['resource "aws_db_instance" "db" {\n  # never drop prod\n  // really\n  deletion_protection   = true\n}'],
    changed: ['resource "aws_db_instance" "db" {\n  deletion_protection = false\n}'] },
  { file: 'migrations/007.sql', lang: 'sql', lock: ['WHERE deleted_at IS NULL'],
    base: 'SELECT id, email\nFROM users\nWHERE deleted_at IS NULL\nORDER BY id;',
    same: ['select id, email\nfrom users\n-- soft-deleted users must never show\nwhere deleted_at is null\norder by id;'],
    changed: ['SELECT id, email\nFROM users\nWHERE deleted_at IS NOT NULL\nORDER BY id;'] },
  { file: 'game.lua', lang: 'lua', lock: ['if hp <= 0 then return end'],
    base: 'function hit(hp)\n  if hp <= 0 then return end\n  hp = hp - 1\nend',
    same: ['function hit(hp)\n  --[[ dead players\n  can\'t be hit ]]\n  if hp <= 0 then\n    return\n  end -- guard\n  hp = hp - 1\nend'],
    changed: ['function hit(hp)\n  if hp < 0 then return end\n  hp = hp - 1\nend'] },
  { file: 'Safe.hs', lang: 'haskell', lock: ['safeDiv _ 0 = Nothing'],
    base: 'safeDiv :: Int -> Int -> Maybe Int\nsafeDiv _ 0 = Nothing\nsafeDiv a b = Just (a `div` b)',
    same: ['safeDiv :: Int -> Int -> Maybe Int\n{- no division by zero {- nested -} -}\nsafeDiv _ 0 = Nothing -- guard\nsafeDiv a b = Just (a `div` b)'],
    changed: ['safeDiv :: Int -> Int -> Maybe Int\nsafeDiv _ 1 = Nothing\nsafeDiv a b = Just (a `div` b)'] },
  { file: 'src/core.clj', lang: 'lisp', lock: ['(when-not (empty? items)', '(reduce + items))'],
    base: '(defn total [items]\n  (when-not (empty? items)\n    (reduce + items)))',
    same: ['(defn total [items]\n  ;; nil for no items\n  (when-not (empty? items) (reduce + items)))'],
    changed: ['(defn total [items]\n  (when (empty? items)\n    (reduce + items)))'] },
  { file: 'srv.erl', lang: 'erlang', lock: ['handle(N) when N > 0 -> ok;'],
    base: 'handle(N) when N > 0 -> ok;\nhandle(_) -> error.',
    same: ['%% positive only\nhandle(N) when N > 0 ->\n    ok;\nhandle(_) -> error.'],
    changed: ['handle(N) when N >= 0 -> ok;\nhandle(_) -> error.'] },
  { file: 'styles/button.scss', lang: 'scss', lock: ['background: url(https://cdn.example.com/a.png);', 'pointer-events: none;'],
    base: '.btn:disabled {\n  background: url(https://cdn.example.com/a.png);\n  pointer-events: none;\n}',
    same: ['.btn:disabled {\n  // disabled buttons must not be clickable\n  background:url(https://cdn.example.com/a.png);\n  /* keep */ pointer-events:none;\n}'],
    changed: ['.btn:disabled {\n  background: url(https://cdn.example.com/a.png);\n  pointer-events: auto;\n}'] },
  { file: 'src/app/login.component.html', lang: 'html', lock: ['<button type="submit" [disabled]="form.invalid || loading" (click)="submit()">', "Don't wait"],
    base: '<form [formGroup]="form">\n  <button type="submit" [disabled]="form.invalid || loading" (click)="submit()">\n    Don\'t wait\n  </button>\n</form>',
    same: ['<form [formGroup]="form">\n  <!-- never allow double submit -->\n  <button\n    type=\'submit\'\n    [disabled]="form.invalid||loading"\n    (click)="submit()"\n  >\n    Don\'t\n    wait\n  </button>\n</form>'],
    changed: ['<form [formGroup]="form">\n  <button type="submit" [disabled]="form.invalid && loading" (click)="submit()">\n    Don\'t wait\n  </button>\n</form>',
      '<form [formGroup]="form">\n  <button type="submit" (click)="submit()">\n    Don\'t wait\n  </button>\n</form>'] },
  { file: 'src/Cart.vue', lang: 'html', lock: ['if (qty < 1) return;', 'items.push(qty);'],
    base: '<template>\n  <p v-if="items.length === 0">Your cart is empty</p>\n</template>\n<script setup lang="ts">\nfunction add(qty: number) {\n  if (qty < 1) return;\n  items.push(qty);\n}\n</script>\n<style scoped>\np { color: red; }\n</style>',
    same: ['<template>\n  <!-- empty state -->\n  <p v-if="items.length===0">\n    Your cart is empty\n  </p>\n</template>\n<script setup lang="ts">\nfunction add(qty: number) {\n  // guard\n  if (qty < 1) { return }\n  items.push(qty);\n}\n</script>\n<style scoped>\np { color: red; }\n</style>'],
    changed: ['<template>\n  <p v-if="items.length === 0">Your cart is empty</p>\n</template>\n<script setup lang="ts">\nfunction add(qty: number) {\n  if (qty < 0) return;\n  items.push(qty);\n}\n</script>\n<style scoped>\np { color: red; }\n</style>'] },
  { file: 'src/CartEmpty.vue', lang: 'html', lock: ['<p v-if="items.length === 0">Your cart is empty</p>'],
    base: '<template>\n  <p v-if="items.length === 0">Your cart is empty</p>\n</template>\n<script setup>\nconst items = [];\n</script>',
    same: ['<template>\n  <!-- empty state -->\n  <p v-if="items.length===0">\n    Your cart is empty\n  </p>\n</template>\n<script setup>\nconst items = [];\n</script>'],
    changed: ['<template>\n  <p v-if="items.length !== 0">Your cart is empty</p>\n</template>\n<script setup>\nconst items = [];\n</script>'] },
  { file: 'src/List.svelte', lang: 'html', lock: ['{#if items.length > 0}'],
    base: '<ul>\n{#if items.length > 0}\n  {#each items as item}<li>{item}</li>{/each}\n{/if}\n</ul>',
    same: ['<ul>\n<!-- only when there are items -->\n{#if items.length>0}\n  {#each items as item}<li>{item}</li>{/each}\n{/if}\n</ul>'],
    changed: ['<ul>\n{#if items.length >= 0}\n  {#each items as item}<li>{item}</li>{/each}\n{/if}\n</ul>'] },
  { file: 'templates/account.html', lang: 'html', lock: ['{% if user.is_authenticated and not user.is_banned %}'],
    base: '<div>\n{% if user.is_authenticated and not user.is_banned %}\n  <a href="/logout">Log out</a>\n{% endif %}\n</div>',
    same: ['<div>\n{# banned users never see this #}\n{%   if user.is_authenticated and not user.is_banned   %}\n  <a href=\'/logout\'>Log out</a>\n{% endif %}\n</div>'],
    changed: ['<div>\n{% if user.is_authenticated %}\n  <a href="/logout">Log out</a>\n{% endif %}\n</div>'] },
  { file: 'Views/Order.cshtml', lang: 'html', lock: ['<input asp-for="Quantity" min="1" max="99" />'],
    base: '<form>\n  <input asp-for="Quantity" min="1" max="99" />\n</form>',
    same: ['<form>\n  @* never allow 0 *@\n  <input asp-for="Quantity"\n         min="1"\n         max="99" />\n</form>'],
    changed: ['<form>\n  <input asp-for="Quantity" min="0" max="99" />\n</form>'] },
  { file: 'pom.xml', lang: 'xml', lock: ['<artifactId>log4j-core</artifactId>', '<version>2.17.1</version>'],
    base: '<dependency>\n  <groupId>org.apache.logging.log4j</groupId>\n  <artifactId>log4j-core</artifactId>\n  <version>2.17.1</version>\n</dependency>',
    same: ['<dependency>\n  <groupId>org.apache.logging.log4j</groupId>\n  <!-- 2.17.1+: Log4Shell fix -->\n  <artifactId>log4j-core</artifactId>\n  <version>2.17.1</version>\n</dependency>'],
    changed: ['<dependency>\n  <groupId>org.apache.logging.log4j</groupId>\n  <artifactId>log4j-core</artifactId>\n  <version>2.14.0</version>\n</dependency>'] },
  { file: 'schema.graphql', lang: 'graphql', lock: ['email: String! @auth(requires: ADMIN)'],
    base: 'type User {\n  id: ID!\n  email: String! @auth(requires: ADMIN)\n}',
    same: ['type User {\n  id: ID!\n  # PII: admins only\n  email: String!   @auth(requires: ADMIN)\n}'],
    changed: ['type User {\n  id: ID!\n  email: String! @auth(requires: USER)\n}'] },
  { file: 'deploy.ps1', lang: 'powershell', lock: ['if (-not $Env:CONFIRM) { exit 1 }'],
    base: 'param()\nif (-not $Env:CONFIRM) { exit 1 }\nDeploy-App',
    same: ['param()\n<# require explicit confirmation #>\nIF (-NOT $env:CONFIRM) {\n  exit 1\n}\nDeploy-App'],
    changed: ['param()\nif ($Env:CONFIRM) { exit 1 }\nDeploy-App'] },
  { file: 'solver.f90', lang: 'fortran', lock: ['if (n <= 0) return'],
    base: 'subroutine solve(n)\n  if (n <= 0) return\nend subroutine',
    same: ['SUBROUTINE solve(n)\n  ! nothing to do\n  IF (N <= 0) RETURN\nEND SUBROUTINE'],
    changed: ['subroutine solve(n)\n  if (n < 0) return\nend subroutine'] },
  { file: 'Module1.vb', lang: 'vb', lock: ['If amount <= 0 Then Return'],
    base: 'Sub Pay(amount As Decimal)\n  If amount <= 0 Then Return\nEnd Sub',
    same: ["Sub Pay(amount As Decimal)\n  ' validate first\n  if Amount <= 0 then return\nEnd Sub"],
    changed: ['Sub Pay(amount As Decimal)\n  If amount < 0 Then Return\nEnd Sub'] },
];

for (const c of CASES) {
  const name = `${c.file} (${c.lang})`;
  ok(LANG.detect(c.file) === c.lang, `${name}: detected as ${c.lang}`, `got ${LANG.detect(c.file)}`);
  ok(status(c.lock, c.base, c.file) === 'intact', `${name}: lock found in the original`, JSON.stringify(S.verify(c.lock, c.base, c.file)));
  c.same.forEach((v, k) => ok(status(c.lock, v, c.file) === 'intact', `${name}: harmless edit #${k + 1} stays intact`, v));
  c.changed.forEach((v, k) => ok(status(c.lock, v, c.file) === 'changed', `${name}: harmful edit #${k + 1} is caught`, `${status(c.lock, v, c.file)}\n${v}`));
}

// Detection details
const detect = {
  'Dockerfile.prod': 'dockerfile', 'Containerfile': 'dockerfile', '.env.production': 'ini', 'CMakeLists.txt': 'cmake',
  'resources/views/home.blade.php': 'html', 'app/views/a.html.erb': 'html', 'BUILD.bazel': 'python', 'Gemfile': 'ruby',
  'Jenkinsfile': 'groovy', 'Makefile': 'make', 'x.d.ts': 'ts', 'README.md': null, 'photo.png': null, 'LICENSE': null,
};
for (const [f, want] of Object.entries(detect)) ok(LANG.detect(f) === want, `detect ${f} → ${want}`, `got ${LANG.detect(f)}`);
ok(LANG.list().length >= 60, `at least 60 languages (${LANG.list().length})`);

// Line numbers stay right through markup, template expressions and <script> bodies
const vue = '<template>\n  <p>{{ a }}</p>\n</template>\n<script>\nconst x = 1;\nif (x) go();\n</script>';
ok(S.verify(['if (x) go();'], vue, 'a.vue').lines.join('-') === '6-6', 'markup: line numbers inside <script>', JSON.stringify(S.verify(['if (x) go();'], vue, 'a.vue')));
// Rust char literal vs lifetime, and raw strings
ok(S.tokenize("let c = 'x'; fn f<'a>(s: &'a str) {}", 'rust').filter((t) => t.k === 'str').length === 1, "rust: 'x' is a char, 'a is a lifetime");
ok(S.tokenize('let s = r#"a "quoted" b"#;', 'rust').some((t) => t.k === 'str' && t.v.includes('"quoted"')), 'rust: raw string with quotes');
// TypeScript: the leading | prettier adds to wrapped unions
ok(status(['let f: A | ((p: B) => C) = g;'], 'let f:\n  | A\n  | ((\n      p: B,\n    ) => C) = g', 'a.ts') === 'intact', 'ts: leading | in a wrapped union type is formatting');
ok(status(['let f: A | B = g;'], 'let f: A & B = g', 'a.ts') === 'changed', 'ts: | → & is still a change');
// Rust: backslash-newline in a string skips the next line's indentation
ok(status(['log("a \\', '  b");'], 'log("a \\\n        b");', 'x.rs') === 'intact', 'rust: re-indenting a string continuation line is formatting');
// SQL: case-insensitive
ok(status(['SELECT * FROM Users'], 'select * from users', 'q.sql') === 'intact', 'sql: keyword and name case are ignored');

// docs/languages.md lists every language (regenerate it when adding one)
const doc = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'languages.md'), 'utf8');
for (const l of LANG.list()) ok(doc.includes('`' + l.files[0] + '`'), `docs/languages.md lists ${l.id} (${l.files[0]})`);

console.log(failures ? `\n${failures} failure(s) of ${checks}` : `\nLANGUAGES PASS (${checks} checks, ${CASES.length} language cases)`);
process.exit(failures ? 1 : 0);
