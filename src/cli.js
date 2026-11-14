'use strict';
// How to run fixlock from files fixlock writes (git hooks, the Claude Code hook, MCP configs, AI rules).
//
// In a JavaScript project that installs @abinandhmj/fixlock, the local copy is used (no network).
// Anywhere else — Python, Go, Java, Rust, .NET, PHP… — it runs through npx with the scoped package name,
// pinned to the installed minor version. Never the bare name `fixlock`: that is not this package on npm.
const fs = require('fs');
const path = require('path');

const PKG = '@abinandhmj/fixlock';
const VERSION = require('../package.json').version;

/** "0.6" for 0.x, "1" for 1.x+: newer patch releases are picked up, breaking ones aren't. */
function pin(version = VERSION) {
  const [major, minor] = version.split('.');
  return major === '0' ? `${major}.${minor}` : major;
}

/** Does this repository install fixlock itself (package.json dependency or node_modules)? */
function installedIn(root) {
  if (!root) return false;
  if (fs.existsSync(path.join(root, 'node_modules', '@abinandhmj', 'fixlock', 'package.json'))) return true;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies].some((d) => d && d[PKG]);
  } catch { return false; }
}

/** argv to run fixlock in `root`: ['npx', ...] */
function argv(root) {
  return installedIn(root) ? ['npx', '--no-install', 'fixlock'] : ['npx', '-y', `${PKG}@${pin()}`];
}

/** Shell command prefix, e.g. "npx --no-install fixlock" or "npx -y @abinandhmj/fixlock@0.6". */
function command(root) { return argv(root).join(' '); }

/** Is `cmd` a fixlock command we wrote (any form, any version)? Used to replace old hook entries. */
function isOurs(cmd) {
  return /\bnpx\b.*?(?:^|\s)(?:fixlock|@abinandhmj\/fixlock(?:@[\w.^~-]+)?)\s+(?:hook|check|autolock|mcp)\b/.test(String(cmd || ''));
}

/** Command to show people: "npx fixlock" where the repo installs it, else "npx @abinandhmj/fixlock". */
function human(root) { return installedIn(root) ? 'npx fixlock' : `npx ${PKG}`; }

module.exports = { PKG, VERSION, pin, installedIn, argv, command, human, isOurs };
