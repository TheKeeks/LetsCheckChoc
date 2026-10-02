// Audit C27: stored XSS. Notes, displayName, photo URLs, entry ids and
// condition values come from Firestore (any crew member, or a direct SDK
// write) or a JSON import, and the community log is rendered for everyone
// via innerHTML. Seed hostile entries, render every surface that shows
// them, and check the generated HTML: only the app's own tags/attributes,
// and the hostile text survives as visible text.
//
// The vm DOM stores innerHTML without parsing it, so scanHtml() below is a
// small tag/attribute tokenizer; tests/e2e/scenarios/w3-xss-surflog.js
// repeats the check with Chromium's real parser.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/load-app');

// ── tiny HTML scanner ──────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };
const decode = s => s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e) => ENT[e]);
function scanHtml(html) {
  const tags = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') continue;
    const attrs = {};
    const ar = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = ar.exec(m[2]))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    tags.push({ tag: m[1].toLowerCase(), attrs });
  }
  const text = decode(html.replace(/<\/?[a-zA-Z][^>]*>/g, ''));
  return { tags, text };
}
const APP_IMG_ONERROR = "this.style.display='none'";
function assertOnlyAppMarkup(html, allowedTags, label) {
  const { tags } = scanHtml(html);
  for (const t of tags) {
    assert.ok(allowedTags.includes(t.tag), `${label}: injected <${t.tag}> in ${html}`);
    for (const [k, v] of Object.entries(t.attrs)) {
      assert.ok(['class', 'style', 'src', 'alt', 'onerror', 'data-id', 'colspan', 'id', 'aria-label', 'href', 'title'].includes(k),
        `${label}: injected attribute ${k}= on <${t.tag}>`);
      if (k === 'onerror') assert.equal(v, APP_IMG_ONERROR, `${label}: onerror handler was rewritten`);
    }
  }
  return scanHtml(html);
}

// ── hostile entries ────────────────────────────────────
const HOSTILE_COMMUNITY = {
  id: 'c1', userId: 'crewB',
  displayName: '<img src=x onerror="window.__xss=1">Bob',
  timestamp: '2026-09-14T07:30',
  ratings: { size: 6, windQuality: 7, rideQuality: 5 },
  notes: '<svg onload=window.__xss=2>',          // 26 chars: survives the 30-char slice
  photos: [
    { url: 'https://h.example/a" onerror="window.__xss=3', path: '' },
    { url: 'javascript:window.__xss=4', path: '' }
  ],
  conditions: {
    swell: { height: '<u>3</u>', period: '<i>10</i>', direction: 150,
             secondary: { height: '<b>1</b>', period: 6, direction: 120 } },
    wind: { speed: '<i>5</i>', direction: '<s>200</s>' },
    tide: { height: 1, rate: 0.5, stage: '<s>rising</s>', timeToNearest: '<b>2</b>' },
    source: 'openmeteo-archive',
    note: '<b>note</b>'
  }
};
const HOSTILE_OWN = Object.assign({}, HOSTILE_COMMUNITY, {
  id: 'x"><img src=y onerror=window.__xss=5>', userId: 'me', displayName: 'Me'
});

// The drill-down formats swell numbers with toFixed(); give it numbers so
// the escaping (not the string-number crash, tested separately) is checked.
const DRILL = Object.assign({}, HOSTILE_COMMUNITY, {
  conditions: Object.assign({}, HOSTILE_COMMUNITY.conditions, {
    swell: { height: 3, period: 10, direction: 150, secondary: { height: 1, period: 6, direction: 120 } }
  })
});

function appWith(entries) {
  const app = loadApp();
  app.run("window._fbUserId = 'me'; window._fbUserIsAnon = false;");
  app.get('STATE').surfLog = app.run(JSON.stringify(entries));
  return app;
}

test('surf log table: notes, displayName, photo URLs and ids render as text, not markup', () => {
  const app = appWith([HOSTILE_COMMUNITY, HOSTILE_OWN]);
  app.call('renderSurfLogTable');
  const rows = app.dom.byId('surflog-tbody').children;
  assert.equal(rows.length, 2);
  const allowed = ['td', 'br', 'span', 'div', 'img', 'button'];
  for (const tr of rows) {
    const { tags, text } = assertOnlyAppMarkup(tr.innerHTML, allowed, 'table row');
    const imgs = tags.filter(t => t.tag === 'img');
    // The https photo keeps its exact URL (quote and all) inside src; the
    // javascript: one is dropped.
    assert.deepEqual(imgs.map(i => i.attrs.src), ['https://h.example/a" onerror="window.__xss=3']);
    assert.ok(text.includes('<svg onload=window.__xss=2>'), 'notes shown as literal text');
    const ids = tags.filter(t => t.attrs['data-id'] != null).map(t => t.attrs['data-id']);
    if (ids.length) assert.deepEqual(ids, [HOSTILE_OWN.id, HOSTILE_OWN.id]);
  }
  const community = scanHtml(rows.find(r => r.innerHTML.includes('community')).innerHTML);
  assert.ok(community.text.includes('<img src=x onerror="window.__xss=1">Bob'), 'displayName shown as literal text');
});

