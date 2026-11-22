'use strict';
// AI lock judgment (optional, off by default). When a change touches a locked fix, ask a model: "is the
// fix's behaviour still there?" and show its short answer next to the lock in the check and PR comment.
//
// Deterministic first, AI second: the answer is advice for the reviewer. It never approves or blocks a PR.
// Code is sent only where the team says, with the team's own key:
//   provider "anthropic"  ANTHROPIC_API_KEY (model default claude-haiku-5-5)
//   provider "openai"     OPENAI_API_KEY, any OpenAI-compatible API (judge.url, judge.model)
//   provider "command"    a local command that reads the prompt on stdin and prints the answer, such as
//                         "ollama run llama3.1" or "claude -p": nothing leaves the machine
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULTS = { enabled: false, provider: 'anthropic', model: '', url: '', command: '', timeout: 60, maxLines: 400 };
const VERDICTS = ['preserved', 'broken', 'unsure'];

/** The code around where the lock was, as it is now (whole file if short). */
function contextOf(content, lock, L, maxLines) {
  if (content === null) return '(the file was deleted)';
  const lines = content.split('\n');
  if (lines.length <= maxLines) return lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
  const at = L.locate(lock, lines);
  const mid = at.length ? Math.round((Math.min(...at) + Math.max(...at)) / 2) : 1;
  const from = Math.max(1, mid - Math.floor(maxLines / 2));
  return lines.slice(from - 1, from - 1 + maxLines).map((l, i) => `${from + i}: ${l}`).join('\n');
}

function prompt(finding, current) {
  const l = finding.lock;
  return [
    'You review one code change for a team that locks bug fixes so they are not undone by accident.',
    `A ${l.type === 'feature' ? 'finished feature' : 'bug fix'} was locked in ${finding.file}.`,
    `What it is: ${l.title}`,
    l.reason && l.reason !== l.title ? `Why it exists: ${l.reason}` : '',
    l.issue ? `Issue: ${l.issue}` : '',
    '',
    'The locked lines were:',
    '```',
    ...l.snippet,
    '```',
    finding.missing && finding.missing.length ? `These locked lines are no longer in the file as written:\n${finding.missing.map((x) => `- ${x.trim()}`).join('\n')}` : '',
    '',
    `The file now (line numbers on the left):`,
    '```',
    current,
    '```',
    '',
    'Question: does the code still do what the locked lines did, so the bug stays fixed (or the feature still works)? The logic may have moved, been renamed or been rewritten; judge the behaviour, not the text.',
    'Answer with JSON only, no other text: {"verdict": "preserved" | "broken" | "unsure", "explanation": "<one or two sentences a reviewer can check, naming the lines>"}',
  ].filter((x) => x !== '').join('\n');
}

/** Pull {verdict, explanation} out of a model's reply. */
function parseAnswer(text) {
  const raw = String(text || '');
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const verdict = String(j.verdict || '').toLowerCase();
      if (VERDICTS.includes(verdict)) return { verdict, explanation: String(j.explanation || '').trim().slice(0, 600) };
    } catch { /* fall through */ }
  }
  const v = VERDICTS.find((x) => new RegExp(`\\b${x}\\b`, 'i').test(raw));
  return { verdict: v || 'unsure', explanation: raw.trim().slice(0, 600) || 'No answer.' };
}

async function post(url, headers, body, timeout) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout * 1000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

/** Ask the configured model. Returns { verdict, explanation, model } or { verdict: "error", explanation }. */
async function ask(cfgJudge, text, env = process.env) {
  const j = { ...DEFAULTS, ...cfgJudge };
  try {
    if (j.provider === 'command') {
      if (!j.command) throw new Error('set judge.command, such as "ollama run llama3.1"');
      const r = spawnSync(j.command, { shell: true, input: text, encoding: 'utf8', timeout: j.timeout * 1000 });
      if (r.status !== 0) throw new Error(`${j.command} exited with ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
      return { ...parseAnswer(r.stdout), model: j.command };
    }
    if (j.provider === 'openai') {
      const key = env.OPENAI_API_KEY || env.FIXLOCK_JUDGE_KEY;
      if (!key) throw new Error('set OPENAI_API_KEY');
      if (!j.model) throw new Error('set judge.model');
      const url = `${(j.url || env.FIXLOCK_OPENAI_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
      const d = await post(url, { authorization: `Bearer ${key}` }, { model: j.model, messages: [{ role: 'user', content: text }] }, j.timeout);
      return { ...parseAnswer(((d.choices || [])[0] || {}).message?.content), model: j.model };
    }
    const key = env.ANTHROPIC_API_KEY || env.FIXLOCK_JUDGE_KEY;
    if (!key) throw new Error('set ANTHROPIC_API_KEY');
    const model = j.model || 'claude-haiku-5-5';
    const url = `${(j.url || env.FIXLOCK_ANTHROPIC_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
    const d = await post(url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: 400, messages: [{ role: 'user', content: text }] }, j.timeout);
    return { ...parseAnswer((d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')), model };
  } catch (e) {
    return { verdict: 'error', explanation: e.name === 'AbortError' ? `timed out after ${j.timeout}s` : e.message, model: j.model || j.provider };
  }
}

/**
 * Judge each changed lock that still needs a person (blocked or warn, not already satisfied or approved).
 * read(file) → current content or null. Sets f.judge.
 */
async function judgeFindings(cfg, findings, read, L, { log = () => {} } = {}) {
  const j = { ...DEFAULTS, ...(cfg.judge || {}) };
  const todo = findings.filter((f) => f.kind === 'lock' && (f.status === 'blocked' || f.status === 'warn') && (f.missing.length || f.deleted));
  for (const f of todo) {
    log(f.lock.id);
    const content = await read(f.file);
    f.judge = await ask(j, prompt(f, contextOf(content, f.lock, L, j.maxLines)));
  }
  return todo.length;
}

module.exports = { DEFAULTS, prompt, parseAnswer, ask, judgeFindings, contextOf };
