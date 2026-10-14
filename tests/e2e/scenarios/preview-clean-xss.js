// Default look, stored XSS (audit C27, the port of w3-xss-surflog.js): the surf log comes from Firestore, any crew
// member (any signed-in account, by firestore.rules) can write their own entries, and the new look shows other
// surfers' entries to everyone. Every place it does must show a hostile string as text, parsed by real Chromium:
//   • the Log tab's past sessions (previews/clean/log.js rowHTML): the crew member's name, the conditions, the
//     ratings, the thumbnail (only an http(s) photo, with its exact URL, quotes and all; a javascript: URL is
//     dropped) and the Edit/Delete data-id of your own session, which must round-trip a hostile id;
//   • Explore's and Methods' ten years (research/index.html, built from scripts/sound-check/page/decade.js) on the
//     seeded day, Mon 28 Sep 2026 (inside the pinned history): the day's sessions (who, when, ratings, notes, photos)
//     and the month's photo strip;
//   • My ratings › Details › a tap on a crew member's dot in "Each factor": that session's sub-page
//     (previews/clean/model.js shows the app's #reg-drilldown-inner in it).
// Each payload would set window.__xss if its markup went live (an <img src=x onerror> fires as soon as the bogus
// image 404s). One more payload sits in a timestamp: firestore.rules accept any string up to 40 characters, so a
// session "at 09:<u" must read as text too. Every surface is checked before the scenario fails, so one report lists
// them all. The unit test tests/unit/w3-escaping.test.js covers app.js's own HTML (the drill-down, the form's readout).
'use strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SAFE = 'https://firebasestorage.test/kai.jpg';
const QUOTE = 'https://firebasestorage.test/a" onerror="window.__xss=3';   // https, so allowed where it is escaped
const cond = (h, p, d, ws, wd, th, tr) => ({
  swell: { height: h, period: p, direction: d },
  wind: { speed: ws, direction: wd },
  tide: { height: th, rate: tr, stage: tr >= 0 ? 'rising' : 'falling', timeToNearest: 1.2 },
  source: 'openmeteo-archive'
});
// Thirteen ordinary sessions of the signed-in surfer (google-1): enough to train the models, so My ratings has
// its Details page and the crew's dots.
const OWN = [];
for (let i = 0; i < 13; i++) {
  const day = String(5 + i).padStart(2, '0');
  OWN.push({ id: 'own-' + i, userId: 'google-1', displayName: 'Test Surfer', timestamp: `2026-09-${day}T0${6 + (i % 3)}:30`, createdAt: `2026-09-${day}T09:00`,
    ratings: { size: 2 + (i * 7) % 8, windQuality: 3 + (i * 5) % 7, rideQuality: 2 + (i * 3) % 8 }, notes: 'Session ' + i, photos: [],
    conditions: cond(1 + (i * 37 % 30) / 10, 6 + (i * 5) % 7, 115 + (i * 13) % 50, 2 + (i * 7) % 15, (i * 47) % 360, -0.4 + (i * 0.3) % 3, -0.6 + (i * 0.17) % 1.2) });
}
const HOSTILE_COND = {
  swell: { height: 6, period: 14, direction: 140 },   // the biggest swell in the log: its dot stands alone
  wind: { speed: '<i>5</i>', direction: 200 },
  tide: { height: 1, rate: 0.5, stage: '<img src=x onerror="window.__xss=6">', timeToNearest: '<b>2</b>' },
  source: 'openmeteo-archive'
};
const NOTES_1 = '<img src=x onerror=__xss=2><script>window.__xss=7</script><svg onload="window.__xss=8"></svg><iframe src="javascript:parent.__xss=9"></iframe><u>under</u>';
const NOTES_2 = '"><img src=x onerror=__xss=12>';
// Bob, as the classic test had him; Kai, whose first name (all the pages show) is itself a payload, with a photo
// the pages may show and two they must not, and minutes that are markup.
const BOB = { id: 'c1', userId: 'crewB', displayName: '<img src=x onerror="window.__xss=1">Bob', timestamp: '2026-09-28T07:30', createdAt: '2026-09-28T09:00',
  ratings: { size: 9, windQuality: 7, rideQuality: 5 }, notes: NOTES_1,
  photos: [{ url: QUOTE, path: '' }, { url: 'javascript:window.__xss=4', path: '' }], conditions: HOSTILE_COND };
