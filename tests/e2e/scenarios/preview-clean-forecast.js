// Default look, Forecast tab: the Sound Check model, hour by hour, on the
// fixture day (Thu 1 Oct 2026, 11:00 ET) with the model run moved there
// (tests/fixtures/soundcheck/fc.json):
//   • the headline is the height at Choc for 11 AM, the mean of GFS-Wave
//     (0.5 ft) and ECMWF (0.4 ft), with each model under it;
//   • each swell at the buoy and its share of Choc's energy, written
//     "1° 0.5 ft @ 7 s SE 138° → 41% of Choc" with a bar as wide as the
//     share, coloured by where it comes from (SE orange, SSW grey);
//   • the map is the Sound Check map (research/map.html) at the same hour:
//     at Fishers it draws those swells' rays into Choc (landing rays only),
//     labels each swell like its row with its share, and pins Choc; the
//     zoom (Ocean, Region, Fishers) is remembered;
//   • the week scrubber moves the hour (keys, the day jump, a mouse drag)
//     and Now brings it back; the headline, swells and the map's hour follow;
//   • Wilderness switches every reading and is remembered;
//   • the wind and tide for the hour; the buoy check: 44097's 8:30 AM reading
//     (2 ft, stale) against Open-Meteo's forecast for 9 AM made 1, 2 and 3
//     days before (2.4 ft each: on track), and its sub-page with the last
//     two days and how each lead did on average;
//   • on a wide screen the tabs run across the top and the map sits left of
//     the readout.
'use strict';

