// Audit C27 in a real browser: a crew member's (or a direct Firestore
// write's) notes, displayName, photo URL, entry id and condition strings
// must render as text for everyone who opens the surf log, the row detail
// and the Regression drill-down. Each payload would set window.__xss if its
// markup became live (several via <img src=x onerror>, which fires as soon
// as the bogus image 404s). The unit test (tests/unit/w3-escaping.test.js)
// checks the generated HTML; this checks Chromium's parse of it.
'use strict';

const HOSTILE_COND = {
  swell: { height: 3, period: 10, direction: 150 },
  wind: { speed: '<i>5</i>', direction: 200 },
  tide: { height: 1, rate: 0.5, stage: '<img src=x onerror="window.__xss=6">', timeToNearest: '<b>2</b>' },
  source: 'openmeteo-archive'
};
const COMMUNITY = {
  id: 'c1', userId: 'crewB', displayName: '<img src=x onerror="window.__xss=1">Bob',
  timestamp: '2026-09-14T07:30', ratings: { size: 6, windQuality: 7, rideQuality: 5 },
  notes: '<img src=x onerror=__xss=2>',   // 27 chars: survives the table's 30-char slice
  photos: [{ url: 'https://firebasestorage.test/a" onerror="window.__xss=3', path: '' }, { url: 'javascript:window.__xss=4', path: '' }],
  conditions: HOSTILE_COND
};
const OWN = Object.assign({}, COMMUNITY, {
  id: 'x"><img src=x onerror=window.__xss=5>', userId: 'google-1', displayName: 'Test Surfer'
});

module.exports = {
  name: 'surf log: hostile community entries render as text (no script runs)',
  options: { firebase: { mode: 'google', logs: [COMMUNITY, OWN] } },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/');
    await ctx.waitFor(() => STATE.surfLog.length === 2 && window._fbUserId === 'google-1', { label: 'community log loaded' });
    await ctx.state(() => switchTab('surflog'));
    await ctx.waitFor(() => document.querySelectorAll('#surflog-tbody tr').length === 2, { label: 'two rows rendered' });

    // Open the community row's detail (a row click, as a user would).
    await page.locator('#surflog-tbody tr', { hasText: 'community' }).first().click({ position: { x: 5, y: 5 } });
    await ctx.waitFor(() => document.querySelector('#surflog-tbody .sl-detail-row'), { label: 'detail row open' });
    // And the Regression drill-down for it (reached from the feature scatter).
    await ctx.state(() => openRegressionDrilldown(STATE.surfLog.find(e => e.userId === 'crewB'), 'wave'));

    // Give any injected <img src=x> time to 404 and fire onerror.
    await page.waitForTimeout(1500);

    const r = await ctx.state(() => {
      const scope = '#surflog-tbody, #reg-drilldown-inner';
      const imgs = [...document.querySelectorAll('#surflog-tbody img, #reg-drilldown-inner img')];
      return {
        xss: window.__xss,
        injected: [...document.querySelectorAll(scope.split(', ').map(s => s + ' :is(b, i, u, s, svg, script, iframe)').join(', '))].map(n => n.outerHTML),
        imgs: imgs.map(i => ({ src: i.getAttribute('src'), onerror: i.getAttribute('onerror') })),
        rowText: document.querySelector('#surflog-tbody').innerText,
        drillText: document.querySelector('#reg-drilldown-inner').innerText,
        editIds: [...document.querySelectorAll('#surflog-tbody .sl-edit-btn')].map(b => b.dataset.id)
      };
    });
    log('images:', JSON.stringify(r.imgs));
    assert.equal(r.xss, undefined, 'an injected handler ran');
    assert.deepEqual(r.injected, []);
    // Only the real photo, with its exact (quote-containing) URL, and only the app's own onerror.
    for (const img of r.imgs) {
      assert.equal(img.src, 'https://firebasestorage.test/a" onerror="window.__xss=3');
      assert.equal(img.onerror, "this.style.display='none'");
    }
    assert.ok(r.imgs.length >= 3, 'two table thumbnails + the drill-down photo');
    assert.deepEqual(r.editIds, [OWN.id], 'the hostile id round-trips through data-id');
    assert.ok(r.rowText.includes('<img src=x onerror="window.__xss=1">Bob'), 'displayName shown as text');
    assert.ok(r.rowText.includes('<img src=x onerror=__xss=2>'), 'notes shown as text');
    assert.ok(r.rowText.includes('<i>5</i> mph'), 'wind value shown as text in the detail row');
    assert.ok(r.drillText.includes('Logged by <img src=x onerror="window.__xss=1">Bob'));
    assert.ok(r.drillText.includes('<img src=x onerror="window.__xss=6">'), 'tide stage shown as text');
    await ctx.state(() => closeRegressionDrilldown());
    await page.locator('#surflog-tbody').scrollIntoViewIfNeeded();
    await ctx.screenshot('surflog-hostile');
  }
};
