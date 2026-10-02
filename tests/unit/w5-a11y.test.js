// Audit C48, static half (no browser): the grey text tokens must pass WCAG
// AA (4.5:1) on the Win95 silver and white surfaces the live web1 theme
// puts them on, and the surf-log rating sliders must have labels. The
// browser half (computed colours, tap-target sizes) is the e2e scenario
// w5-a11y-phone.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../helpers/load-app');

// Load order from index.html.
const SHEETS = ['style.css', 'styles-web1.css', 'styles-web1-extensions.css', 'styles-retro.css', 'styles-kiosk.css'];
const read = f => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every `--inkN: value` declaration with its selector, in cascade order.
function inkDeclarations() {
  const out = [];
  SHEETS.forEach((file, fi) => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m, n = 0;
    while ((m = re.exec(css))) {
      for (const d of m[2].matchAll(/(--ink[234])\s*:\s*([^;]+)/g)) {
        out.push({ file, order: fi * 1e6 + n++, selector: m[1].trim(), prop: d[1], value: d[2].trim() });
      }
    }
  });
  return out;
}

// The tokens a non-kiosk web1 page actually inherits: :root, overridden by
// any body-level rule (a declaration on body beats one inherited from html),
// ranked by specificity then source order.
function web1Tokens() {
  const BODY_LEVEL = {
    'body': 1, '[data-era="web1"]': 10, 'body[data-era="web1"]': 11, 'body[data-era="web1"]:not(.kiosk)': 21
  };
  const tokens = {};
  const decls = inkDeclarations();
  for (const d of decls.filter(x => x.selector === ':root')) tokens[d.prop] = d.value;
  const bodyDecls = decls.filter(x => BODY_LEVEL[x.selector])
    .sort((a, b) => BODY_LEVEL[a.selector] - BODY_LEVEL[b.selector] || a.order - b.order);
  for (const d of bodyDecls) tokens[d.prop] = d.value;
  return { tokens, decls };
}

test('--ink2/3/4 pass WCAG AA on Win95 silver and white in the web1 theme', () => {
  const { tokens, decls } = web1Tokens();
  // Anything else defining these tokens needs a look (and this test updated).
  const known = new Set([':root', 'body[data-era="web1"]:not(.kiosk)']);
  assert.deepEqual(decls.filter(d => !known.has(d.selector)).map(d => `${d.file}: ${d.selector}`), []);
  for (const prop of ['--ink2', '--ink3', '--ink4']) {
    assert.match(tokens[prop] || '', /^#[0-9a-f]{3,6}$/i, `${prop} is a plain hex colour`);
    for (const bg of ['#c0c0c0', '#ffffff']) {
      const r = contrast(tokens[prop], bg);
      assert.ok(r >= 4.5, `${prop} ${tokens[prop]} on ${bg} is ${r.toFixed(2)}:1`);
    }
  }
});

test('Choc TV styles do not consume the grey ink tokens', () => {
  assert.doesNotMatch(read('styles-kiosk.css'), /var\(--ink[234]\)/);
});

test('every range input in index.html has a label', () => {
  const html = read('index.html');
  const ranges = [...html.matchAll(/<input[^>]*type="range"[^>]*>/g)].map(m => m[0]);
  assert.ok(ranges.length >= 3);
  for (const tag of ranges) {
    const id = (tag.match(/\sid="([^"]+)"/) || [])[1];
    const named = /\saria-label(ledby)?="[^"]+"/.test(tag) || new RegExp(`<label[^>]*\\sfor="${id}"`).test(html);
    assert.ok(named, `#${id} has no <label for>, aria-label or aria-labelledby`);
  }
});