const sp = s => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = {
  name: 'clean forecast: Sound Check headline and swells with share bars, ray map, week scrubber, Wilderness, buoy check, wide layout',
  options: { gate: null, viewport: { width: 390, height: 844 }, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  async run({ page, ctx, assert, log }) {
    ctx.serve('/research/fc/fc.json', { status: 200, headers: { 'content-type': 'application/json' }, body: ctx.fixture('soundcheck/fc.json') });
    await ctx.state(() => { try { localStorage.removeItem('lcc-f-spot'); } catch (_) { /* fine */ } }).catch(() => {});
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.ready && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok', { label: 'model forecast' });
    await ctx.waitFor(() => CLEAN.forecastInfo().prev === 'ok', { label: 'earlier forecasts at the buoy' });
    await ctx.waitForLoad();
    await ctx.waitFor(() => /mph/.test(document.querySelector('#cl-view-forecast .cl-f-cond').textContent) && /ft/.test(document.querySelector('#cl-view-forecast .cl-f-bc').textContent), { label: 'wind, tide and buoy painted' });

    const read = () => ctx.state(() => {
      const q = s => { const e = document.querySelector('#cl-view-forecast ' + s); return e ? e.textContent : null; };
      return {
        info: CLEAN.forecastInfo(),
        when: q('.cl-f-when'), num: q('.cl-f-num'), unit: q('.cl-f-unit'), models: q('.cl-f-models'),
        rows: [...document.querySelectorAll('#cl-view-forecast .cl-f-tr li')].map(li => ({
          text: (li.querySelector('.cl-f-trt') || li).textContent,
          bar: li.querySelector('.cl-f-bar i') && li.querySelector('.cl-f-bar i').style.width,
          dot: li.querySelector('.cl-f-dot') && getComputedStyle(li.querySelector('.cl-f-dot')).backgroundColor
        })),
        cond: document.querySelector('#cl-view-forecast .cl-f-cond').innerText,
        bc: document.querySelector('#cl-view-forecast .cl-f-bc').innerText,
        bcStale: !!document.querySelector('#cl-view-forecast .cl-f-bc .cl-stale'),
        valuetext: document.querySelector('#cl-view-forecast .cl-f-cx').getAttribute('aria-valuetext'),
        errors: CLEAN.errors.map(e => e.where + ': ' + e.message)
      };
    });

    // the map in its frame (research/map.html): its hour, spot, zoom and what it drew
    const mf = () => page.frames().find(f => /research\/map\.html/.test(f.url()));
    const mapAt = (t, spot) => mf().waitForFunction(([tt, ss]) => {
      const f = window.CHOC && CHOC.trip && CHOC.trip.fc; return !!(f && f.d && Date.parse(f.d.gfs[f.i].t) === tt && f.spot === ss && f.rayCount > 0);
    }, [t, spot], { timeout: 20000 });
    const mapState = () => mf().evaluate(() => {
      const f = CHOC.trip.fc, cv = document.getElementById('tripCv'), p = CHOC.trip._screen(-71.96339, 41.27557), k = cv.width / cv.clientWidth;
      const pin = Array.from(cv.getContext('2d').getImageData(Math.round(p[0] * k), Math.round(p[1] * k), 1, 1).data.slice(0, 3));
      return { t: Date.parse(f.d.gfs[f.i].t), spot: f.spot, W: CHOC.trip.state.cam.W, tags: f.rayTags, rays: f.rayCount, note: f.note, pin, label: f.spotLabel };
    });

    // ── 11 AM at Choc ──
    let r = await read();
    log('now', JSON.stringify(r));
    assert.equal(sp(r.when), 'Thu 11 AMnow');
    assert.equal(r.info.mode, 'now');
    assert.equal(r.num, '0.5', 'the mean of GFS-Wave 0.5 and ECMWF 0.4 ft');
    assert.equal(sp(r.unit), 'ft at Choc');
    assert.equal(sp(r.models), 'GFS-Wave 0.5 · ECMWF 0.4 ft');
    assert.deepEqual(r.rows.map(x => sp(x.text)), [
      '1° 0.5 ft @ 7 s SE 138° → 41% of Choc',
      '2° 0.5 ft @ 8 s SE 124° → 41% of Choc',
      '3° 1.5 ft @ 5 s SSW 205° → 18% of Choc'
    ], 'swells at the buoy, biggest share of Choc first; the wind sea that reaches nothing is left out');
    assert.deepEqual(r.rows.map(x => x.bar), ['41%', '41%', '18%'], 'bars as wide as the share');
    assert.deepEqual(r.rows.map(x => x.dot), ['rgb(240, 138, 75)', 'rgb(240, 138, 75)', 'rgb(140, 154, 168)'], 'SE orange; SSW (205°) grey');
    // the map: the Sound Check map at the same hour; at Fishers each swell's landing rays, labelled like its row
    await ctx.waitFor(() => CLEAN.forecastInfo().map.status === 'ready', { label: 'the map' });
    assert.equal(r.info.map.zoom, 'reg', 'the map opens on the region');
    await page.locator('#cl-view-forecast .cl-f-zseg button[data-zoom="fi"]').click();
    await mapAt(r.info.t, 'choc');
    let m = await mapState();
    log('map at Fishers', JSON.stringify(m));
    assert.ok(m.W < 160, 'Fishers zoom');
    assert.deepEqual(m.tags.map(sp), ['3° 1.5 ft @ 5 s SSW · 18%', '2° 0.5 ft @ 8 s SE · 41%', '1° 0.5 ft @ 7 s SE · 41%'], 'each swell labelled like its row, with its share (biggest drawn last)');
    assert.ok(m.rays > 50, `landing rays drawn (${m.rays})`);
    assert.equal(m.note, '');
    assert.ok(m.pin[0] > 220 && m.pin[1] > 110 && m.pin[1] < 165 && m.pin[2] < 110, `Choc pinned at its place (${m.pin})`);
    assert.equal(m.label, 'Choc 0.5 ft', 'the map\'s Choc carries the headline\'s number');
    assert.match(sp(r.cond), /^Wind 7 mph SW, cross-shore · gusts 11 Tide 2\.3 ft ▲ · high 1:37 PM$/);
    assert.equal(sp(r.bc), 'Buoy 44097 2 ft all waves · 8:30 AM forecasts on track Forecast for 9 AM, made 1 · 2 · 3 days before: 2.4 · 2.4 · 2.4 ft');
    assert.ok(r.bcStale, 'a 2.5 h old reading is marked stale');
    assert.equal(sp(r.valuetext), 'Thu 11 AM, 0.5 ft at Choc');
    await ctx.screenshot('forecast-phone', { fullPage: true });

    // ── A day later with the keys; the map and swells follow ──
    await page.locator('#cl-view-forecast .cl-f-cx').focus();
    await page.keyboard.press('PageUp');
    r = await read();
    log('PageUp', JSON.stringify(r));
    assert.equal(sp(r.when), 'Fri 11 AM', 'one day on, no "now"');
    assert.equal(r.info.mode, 'pick');
    assert.equal(r.num, '0.3', 'GFS-Wave 0.6 and ECMWF 0 ft');
    assert.equal(sp(r.rows[0].text), '1° 1 ft @ 8 s SE 140° → 97% of Choc');
    assert.match(sp(r.rows[1].text), /^2° 1\.9 ft @ \d s N 351° wind sea → 3% of Choc$/);
    await mapAt(r.info.t, 'choc');
    m = await mapState();
    assert.equal(sp(m.tags[m.tags.length - 1]), '1° 1 ft @ 8 s SE · 97%', 'the map follows to the same hour');
    await page.keyboard.press('End');
    r = await read();
    assert.equal(sp(r.when), 'Thu 8 Oct, 8 AM', 'a week out the date comes along');
    await page.keyboard.press('ArrowLeft');
    assert.equal(sp((await read()).when), 'Thu 8 Oct, 2 AM', 'late in the run the steps are 6 h apart');
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();
    r = await read();
    assert.equal(sp(r.when), 'Thu 11 AMnow', 'Now');
    assert.equal(r.info.mode, 'now');
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="day"]').click();
    assert.equal(sp((await read()).when), 'Fri 11 AM', 'day »');
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="-1"]').click();
    assert.equal(sp((await read()).when), 'Fri 8 AM', '‹ one step');
    for (let k = 0; k < 4; k++) await page.locator('#cl-view-forecast .cl-f-jb[data-j="day"]').click();
    assert.equal(sp((await read()).when), 'Tue 8 AM', 'day » four times');
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="day"]').click();
    assert.equal(sp((await read()).when), 'Wed 8 AM', 'day » where the steps are 6 h apart');
    await page.locator('#cl-view-forecast .cl-f-jb[data-j="now"]').click();

    // ── Wilderness: every reading switches, and it is remembered ──
    await page.locator('#cl-view-forecast .cl-f-seg button[data-spot="wild"]').click();
    r = await read();
    log('Wilderness', JSON.stringify(r));
    assert.equal(sp(r.unit), 'ft at Wilderness');
    assert.equal(sp(r.models), 'GFS-Wave 0.4 · ECMWF 0.3 ft');
    assert.ok(r.rows.length >= 1 && r.rows.every(x => / of Wilderness$/.test(sp(x.text))), 'shares of Wilderness');
    assert.equal(r.info.spot, 'wild');
    await mapAt(r.info.t, 'wild');
    m = await mapState();
    assert.ok(m.rays > 0 && m.tags.every(t => /%$/.test(t)), 'Wilderness rays on the map');
    assert.equal(await page.getAttribute('#cl-view-forecast .cl-f-seg button[data-spot="wild"]', 'aria-pressed'), 'true');
    await ctx.screenshot('forecast-wilderness');
    await ctx.open('/?preview=clean');
    await ctx.waitFor(() => window.CLEAN && CLEAN.forecastInfo && CLEAN.forecastInfo().fc === 'ok', { label: 'reloaded' });
    assert.equal((await read()).info.spot, 'wild', 'Wilderness remembered across a reload');
    assert.equal((await read()).info.map.zoom, 'fi', 'and the map\'s zoom');
    assert.equal(await page.getAttribute('#cl-view-forecast .cl-f-zseg button[data-zoom="fi"]', 'aria-pressed'), 'true');
    await page.locator('#cl-view-forecast .cl-f-seg button[data-spot="choc"]').click();
    assert.equal(sp((await read()).unit), 'ft at Choc');
    await ctx.waitFor(() => CLEAN.forecastInfo().prev === 'ok', { label: 'earlier forecasts again' });

    // ── Buoy check: the last two days ──
    await page.locator('#cl-view-forecast .cl-f-bc').click();
    await ctx.waitFor(() => document.querySelector('#cl-sub-buoycheck .cl-f-obs') && CLEAN.forecastInfo().verif === 'ok', { label: 'buoy check sub-page' });
    await page.waitForTimeout(200);
    const sheet = await ctx.state(() => ({
      title: document.querySelector('#cl-sub-buoycheck h1') && document.querySelector('#cl-sub-buoycheck h1').textContent,
      dots: document.querySelectorAll('#cl-sub-buoycheck .cl-f-obs').length,
      lines: ['.cl-f-l1', '.cl-f-l2', '.cl-f-l3'].map(c => document.querySelectorAll('#cl-sub-buoycheck ' + c).length),
      rows: [...document.querySelectorAll('#cl-sub-buoycheck .cl-sr')].map(e => e.innerText)
    }));
    log('buoy check', JSON.stringify(sheet));
    assert.equal(sheet.title, 'Buoy vs earlier forecasts');
    assert.ok(sheet.dots >= 6, `buoy readings over two days (${sheet.dots})`);
    assert.deepEqual(sheet.lines.map(n => n > 0), [true, true, true], 'a line for each lead');
    assert.deepEqual(sheet.rows.map(sp), [
      '1 day before 8 hours compared +0.4 ft (17% high)',
      '2 days before 8 hours compared +0.4 ft (17% high)',
      '3 days before 8 hours compared +0.3 ft (15% high)'
    ], 'how each lead did against the buoy');
    await ctx.screenshot('forecast-buoycheck');
    await page.keyboard.press('Escape');
    await ctx.waitFor(() => !document.querySelector('#cl-sub-buoycheck'), { label: 'sub-page closed' });

    // ── Dark theme: the chart and readout follow the tokens (the map is imagery, dark in both) ──
    await ctx.state(() => CLEAN.setThemeMode('dark'));
    await ctx.waitFor(() => CLEAN.theme() === 'night', { label: 'dark theme' });
    await page.waitForTimeout(500);
    await ctx.screenshot('forecast-dark');
    await ctx.state(() => CLEAN.setThemeMode('light'));
    await ctx.waitFor(() => CLEAN.theme() === 'day', { label: 'light again' });

    // ── Wide screen: tabs on top, map left of the readout; a mouse drag scrubs ──
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(400);
    const lay = await ctx.state(() => {
      const R = s => document.querySelector(s).getBoundingClientRect();
      return { tabs: R('#cl-app .cl-tabs').top, tabsH: R('#cl-app .cl-tabs').height, map: R('#cl-view-forecast .cl-f-map'), head: R('#cl-view-forecast .cl-f-head'), wk: R('#cl-view-forecast .cl-f-wk') };
    });
    log('wide', JSON.stringify(lay));
    assert.equal(Math.round(lay.tabs), 0, 'the tab bar runs across the top');
    assert.ok(lay.map.right <= lay.head.left, 'the map sits left of the readout');
    assert.ok(lay.wk.top >= lay.map.bottom - 1 && lay.wk.width > 1000, 'the week runs underneath, full width');
    await ctx.screenshot('forecast-wide');
    const box = await page.locator('#cl-view-forecast .cl-f-cx').boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + 60, { steps: 4 });
    await page.mouse.up();
    r = await read();
    log('dragged', JSON.stringify(r.info));
    assert.equal(r.info.mode, 'pick');
    assert.ok(r.info.step > 20 && r.info.step < 30, `the drag lands mid-week (step ${r.info.step})`);
    assert.deepEqual(r.errors, [], 'CLEAN.errors');
  }
};
