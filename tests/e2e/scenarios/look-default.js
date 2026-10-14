// The approved "A refined" look (previews/clean/) is the site: the plain
// address and Choc TV's ?kiosk=1 open it with no parameter, so the crew
// never needs a special link. The old look is retired: Settings no longer
// offers it, and the page no longer downloads its Win95 styles, fonts and
// Leaflet maps (only ?classic=1 does: the old look stays reachable there as
// an emergency fallback, with its boat question and no look files, and the
// older scenarios test the app underneath through it). Choc TV still loads
// the classic TV's styles, its own fallback. The retired candidate looks'
// names, or any unknown one, open the new look and fetch nothing else.
'use strict';

const PHONE = { width: 390, height: 844 };
// the old look's own files (its Google Fonts by family: the Forecast map's frame loads its own). Its Win95 font
// isn't here: the old chart, still drawn out of sight under the new look, paints its labels in it.
const OLD = ['styles-web1.css', 'styles-web1-extensions.css', 'styles-retro.css', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js', 'family=Libre+Baskerville'];

module.exports = {
  name: 'default look: the plain address and Choc TV open the new look without the old look\'s files; ?classic=1 opens the old one',
  options: {
    gate: null,                                   // nothing seeded: the visitor's first load
    viewport: PHONE,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
  },
  async run({ page, ctx, assert, log }) {
    const look = () => ctx.state(() => ({
      preview: typeof LCC_PREVIEW === 'undefined' ? 'n/a' : LCC_PREVIEW,
      on: document.documentElement.classList.contains('cl-on'),
      gateShown: (() => { const g = document.getElementById('gate-overlay'); return !!g && getComputedStyle(g).display !== 'none'; })()
    }));
    const since = r0 => ctx.requests.slice(r0).map(r => r.url);
    const old = urls => OLD.filter(f => urls.some(u => u.includes(f)));

    // ── Phone, plain address, exactly as a visitor types it ──
    const r0 = ctx.requests.length;
    ctx.t0 = Date.now();
    await page.goto(ctx.url('/'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'new look up on the plain address' });
    await ctx.waitForChart();
    await page.waitForTimeout(500);
    const plain = await look();
    log('plain', JSON.stringify(plain));
    assert.equal(plain.preview, 'clean');
    assert.ok(plain.on, 'the new look mounted');
    assert.equal(plain.gateShown, false, 'no boat question in the new look');
    let got = since(r0);
    assert.ok(got.some(u => u.includes('/previews/clean/theme.css')) && got.some(u => u.includes('/previews/clean/core.js')), 'its files load');
    assert.deepEqual(old(got), [], 'none of the old look’s styles, fonts or maps');
    assert.ok(!got.some(u => u.includes('styles-kiosk.css')), 'nor Choc TV’s classic styles on the phone');
    assert.ok(got.some(u => /\/style\.css$/.test(u)), 'style.css still loads (toasts, the borrowed rating charts)');

    // Settings no longer offers the old look.
    const classicLinks = await ctx.state(() => {
      CLEAN.openSettings();
      return [...document.querySelectorAll('a')].filter(x => /classic/i.test(x.textContent) || /classic=1/.test(x.getAttribute('href') || '')).map(a => a.textContent);
    });
    assert.deepEqual(classicLinks, [], 'no "Open the classic view" in Settings');

    // ── ?classic=1: the old look, boat question first, with its own files and no look files ──
    const r1 = ctx.requests.length;
    ctx.t0 = Date.now();
    await page.goto(ctx.url('/?classic=1'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => { const g = document.getElementById('gate-overlay'); return g && getComputedStyle(g).display !== 'none'; }, { label: 'classic boat question' });
    await page.waitForTimeout(300);
    const classic = await look();
    log('classic', JSON.stringify(classic));
    assert.equal(classic.preview, null);
    assert.equal(classic.on, false);
    got = since(r1);
    assert.equal(got.filter(u => u.includes('/previews/')).length, 0, '?classic=1 loads no look files');
    assert.deepEqual(old(got), OLD, 'the old look brings its styles, fonts and maps');
    assert.ok(got.some(u => u.includes('fonts/ms_sans_serif')), 'and its Win95 font, preloaded');
    assert.equal(await ctx.state(() => getComputedStyle(document.body).fontFamily.includes('MS Sans Serif')), true, 'in its Win95 type');

    // ── The retired candidate looks' names, or any other, open the new look ──
    for (const q of ['draft-paper', 'chart-room', '../../secrets']) {
      const r2 = ctx.requests.length;
      await page.goto(ctx.url('/?preview=' + q), { waitUntil: 'domcontentloaded' });
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: q + ': the new look' });
      assert.equal((await look()).preview, 'clean', q);
      assert.deepEqual(since(r2).filter(u => u.includes('/previews/') && !u.includes('/previews/clean/')), [], q + ': nothing else fetched');
    }

    // ── Choc TV: ?kiosk=1 with nothing else opens the new TV ──
    await page.setViewportSize({ width: 1180, height: 820 });
    const r3 = ctx.requests.length;
    ctx.t0 = Date.now();
    await page.goto(ctx.url('/?kiosk=1'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && document.getElementById('cl-tv'), { label: 'new Choc TV up' });
    await ctx.waitFor(() => document.querySelectorAll('#cl-tv .cl-tv-card').length >= 3, { label: 'TV day cards', timeout: 15000 });
    const tv = await look();
    log('tv', JSON.stringify(tv));
    assert.equal(tv.preview, 'clean');
    got = since(r3);
    assert.ok(got.some(u => u.includes('styles-kiosk.css')), 'the classic TV’s styles, for its fallback');
    assert.deepEqual(old(got), [], 'but not the old look’s');
    ctx.t0 = Date.now();
    await page.goto(ctx.url('/?kiosk=1&classic=1'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => /LOW|low/.test((document.getElementById('kiosk-days-1') || {}).innerText || ''), { label: 'classic Choc TV day cards' });
    assert.equal((await look()).preview, null, '?kiosk=1&classic=1 is the old Choc TV');

    // ── The new look gives the page back (here Choc TV's part never loads, so after 1.5 s the classic TV takes the
    //    screen): the old look's styles and fonts come back with it ──
    ctx.serve('/previews/clean/tv.js', { status: 200, headers: { 'content-type': 'text/javascript' }, body: '/* not this time */' });
    const r4 = ctx.requests.length;
    await page.goto(ctx.url('/?kiosk=1'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => !document.documentElement.classList.contains('cl-on') && /LOW|low/.test((document.getElementById('kiosk-days-1') || {}).innerText || ''), { label: 'the classic Choc TV took over', timeout: 20000 });
    await page.waitForTimeout(300);
    const back = old(since(r4));
    log('given back', JSON.stringify(back));
    assert.deepEqual(back, OLD.filter(f => !/leaflet/.test(f)), 'the old look’s styles and fonts (its maps stay off: the app started without them)');
    await page.setViewportSize(PHONE);
  }
};
