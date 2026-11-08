'use strict';
const g = require('./git');

const lc = (s) => String(s || '').trim().toLowerCase();

/** Find a team member by github username, email or name. */
function find(cfg, who) {
  const w = lc(who);
  if (!w) return null;
  return cfg.team.find((m) => lc(m.github) === w || lc(m.name) === w || (m.emails || []).some((e) => lc(e) === w)) || null;
}

/** The person running fixlock: FIXLOCK_USER (github/email) or git user.email. */
function current(cfg) {
  const id = process.env.FIXLOCK_USER || g.userEmail();
  return find(cfg, id) || { name: id || 'unknown', github: null, emails: id ? [id] : [], role: 'developer', unknown: true };
}

const handle = (m) => (m ? (m.github ? `@${m.github}` : m.name) : 'unknown');

/** GitHub usernames allowed to approve changes to a lock, per policy. */
function approvers(cfg, lock) {
  const policy = cfg.policies[lock.type] || cfg.policies.bug;
  const owner = find(cfg, lock.owner);
  const leads = cfg.team.filter((m) => m.role === 'lead');
  const set = new Set();
  if (['owner', 'owner-or-lead'].includes(policy.approval) && owner) set.add(owner);
  if (['lead', 'owner-or-lead'].includes(policy.approval)) leads.forEach((l) => set.add(l));
  if (policy.approval === 'owner' && !owner) leads.forEach((l) => set.add(l)); // owner left the team → leads
  return [...set];
}

/** Can this person change the lock without anyone's approval? */
function exempt(cfg, lock, person) {
  const policy = cfg.policies[lock.type] || cfg.policies.bug;
  if (policy.approval === 'none') return true;
  return approvers(cfg, lock).some((a) => a === person || (person.github && lc(a.github) === lc(person.github)));
}

module.exports = { find, current, handle, approvers, exempt };
