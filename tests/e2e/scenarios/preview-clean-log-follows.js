// Default look: Explore's ten years (the calendar beside the map) and Methods' follow the surf log. Their page
// (research/index.html) reads the log through the site's own Firebase connection (Explore's copy sits two frames
// down, inside map/), and reads it again when a session is saved, edited or deleted on the site:
//   • a session filed for Monday 28 Sep gets its day a camera (it has a photo), the month counts it, and the day's
//     details show who, when, the ratings and the notes, with the photo, in Explore and in Methods;
//   • an edit shows its new notes; a delete takes it off again;
//   • drawing the log again without a change (opening the Log tab does) reads nothing;
//   • a session on a day the history hasn't reached yet (it runs through yesterday) still gets its dot.
// On the pinned history (through Mon 5 Oct) and fixture day Thu 1 Oct 2026.
'use strict';

const cond = (h, p, d) => ({
  swell: { height: h, period: p, direction: d },
  wind: { speed: 6, direction: 330 },
  tide: { height: 0.8, rate: -0.4, stage: 'falling', timeToNearest: 1.2 },
  source: 'openmeteo-archive'
});
// Bob's Saturday session; the owner (google-1, "Test Surfer") has none yet.
const LOGS = [
  { id: 'bob-1', userId: 'crewB', displayName: 'Bob Crew', timestamp: '2026-09-26T08:00', createdAt: '2026-09-26T08:00',
    ratings: { size: 4, windQuality: 6, rideQuality: 6 }, notes: 'Fun lefts on the push', photos: [], conditions: cond(1.8, 8, 130) }
];
const PHOTO = 'https://firebasestorage.test/monday.jpg';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

