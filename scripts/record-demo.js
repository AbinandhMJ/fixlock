#!/usr/bin/env node
// Records `fixlock demo` into an animated terminal SVG (README/docs) plus a static poster SVG.
// The text comes from a real run of the demo, so the recording can't drift from the product.
//   node scripts/record-demo.js            → docs/public/demo.svg, docs/public/demo-static.svg
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'public');

/* 1. Capture a coloured run of the demo. */
function capture() {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { require('../src/demo').run({ fast: true, color: true }); } finally { console.log = orig; }
  return lines.join('\n').replace(/fixlock-demo-[A-Za-z0-9]+/g, 'fixlock-demo-k3x9').replace(/\/tmp\/|[A-Z]:\\[^ ]*\\Temp\\/g, '/tmp/').split('\n');
}

/* 2. ANSI → styled runs. */
const PALETTE = { 31: '#FF6B6B', 32: '#7EE787', 33: '#F2CC60', 36: '#79C0FF', lime: '#B8F23A' };
function runs(line) {
  const out = []; let st = {};
  const re = /\x1b\[([\d;]+)m/g; let last = 0; let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), ...st });
    const code = m[1];
    if (code === '0') st = {};
    else if (code === '1') st = { ...st, bold: true };
    else if (code === '2') st = { ...st, dim: true };
    else if (code === '38;5;155') st = { ...st, color: PALETTE.lime };
    else if (PALETTE[code]) st = { ...st, color: PALETTE[code] };
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ text: line.slice(last), ...st });
  return out;
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (l) => l.replace(/\x1b\[[\d;]+m/g, '');

/* 3. Timing: lines appear one by one; steps and the AI verdict get a beat. */
function timeline(lines) {
  let t = 0.6; const at = [];
  for (const l of lines) {
    const p = plain(l);
    if (/^\d /.test(p)) t += 1.1;                 // new step
    else if (/verdict:/.test(p)) t += 0.9;        // the moment that matters
    else if (/^\s+\$ /.test(p)) t += 0.5;         // a command
    else if (/^Without fixlock/.test(p)) t += 1.2;
    else t += p.trim() ? 0.16 : 0.05;
    at.push(t);
  }
  return { at, total: t + 5 };
}

function svg(lines, { animate }) {
  const LH = 19; const CW = 7.83; const PADX = 22; const TOP = 52;
  const width = Math.ceil(Math.max(...lines.map((l) => plain(l).length)) * CW + PADX * 2);
  const height = TOP + lines.length * LH + 24;
  const { at, total } = timeline(lines);
  let css = `.t{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:13px;fill:#E6EDF3;white-space:pre}.b{font-weight:700}.d{opacity:.55}`;
  let body = '';
  lines.forEach((l, i) => {
    const y = TOP + i * LH;
    let cls = 't';
    if (animate) {
      const p = ((at[i] / total) * 100).toFixed(2);
      css += `@keyframes k${i}{0%,${p}%{opacity:0}${(Number(p) + 0.01).toFixed(2)}%,97%{opacity:1}100%{opacity:0}}.l${i}{animation:k${i} ${total.toFixed(1)}s linear infinite}`;
      cls += ` l${i}`;
    }
    const spans = runs(l).map((r) => {
      const attrs = [r.color ? `fill="${r.color}"` : '', r.bold ? 'class="b"' : '', r.dim ? 'class="d"' : ''].filter(Boolean);
      if (r.bold && r.dim) attrs.splice(attrs.indexOf('class="b"'), 2, 'class="b d"');
      return attrs.length ? `<tspan ${attrs.join(' ')}>${esc(r.text)}</tspan>` : esc(r.text);
    }).join('');
    body += `<text class="${cls}" x="${PADX}" y="${y}" xml:space="preserve">${spans}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Terminal recording of the fixlock demo: a bug fix is locked, an AI edit that would undo it is stopped, and the pull request is blocked until the owner approves.">` +
    `<style>${css}</style>` +
    `<rect width="${width}" height="${height}" rx="12" fill="#0E1116"/>` +
    `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="#2A313C"/>` +
    `<circle cx="22" cy="20" r="6" fill="#FF5F57"/><circle cx="42" cy="20" r="6" fill="#FEBC2E"/><circle cx="62" cy="20" r="6" fill="#28C840"/>` +
    `<text class="t d" x="${width / 2}" y="24" text-anchor="middle">npx @abinandhmj/fixlock demo</text>` +
    body + '</svg>\n';
}

const lines = capture();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'demo.svg'), svg(lines, { animate: true }));
fs.writeFileSync(path.join(OUT, 'demo-static.svg'), svg(lines, { animate: false }));
const { total } = timeline(lines);
console.log(`demo.svg: ${lines.length} lines, ${total.toFixed(0)}s loop`);
module.exports = { svg, capture, timeline };

/* 4. Optional: MP4 + GIF for social posts (needs playwright + ffmpeg; dev machines only).
 *    node scripts/record-demo.js --video   → assets/demo/fixlock-demo.mp4, .gif */
if (process.argv.includes('--video')) {
  (async () => {
    const { execFileSync } = require('child_process');
    const os = require('os');
    let pw; try { pw = require('playwright'); } catch { console.error('--video needs playwright'); process.exit(1); }
    const { at, total } = timeline(lines);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlock-rec-'));
    const full = svg(lines, { animate: false });
    const W = Number(full.match(/width="(\d+)"/)[1]); const H = Number(full.match(/height="(\d+)"/)[1]);
    const b = await pw.chromium.launch();
    const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5 });
    let concat = '';
    const frame = async (k, dur) => {
      const partial = svg(lines.map((l, i) => (i < k ? l : '')), { animate: false }).replace(/height="\d+"/, `height="${H}"`).replace(/viewBox="0 0 (\d+) \d+"/, `viewBox="0 0 $1 ${H}"`);
      await page.setContent(`<body style="margin:0;background:#0E1116"><img style="display:block" src="data:image/svg+xml;base64,${Buffer.from(partial).toString('base64')}"></body>`);
      const f = path.join(tmp, `f${String(k).padStart(3, '0')}.png`);
      await page.screenshot({ path: f });
      concat += `file '${f}'\nduration ${dur.toFixed(2)}\n`;
      return f;
    };
    await frame(0, at[0]);
    let lastFile;
    for (let k = 1; k <= lines.length; k++) lastFile = await frame(k, (k < lines.length ? at[k] : total) - at[k - 1]);
    concat += `file '${lastFile}'\n`;
    await b.close();
    const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, concat);
    const outDir = path.join(__dirname, '..', 'assets', 'demo'); fs.mkdirSync(outDir, { recursive: true });
    const mp4 = path.join(outDir, 'fixlock-demo.mp4'); const gif = path.join(outDir, 'fixlock-demo.gif');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48[p];[b][p]paletteuse=dither=none', gif]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`video: ${path.relative(process.cwd(), mp4)} (${(fs.statSync(mp4).size / 1024).toFixed(0)} kB), ${path.relative(process.cwd(), gif)} (${(fs.statSync(gif).size / 1024).toFixed(0)} kB)`);
  })();
}
