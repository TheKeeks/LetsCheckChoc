// Default look on a phone (390 px, and 375), in the day and the night theme, the port of w5-a11y-phone.js (audit
// C48): what the crew reads and taps on Forecast, Log (its form, "Other › Older" open too, and the past sessions),
// My ratings (trained, and a new surfer's "log 12 sessions" page) and Settings (with Forecast model and Spot and
// buoy):
//   • every bit of text in the look's muted, amber (stale data) or red (dead data) ink reaches WCAG AA 4.5:1
//     against what is really behind it (computed colours, composited up through the backgrounds and opacities it
//     sits on), placeholder text included. The fixture's 2 h 30 m old buoy reading is stale for real (amber on
//     Forecast and in Data sources); each stale cue and data-source value is also forced to stale and to dead by
//     class, so both colours are checked without waiting hours or breaking a fetch;
//   • every control is at least 24 × 24 px (WCAG 2.5.8; a link inside a sentence is exempt) and no two overlap.
//     CONTRACT.md promises 44 px touch targets: the ones short of 44 are listed in the log and the metrics, not
//     failed, because the design keeps some (the 0–10 rating cells are ~32 px wide);
//   • every control has an accessible name; the three rating rows are groups named Size, Wind quality and Ride
//     quality, and each cell says what it means ("Size 6 of 10, Chest high");
//   • the week scrubber (.cl-f-cx) is a slider that says its hour and height (aria-valuetext), in step with the
//     headline, as the arrow keys move it.
'use strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const cond = (h, p, d, ws, wd, th, tr) => ({
  swell: { height: h, period: p, direction: d },
  wind: { speed: ws, direction: wd },
  tide: { height: th, rate: tr, stage: tr >= 0 ? 'rising' : 'falling', timeToNearest: 1.2 },
  source: 'openmeteo-archive'
});
// Thirteen sessions of the signed-in surfer (google-1, so My ratings is trained), one with a photo, and Bob's.
const LOGS = [];
for (let i = 0; i < 13; i++) {
  const day = String(5 + i).padStart(2, '0');
  LOGS.push({ id: 'own-' + i, userId: 'google-1', displayName: 'Test Surfer', timestamp: `2026-09-${day}T0${6 + (i % 3)}:30`, createdAt: `2026-09-${day}T09:00`,
    ratings: { size: 2 + (i * 7) % 8, windQuality: 3 + (i * 5) % 7, rideQuality: 2 + (i * 3) % 8 }, notes: 'Session ' + i,
    photos: i === 12 ? [{ url: 'https://firebasestorage.test/own.jpg', path: '' }] : [],
    conditions: cond(1 + (i * 37 % 30) / 10, 6 + (i * 5) % 7, 115 + (i * 13) % 50, 2 + (i * 7) % 15, (i * 47) % 360, -0.4 + (i * 0.3) % 3, -0.6 + (i * 0.17) % 1.2) });
}
LOGS.push({ id: 'bob-1', userId: 'crewB', displayName: 'Bob Crew', timestamp: '2026-09-26T08:00', createdAt: '2026-09-26T08:00',
  ratings: { size: 4, windQuality: 6, rideQuality: 6 }, notes: 'Fun lefts on the push', photos: [], conditions: cond(1.8, 8, 130, 6, 330, 0.8, -0.4) });