const KAI = { id: 'c2', userId: 'crewC', displayName: '<svg/onload=__xss=11>Kai', timestamp: '2026-09-28T09:<u', createdAt: '2026-09-28T10:00',
  ratings: { size: 5, windQuality: 6, rideQuality: 7 }, notes: NOTES_2,
  photos: [{ url: SAFE, path: '' }, 'javascript:window.__xss=13', 'data:text/html,<script>parent.__xss=14</script>'], conditions: cond(2.2, 9, 135, 6, 330, 1.5, 0.3) };
// One of the surfer's own, with a hostile id (it goes into data-id) and the same hostile fields.
const MINE = Object.assign({}, BOB, { id: 'x"><img src=x onerror=window.__xss=5>', userId: 'google-1', displayName: 'Test Surfer',
  timestamp: '2026-09-29T07:00', createdAt: '2026-09-29T09:00', conditions: Object.assign({}, HOSTILE_COND, { swell: { height: 3, period: 10, direction: 150 } }) });
const LOGS = [BOB, KAI, MINE].concat(OWN);

const BAD_TAGS = 'script, iframe, object, embed, frame, marquee, details, style, link, meta, base, form, input, textarea, video, audio, math, i, u, s';
// Elements a payload would have made: tags the surface never draws, svg it doesn't draw, any on* attribute (bar the
// app's own), img or a pointing anywhere but the one allowed photo URL, and javascript: anywhere.
function scan(o) {
  const out = [], html = (e) => e.outerHTML.slice(0, 140);
  const nodes = [...document.querySelectorAll(o.sel)].flatMap((r) => [r, ...r.querySelectorAll('*')]);
  if (!nodes.length) return ['nothing matches ' + o.sel];
  for (const e of nodes) {
    const tag = e.tagName.toLowerCase();
    if (e.matches(o.bad)) out.push('element ' + html(e));
    if (tag === 'svg' && !o.svgOk.some((c) => e.classList.contains(c))) out.push('svg ' + html(e));
    for (const a of e.attributes) {
      if (/^on/i.test(a.name) && !o.onOk.includes(tag + ' ' + a.name + '=' + a.value)) out.push('handler ' + a.name + '="' + a.value + '" on ' + html(e));
      if (/^\s*javascript:/i.test(a.value)) out.push('javascript: in ' + a.name + ' on ' + html(e));
    }
    if (tag === 'img' && !o.imgOk.includes(e.getAttribute('src'))) out.push('img src ' + JSON.stringify(e.getAttribute('src')));
    if (tag === 'a' && !o.hrefOk.includes(e.getAttribute('href'))) out.push('a href ' + JSON.stringify(e.getAttribute('href')));
  }
  return out;
}
const sp = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean stored XSS: hostile crew entries render as text on Log, Explore and Methods\' ten years, and My ratings\' session page',
  options: {
    viewport: { width: 390, height: 844 },
    timeoutMs: 150000,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' },
    firebase: { mode: 'google', logs: LOGS }   // signed in as google-1 ("Test Surfer")
  },
  async run({ page, ctx, assert, log }) {
    const problems = [];
    const check = (ok, msg) => { if (!ok) problems.push(msg); };
    // Real photos load (a broken thumbnail is taken off the page, which would hide what was drawn)
    await ctx.route(/firebasestorage\.test/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    // __xss in every frame on the page (the site, the Forecast map, Explore's two frames, Methods)
    const xssAnywhere = async () => {
      const hit = [];
      for (const f of page.frames()) {
        const v = await f.evaluate(() => window.__xss).catch(() => undefined);
        if (v !== undefined) hit.push(f.url() + ' → ' + v);
      }
      return hit;
    };

    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean look' });
    await ctx.waitForLoad();
    await ctx.waitFor((n) => window._fbUserId === 'google-1' && STATE.surfLog.length === n && STATE._lastFitAt, { arg: LOGS.length, label: 'signed in, the crew\'s log loaded' });

    // ── Log: past sessions ──
    await page.locator('#cl-app .cl-tabs .cl-tab[data-tab="log"]').click();
    await ctx.waitFor((n) => document.querySelectorAll('#cl-view-log .cl-l-list .cl-l-ss').length === n, { arg: LOGS.length, label: 'every session listed' });
    await page.waitForTimeout(1500);   // time for an injected <img src=x> to 404 and fire
    const L = await ctx.state(() => {
      const rows = [...document.querySelectorAll('#cl-view-log .cl-l-list .cl-l-ss')].map((r) => ({
        crew: r.classList.contains('cl-l-crew'),
        head: r.querySelector('.cl-l-sd').textContent,
        img: (r.querySelector('.cl-l-tn img') || { getAttribute: () => null }).getAttribute('src'),
        ids: [...r.querySelectorAll('[data-act="edit"], [data-act="delete"]')].map((b) => b.getAttribute('data-id'))
      }));
      return { rows, xss: window.__xss };
    });
    log('log rows', JSON.stringify(L.rows.filter((r) => r.crew || r.img)));
    const bob = L.rows.find((r) => r.crew && /^Mon 28 Sep/.test(r.head));
    const kai = L.rows.find((r) => r.crew && r.head !== (bob && bob.head));
    const mine = L.rows.find((r) => r.ids.includes(MINE.id));
    assert.ok(bob && kai && mine, 'Bob\'s, Kai\'s and the surfer\'s hostile sessions are listed');
    check(L.xss === undefined, `Log: window.__xss = ${L.xss}`);
    check(bob.head === 'Mon 28 Sep · <img', `Log: Bob's row reads ${JSON.stringify(bob.head)}, not his first name as text`);
    check(kai.head === '— · <svg/onload=__xss=11>Kai', `Log: Kai's row reads ${JSON.stringify(kai.head)}`);
    check(bob.img === QUOTE && mine.img === QUOTE, `Log: thumbnails ${JSON.stringify([bob.img, mine.img])}, not the exact https URL (quotes kept as text)`);
    check(kai.img === SAFE, `Log: Kai's thumbnail ${JSON.stringify(kai.img)}`);
    check(JSON.stringify(mine.ids) === JSON.stringify([MINE.id, MINE.id]), `Log: Edit/Delete data-id ${JSON.stringify(mine.ids)} doesn't round-trip the stored id`);
    check(L.rows.filter((r) => !r.crew).length === 14 && L.rows.filter((r) => r.crew).every((r) => !r.ids.length), 'Log: Edit/Delete only on the surfer\'s own 14 sessions');
    const logScan = await ctx.state(scan, { sel: '#cl-view-log .cl-l-list', bad: BAD_TAGS + ', b', svgOk: ['cl-ic'], onOk: [], imgOk: [QUOTE, SAFE], hrefOk: [] });
    logScan.forEach((p) => problems.push('Log: ' + p));
    await ctx.state(() => document.querySelector('#cl-view-log .cl-l-past').scrollIntoView({ block: 'start' }));
    await ctx.screenshot('log-hostile');

    // ── The ten years: the day's sessions and the month's photos ──
    // What decade.js should draw for the 28th: names (first word), times and notes as text, Kai's one https photo.
    const WANT_DAY = [
      'Logged by <img at 7:30 am: rated 7.0/10 (size 9, wind 7, ride 5)', NOTES_1,
      'Logged by <svg/onload=__xss=11>Kai at 9:<u am: rated 6.0/10 (size 5, wind 6, ride 7)', NOTES_2
    ];
    const tenYears = (fr, where) => fr.evaluate(() => {
      const day = document.getElementById('decDay'), m = document.getElementById('decMonth');
      const c28 = [...m.querySelectorAll('.dec-d')].find((x) => (x.getAttribute('aria-label') || '').startsWith('September 28:'));
      return {
        xss: window.__xss,
        month: (m.querySelector('.dec-mh h3') || {}).textContent || null,
        cell: c28 ? c28.className : null,
        sessions: day.querySelectorAll('.dec-log').length,
        day: day.innerText,
        strip: [...m.querySelectorAll('.dec-ph .dec-ph-a')].map((a) => ({ href: a.getAttribute('href'), src: a.querySelector('img').getAttribute('src'), title: a.getAttribute('title') }))
      };
    }).then(async (r) => {
        r.scan = await fr.evaluate(scan, { sel: '#decDay, #decMonth .dec-ph', bad: BAD_TAGS, svgOk: ['warr', 'dec-cam'], onOk: [], imgOk: [SAFE], hrefOk: [SAFE] });
        log(where, JSON.stringify(Object.assign({}, r, { day: sp(r.day).slice(-420) })));
        check(r.xss === undefined, `${where}: window.__xss = ${r.xss}`);
        check(r.month === 'September 2026' && /\bph\b/.test(r.cell || ''), `${where}: September 2026 with a camera on the 28th (${r.month}, ${r.cell})`);
        check(r.sessions === 2, `${where}: ${r.sessions} sessions on the 28th, not 2`);
        for (const w of WANT_DAY) check(sp(r.day).includes(sp(w)), `${where}: the day doesn't read ${JSON.stringify(w)} as text`);
        check(JSON.stringify(r.strip) === JSON.stringify([{ href: SAFE, src: SAFE, title: '2026-09-28, <svg/onload=__xss=11>Kai: ' + NOTES_2 }]),
          `${where}: the month's photos ${JSON.stringify(r.strip)}: only Kai's https photo, its title as text`);
        r.scan.forEach((p) => problems.push(where + ': ' + p));
        return r;
      });

    // Explore, opened on the 28th as Methods' "open this day on the map" does
    await ctx.state(() => CLEAN.emit('x-open-map', { date: '2026-09-28' }));
    await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const w = f && f.contentWindow; const r = w && w.document.getElementById('explorerFrame'); const c = r && r.contentWindow && r.contentWindow.CHOC;
      return !!(c && c.trip && c.trip.state.phase === 'past' && c.D[c.st.idx] && c.D[c.st.idx].iso === '2026-09-28'); }, { timeout: 45000, label: 'Explore on 28 Sep' });
    const explore = () => page.frames().find((f) => /research\/index\.html\?view=map/.test(f.url()));
    await explore().evaluate(() => CHOC.logLoaded);
    await explore().waitForFunction(() => document.querySelectorAll('#decDay .dec-log').length >= 2, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await tenYears(explore(), 'Explore');
    await explore().evaluate(() => document.querySelector('#decDay .dec-log').scrollIntoView({ block: 'start' }));
    await ctx.screenshot('explore-hostile-day');

    // Methods: its ten years on September 2026, then the 28th
    await ctx.state(() => CLEAN.show('methods'));
    await ctx.waitFor(() => { const f = document.querySelector('#cl-view-methods iframe'); const c = f && f.contentWindow && f.contentWindow.CHOC; return !!(c && c.logLoaded && f.contentDocument.querySelector('#decHeat svg')); }, { timeout: 45000, label: 'Methods up' });
    const methods = () => page.frames().find((f) => /research\/index\.html\?view=methods/.test(f.url()));
    await methods().evaluate(async () => {
      await CHOC.logLoaded;
      document.querySelector('#decHeat g.dec-cell[aria-label^="September 2026"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      [...document.querySelectorAll('#decMonth .dec-d[data-i]')].find((x) => /^September 28:/.test(x.getAttribute('aria-label'))).click();
    });
    await methods().waitForFunction(() => document.querySelectorAll('#decDay .dec-log').length >= 2, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await tenYears(methods(), 'Methods');

    // ── My ratings › Details › Bob's dot in the first "Each factor" chart ──
    await page.locator('#cl-app .cl-tabs .cl-tab[data-tab="model"]').click();
    await ctx.waitFor(() => document.querySelector('#cl-view-model [data-act="detail"]'), { label: 'My ratings trained (Details row)' });
    await page.locator('#cl-view-model [data-act="detail"]').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-model-detail .reg-feature-mini-canvas'), { label: 'Details: Each factor' });
    await ctx.state(() => document.querySelector('#cl-sub-model-detail .reg-feature-mini-canvas').scrollIntoView({ block: 'center' }));
    // where app.js _regBuildFeatureMini draws Bob's dot (feature 0, the wave model)
    const dot = await ctx.state((id) => {
      const cfg = REG_SUBMODELS[_regActiveSubmodel], fi = 0;
      const mr = _modelRows(STATE.surfLog.filter((e) => e.conditions && e.conditions.swell), cfg.extractor, cfg.targetFn);
      const k = mr.kept.findIndex((e) => e.id === id), xs = mr.X.map((r) => r[fi]);
      let lo = Math.min(...xs), hi = Math.max(...xs);
      if (lo === hi) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
      const P = REG_FG_PAD, W = REG_FG_W - P.left - P.right, H = REG_FG_H - P.top - P.bottom;
      const r = document.querySelector('#cl-sub-model-detail .reg-feature-mini-canvas').getBoundingClientRect();
      return { k, x: r.left + P.left + W * ((mr.X[k][fi] - lo) / (hi - lo)), y: r.top + P.top + H * (1 - mr.y[k] / 10) };
    }, BOB.id);
    assert.ok(dot.k >= 0, 'Bob\'s session is a dot in the chart');
    await page.touchscreen.tap(dot.x, dot.y);
    await ctx.waitFor(() => { const s = document.querySelector('#cl-sub-model-session'); return s && /from community log/.test(s.textContent); }, { label: 'Bob\'s session page', timeout: 5000 });
    await page.waitForTimeout(1500);
    const S = await ctx.state(() => {
      const inner = document.querySelector('#cl-sub-model-session #reg-drilldown-inner');
      return { xss: window.__xss, text: inner.innerText, imgs: [...inner.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), onerror: i.getAttribute('onerror') })) };
    });
    log('session', JSON.stringify(S.imgs), sp(S.text).slice(0, 300));
    check(S.xss === undefined, `My ratings: window.__xss = ${S.xss}`);
    for (const w of ['Logged by <img src=x onerror="window.__xss=1">Bob', NOTES_1, 'Tide: +1.0ft · <img src=x onerror="window.__xss=6">', 'time to nearest: <b>2</b>h']) {
      check(sp(S.text).includes(sp(w)), `My ratings: the session page doesn't read ${JSON.stringify(w)} as text`);
    }
    check(JSON.stringify(S.imgs) === JSON.stringify([{ src: QUOTE, onerror: 'this.style.display=\'none\'' }]),
      `My ratings: photos ${JSON.stringify(S.imgs)}: only the https one, exact URL, the app's own onerror`);
    const sessScan = await ctx.state(scan, { sel: '#cl-sub-model-session #reg-drilldown-inner', bad: BAD_TAGS + ', b', svgOk: [], onOk: ['img onerror=this.style.display=\'none\''], imgOk: [QUOTE], hrefOk: ['#'] });
    sessScan.forEach((p) => problems.push('My ratings: ' + p));
    await ctx.screenshot('ratings-hostile-session');

    // ── After all of it: nothing ran anywhere ──
    const hits = await xssAnywhere();
    hits.forEach((h) => problems.push('window.__xss set in ' + h));
    ctx.metric('xssSurfacesChecked', { log: L.rows.length, explore: 1, methods: 1, ratingsSession: 1, frames: page.frames().length });
    log(problems.length ? 'PROBLEMS:\n      ' + problems.join('\n      ') : 'every surface shows the hostile strings as text');
    assert.deepEqual(problems, [], `${problems.length} place(s) where a crew member's stored text became markup`);
    assert.deepEqual(await ctx.state(() => CLEAN.errors.map((e) => e.where + ': ' + e.message)), [], 'CLEAN.errors');
  }
};
