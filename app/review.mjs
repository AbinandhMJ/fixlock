// Judge one pull request exactly like `fixlock check` does in CI, but from the GitHub API: no checkout,
// no workflow file. Then report it as the "fixlock" check run plus one sticky PR comment.
import config from '../src/config.js';
import evaluate from '../src/evaluate.js';

export const CHECK_NAME = 'fixlock';
export const MARKER = '<!-- fixlock-app -->';
const DOCS = 'https://abinandhmj.github.io/fixlock/';

const ACTION = /uses:\s*['"]?abinandhmj\/fixlock@/i;

/** Does the repo already run the fixlock GitHub Action? Then the App stays out of the way. */
export async function usesAction(gh, repo, ref) {
  const files = (await gh.list(repo, '.github/workflows', ref)).filter((f) => f.type === 'file' && /\.ya?ml$/i.test(f.name));
  for (const f of files) if (ACTION.test((await gh.file(repo, f.path, ref)) || '')) return f.path;
  return null;
}

/**
 * gh: client() from github.mjs (installation token). pr: the pull_request object from the webhook.
 * Returns { conclusion, title, summary, findings }.
 */
export async function reviewPullRequest(gh, pr) {
  const baseRepo = pr.base.repo.full_name;
  const headRepo = (pr.head.repo && pr.head.repo.full_name) || baseRepo; // null when the fork was deleted
  const baseSha = pr.base.sha;
  const headSha = pr.head.sha;

  // Policy and locks come from the base branch, so a PR can't approve itself by editing them.
  // A PR that sets fixlock up for the first time is judged by its own config.
  let rawCfg = await gh.file(baseRepo, '.fixlock/config.json', baseSha);
  let rawReg = await gh.file(baseRepo, '.fixlock/registry.json', baseSha);
  if (rawCfg === null) {
    rawCfg = await gh.file(headRepo, '.fixlock/config.json', headSha);
    rawReg = await gh.file(headRepo, '.fixlock/registry.json', headSha);
  }
  if (rawCfg === null) {
    return { conclusion: 'neutral', title: 'fixlock is not set up in this repository', summary: `No \`.fixlock/config.json\` on \`${pr.base.ref}\`. Run \`fixlock init\` to start: ${DOCS}getting-started`, findings: [] };
  }
  const cfg = config.mergeConfig(parse(rawCfg, '.fixlock/config.json'));
  const reg = config.normalizeRegistry(rawReg === null ? null : parse(rawReg, '.fixlock/registry.json'));

  const files = await gh.all(`/repos/${baseRepo}/pulls/${pr.number}/files`);
  const changes = files.map((f) => ({ file: f.filename, from: f.previous_filename || f.filename, status: f.status }));
  const renames = {};
  for (const ch of changes) if (ch.status === 'renamed') renames[ch.from] = ch.file;
  const only = new Set(changes.flatMap((ch) => [ch.file, ch.from]));

  const cache = new Map();
  const at = (repo, sha) => (file) => {
    const k = `${repo}@${sha}:${file}`;
    if (!cache.has(k)) cache.set(k, gh.file(repo, file, sha));
    return cache.get(k);
  };
  const findings = [
    ...await evaluate.lockFindings(cfg, reg, { read: at(headRepo, headSha), good: at(baseRepo, baseSha), renames, only }),
    ...evaluate.pathFindings(cfg, changes),
  ];

  let approvers = new Set();
  if (evaluate.needingApproval(cfg, findings).length) approvers = evaluate.approvedBy(await gh.all(`/repos/${baseRepo}/pulls/${pr.number}/reviews`));
  const blocked = evaluate.applyApprovals(cfg, findings, { approvers, author: pr.user && pr.user.login });

  const locks = findings.filter((f) => f.kind === 'lock');
  const title = blocked.length ? `${blocked.length} locked change(s) need approval`
    : locks.length ? `${locks.length} locked change(s), all approved or warnings only`
    : findings.length ? 'Review notes' : `All ${reg.locks.length} locks intact`;
  return { conclusion: blocked.length ? 'failure' : 'success', title, summary: evaluate.toMarkdown(cfg, findings, pr.base.ref), findings };
}

function parse(text, name) {
  try { return JSON.parse(text); } catch (e) { throw new Error(`${name} is not valid JSON: ${e.message}`); }
}

/** Run the review and publish it: the check run, and the PR comment when there's something to say. */
export async function publish(gh, pr) {
  const repo = pr.base.repo.full_name;
  // One check and one comment per PR: if the fixlock Action runs here, it reports; the App doesn't.
  try {
    const workflow = await usesAction(gh, repo, pr.base.sha);
    if (workflow) return { skipped: `the fixlock GitHub Action runs in ${workflow}` };
  } catch (e) { console.error('fixlock: could not read workflows', e); }
  let result;
  try {
    result = await reviewPullRequest(gh, pr);
  } catch (e) {
    console.error('fixlock review failed', e);
    result = { conclusion: 'neutral', title: 'fixlock could not check this pull request', summary: `Error: ${String(e.message || e).slice(0, 500)}`, findings: [], error: true };
  }
  await gh.post(`/repos/${repo}/check-runs`, {
    name: CHECK_NAME, head_sha: pr.head.sha, status: 'completed', conclusion: result.conclusion,
    details_url: DOCS, output: { title: result.title, summary: result.summary.slice(0, 65000) },
  });

  // One comment per PR, edited in place. Clean PRs don't get one unless there was one before.
  const comments = await gh.all(`/repos/${repo}/issues/${pr.number}/comments`);
  const mine = comments.find((c) => (c.body || '').includes(MARKER));
  if (result.findings.length || mine) {
    const body = `${MARKER}\n${result.summary}\n<sub>[fixlock](${DOCS}) · fixed stays fixed · a product of Algotricz</sub>\n`;
    if (mine) { if (mine.body !== body) await gh.patch(`/repos/${repo}/issues/comments/${mine.id}`, { body }); }
    else await gh.post(`/repos/${repo}/issues/${pr.number}/comments`, { body });
  }
  return result;
}