// ── The audit, run in the page on one screen (a CSS selector for its root) ──
function audit(o) {
  const scope = document.querySelector(o.scope);
  if (!scope) return { error: 'no ' + o.scope };
  const probe = document.createElement('span');
  scope.appendChild(probe);
  const tok = {};
  for (const t of ['muted', 'amber', 'red']) { probe.style.color = 'var(--' + t + ')'; tok[t] = getComputedStyle(probe).color; }
  probe.remove();
  const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => [c.r, c.g, c.b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // The text's pixel and the pixel beside it: the colour composited over every background and through every
  // opacity up to the page (premultiplied alpha), then over the white canvas. A background image can't be judged.
  const pm = (c) => ({ r: c.r * c.a, g: c.g * c.a, b: c.b * c.a, a: c.a });
  const over = (t, b) => ({ r: t.r + b.r * (1 - t.a), g: t.g + b.g * (1 - t.a), b: t.b + b.b * (1 - t.a), a: t.a + b.a * (1 - t.a) });
  const scale = (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k, a: c.a * k });
  const flat = (c) => (c.a ? { r: c.r / c.a, g: c.g / c.a, b: c.b / c.a, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
  function pixels(e, fg) {
    let t = pm(fg), b = { r: 0, g: 0, b: 0, a: 0 }, img = null;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') img = img || cs.backgroundImage.slice(0, 50);
      const bg = pm(parse(cs.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 });
      t = over(t, bg); b = over(b, bg);
      const op = Number(cs.opacity);
      if (op < 1) { t = scale(t, op); b = scale(b, op); }
    }
    const W = { r: 255, g: 255, b: 255, a: 1 };
    return { t: flat(over(t, W)), b: flat(over(b, W)), img };
  }
  const rgb = (c) => 'rgb(' + [c.r, c.g, c.b].map(Math.round).join(', ') + ')';
  const vis = (e) => e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) && e.getClientRects().length > 0;
  const where = (e) => { const out = []; for (let n = e; n && n !== scope && out.length < 3; n = n.parentElement) out.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : n.getAttribute('class') ? '.' + n.getAttribute('class').trim().split(/\s+/).join('.') : '')); return out.join(' > '); };
  const kind = (c) => Object.keys(tok).find((k) => tok[k] === c) || null;
  const measure = (e, color, label) => {
    const fg = parse(color);
    const px = pixels(e, fg);
    return { at: where(e), text: label, ink: kind(color), fg: rgb(px.t), bg: rgb(px.b), ratio: Math.round(ratio(px.t, px.b) * 100) / 100, img: px.img };
  };
  // text in the tokens' ink (SVG text by its fill)
  const texts = [];
  for (const e of scope.querySelectorAll('*')) {
    if (!vis(e)) continue;
    const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height < 4) continue;   // visually hidden (.cl-sr-only)
    const cs = getComputedStyle(e), color = e instanceof SVGElement ? cs.fill : cs.color;
    if (kind(color)) texts.push(measure(e, color, own.slice(0, 50)));
  }
  // placeholders of the empty fields on screen
  for (const e of scope.querySelectorAll('input, textarea')) {
    if (!vis(e) || e.value || !e.placeholder) continue;
    const ps = getComputedStyle(e, '::placeholder'), c = parse(ps.color);
    if (!c || !kind(ps.color)) continue;
    c.a *= Number(ps.opacity);
    const m = measure(e, ps.color, 'placeholder "' + e.placeholder + '"' + (Number(ps.opacity) < 1 ? ' at opacity ' + ps.opacity : ''));
    const px = pixels(e, c);
    Object.assign(m, { fg: rgb(px.t), bg: rgb(px.b), ratio: Math.round(ratio(px.t, px.b) * 100) / 100 });
    texts.push(m);
  }
  // data-age cues forced to stale and to dead (then put back)
  const cues = [];
  for (const e of scope.querySelectorAll(o.cues)) {
    if (!vis(e) || !e.textContent.trim()) continue;
    const was = e.getAttribute('class');
    for (const st of ['stale', 'dead']) {
      e.classList.remove('cl-stale', 'cl-dead');
      e.classList.add('cl-' + st);
      const color = getComputedStyle(e).color, m = measure(e, color, st + ' cue "' + e.textContent.trim().slice(0, 40) + '"');
      m.want = st === 'stale' ? 'amber' : 'red';
      cues.push(m);
    }
    if (was == null) e.removeAttribute('class'); else e.setAttribute('class', was);
  }
  // controls: size, overlap, name
  const CTL = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="slider"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const name = (e) => {
    const lb = e.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent.trim()).join(' ').trim(); if (t) return t; }
    const al = (e.getAttribute('aria-label') || '').trim(); if (al) return al;
    if (e.labels && e.labels.length) { const t = [...e.labels].map((l) => l.textContent.trim()).join(' ').trim(); if (t) return t; }
    if (!/^(input|textarea|select)$/i.test(e.tagName)) { const t = (e.innerText || '').trim(); if (t) return t; }
    return (e.getAttribute('title') || e.getAttribute('placeholder') || '').trim();
  };
  const ctls = [...scope.querySelectorAll(CTL)].filter(vis).map((e) => {
    const r = e.getBoundingClientRect();
    let fixed = false;
    for (let n = e; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') { fixed = true; break; }
    // a link inside a sentence (WCAG 2.5.8's inline exception): an inline <a> in a block that has other text
    const inline = e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.parentElement.textContent.trim() !== e.textContent.trim();
    return { e, at: where(e), name: name(e).replace(/\s+/g, ' ').slice(0, 60), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: r.left + scrollX, y: r.top + scrollY, fixed, inline };
  });
  const overlaps = [];
  for (let i = 0; i < ctls.length; i++) {
    for (let j = i + 1; j < ctls.length; j++) {
      const a = ctls[i], b = ctls[j];
      if (a.e.contains(b.e) || b.e.contains(a.e) || a.fixed !== b.fixed) continue;   // the fixed tab bar scrolls over content
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) overlaps.push(`"${a.name}" (${a.at}) and "${b.name}" (${b.at}) overlap ${ox.toFixed(1)} × ${oy.toFixed(1)} px`);
    }
  }
  return { tok, texts, cues, overlaps, ctls: ctls.map((c) => ({ at: c.at, name: c.name, w: c.w, h: c.h, inline: c.inline })) };
}

