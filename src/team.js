'use strict';

const lc = (s) => String(s || '').trim().toLowerCase();

/** Find a team member by github username, email or name. */
function find(cfg, who) {
  const w = lc(who);
  if (!w) return null;
  return cfg.team.find((m) => lc(m.github) === w || lc(m.gitlab) === w || lc(m.name) === w || (m.emails || []).some((e) => lc(e) === w)) || null;
}

/** The person running fixlock: FIXLOCK_USER (github/email) or git user.email. */
function current(cfg) {
  const id = process.env.FIXLOCK_USER || require('./git').userEmail();
  return find(cfg, id) || { name: id || 'unknown', github: null, emails: id ? [id] : [], role: 'developer', unknown: true };
}

const handle = (m) => (m ? (m.github || m.gitlab ? `@${m.github || m.gitlab}` : m.name) : ''); // nobody → '' so callers can fall back to the recorded owner

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

/** Approvers of a lock who can approve on GitHub (they have a GitHub username). */
function githubApprovers(cfg, lock) {
  return approvers(cfg, lock).filter((m) => m.github);
}

/** Can this person change the lock without anyone's approval? */
function exempt(cfg, lock, person) {
  const policy = cfg.policies[lock.type] || cfg.policies.bug;
  if (policy.approval === 'none') return true;
  return approvers(cfg, lock).some((a) => a === person || (person.github && lc(a.github) === lc(person.github)) || (person.gitlab && lc(a.gitlab) === lc(person.gitlab)));
}

module.exports = { find, current, handle, approvers, githubApprovers, exempt };
