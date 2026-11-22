'use strict';
// Test-linked locks: a lock can name the test that proves its fix (lock.test). When the locked lines
// change, `fixlock check --run-tests` runs that test. If it still passes, and the change didn't touch the
// test itself, the lock is satisfied: the code was restructured but the fix still works, so nobody has to
// approve. If it fails, the fix is broken, whatever the diff looks like.
//
// The command comes from cfg.tests.commands (by file extension, or "*"), else from the project:
//   Python → pytest; JS/TS → vitest, jest, mocha or node --test (from package.json); Go → go test;
//   Java/Kotlin → Gradle or Maven, for that class; PHP → phpunit; Ruby → rspec or ruby; Rust → cargo test.
// {files} in a command becomes the test files; {dir} the first file's folder; {class} its class name.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULTS = { run: false, satisfies: true, timeout: 600, commands: {} };

const exists = (root, rel) => fs.existsSync(path.join(root, rel));
function pkgDeps(root) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return { ...p.dependencies, ...p.devDependencies };
  } catch { return {}; }
}

/** The command template for a test file, or null when fixlock doesn't know how to run it. */
function commandFor(root, cfg, file) {
  const t = { ...DEFAULTS, ...(cfg.tests || {}) };
  const ext = path.extname(file).toLowerCase();
  if (t.commands[ext]) return t.commands[ext];
  if (t.commands['*']) return t.commands['*'];
  if (ext === '.py') return 'python -m pytest -q {files}';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts'].includes(ext)) {
    const d = pkgDeps(root);
    if (d.vitest) return 'npx vitest run {files}';
    if (d.jest || d['ts-jest']) return 'npx jest {files}';
    if (d.mocha) return 'npx mocha {files}';
    return ext.startsWith('.t') || ext === '.mts' || ext === '.cts' ? null : 'node --test {files}';
  }
  if (ext === '.go') return 'go test ./{dir}/...';
  if (ext === '.java' || ext === '.kt') {
    if (exists(root, 'gradlew')) return './gradlew test --tests {class}';
    if (exists(root, 'build.gradle') || exists(root, 'build.gradle.kts')) return 'gradle test --tests {class}';
    if (exists(root, 'pom.xml')) return 'mvn -q test -Dtest={class}';
    return null;
  }
  if (ext === '.php') return exists(root, 'vendor/bin/phpunit') ? 'vendor/bin/phpunit {files}' : null;
  if (ext === '.rb') return file.includes('spec') ? 'bundle exec rspec {files}' : 'ruby -Itest {files}';
  if (ext === '.rs') return 'cargo test';
  return null;
}

const shellQuote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/** Fill a command template for these test files. */
function fill(template, files) {
  const first = files[0];
  return template
    .replace(/\{files\}/g, files.map(shellQuote).join(' '))
    .replace(/\{dir\}/g, path.posix.dirname(first) === '.' ? '.' : path.posix.dirname(first))
    .replace(/\{class\}/g, path.basename(first).replace(/\.[^.]+$/, ''));
}

/**
 * Run each test file once. files: repo-relative paths. Returns { [file]: { status, command, output } },
 * status: "passed" | "failed" | "missing" (no such file) | "no-runner" | "timeout".
 */
function run(root, cfg, files, { log = () => {} } = {}) {
  const t = { ...DEFAULTS, ...(cfg.tests || {}) };
  const out = {};
  for (const file of [...new Set(files)]) {
    if (!exists(root, file)) { out[file] = { status: 'missing', command: null, output: '' }; continue; }
    const template = commandFor(root, cfg, file);
    if (!template) { out[file] = { status: 'no-runner', command: null, output: `fixlock doesn't know how to run ${file}. Set "tests": { "commands": { "${path.extname(file) || '*'}": "<command> {files}" } } in .fixlock/config.json.` }; continue; }
    const command = fill(template, [file]);
    log(command);
    const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', timeout: t.timeout * 1000, env: { ...process.env, CI: process.env.CI || '1', FORCE_COLOR: '0' } });
    const output = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-30).join('\n');
    out[file] = { status: r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : r.status === 0 ? 'passed' : 'failed', command, output };
  }
  return out;
}

module.exports = { DEFAULTS, commandFor, fill, run };
