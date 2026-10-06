// The approved "A refined" look (previews/clean/) is the site's default: the
// plain address and Choc TV's ?kiosk=1 open it with no parameter, so the crew
// never needs a special link. The old look stays one tap away at ?classic=1
// (Settings links to it), with its boat question, and loads no look files.
'use strict';

const PHONE = { width: 390, height: 844 };

module.exports = {
  name: 'default look: the plain address and Choc TV open the new look; ?classic=1 opens the old one',
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

    // ── Phone, plain address, exactly as a visitor types it ──
    const r0 = ctx.requests.length;
    ctx.t0 = Date.now();
    await page.goto(ctx.url('/'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'new look up on the plain address' });
    await ctx.waitForChart();
    const plain = await look();
    log('plain', JSON.stringify(plain));
    assert.equal(plain.preview, 'clean');
    assert.ok(plain.on, 'the new look mounted');
    assert.equal(plain.gateShown, false, 'no boat question in the new look');
    const got = ctx.requests.slice(r0).map(r => r.url);
    assert.ok(got.some(u => u.includes('/previews/clean/theme.css')) && got.some(u => u.includes('/previews/clean/core.js')), 'its files load');

    // Settings links to the old look.
    const classicHref = await ctx.state(() => {
      CLEAN.openSettings();
      const a = [...document.querySelectorAll('a')].find(x => /classic view/i.test(x.textContent));
      return a && a.getAttribute('href');
    });
    assert.ok(classicHref && /[?&]classic=1\b/.test(classicHref), 'Settings › "Open the classic view" goes to ?classic=1, got ' + classicHref);

    // ── ?classic=1: the old look, boat question first, no look files ──
    const r1 = ctx.requests.length;
    ctx.t0 = Date.now();
    await page.goto(ctx.url(classicHref), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => { const g = document.getElementById('gate-overlay'); return g && getComputedStyle(g).display !== 'none'; }, { label: 'classic boat question' });
    const classic = await look();
    log('classic', JSON.stringify(classic));
    assert.equal(classic.preview, null);
    assert.equal(classic.on, false);
    assert.equal(ctx.requests.slice(r1).filter(r => r.url.includes('/previews/')).length, 0, '?classic=1 loads no look files');

    // ── Choc TV: ?kiosk=1 with nothing else opens the new TV ──
    await page.setViewportSize({ width: 1180, height: 820 });
    ctx.t0 = Date.now();
    await page.goto(ctx.url('/?kiosk=1'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && document.getElementById('cl-tv'), { label: 'new Choc TV up' });
    await ctx.waitFor(() => document.querySelectorAll('#cl-tv .cl-tv-card, #cl-days1 [class*="card"]').length >= 3, { label: 'TV day cards', timeout: 15000 });
    const tv = await look();
    log('tv', JSON.stringify(tv));
    assert.equal(tv.preview, 'clean');
    ctx.t0 = Date.now();
    await page.goto(ctx.url('/?kiosk=1&classic=1'), { waitUntil: 'domcontentloaded' });
    await ctx.waitFor(() => /LOW|low/.test((document.getElementById('kiosk-days-1') || {}).innerText || ''), { label: 'classic Choc TV day cards' });
    assert.equal((await look()).preview, null, '?kiosk=1&classic=1 is the old Choc TV');
    await page.setViewportSize(PHONE);
  }
};
