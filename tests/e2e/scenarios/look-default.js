// One look, the approved "A refined" design (previews/clean/): the plain address and Choc TV's ?kiosk=1 open it, and
// the old look is gone with its code. Nothing from it downloads (no Win95 sheets, fonts, Leaflet maps or the old
// lineup picture), its URL parameters open the new look, and Settings offers nothing else.
// When the look can't start (its scripts failed to load or to mount), index.html's own "didn't start" card covers
// the screen instead of a blank page: Reload on a phone; on Choc TV a line saying it tries again by itself, and
// kiosk.js does (a minute later, then every 5 min, behind its reload guards), so a fixed deploy or a network that
// came back brings the TV at the house back without a hand.
'use strict';

const PHONE = { width: 390, height: 844 };
// what the old look used to download
const OLD = ['styles-web1', 'styles-retro', 'styles-kiosk', 'leaflet', 'family=Libre+Baskerville', 'ms_sans_serif', 'Orbitron', 'DSEG', 'lineup.jpg'];

module.exports = {
  name: 'default look: the plain address and Choc TV open the one look with nothing of the old; a look that can\'t start shows its card, and the TV retries',
  options: {
    viewport: PHONE,
    contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
  },
  async run({ page, ctx, assert, log }) {
    const since = r0 => ctx.requests.slice(r0).map(r => r.url);
    const old = urls => OLD.filter(f => urls.some(u => u.includes(f)));
    const card = () => ctx.state(() => {
      const c = document.getElementById('lcc-down');
      const b = c && c.querySelector('button');
      return {
        shown: !!c && getComputedStyle(c).display !== 'none',
        text: c ? c.innerText.replace(/\s+/g, ' ').trim() : '',
        reload: !!b && getComputedStyle(b).display !== 'none'
      };
    });

    // ── Phone, plain address, exactly as a visitor types it ──
    const r0 = ctx.requests.length;
    await ctx.open('/');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'the look up on the plain address' });
    await ctx.waitForChart();
    await page.waitForTimeout(500);
    let got = since(r0);
    assert.ok(got.some(u => u.includes('/previews/clean/theme.css')) && got.some(u => u.includes('/previews/clean/core.js')), 'its files load');
    assert.deepEqual(old(got), [], 'nothing of the old look');
    assert.ok(got.some(u => /\/style\.css$/.test(u)), 'style.css still loads (toasts, the borrowed rating charts)');
    assert.equal((await card()).shown, false, 'no "didn\'t start" card on a page that started');
    const links = await ctx.state(() => {
      CLEAN.openSettings();
      return [...document.querySelectorAll('a')].filter(x => /classic/i.test(x.textContent) || /classic=1/.test(x.getAttribute('href') || '')).map(a => a.textContent);
    });
    assert.deepEqual(links, [], 'no "Open the classic view" in Settings');

    // ── The old look's and the retired candidates' URLs open the one look ──
    for (const q of ['classic=1', 'preview=clean', 'preview=draft-paper', 'preview=../../secrets']) {
      const r1 = ctx.requests.length;
      await ctx.open('/?' + q);
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: q + ': the look' });
      got = since(r1);
      assert.deepEqual(old(got), [], q + ': nothing of the old look');
      assert.deepEqual(got.filter(u => u.includes('/previews/') && !u.includes('/previews/clean/')), [], q + ': nothing else fetched');
    }

    // ── A look that can't start: the card, with Reload ──
    ctx.serve('/previews/clean/core.js', { status: 200, headers: { 'content-type': 'text/javascript' }, body: 'throw new Error("not this time")' });
    ctx.allowPageError(/not this time/);
    await ctx.open('/');
    await ctx.waitFor(() => document.documentElement.classList.contains('lcc-down'), { label: 'the down card', timeout: 15000 });
    const phone = await card();
    log('phone, core.js broken', JSON.stringify(phone));
    assert.ok(phone.shown && phone.reload, 'the card shows, with Reload');
    assert.match(phone.text, /LetsCheckChoc didn’t start/);
    assert.doesNotMatch(phone.text, /tries again by itself/, 'the TV line is the TV\'s');
    await ctx.screenshot('down-phone');
    ctx.serve('/previews/clean/core.js', undefined);

    // ── Choc TV: ?kiosk=1 opens the new TV, with nothing of the old ──
    await page.setViewportSize({ width: 1180, height: 820 });
    const r3 = ctx.requests.length;
    await ctx.open('/?kiosk=1');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && document.getElementById('cl-tv'), { label: 'Choc TV up' });
    await ctx.waitFor(() => document.querySelectorAll('#cl-tv .cl-tv-card').length >= 3, { label: 'TV day cards', timeout: 15000 });
    assert.deepEqual(old(since(r3)), [], 'Choc TV loads nothing of the old look, its TV styles included');

    // ── Choc TV whose screen (tv.js) never loads: the card, then a reload by itself once the fix is up ──
    ctx.serve('/previews/clean/tv.js', { status: 200, headers: { 'content-type': 'text/javascript' }, body: '/* not this time */' });
    await ctx.open('/?kiosk=1');
    await ctx.waitFor(() => document.documentElement.classList.contains('lcc-down'), { label: 'the TV down card', timeout: 15000 });
    const tv = await card();
    log('tv, tv.js missing', JSON.stringify(tv));
    assert.ok(tv.shown, 'the card covers the TV, never a blank screen');
    assert.equal(tv.reload, false, 'no button to tap on the TV');
    assert.match(tv.text, /Choc TV tries again by itself/);
    await ctx.screenshot('down-tv');
    await ctx.state(() => { window.__bootDocument = true; });
    ctx.serve('/previews/clean/tv.js', undefined);   // the fix lands
    // kiosk.js's 1 Hz tick notes the card and sets its first retry a minute out; a clock jump fires a timer once
    await ctx.waitFor(() => KIOSK.downNextTry > 0, { label: 'kiosk.js saw the card' });
    assert.equal(ctx.requestsTo(/[?&]probe=/).length, 0, 'no retry before the minute is up');
    await page.clock.fastForward('01:05');
    await ctx.waitFor(() => !window.__bootDocument && window.CLEAN && CLEAN.ready && CLEAN.part('tv') && CLEAN.part('tv').mounted,
      { label: 'the TV reloaded into a working screen', timeout: 20000 });
    assert.equal((await card()).shown, false, 'and the card is gone');
    assert.ok(ctx.requestsTo(/[?&]probe=/).length >= 1, 'it reloaded only after the probe answered');
    await page.setViewportSize(PHONE);
  }
};
