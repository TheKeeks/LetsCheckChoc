// Choc TV (audit C34): the kiosk used to run the JS it booted with forever.
// On the 15-min refresh it now compares the deployed code with what it
// booted with and, when it changed, probes the site and reloads. A
// data-only refresh (the bot's 2-hourly commits) must not reload.
'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../../helpers/fixtures');

module.exports = {
  name: 'kiosk: a deploy that changes kiosk.js is picked up on the refresh tick',
  options: { device: 'iPad Pro 11 landscape', gate: null },
  async run({ page, ctx, assert, log }) {
    await ctx.open('/?kiosk=1');
    await ctx.waitForLoad();
    const sig0 = (await ctx.waitFor(() => KIOSK.codeSig, { label: 'boot code signature' })).value;
    await page.evaluate(() => { window.__bootDocument = true; });

    // Refresh with unchanged code: the code files are polled, nothing reloads.
    const polls = () => ctx.requestsTo(/\/kiosk\.js$/).length;
    const before = polls();
    await page.clock.fastForward('15:00');
    await ctx.waitFor(n => !KIOSK.codeBusy && n, { arg: true, label: 'code poll' });
    await page.waitForTimeout(500);
    assert.ok(polls() > before, 'kiosk.js was polled');
    assert.equal(await ctx.state(() => window.__bootDocument === true), true, 'no reload without a code change');
    assert.equal(ctx.requestsTo('probe=').length, 0);

    // Deploy: kiosk.js changes on the server.
    ctx.serve('/kiosk.js', fs.readFileSync(path.join(REPO_ROOT, 'kiosk.js'), 'utf8') + '\n// deploy marker\n');
    await page.clock.fastForward('15:00');
    await ctx.waitFor(() => !window.__bootDocument && typeof KIOSK === 'object' && !!KIOSK.codeSig,
      { timeout: 30000, label: 'page reloaded and re-baselined' });
    const sig1 = await ctx.state(() => KIOSK.codeSig);
    assert.notEqual(sig1, sig0);
    assert.equal(ctx.requestsTo('probe=').length, 1, 'probed the site before reloading');
    const stamp = await ctx.state(() => localStorage.getItem('lcc-kiosk-last-reload'));
    assert.ok(Number(stamp) > 0, 'reload stamped for the 30-min guard');
    await ctx.waitForLoad();
    log(`build ${sig0.slice(0, 7)} → ${sig1.slice(0, 7)}`);
  }
};