test('row detail (conditions) escapes every stored value', () => {
  const app = appWith([HOSTILE_COMMUNITY]);
  let detail = null;
  const fakeTr = { nextElementSibling: null, after(n) { detail = n; } };
  app.call('toggleEntryDetail', app.run('STATE.surfLog[0]'), fakeTr);
  assert.ok(detail, 'detail row rendered');
  const { text } = assertOnlyAppMarkup(detail.innerHTML, ['td', 'div', 'span', 'br'], 'detail row');
  for (const s of ['<u>3</u>', '<i>10</i>', '<b>1</b>', '<i>5</i>', '<s>200</s>', '<s>rising</s>', '<b>2</b>']) {
    assert.ok(text.includes(s), 'shown as text: ' + s);
  }
});

test('regression drill-down escapes displayName, notes, photo URL and tide strings', () => {
  const app = appWith([DRILL]);
  app.call('openRegressionDrilldown', app.run('STATE.surfLog[0]'), 'wave');
  const html = app.dom.byId('reg-drilldown-inner').innerHTML;
  const { tags, text } = assertOnlyAppMarkup(html, ['div', 'span', 'img', 'button', 'a', 'strong'], 'drill-down');
  assert.deepEqual(tags.filter(t => t.tag === 'img').map(t => t.attrs.src), ['https://h.example/a" onerror="window.__xss=3']);
  assert.ok(text.includes('Logged by <img src=x onerror="window.__xss=1">Bob'));
  assert.ok(text.includes('<svg onload=window.__xss=2>'));
  assert.ok(text.includes('<s>rising</s>') && text.includes('time to nearest: <b>2</b>h'));
});

test('regression drill-down does not throw on string-typed numbers', () => {
  const app = appWith([HOSTILE_COMMUNITY]);
  app.call('openRegressionDrilldown', app.run('STATE.surfLog[0]'), 'wave');
  const { text } = scanHtml(app.dom.byId('reg-drilldown-inner').innerHTML);
  assert.match(text, /Swell: —ft @ —s/);
});

test('a javascript: photo URL never reaches a src attribute in the drill-down', () => {
  const evil = Object.assign({}, DRILL, { photos: [{ url: 'javascript:window.__xss=4', path: '' }, 'data:text/html,<script>x</script>'] });
  const app = appWith([evil]);
  app.call('openRegressionDrilldown', app.run('STATE.surfLog[0]'), 'wave');
  const { tags } = scanHtml(app.dom.byId('reg-drilldown-inner').innerHTML);
  assert.deepEqual(tags.filter(t => t.tag === 'img'), []);
});

test('log form conditions readout escapes a stored/imported entry', () => {
  const app = appWith([]);
  app.call('renderConditionsDisplay', app.run(`(${JSON.stringify(HOSTILE_COMMUNITY.conditions)})`));
  const { text } = assertOnlyAppMarkup(app.dom.byId('sl-conditions-display').innerHTML, ['div', 'span'], 'conditions readout');
  assert.ok(text.includes('<b>note</b>') && text.includes('<s>rising</s>'));
});

test('match modal (kept for Tab 2 reuse) escapes condition values', () => {
  const app = appWith([HOSTILE_COMMUNITY]);
  app.call('openMatchModal', app.run('STATE.surfLog[0]'), '2026-10-01', 0);
  const { text } = assertOnlyAppMarkup(app.dom.byId('modal-conditions').innerHTML, ['span'], 'match modal');
  assert.ok(text.includes('<s>rising</s>'));
});

test('escHtml / safeUrl', () => {
  const app = loadApp();
  assert.equal(app.call('escHtml', `<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(app.call('escHtml', null), '');
  assert.equal(app.call('escHtml', 3.5), '3.5');
  assert.equal(app.call('safeUrl', 'https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg?alt=media&token=1'),
    'https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg?alt=media&amp;token=1');
  assert.equal(app.call('safeUrl', 'data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.example/x.jpg', '', null]) {
    assert.equal(app.call('safeUrl', bad), '', String(bad));
  }
});