module.exports = {
  name: 'clean phone a11y: muted/amber/red text 4.5:1 day and night, 24 px targets apart, named controls, scrubber value',
  options: {
    viewport: { width: 390, height: 844 },
    timeoutMs: 150000,
    // reduced motion: the 400 ms day/night fade and the 120 ms tab fade are off, so colours are final when measured
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' },
    firebase: { mode: 'google', logs: LOGS }
  },
  async run({ page, ctx, assert, log }) {
    await ctx.route(/firebasestorage\.test/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    // The Sound Check model run moved to the fixture day (tests/fixtures/README.md)
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    const problems = [], short = new Map(), counts = {};
    let screens = 0, controls = 0;
    const sp = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

    const record = (r, label) => {
      assert.ok(!r.error, label + ': ' + r.error);
      screens++;
      controls += r.ctls.length;
      for (const t of r.texts) {
        counts[t.ink] = (counts[t.ink] || 0) + 1;
        if (t.img) log(label, 'not judged (background image):', t.at, t.img);
        else if (t.ratio < 4.5) problems.push(`${label}: ${t.ink} ${t.text} at ${t.at}: ${t.fg} on ${t.bg} = ${t.ratio}:1, under 4.5:1`);
      }
      for (const c of r.cues) {
        counts['forced ' + c.want] = (counts['forced ' + c.want] || 0) + 1;
        if (c.ink !== c.want) problems.push(`${label}: ${c.text} at ${c.at} is ${c.fg}, not the ${c.want} token`);
        else if (c.ratio < 4.5) problems.push(`${label}: ${c.text} at ${c.at}: ${c.fg} on ${c.bg} = ${c.ratio}:1, under 4.5:1`);
      }
      for (const c of r.ctls) {
        if (!c.name) problems.push(`${label}: control at ${c.at} has no accessible name`);
        if ((c.w < 24 || c.h < 24) && !c.inline) problems.push(`${label}: "${c.name}" at ${c.at} is ${c.w} × ${c.h} px, under 24 × 24`);
        if (c.w < 44 || c.h < 44) {
          const k = c.at.replace(/\[.*?\]/g, '') + ' ' + c.w + '×' + c.h + (c.inline ? ' (inline link)' : '');
          short.set(k, (short.get(k) || []).concat(c.name).slice(0, 3));
        }
      }
      r.overlaps.forEach((o) => problems.push(label + ': ' + o));
      log(label, `${r.texts.length} token-ink texts, ${r.cues.length / 2} cues forced, ${r.ctls.length} controls`,
        r.texts.concat(r.cues).filter((t) => t.ratio < 4.5).length ? 'UNDER 4.5:1 FOUND' : 'all ≥ 4.5:1');
    };
    const run = (scope, cues) => page.evaluate(audit, { scope, cues: cues || '.cl-stale' });

    const boot = async () => {
      await ctx.open('/?preview=clean');
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean look' });
      await ctx.waitForLoad();
      await ctx.waitFor(() => window._fbUserId === 'google-1' && STATE._lastFitAt && STATE.surfLog.length === 14, { label: 'signed in, log loaded, model trained' });
      await ctx.waitFor(() => CLEAN.forecastInfo().fc === 'ok' && CLEAN.forecastInfo().step >= 0 && CLEAN.forecastInfo().prev !== 'loading', { label: 'the model forecast for now' });
    };
    const setTheme = async (mode) => {
      await ctx.state((m) => CLEAN.setThemeMode(m), mode);
      await ctx.waitFor((t) => document.documentElement.getAttribute('data-clean-theme') === t, { arg: mode === 'dark' ? 'night' : 'day', label: 'theme ' + mode });
      await page.waitForTimeout(150);
    };
    // Sub-pages close through history.back(), one popstate each: close them one at a time.
    const closeSubs = async () => {
      for (let d = await ctx.state(() => CLEAN.sub.depth()); d > 0; d--) {
        await ctx.state(() => CLEAN.sub.close());
        await ctx.waitFor((n) => CLEAN.sub.depth() < n, { arg: d, label: 'sub-page closed' });
      }
    };
    const tab = async (t) => {
      await closeSubs();
      await page.locator(`#cl-app .cl-tabs .cl-tab[data-tab="${t}"]`).click();
      await ctx.waitFor((id) => CLEAN.tab() === id && !document.getElementById('cl-view-' + id).hidden, { arg: t, label: 'tab ' + t });
      await page.waitForTimeout(250);
    };
    const settings = async (label) => {
      await page.locator('#cl-settings-btn').click();
      await ctx.waitFor(() => document.querySelector('#cl-sub-settings [data-src]'), { label: 'Settings' });
      record(await run('#cl-sub-settings', '.cl-stale, #cl-sub-settings [data-src] .cl-v'), label + ' Settings');
      for (const [act, id] of [['model', 'model-picker'], ['spot', 'spot']]) {
        await page.locator(`#cl-sub-settings [data-act="${act}"]`).click();
        await ctx.waitFor((i) => document.querySelector('#cl-sub-' + i + ' .cl-sr'), { arg: id, label: 'Settings › ' + id });
        record(await run('#cl-sub-' + id), label + ' Settings › ' + id);
        await ctx.state(() => CLEAN.sub.close());
        await ctx.waitFor(() => CLEAN.sub.depth() === 1 && !document.querySelector('#cl-sub-settings').hidden, { label: 'back to Settings' });
      }
      await closeSubs();
    };

    for (const w of [390, 375]) {
      await page.setViewportSize({ width: w, height: 844 });
      await boot();
      assert.equal(await ctx.state(() => document.documentElement.clientWidth), w, 'layout width');
      await ctx.waitFor(() => document.querySelector('#cl-view-forecast .cl-f-bc .cl-stale') && document.querySelector('#cl-view-forecast .cl-f-src > span'),
        { timeout: 10000, label: 'the fixture\'s 2 h 30 m old buoy reading shows as stale on Forecast, and the run\'s age' });
      for (const mode of ['light', 'dark']) {
        await setTheme(mode);
        const L = `${w} px ${mode === 'light' ? 'day' : 'night'}:`;
        await tab('forecast');
        record(await run('#cl-app', '.cl-stale, #cl-view-forecast .cl-f-src > span'), L + ' Forecast');
        await tab('log');
        record(await run('#cl-app'), L + ' Log');
        await page.locator('#cl-view-log [data-act="other"]').click();
        await page.locator('#cl-view-log [data-act="day"][data-k="older"]').click();
        await ctx.waitFor(() => !document.querySelector('#cl-view-log .cl-l-df').hidden, { label: 'Log: Other › Older' });
        record(await run('#cl-app'), L + ' Log › Other › Older');
        await page.locator('#cl-view-log [data-act="now"]').click();
        await tab('model');
        assert.ok(await ctx.state(() => !!document.querySelector('#cl-view-model [data-act="detail"]')), 'My ratings is trained');
        record(await run('#cl-app'), L + ' My ratings');
        await settings(L);
      }

      // ── A new surfer: My ratings before training, the Log with only the crew's sessions ──
      await setTheme('light');
      await ctx.state(() => CLEAN.signOut());
      await ctx.waitFor(() => window._fbUserId === 'anon-1', { label: 'signed out', timeout: 10000 });
      await ctx.state(() => { window.__FB_LINK_ERROR = 'auth/credential-already-in-use'; window.__FB_POPUP_USER = { uid: 'google-2', displayName: 'Kai Two' }; CLEAN.signIn(); });
      await ctx.waitFor(() => window._fbUserId === 'google-2' && CLEAN.auth().signedIn && STATE._lastFitAt && !STATE.surfLogWaveWeights, { label: 'signed in as google-2', timeout: 15000 });
      for (const mode of ['light', 'dark']) {
        await setTheme(mode);
        const L = `${w} px ${mode === 'light' ? 'day' : 'night'}, new surfer:`;
        await tab('model');
        await ctx.waitFor(() => document.querySelector('#cl-view-model .cl-m-dots'), { label: 'My ratings, untrained' });
        record(await run('#cl-app'), L + ' My ratings');
        await tab('log');
        await ctx.waitFor(() => document.querySelectorAll('#cl-view-log .cl-l-crew').length === 14, { label: 'Log: the crew\'s sessions' });
        record(await run('#cl-app'), L + ' Log');
      }
      await setTheme('light');
    }

    // ── The rating rows: named groups, each cell says what it means ──
    await page.setViewportSize({ width: 390, height: 844 });
    await boot();
    await tab('log');
    const names = {};
    for (const [label, word] of [['Size', 'Size'], ['Wind quality', 'Wind quality'], ['Ride quality', 'Ride quality']]) {
      const group = page.getByRole('group', { name: label, exact: true });
      names[label] = await group.count();
      if (names[label] !== 1) { problems.push(`Log: no rating group named "${label}" (${names[label]})`); continue; }
      for (let v = 0; v <= 10; v++) {
        const n = await group.getByRole('button', { name: new RegExp(`^${word} ${v} of 10(, .+)?$`) }).count();
        if (n !== 1) problems.push(`Log: no "${word} ${v} of 10" button in the ${label} group (${n})`);
      }
    }
    log('rating groups', JSON.stringify(names), await page.getByRole('button', { name: /^Size 6 of 10/ }).getAttribute('aria-label'));

    // ── The week scrubber says its value, and keeps saying it as it moves ──
    await tab('forecast');
    const cx = () => ctx.state(() => {
      const e = document.querySelector('#cl-view-forecast .cl-f-cx');
      const q = (s) => (document.querySelector('#cl-view-forecast ' + s) || {}).textContent || '';
      return { role: e.getAttribute('role'), label: e.getAttribute('aria-label'), now: e.getAttribute('aria-valuenow'), min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'),
        text: e.getAttribute('aria-valuetext'), when: q('.cl-f-when .cl-serif'), num: q('.cl-f-num'), step: CLEAN.forecastInfo().step };
    });
    const s0 = await cx();
    log('scrubber', JSON.stringify(s0));
    const steady = (s, where) => {
      if (s.role !== 'slider' || !s.label) problems.push(`${where}: .cl-f-cx is ${s.role} "${s.label}", not a named slider`);
      if (sp(s.text) !== sp(`${s.when}, ${s.num} ft at Choc`)) problems.push(`${where}: aria-valuetext "${s.text}" doesn't say what the headline shows ("${s.when}", ${s.num} ft at Choc)`);
      if (+s.now !== s.step || +s.now < +s.min || +s.now > +s.max) problems.push(`${where}: aria-valuenow ${s.now} (min ${s.min}, max ${s.max}) isn't the step on show (${s.step})`);
    };
    steady(s0, 'Forecast');
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await ctx.waitFor((n) => CLEAN.forecastInfo().step === n + 2, { arg: s0.step, label: 'two steps later', timeout: 3000 });
    const s1 = await cx();
    log('scrubber after →→', JSON.stringify(s1));
    steady(s1, 'Forecast after →→');
    if (s1.text === s0.text) problems.push('Forecast: aria-valuetext did not change when the hour moved');

    ctx.metric('a11yChecked', { screens, controls, texts: counts });
    ctx.metric('targetsUnder44', [...short.entries()].map(([k, v]) => k + ' ' + JSON.stringify(v)));
    log('controls under 44 px (CONTRACT.md\'s touch target):\n      ' + [...short.keys()].join('\n      '));
    log(problems.length ? 'PROBLEMS:\n      ' + problems.join('\n      ') : 'no problems');
    assert.ok(counts.muted > 50 && counts.amber > 0 && counts['forced red'] > 0, 'the audit found muted, amber and red text to check');
    assert.deepEqual(problems, [], `${problems.length} accessibility problem(s)`);
    assert.deepEqual(await ctx.state(() => CLEAN.errors.map((e) => e.where + ': ' + e.message)), [], 'CLEAN.errors');
  }
};
