// HTML for the fixlock dashboard. Server-rendered, no JavaScript, readable on a phone. Every value that
// comes from GitHub or a repository goes through esc().

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--ink:#0E1116;--paper:#F7F6F2;--lime:#B8F23A;--line:#E3E1DA;--muted:#5E6470;--red:#C2362B;--amber:#A86A00;--green:#2E7D32}
@media (prefers-color-scheme:dark){:root{--paper:#0E1116;--ink:#EDEDEA;--line:#2A2F38;--muted:#9AA1AD;--red:#FF7B6E;--amber:#F2B84B;--green:#7BD88F}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:inherit}header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line)}
.brand{font-weight:700;font-size:18px;text-decoration:none}.brand span{background:var(--lime);color:#0E1116;padding:0 6px;border-radius:4px;margin-left:6px;font-size:12px;font-weight:600}
header .who{margin-left:auto;color:var(--muted);font-size:14px}main{max-width:1040px;margin:0 auto;padding:20px}
h1{font-size:22px;margin:4px 0 16px}h2{font-size:17px;margin:28px 0 10px}.muted{color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}
.tile{border:1px solid var(--line);border-radius:10px;padding:12px}.tile b{display:block;font-size:24px}.tile.alert b{color:var(--red)}.tile.warn b{color:var(--amber)}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}.card h3{margin:0 0 4px;font-size:16px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;white-space:nowrap}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid currentColor;white-space:nowrap}
.bad{color:var(--red)}.ok{color:var(--green)}.mid{color:var(--amber)}.none{color:var(--muted)}
.btn{display:inline-block;background:var(--lime);color:#0E1116;padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;border:0;font:inherit;font-weight:600;cursor:pointer}
.note{border-left:3px solid var(--amber);padding:8px 12px;margin:12px 0;background:color-mix(in srgb,var(--amber) 8%,transparent)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}footer{max-width:1040px;margin:30px auto;padding:0 20px;color:var(--muted);font-size:13px}`;

export function layout(title, body, user) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · fixlock</title><style>${CSS}</style></head><body>
<header><a class="brand" href="/dashboard">fixlock<span>dashboard</span></a>${user ? `<span class="who">@${esc(user.login)} · <a href="/logout">Sign out</a></span>` : ''}</header>
<main>${body}</main>
<footer>fixlock · fixed stays fixed · a product of Algotricz · <a href="https://abinandhmj.github.io/fixlock/dashboard">Help</a></footer></body></html>`;
}

/** The "Set up" button: opens a pull request that sets fixlock up (POST, same origin only). */
export const setupButton = (repo, label = 'Set up') => {
  const [owner, name] = repo.split('/');
  return `<form method="post" action="/dashboard/setup/${encodeURIComponent(owner)}/${encodeURIComponent(name)}" style="display:inline"><button class="btn" type="submit">${esc(label)}</button></form>`;
};

const tile = (n, label, cls = '') => `<div class="tile ${cls}"><b>${esc(n)}</b>${esc(label)}</div>`;

function checkChip(check) {
  if (!check) return '<span class="chip none">No check</span>';
  if (check.conclusion === 'failure') return `<a class="chip bad" href="${esc(check.url)}">Needs approval</a>`;
  if (check.conclusion === 'success') return `<a class="chip ok" href="${esc(check.url)}">Passing</a>`;
  return `<a class="chip none" href="${esc(check.url)}">${esc(check.conclusion || 'Pending')}</a>`;
}

const stateChip = (s) => `<span class="chip ${s === 'intact' ? 'ok' : s === 'renamed' ? 'mid' : 'bad'}">${esc(s === 'intact' ? 'Intact' : s === 'renamed' ? 'Renamed' : s === 'needs re-lock' ? 'Needs re-lock' : 'File missing')}</span>`;

export function landing(configuredOk) {
  return layout('Sign in', `<h1>fixlock dashboard</h1>
<p>Every locked fix across your repositories: who owns it, which pull requests are waiting for approval, and what fixlock has stopped.</p>
${configuredOk ? '<p><a class="btn" href="/login">Sign in with GitHub</a></p><p class="muted">You will only see repositories you can already open on GitHub, where the fixlock GitHub App is installed.</p>'
    : '<div class="note">The dashboard isn\'t set up on this server yet: it needs <code>CLIENT_ID</code>, <code>CLIENT_SECRET</code> and <code>SESSION_SECRET</code>. See the <a href="https://abinandhmj.github.io/fixlock/dashboard">dashboard docs</a>.</div>'}`);
}

/** All repositories the person can see, grouped by account. */
export function overview(user, groups) {
  if (!groups.length) {
    return layout('Dashboard', `<h1>No repositories yet</h1><p>The fixlock GitHub App isn't installed on any repository you can access. <a class="btn" href="https://github.com/apps/fixlock-by-algotricz/installations/new">Install the GitHub App</a></p>`, user);
  }
  const all = groups.flatMap((g) => g.summaries);
  const set = all.filter((s) => s.setUp && !s.error);
  const sum = (k) => set.reduce((n, s) => n + s.counts[k], 0);
  let body = `<h1>Your locked fixes</h1>
<div class="tiles">${tile(sum('locks'), 'locks')}${tile(sum('blocked'), 'open PRs waiting for approval', sum('blocked') ? 'alert' : '')}${tile(sum('stopped'), 'recent PRs fixlock stopped')}${tile(sum('needsRelock'), 'locks to re-lock', sum('needsRelock') ? 'warn' : '')}</div>`;
  for (const g of groups) {
    body += `<h2>${esc(g.account)}</h2>`;
    for (const s of g.summaries) {
      if (!s.setUp) continue;
      const [owner, name] = s.repo.split('/');
      body += `<div class="card"><h3><a href="/dashboard/${encodeURIComponent(owner)}/${encodeURIComponent(name)}">${esc(s.repo)}</a>${s.private ? ' <span class="chip none">private</span>' : ''}</h3>`
        + (s.error ? `<p class="bad">${esc(s.error)}</p>` : `<span class="muted">${s.counts.locks} locks · <span class="${s.counts.blocked ? 'bad' : ''}">${s.counts.blocked} PRs waiting for approval</span> · ${s.counts.stopped} recently stopped${s.counts.needsRelock ? ` · <span class="mid">${s.counts.needsRelock} to re-lock</span>` : ''}</span>`)
        + '</div>';
    }
    const notSet = g.summaries.filter((s) => !s.setUp);
    if (notSet.length) {
      body += `<h3 class="muted" style="font-size:15px;margin-top:20px">Not set up yet</h3><p class="muted">Set up opens a pull request with the team and the past fixes worth locking. Nothing changes until you merge it.</p>`;
      body += notSet.map((s) => `<div class="card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1">${esc(s.repo)}</span>${setupButton(s.repo)}</div>`).join('');
    }
  }
  return layout('Dashboard', body, user);
}

/** One repository in detail. */
export function repoPage(user, s) {
  if (!s.setUp) return layout(s.repo, `<p class="muted"><a href="/dashboard">All repositories</a></p><h1>${esc(s.repo)}</h1><p>fixlock isn't set up here yet. <b>Set up</b> opens a pull request with the team (from recent commit authors) and the past fixes fixlock is surest about. Nothing changes until you merge it.</p><p>${setupButton(s.repo, 'Set up fixlock')}</p><p class="muted">Or in a clone: <code>npx @abinandhmj/fixlock quickstart</code></p>`, user);
  if (s.error) return layout(s.repo, `<h1>${esc(s.repo)}</h1><p class="bad">${esc(s.error)}</p>`, user);
  const c = s.counts;
  let body = `<p class="muted"><a href="/dashboard">All repositories</a></p><h1><a href="${esc(s.url)}">${esc(s.repo)}</a></h1>
<div class="tiles">${tile(c.locks, 'locks')}${tile(c.blocked, 'open PRs waiting for approval', c.blocked ? 'alert' : '')}${tile(c.stopped, 'recent PRs fixlock stopped')}${tile(c.overrides, 'approved by the owner')}${tile(`${c.withTests || 0}/${c.locks}`, 'locks proved by a test')}${tile(c.needsRelock, 'locks to re-lock', c.needsRelock ? 'warn' : '')}</div>`;
  if (s.noGithub.length) body += `<div class="note">${s.noGithub.map(esc).join(', ')} ${s.noGithub.length > 1 ? 'have' : 'has'} no GitHub username in <code>.fixlock/config.json</code>, so pull requests can't be approved by ${s.noGithub.length > 1 ? 'them' : 'them'}. Add it with <code>fixlock team add --name "…" --github &lt;username&gt;</code>.</div>`;

  body += '<h2>Open pull requests</h2>';
  body += s.openPrs.length ? `<div class="scroll"><table><tr><th>Pull request</th><th>Author</th><th>fixlock</th></tr>${s.openPrs.map((p) => `<tr><td><a href="${esc(p.url)}">#${p.number} ${esc(p.title)}</a>${p.draft ? ' <span class="chip none">draft</span>' : ''}</td><td>${esc(p.author)}</td><td>${checkChip(p.check)}${p.check && p.check.conclusion === 'failure' ? `<div class="muted">${esc(p.check.title)}</div>` : ''}</td></tr>`).join('')}</table></div>`
    : '<p class="muted">No open pull requests.</p>';

  body += '<h2>Recently stopped</h2>';
  body += s.stopped.length ? `<div class="scroll"><table><tr><th>Pull request</th><th>Outcome</th></tr>${s.stopped.map((p) => `<tr><td><a href="${esc(p.url)}">#${p.number} ${esc(p.title)}</a></td><td><span class="chip ${p.outcome === 'merged while blocked' ? 'bad' : p.outcome.startsWith('approved') ? 'mid' : 'ok'}">${esc(p.outcome)}</span></td></tr>`).join('')}</table></div><p class="muted">Pull requests closed recently whose final commit fixlock blocked at least once.</p>`
    : '<p class="muted">fixlock hasn\'t stopped any of the last 20 closed pull requests.</p>';

  body += `<h2>Locks (${s.locks.length})</h2>`;
  body += s.locks.length ? `<div class="scroll"><table><tr><th>Lock</th><th>File</th><th>Owner</th><th>On ${esc(s.defaultBranch)}</th></tr>${s.locks.map((l) => `<tr><td><b>${esc(l.id)}</b> ${esc(l.title)} <span class="muted">(${esc(l.type)})</span></td><td><code>${esc(l.file)}</code></td><td>${esc(l.owner)}${l.ownerOnTeam === false ? ' <span class="chip bad">left the team</span>' : l.ownerHasGithub ? '' : ' <span class="chip mid">no GitHub username</span>'}</td><td>${stateChip(l.state)}${l.expired ? ' <span class="chip mid">expired</span>' : ''}${l.test ? ' <span class="chip ok" title="${esc(l.test)}">test-linked</span>' : ''}</td></tr>`).join('')}</table></div>`
    + (c.needsRelock ? '<p class="muted">"Needs re-lock": the locked lines changed on the default branch, usually through an approved PR. Run <code>fixlock relock --changed</code> to lock the lines that hold the fix now, or remove the lock if the fix is gone for good.</p>' : '')
    + (c.expired || c.orphaned ? `<p class="muted">${c.expired ? `${c.expired} expired lock(s) only warn now. ` : ''}${c.orphaned ? `${c.orphaned} lock(s) belong to someone who left the team: <code>fixlock handover &lt;from&gt; &lt;to&gt;</code>. ` : ''}<code>fixlock review</code> lists every lock that needs a decision.</p>` : '')
    : '<p class="muted">No locks yet. Run <code>fixlock discover</code> to find past fixes worth locking.</p>';

  body += `<h2>Team</h2><div class="scroll"><table><tr><th>Name</th><th>GitHub</th><th>Role</th></tr>${s.team.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.github ? `@${esc(m.github)}` : '<span class="mid">none</span>'}</td><td>${esc(m.role)}</td></tr>`).join('')}</table></div>`;
  body += `<p class="muted">Checked ${esc(new Date(s.checkedAt).toUTCString())}. <a href="?refresh=1">Refresh now</a></p>`;
  return layout(s.repo, body, user);
}