module.exports = {
  name: 'clean Explore and Methods follow the surf log: a session filed, edited or deleted shows on the ten years at once',
  options: {
    gate: null,
    viewport: { width: 1180, height: 820 },
    timeoutMs: 150000,
    contextOptions: { reducedMotion: 'reduce' },
    firebase: { mode: 'google', logs: LOGS }
  },
  async run({ page, ctx, assert, log }) {
    // Firestore keeps its docs (the app's writes land where the pages read) and checks each write's owner.
    await ctx.context.addInitScript(() => { window.__FB_RULES = 1; });
    await ctx.route(/firebasestorage\.test/, route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    const explore = () => page.frames().find(f => /research\/index\.html\?view=map/.test(f.url()));
    const methods = () => page.frames().find(f => /research\/index\.html\?view=methods/.test(f.url()));
    // what the ten years show for September 2026 and its 28th
    const cal = (fr) => fr().evaluate(() => {
      const m = document.getElementById('decMonth'), cell = (d) => [...m.querySelectorAll('.dec-d')].find(x => (x.getAttribute('aria-label') || '').startsWith('September ' + d + ':'));
      const c26 = cell(26), c28 = cell(28), day = document.getElementById('decDay');
      return {
        month: (m.querySelector('.dec-mh h3') || {}).textContent || null,
        head: ((m.querySelector('.dec-mh span') || {}).textContent || '').replace(/\s+/g, ' '),
        d26: c26 ? (c26.classList.contains('ph') ? 'photos' : c26.classList.contains('lg') ? 'logged' : '') : null,
        d28: c28 ? (c28.classList.contains('ph') ? 'photos' : c28.classList.contains('lg') ? 'logged' : '') : null,
        day: day ? day.innerText.replace(/\s+/g, ' ') : '',
        strip: [...m.querySelectorAll('.dec-ph .dec-ph-a img')].map(i => i.getAttribute('src'))
      };
    });
    const until = (fr, pred, arg, label) => fr().waitForFunction(pred, arg, { timeout: 15000 }).catch(async (e) => { throw new Error(label + ': ' + e.message + ' · ' + JSON.stringify(await cal(fr))); });

    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready, { label: 'clean look' });
    await ctx.waitForLoad();
    await ctx.waitFor(() => window._fbUserId === 'google-1' && STATE.surfLog.some(e => e.id === 'bob-1'), { label: 'signed in, the crew\'s log loaded' });

    // ── Explore, on Monday 28 Sep (as Methods' "open this day on the map" does) ──
    await ctx.state(() => CLEAN.emit('x-open-map', { date: '2026-09-28' }));
    await ctx.waitFor(() => { const f = document.querySelector('#cl-view-map iframe'); const w = f && f.contentWindow; const r = w && w.document.getElementById('explorerFrame'); const c = r && r.contentWindow && r.contentWindow.CHOC;
      return !!(c && c.trip && c.trip.state.phase === 'past' && c.D[c.st.idx] && c.D[c.st.idx].iso === '2026-09-28'); }, { timeout: 45000, label: 'Explore on 28 Sep' });
    await explore().evaluate(() => CHOC.logLoaded);
    let e = await cal(explore);
    log('explore before', JSON.stringify(e));
    assert.equal(e.month, 'September 2026');
    assert.match(e.head, / · 1 session logged$/);
    assert.equal(e.d26, 'logged', 'Bob\'s Saturday');
    assert.equal(e.d28, '', 'nothing on Monday yet');
    assert.doesNotMatch(e.day, /Logged/);

    // ── Methods, its ten years on September 2026 ──
    await ctx.state(() => CLEAN.show('methods'));
    await ctx.waitFor(() => { const f = document.querySelector('#cl-view-methods iframe'); const c = f && f.contentWindow && f.contentWindow.CHOC; return !!(c && c.logLoaded && f.contentDocument.querySelector('#decHeat svg')); }, { timeout: 45000, label: 'Methods up' });
    await methods().evaluate(async () => {
      await CHOC.logLoaded;
      document.querySelector('#decHeat g.dec-cell[aria-label^="September 2026"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    let m = await cal(methods);
    log('methods before', JSON.stringify(m));
    assert.equal(m.month, 'September 2026');
    assert.match(m.head, / · 1 session logged$/);
    assert.equal(m.d28, '');

    // Count the pages' reads of the log from here on (they read through the site's connection).
    await ctx.state(() => {
      window.__logReads = 0;
      const fs = window.fbFirestore, col = fs.collection;
      fs.collection = function (name) {
        const q = col.call(fs, name);
        if (name === 'surf_logs') { const get = q.get; q.get = function () { window.__logReads++; return get.apply(q, arguments); }; }
        return q;
      };
    });

    // ── Opening the Log tab draws the log again, unchanged: nothing is read ──
    await ctx.state(() => CLEAN.show('log'));
    await page.waitForTimeout(1200);
    await ctx.state(() => CLEAN.show('map'));
    await page.waitForTimeout(800);
    assert.equal(await ctx.state(() => window.__logReads), 0, 'no read when nothing changed');

    // ── The owner files Monday's session, with a photo ──
    const id = await ctx.state(async ({ photo, c }) => {
      await addLogEntry({ timestamp: '2026-09-28T07:30', photos: [photo], ratings: { size: 7, windQuality: 8, rideQuality: 6 }, notes: 'Dawn patrol, chest high sets', conditions: c });
      return STATE.surfLog.find(x => x.timestamp === '2026-09-28T07:30').id;
    }, { photo: PHOTO, c: cond(2.6, 10, 140) });
    await until(explore, () => { const c = [...document.querySelectorAll('#decMonth .dec-d')].find(x => (x.getAttribute('aria-label') || '').startsWith('September 28:')); return c && c.classList.contains('ph'); }, null, 'Explore: Monday gets its camera');
    e = await cal(explore);
    log('explore after', JSON.stringify(e));
    assert.match(e.head, / · 2 sessions logged$/, 'the month counts it');
    assert.equal(e.d28, 'photos');
    assert.match(e.day, /Logged by Test at 7:30 am: rated 7\.0\/10 \(size 7, wind 8, ride 6\)/, 'the day shows who, when and the ratings');
    assert.match(e.day, /Dawn patrol, chest high sets/, 'and the notes');
    assert.deepEqual(e.strip, [PHOTO], 'the month\'s photos');
    await explore().evaluate(() => document.querySelector('#decMonth .dec-cal').scrollIntoView({ block: 'start' }));
    await ctx.screenshot('explore-session-filed');
    await explore().evaluate(() => document.querySelector('#decDay .dec-log').scrollIntoView({ block: 'center' }));
    await ctx.screenshot('explore-session-day');
    await until(methods, () => /2 sessions logged/.test(document.querySelector('#decMonth .dec-mh span').textContent), null, 'Methods counts it');
    m = await cal(methods);
    log('methods after', JSON.stringify(m));
    assert.equal(m.d28, 'photos');
    assert.deepEqual(m.strip, [PHOTO]);
    const reads = await ctx.state(() => window.__logReads);
    log('reads for one save', reads);
    assert.ok(reads >= 2 && reads <= 4, `each page reads the log once or twice for a save (${reads})`);

    // ── An edit ──
    await ctx.state(async (i) => { await updateLogEntry(i, { notes: 'Overhead sets on the push' }); }, id);
    await until(explore, () => /Overhead sets on the push/.test(document.getElementById('decDay').innerText), null, 'Explore shows the edit');

    // ── A delete ──
    await ctx.state(async (i) => { await deleteLogEntry(i); }, id);
    await until(explore, () => /1 session logged/.test(document.querySelector('#decMonth .dec-mh span').textContent), null, 'Explore: back to one session');
    e = await cal(explore);
    log('explore after delete', JSON.stringify(e));
    assert.equal(e.d28, '', 'Monday is clear again');
    assert.doesNotMatch(e.day, /Logged/);
    assert.deepEqual(e.strip, []);
    await until(methods, () => /1 session logged/.test(document.querySelector('#decMonth .dec-mh span').textContent), null, 'Methods: back to one session');

    // ── A day past the end of the history (the pinned copy ends on Mon 5 Oct): no numbers yet, but the session shows ──
    await ctx.state(() => CLEAN.emit('x-open-map', { date: '2026-10-05' }));
    await until(explore, () => (document.querySelector('#decMonth .dec-mh h3') || {}).textContent === 'October 2026', null, 'Explore on October');
    await ctx.state(async (c) => {
      await addLogEntry({ timestamp: '2026-10-06T16:00', photos: [], ratings: { size: 5, windQuality: 6, rideQuality: 5 }, notes: '', conditions: c });
    }, cond(1.9, 9, 150));
    await until(explore, () => [...document.querySelectorAll('#decMonth .dec-d.none.lg')].some(x => x.getAttribute('aria-label') === 'October 6: no buoy history yet, logged' && x.querySelector('.dec-dot')), null, 'Explore: 6 Oct gets its dot');
    assert.deepEqual(await ctx.state(() => CLEAN.errors.map(x => x.where + ': ' + x.message)), []);
  }
};
