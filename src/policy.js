'use strict';
// Changes a pull request makes to fixlock itself. Checks use the locks and settings of the base branch, so
// a PR can't switch its own check off; these findings make sure it can't switch off the next one either:
//   - a lock removed from .fixlock/registry.json, or changed in a way that matters (its code, file, owner,
//     test, expiry, …), needs that lock's owner, like a change to the locked code;
//   - a change to .fixlock/config.json (team and leads, policies, rules, AI review, tests, …) needs a lead.
// New locks never need approval: fixes lock themselves as they land. No git or disk here, so the CLI and
// the GitHub App apply this the same way.
const { mergeConfig, normalizeRegistry } = require('./config');

const REGISTRY = '.fixlock/registry.json';
const CONFIG = '.fixlock/config.json';

/** Lock fields that only describe or record history: changing them can't weaken a lock. */
const HARMLESS = new Set(['title', 'reason', 'issue', 'history', 'reviewed', 'release', 'date', 'previousOwners', 'source', 'commit', 'auto']);

const SETTINGS_RULE = {
  name: 'fixlock settings',
  paths: [CONFIG],
  approval: 'lead',
  reason: "fixlock's settings decide what is checked and who approves, so a lead approves changes to them.",
};

/** JSON with sorted keys, undefined dropped: equal values give equal text. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map((x) => canon(x === undefined ? null : x)).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

/** Fields of a lock that changed in a way that matters (null and missing count as the same). */
function changedFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !HARMLESS.has(k) && canon(before[k] == null ? null : before[k]) !== canon(after[k] == null ? null : after[k])).sort();
}

function tryParse(text) { try { return { value: JSON.parse(text) }; } catch (e) { return { error: e.message }; } }

/**
 * baseCfg, baseReg: the base branch's settings and locks (already parsed and merged).
 * head: { config, registry } — the PR's versions of the two files as text, or null when the PR deletes them.
 * Returns findings in the shapes evaluate.js already handles:
 *   { kind: 'lock', lock, file: '.fixlock/registry.json', registry: 'removed' | 'changed', fields, ... }
 *   { kind: 'rule', rule: SETTINGS_RULE, files: ['.fixlock/config.json'], settings: [...keys], ... }
 */
function policyFindings(baseCfg, baseReg, head, { expired = () => false } = {}) {
  const out = [];

  let headLocks = [];
  let unreadable = null;
  if (head.registry != null) {
    const p = tryParse(head.registry);
    if (p.error) unreadable = p.error; else headLocks = normalizeRegistry(p.value).locks;
  }
  const byId = new Map(headLocks.filter((l) => l && l.id).map((l) => [l.id, l]));
  for (const lock of baseReg.locks) {
    const now = byId.get(lock.id);
    const fields = now ? changedFields(lock, now) : [];
    if (now && !fields.length) continue;
    out.push({
      kind: 'lock', lock, file: REGISTRY, registry: now ? 'changed' : 'removed', fields,
      missing: [], renamed: [], copies: null, deleted: false, expired: expired(lock),
      note: now ? `lock changed in ${REGISTRY}: ${fields.join(', ')}`
        : head.registry == null ? `${REGISTRY} deleted` : unreadable ? `${REGISTRY} is not valid JSON (${unreadable})` : `lock removed from ${REGISTRY}`,
    });
  }

  let settings = null;
  if (head.config == null) settings = ['deleted'];
  else {
    const p = tryParse(head.config);
    if (p.error) settings = ['not valid JSON'];
    else {
      const now = mergeConfig(p.value);
      const keys = [...new Set([...Object.keys(baseCfg), ...Object.keys(now)])].filter((k) => canon(baseCfg[k]) !== canon(now[k])).sort();
      if (keys.length) settings = keys;
    }
  }
  if (settings) {
    out.push({
      kind: 'rule', rule: SETTINGS_RULE, files: [CONFIG], agents: [], file: CONFIG, settings,
      msg: settings[0] === 'deleted' ? `${CONFIG} deleted` : settings[0] === 'not valid JSON' ? `${CONFIG} is not valid JSON` : `${CONFIG} changed (${settings.join(', ')})`,
    });
  }
  return out;
}

/** Does a list of changed files touch fixlock's own files? */
const touchesFixlock = (files) => files.some((f) => f === REGISTRY || f === CONFIG);

module.exports = { REGISTRY, CONFIG, HARMLESS, SETTINGS_RULE, canon, changedFields, policyFindings, touchesFixlock };
