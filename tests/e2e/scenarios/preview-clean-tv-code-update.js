// Choc TV, the new look's (?kiosk=1&preview=clean: previews/clean/tv.js on
// kiosk.js's machinery): the iPad at the house runs for weeks under Guided
// Access, so a deploy only reaches it if the TV notices by itself. On each
// 15-min refresh kiosk.js re-signs its code files (KIOSK_CODE_FILES: the page,
// app.js, kiosk.js, … plus the new look's own files, which tv.js adds) and,
// when the deployed code differs from what it booted with, probes the site and
// reloads, stamping lcc-kiosk-last-reload so a half-landed deploy can't
// reload-loop it (no second reload within 30 min). The bots' data commits every
// 2 h must not reload it. Three cases:
//   • unchanged code: the files are polled, no probe, no reload;
//   • kiosk.js changed: probe, reload, stamp, and a new baseline, so the
//     reloaded TV sits still on its next tick;
//   • a deploy that changes only previews/clean/tv.js (the new TV alone): it
//     reloads the same way, on the reloaded TV's second tick, the first one 30
//     min after the last reload, rather than waiting for the nightly 03:30
//     reload.
// Port of w2-kiosk-code-update.js (the classic TV) to the new TV, plus the
// tv.js-only deploy the classic test never had.
'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('../../helpers/fixtures');

const MARKER = '\n// deploy marker\n';
const KIOSK_JS = /\/kiosk\.js$/, TV_JS = /\/previews\/clean\/tv\.js$/;

module.exports = {
  name: 'clean preview Choc TV: a deploy (kiosk.js, or only the new TV’s tv.js) is picked up on the refresh tick',
  options: { device: 'iPad Pro 11 landscape' },
  async run({ page, ctx, assert, log }) {
    // The pinned Sound Check run (made Thu 1 Oct 2026, 10:30 AM), not the copy the bot last shipped.
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    const nodeWait = async (fn, label, timeout = 15000) => {
      const t0 = Date.now();
      while (!fn()) {
        if (Date.now() - t0 > timeout) throw new Error('timed out: ' + label);
        await new Promise(r => setTimeout(r, 50));
      }
    };
    const polls = re => ctx.requestsTo(re).length;
    const probes = () => ctx.requestsTo('probe=').length;
    const stamp = () => ctx.state(() => Number(localStorage.getItem('lcc-kiosk-last-reload')) || 0);
    const cleanErrors = () => ctx.state(() => (CLEAN.errors || []).map(e => e.where + ': ' + e.message));
    // The new TV up with its cards, a load done and the boot signature taken (no poll in flight).
    const tvReady = async label => {
      await ctx.waitForLoad();
      await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.isTV && CLEAN.part('tv') && CLEAN.part('tv').mounted &&
        !CLEAN.part('tv').failed && document.querySelectorAll('#cl-tv [data-panel="cl-days1"] .cl-tv-card').length === 3 &&
        typeof KIOSK === 'object' && !!KIOSK.codeSig && !KIOSK.codeBusy, { timeout: 30000, label });
      return ctx.state(() => KIOSK.codeSig);
    };
    // One 15-min refresh tick with nothing new deployed.
    const quietTick = async what => {
      const k0 = polls(KIOSK_JS), t0 = polls(TV_JS), p0 = probes();
      await page.evaluate(() => { window.__bootDocument = true; });
      await page.clock.fastForward('15:00');
      await nodeWait(() => polls(KIOSK_JS) > k0 && polls(TV_JS) > t0, what + ': kiosk.js and tv.js polled');
      await ctx.waitFor(() => !KIOSK.codeBusy, { label: what + ': code poll done' });
      await page.waitForTimeout(500);
      return { probes: probes() - p0, same: await ctx.state(() => window.__bootDocument === true), sig: await ctx.state(() => KIOSK.codeSig) };
    };
    // A deploy has landed; one 15-min tick, and the TV reloads into the new code.
    const deployTick = async what => {
      await page.evaluate(() => { window.__bootDocument = true; });
      await page.clock.fastForward('15:00');
      await ctx.waitFor(() => !window.__bootDocument && typeof KIOSK === 'object' && !!KIOSK.codeSig,
        { timeout: 30000, label: what + ': page reloaded and re-baselined' });
      return tvReady(what + ': the new TV back after the reload');
    };

    await ctx.open('/?kiosk=1&preview=clean');
    const sig0 = await tvReady('the new TV, its first load and its boot signature');
    const files = await ctx.state(() => KIOSK_CODE_FILES.slice());
    log('signed files', JSON.stringify(files));
    // Not the exact list (it is about to change): only that the new TV's own code is signed.
    assert.ok(files.includes('kiosk.js'), 'kiosk.js is signed');
    assert.ok(files.includes('previews/clean/tv.js'), 'the new TV’s tv.js is signed');

    // ── Refresh with unchanged code (a data-only deploy): polled, no reload ──
    const q0 = await quietTick('unchanged');
    log('unchanged', JSON.stringify(q0));
    assert.equal(q0.probes, 0, 'no probe without a code change');
    assert.equal(q0.same, true, 'no reload without a code change');
    assert.equal(q0.sig, sig0, 'the baseline stays');
    assert.deepEqual(await cleanErrors(), [], 'no CLEAN.errors (first boot)');

    // ── Deploy: kiosk.js changes on the server ──
    ctx.serve('/kiosk.js', fs.readFileSync(path.join(REPO_ROOT, 'kiosk.js'), 'utf8') + MARKER);
    const sig1 = await deployTick('kiosk.js deploy');
    const stamp1 = await stamp();
    log(`kiosk.js deploy: build ${sig0.slice(0, 7)} → ${sig1.slice(0, 7)}`);
    assert.notEqual(sig1, sig0, 'the reloaded TV signed the new kiosk.js');
    assert.equal(probes(), 1, 'probed the site before reloading');
    assert.ok(stamp1 > 0, 'reload stamped for the 30-min guard');

    // ── The reloaded TV took the deploy as its baseline: the next tick is quiet ──
    const q1 = await quietTick('after the reload');
    log('after the reload', JSON.stringify(q1));
    assert.equal(q1.probes, 0, 'no second probe: no reload loop');
    assert.equal(q1.same, true, 'no second reload');
    assert.equal(q1.sig, sig1);
    assert.deepEqual(await cleanErrors(), [], 'no CLEAN.errors (after the kiosk.js reload)');

    // ── Deploy: only the new TV's tv.js changes ──
    ctx.serve('/previews/clean/tv.js', fs.readFileSync(path.join(REPO_ROOT, 'previews', 'clean', 'tv.js'), 'utf8') + MARKER);
    const sig2 = await deployTick('tv.js deploy');
    const stamp2 = await stamp();
    log(`tv.js deploy: build ${sig1.slice(0, 7)} → ${sig2.slice(0, 7)}, ${((stamp2 - stamp1) / 60e3).toFixed(1)} min after the last reload`);
    assert.notEqual(sig2, sig1, 'the reloaded TV signed the new tv.js');
    assert.equal(probes(), 2, 'probed the site before reloading');
    assert.ok(stamp2 - stamp1 >= 30 * 60e3, 'the reload stamp moved on, 30 min or more after the last reload');
    assert.deepEqual(await cleanErrors(), [], 'no CLEAN.errors (after the tv.js reload)');
  }
};
