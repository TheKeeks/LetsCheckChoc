// Baseline: Choc TV (?kiosk=1) boots on an iPad-sized viewport and renders
// the day-summary cards from the fixtures.
'use strict';

module.exports = {
  name: 'kiosk (?kiosk=1) boots and renders day cards',
  options: { device: 'iPad Pro 11 landscape', gate: null },   // kiosk.js seeds the gate itself
  async run({ page, ctx, assert, log }) {
    await ctx.open('/?kiosk=1');

    await ctx.waitFor(() => document.body.classList.contains('kiosk'), { label: 'body.kiosk' });
    const loadMs = await ctx.waitForLoad();
    ctx.metric('timeToLoadCompleteMs', loadMs);

    const cards = await ctx.waitFor(() => {
      const p = document.getElementById('kiosk-days-1');
      const days = p ? p.querySelectorAll('.np-day') : [];
      return days.length === 3 && /LOW @/.test(p.innerText) ? [...days].map(d => d.querySelector('.np-day-title').textContent) : null;
    }, { label: 'three day cards with tide lows' });
    assert.deepEqual(cards.value, ['TODAY', 'TOMORROW', 'SATURDAY']);

    // The status strip refreshes on a 1 s tick, so wait for it.
    const { value: status } = await ctx.waitFor(() => {
      const t = (document.getElementById('kiosk-status-updated') || {}).textContent || '';
      return /^updated /.test(t) && t;
    }, { timeout: 5000, label: 'status strip shows "updated …"' });
    const second = await page.$$eval('#kiosk-days-2 .np-day', els => els.length);
    assert.equal(second, 3);
    log(`load complete ${loadMs} ms, status "${status}"`);
    await ctx.screenshot('days1');
  }
};
