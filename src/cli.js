'use strict';
// How to run fixlock from files fixlock writes (git hooks, the Claude Code hook, MCP configs, AI rules).
//
// In a JavaScript project that installs @abinandhmj/fixlock, the local copy is used (no network).
// Teams that installed the standalone `fixlock` command (pip/pipx/uv, downloads) use it directly:
// `fixlock init` records that as `"launcher": "fixlock"` in .fixlock/config.json.
// Anywhere else it runs through npx with the scoped package name, pinned to the installed minor
// version. Never `npx fixlock` (the bare name): that is not this package on npm.
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

/** Running as the standalone binary (pip wheel, download) rather than on Node.js? */
function native() { return !!(process.versions && process.versions.bun); }

/** The repo's chosen launcher: FIXLOCK_LAUNCHER, else .fixlock/config.json "launcher" ("fixlock" | "npx"). */
function launcher(root) {
  if (process.env.FIXLOCK_LAUNCHER) return process.env.FIXLOCK_LAUNCHER;
  try { return JSON.parse(fs.readFileSync(path.join(root, '.fixlock', 'config.json'), 'utf8')).launcher || null; } catch { return null; }
}

/** Which launcher `init` should record for a repo: "fixlock" when set up from the standalone binary. */
function defaultLauncher(root) {
  return native() && !installedIn(root) ? 'fixlock' : null;
}

/** argv to run fixlock in `root`: ['npx', ...] or ['fixlock'] */
function argv(root) {
  const l = launcher(root);
  if (l === 'fixlock') return ['fixlock'];                         // the team installs the native command
  if (installedIn(root)) return ['npx', '--no-install', 'fixlock']; // JS project with fixlock in its deps
  if (l !== 'npx' && native()) return ['fixlock'];                 // set up from the native command
  return ['npx', '-y', `${PKG}@${pin()}`];
}

/** Shell command prefix, e.g. "npx --no-install fixlock" or "npx -y @abinandhmj/fixlock@0.6". */
function command(root) { return argv(root).join(' '); }

/** Is `cmd` a fixlock command we wrote (any form, any version)? Used to replace old hook entries. */
function isOurs(cmd) {
  const c = String(cmd || '');
  return /\bnpx\b.*?(?:^|\s)(?:fixlock|@abinandhmj\/fixlock(?:@[\w.^~-]+)?)\s+(?:hook|check|autolock|mcp)\b/.test(c)
    || /^(?:\S*[\\/])?fixlock(?:\.exe)?\s+(?:hook|check|autolock|mcp)\b/.test(c.trim());
}

/** Command to show people: "npx fixlock" where the repo installs it, else "npx @abinandhmj/fixlock". */
function human(root) {
  if (argv(root)[0] === 'fixlock') return 'fixlock';
  return installedIn(root) ? 'npx fixlock' : `npx ${PKG}`;
}

module.exports = { PKG, VERSION, pin, installedIn, native, launcher, defaultLauncher, argv, command, human, isOurs };
